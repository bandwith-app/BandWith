import Foundation
import Capacitor
import CoreBluetooth
import CryptoKit

/// Stage mode over Bluetooth, leader side: the band admin's phone becomes a
/// Bluetooth LE peripheral with one service (UUID derived from the gig's
/// key, see `src/lib/stageBle.ts`) and one characteristic:
/// - read: the full state (long reads are served by offset);
/// - notify: a short value (the seq); subscribers then read the full state.
/// No encryption is required, so members connect without pairing. The JS
/// side signs every value; this state (version 2) carries an HMAC with the
/// band key, kept for apps from before signed states.
///
/// Members' phones use @capacitor-community/bluetooth-le (central role).
///
/// More characteristics, for members on this app (`src/lib/stageBleSync.ts`):
/// - signed state (read + notify, `signedUuid`): the same state signed with
///   the gig's private key, which only admins get (version 4, audit #1);
/// - clock (read only, `clockUuid`): every read is answered at once with
///   this phone's clock at that moment, signed here with `signKey`
///   (ECDSA P-256, PKCS#8 base64); both only when `signKey` is given;
/// - live (read + notify, `liveUuid`): the click and the playhead (B3).
/// Reads, not writes: a member's write in flight can crash its app on Android
/// when Bluetooth turns off; reads fail cleanly. Apps from before them never
/// look at these characteristics.
///
/// JS: `StageBle.start({ serviceUuid, characteristicUuid, value, notify,
/// clockUuid?, liveUuid?, signedUuid?, signKey? })`, `update({ value, notify })`,
/// `updateSigned({ value, notify })`, `updateLive({ value, notify })`,
/// `now()` → `{ now }` (this plugin's clock, ms), `setClock({ offset })` (the
/// app's clock minus this plugin's, so clock reads carry the app's clock),
/// `stop()` (values base64), and the `stateChange` event
/// `{ state, subscribers }` with state on | off | unauthorized | unsupported
/// | unknown (subscribers: phones following, on either state).
@objc(StageBlePlugin)
public class StageBlePlugin: CAPPlugin, CAPBridgedPlugin, CBPeripheralManagerDelegate {
    public let identifier = "StageBlePlugin"
    public let jsName = "StageBle"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateLive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateSigned", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "now", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setClock", returnType: CAPPluginReturnPromise),
    ]

    private var manager: CBPeripheralManager?
    private var serviceUUID: CBUUID?
    private var characteristicUUID: CBUUID?
    private var characteristic: CBMutableCharacteristic?
    private var serviceAdded = false
    private var value = Data()
    private var notifyValue = Data()
    private var subscribers: [CBCentral] = []
    private var notifyPending = false

    // Clock and live characteristics (frame version 3), signed state (version 4).
    private var clockUUID: CBUUID?
    private var liveUUID: CBUUID?
    private var signedUUID: CBUUID?
    private var liveCharacteristic: CBMutableCharacteristic?
    private var signedCharacteristic: CBMutableCharacteristic?
    private var signKey: P256.Signing.PrivateKey?
    /// Each phone's last clock answer, for a read continued at an offset (a small MTU).
    private var lastClock: [UUID: Data] = [:]
    private var signedValue = Data()
    private var signedNotifyValue = Data()
    private var signedSubscribers: [CBCentral] = []
    private var signedPending = false
    private var liveValue = Data()
    private var liveNotifyValue = Data()
    private var liveSubscribers: [CBCentral] = []
    private var livePending = false
    /// The app's clock minus `clockMs()` (set by the app, see `setClock`).
    private var clockOffset: Double = 0

    @objc func start(_ call: CAPPluginCall) {
        guard let service = call.getString("serviceUuid"), let char = call.getString("characteristicUuid"),
              let value = Data(base64Encoded: call.getString("value") ?? ""),
              let notify = Data(base64Encoded: call.getString("notify") ?? "")
        else {
            call.reject("serviceUuid, characteristicUuid, value and notify are required")
            return
        }
        DispatchQueue.main.async {
            let newService = CBUUID(string: service)
            if self.serviceUUID != newService { self.teardown() }
            self.serviceUUID = newService
            self.characteristicUUID = CBUUID(string: char)
            self.value = value
            self.notifyValue = notify
            // CryptoKit reads the PKCS#8 that WebCrypto exports.
            let key = Data(base64Encoded: call.getString("signKey") ?? "")
                .flatMap { try? P256.Signing.PrivateKey(derRepresentation: $0) }
            let newClock = key == nil ? nil : call.getString("clockUuid").map { CBUUID(string: $0) }
            let newSigned = key == nil ? nil : call.getString("signedUuid").map { CBUUID(string: $0) }
            let newLive = call.getString("liveUuid").map { CBUUID(string: $0) }
            if (self.clockUUID != newClock || self.liveUUID != newLive || self.signedUUID != newSigned) && self.serviceAdded {
                self.teardown()
            }
            self.clockUUID = newClock
            self.signedUUID = newSigned
            self.liveUUID = newLive
            self.signKey = key
            if self.manager == nil {
                // Creating the manager shows the Bluetooth permission prompt the first time.
                self.manager = CBPeripheralManager(delegate: self, queue: nil)
            } else {
                self.setUpIfReady()
            }
            call.resolve(["state": self.stateName()])
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard let value = Data(base64Encoded: call.getString("value") ?? ""),
              let notify = Data(base64Encoded: call.getString("notify") ?? "")
        else {
            call.reject("value and notify are required")
            return
        }
        DispatchQueue.main.async {
            self.value = value
            self.notifyValue = notify
            self.sendNotify()
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.teardown()
            self.serviceUUID = nil
            self.clockUUID = nil
            self.liveUUID = nil
            self.signedUUID = nil
            self.signKey = nil
            self.lastClock = [:]
            self.liveValue = Data()
            self.liveNotifyValue = Data()
            self.signedValue = Data()
            self.signedNotifyValue = Data()
            call.resolve()
        }
    }

    /// Live characteristic: the value reads get, and a notice for its subscribers (empty: none).
    @objc func updateLive(_ call: CAPPluginCall) {
        guard let value = Data(base64Encoded: call.getString("value") ?? ""),
              let notify = Data(base64Encoded: call.getString("notify") ?? "")
        else {
            call.reject("value and notify are required")
            return
        }
        DispatchQueue.main.async {
            self.liveValue = value
            self.liveNotifyValue = notify
            if !notify.isEmpty { self.sendLive() }
            call.resolve()
        }
    }

    /// Signed state: the value reads get, and a notice for its subscribers (empty: none).
    @objc func updateSigned(_ call: CAPPluginCall) {
        guard let value = Data(base64Encoded: call.getString("value") ?? ""),
              let notify = Data(base64Encoded: call.getString("notify") ?? "")
        else {
            call.reject("value and notify are required")
            return
        }
        DispatchQueue.main.async {
            self.signedValue = value
            self.signedNotifyValue = notify
            if !notify.isEmpty { self.sendSigned() }
            call.resolve()
        }
    }

    @objc func now(_ call: CAPPluginCall) {
        call.resolve(["now": StageBlePlugin.clockMs()])
    }

    @objc func setClock(_ call: CAPPluginCall) {
        guard let offset = call.getDouble("offset"), offset.isFinite else {
            call.reject("offset is required")
            return
        }
        DispatchQueue.main.async {
            self.clockOffset = offset
            call.resolve()
        }
    }

    // MARK: - Clock

    /// Monotonic, ms (doesn't jump when the wall clock is set).
    static func clockMs() -> Double {
        Double(clock_gettime_nsec_np(CLOCK_UPTIME_RAW)) / 1_000_000
    }

    /// Clock answer stamped `t1` (the app's clock, ms), 72 bytes: see stageBleSync.ts.
    /// ECDSA signatures differ every time: stageBleSync.test.ts checks a frame made here.
    static func clockFrame(t1: Double, key: P256.Signing.PrivateKey) -> Data {
        let ticks = UInt64((t1 * 10).rounded())
        var body = Data([3, 2])
        body.append(UInt8((ticks >> 40) & 0xff))
        body.append(UInt8((ticks >> 32) & 0xff))
        body.append(UInt8((ticks >> 24) & 0xff))
        body.append(UInt8((ticks >> 16) & 0xff))
        body.append(UInt8((ticks >> 8) & 0xff))
        body.append(UInt8(ticks & 0xff))
        // r‖s, 64 bytes (WebCrypto's form).
        if let sig = try? key.signature(for: body) { body.append(sig.rawRepresentation) }
        return body
    }

    // MARK: - Peripheral

    private func stateName() -> String {
        switch manager?.state {
        case .poweredOn: return "on"
        case .poweredOff: return "off"
        case .unauthorized: return "unauthorized"
        case .unsupported: return "unsupported"
        default: return "unknown"
        }
    }

    /// Phones following: on the older state, the signed one, or both (counted once).
    private func followerCount() -> Int {
        Set(subscribers.map { $0.identifier } + signedSubscribers.map { $0.identifier }).count
    }

    private func emitState() {
        notifyListeners("stateChange", data: ["state": stateName(), "subscribers": followerCount()])
    }

    private func teardown() {
        manager?.stopAdvertising()
        manager?.removeAllServices()
        characteristic = nil
        liveCharacteristic = nil
        signedCharacteristic = nil
        serviceAdded = false
        subscribers.removeAll()
        liveSubscribers.removeAll()
        signedSubscribers.removeAll()
        lastClock = [:]
        notifyPending = false
        livePending = false
        signedPending = false
    }

    private func setUpIfReady() {
        guard let manager = manager, manager.state == .poweredOn, !serviceAdded,
              let serviceUUID = serviceUUID, let characteristicUUID = characteristicUUID
        else { return }
        // Value nil: reads come to the delegate, so they always get the latest state.
        let char = CBMutableCharacteristic(type: characteristicUUID, properties: [.read, .notify], value: nil, permissions: [.readable])
        let service = CBMutableService(type: serviceUUID, primary: true)
        service.characteristics = [char]
        if signKey != nil {
            if let clockUUID = clockUUID {
                // Value nil: every read comes to the delegate, stamped there.
                service.characteristics?.append(CBMutableCharacteristic(type: clockUUID, properties: [.read], value: nil, permissions: [.readable]))
            }
            if let signedUUID = signedUUID {
                let signed = CBMutableCharacteristic(type: signedUUID, properties: [.read, .notify], value: nil, permissions: [.readable])
                service.characteristics?.append(signed)
                signedCharacteristic = signed
            }
        }
        if let liveUUID = liveUUID {
            let live = CBMutableCharacteristic(type: liveUUID, properties: [.read, .notify], value: nil, permissions: [.readable])
            service.characteristics?.append(live)
            liveCharacteristic = live
        }
        characteristic = char
        serviceAdded = true
        manager.add(service)
    }

    private func sendLive() {
        guard let manager = manager, let char = liveCharacteristic, !liveSubscribers.isEmpty, !liveNotifyValue.isEmpty else { return }
        livePending = !manager.updateValue(liveNotifyValue, for: char, onSubscribedCentrals: nil)
    }

    private func sendSigned() {
        guard let manager = manager, let char = signedCharacteristic, !signedSubscribers.isEmpty, !signedNotifyValue.isEmpty else { return }
        signedPending = !manager.updateValue(signedNotifyValue, for: char, onSubscribedCentrals: nil)
    }

    private func sendNotify() {
        guard let manager = manager, let char = characteristic, !subscribers.isEmpty else { return }
        notifyPending = !manager.updateValue(notifyValue, for: char, onSubscribedCentrals: nil)
    }

    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if peripheral.state == .poweredOn {
            setUpIfReady()
        } else {
            // Services are dropped when Bluetooth goes off; add them again when it's back.
            serviceAdded = false
            characteristic = nil
            liveCharacteristic = nil
            signedCharacteristic = nil
            subscribers.removeAll()
            liveSubscribers.removeAll()
            signedSubscribers.removeAll()
        }
        emitState()
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if error != nil {
            serviceAdded = false
            emitState()
            return
        }
        // iOS advertises only service UUIDs and a local name (no data); in the
        // background the UUID moves to the overflow area.
        peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [service.uuid]])
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
        // Stamped first, before any other work: the member's round trip brackets this moment.
        let t1 = StageBlePlugin.clockMs() + clockOffset
        let current: Data
        if request.characteristic.uuid == characteristicUUID {
            current = value
        } else if let clockUUID = clockUUID, request.characteristic.uuid == clockUUID, let key = signKey {
            let who = request.central.identifier
            if request.offset == 0 { lastClock[who] = StageBlePlugin.clockFrame(t1: t1, key: key) }
            current = lastClock[who] ?? Data()
        } else if let signedUUID = signedUUID, request.characteristic.uuid == signedUUID {
            current = signedValue
        } else if let liveUUID = liveUUID, request.characteristic.uuid == liveUUID {
            current = liveValue
        } else {
            peripheral.respond(to: request, withResult: .attributeNotFound)
            return
        }
        if request.offset > current.count {
            peripheral.respond(to: request, withResult: .invalidOffset)
            return
        }
        request.value = current.subdata(in: request.offset..<current.count)
        peripheral.respond(to: request, withResult: .success)
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
        if let liveUUID = liveUUID, characteristic.uuid == liveUUID {
            if !liveSubscribers.contains(where: { $0.identifier == central.identifier }) { liveSubscribers.append(central) }
            sendLive()
            return
        }
        if let signedUUID = signedUUID, characteristic.uuid == signedUUID {
            if !signedSubscribers.contains(where: { $0.identifier == central.identifier }) { signedSubscribers.append(central) }
            sendSigned()
            emitState()
            return
        }
        if !subscribers.contains(where: { $0.identifier == central.identifier }) { subscribers.append(central) }
        sendNotify()
        emitState()
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
        if let liveUUID = liveUUID, characteristic.uuid == liveUUID {
            liveSubscribers.removeAll { $0.identifier == central.identifier }
            return
        }
        lastClock[central.identifier] = nil
        if let signedUUID = signedUUID, characteristic.uuid == signedUUID {
            signedSubscribers.removeAll { $0.identifier == central.identifier }
            emitState()
            return
        }
        subscribers.removeAll { $0.identifier == central.identifier }
        emitState()
    }

    public func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        if notifyPending { sendNotify() }
        if livePending { sendLive() }
        if signedPending { sendSigned() }
    }
}

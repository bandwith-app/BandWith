import Foundation
import Capacitor
import CoreBluetooth
import CryptoKit

/// Stage mode over Bluetooth, leader side: the band admin's phone becomes a
/// Bluetooth LE peripheral with one service (UUID derived from the gig's
/// key, see `src/lib/stageBle.ts`) and one characteristic:
/// - read: the full state (long reads are served by offset);
/// - notify: a short value (the seq); subscribers then read the full state.
/// No encryption is required, so members connect without pairing; every
/// state carries an HMAC that only band members can make.
///
/// Members' phones use @capacitor-community/bluetooth-le (central role).
///
/// A second characteristic, "sync" (read + write + notify, optional: only
/// when `syncUuid` and `key` are given), carries the leader's clock for
/// members with no internet (`src/lib/stageBleSync.ts`, frame version 3):
/// a member writes a 4-byte ping, and this phone answers that member at once
/// with an 18-byte signed pong holding its clock when the ping arrived. Apps
/// from before it never look at this characteristic.
///
/// JS: `StageBle.start({ serviceUuid, characteristicUuid, value, notify,
/// syncUuid?, key? })`, `update({ value, notify })`, `updateSync({ value,
/// notify })`, `now()` → `{ now }` (this plugin's clock, ms), `setClock({
/// offset })` (the app's clock minus this plugin's, so pongs carry the app's
/// clock), `stop()` (values base64), and the `stateChange` event `{ state,
/// subscribers }` with state on | off | unauthorized | unsupported | unknown.
@objc(StageBlePlugin)
public class StageBlePlugin: CAPPlugin, CAPBridgedPlugin, CBPeripheralManagerDelegate {
    public let identifier = "StageBlePlugin"
    public let jsName = "StageBle"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateSync", returnType: CAPPluginReturnPromise),
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

    // Sync characteristic (clock, frame version 3).
    private var syncUUID: CBUUID?
    private var syncCharacteristic: CBMutableCharacteristic?
    private var key = Data()
    private var syncValue = Data()
    private var syncSubscribers: [CBCentral] = []
    /// Notifications iOS couldn't queue yet (sent again when it's ready).
    private var syncQueue: [(Data, [CBCentral]?)] = []
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
            if let sync = call.getString("syncUuid"), let key = Data(base64Encoded: call.getString("key") ?? ""), !key.isEmpty {
                let newSync = CBUUID(string: sync)
                if self.syncUUID != newSync && self.serviceAdded { self.teardown() }
                self.syncUUID = newSync
                self.key = key
            }
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
            self.syncUUID = nil
            self.key = Data()
            self.syncValue = Data()
            call.resolve()
        }
    }

    /// Sync characteristic: the value reads get, and a notice for its subscribers (empty: none).
    @objc func updateSync(_ call: CAPPluginCall) {
        guard let value = Data(base64Encoded: call.getString("value") ?? ""),
              let notify = Data(base64Encoded: call.getString("notify") ?? "")
        else {
            call.reject("value and notify are required")
            return
        }
        DispatchQueue.main.async {
            self.syncValue = value
            if !notify.isEmpty { self.sendSync(notify, to: nil) }
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

    /// Pong for ping `nonce`, stamped `t1` (the app's clock, ms): see stageBleSync.ts.
    /// Test vector: nonce 0x1234, t1 1795000000123.4, the test key → 0302123410534f5fb0d2879d96279f5e7feb.
    static func pong(nonce: UInt16, t1: Double, key: Data) -> Data {
        let ticks = UInt64((t1 * 10).rounded())
        var body = Data([3, 2, UInt8(nonce >> 8), UInt8(nonce & 0xff)])
        body.append(UInt8((ticks >> 40) & 0xff))
        body.append(UInt8((ticks >> 32) & 0xff))
        body.append(UInt8((ticks >> 24) & 0xff))
        body.append(UInt8((ticks >> 16) & 0xff))
        body.append(UInt8((ticks >> 8) & 0xff))
        body.append(UInt8(ticks & 0xff))
        let mac = HMAC<SHA256>.authenticationCode(for: body, using: SymmetricKey(data: key))
        body.append(contentsOf: Data(mac).prefix(8))
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

    private func emitState() {
        notifyListeners("stateChange", data: ["state": stateName(), "subscribers": subscribers.count])
    }

    private func teardown() {
        manager?.stopAdvertising()
        manager?.removeAllServices()
        characteristic = nil
        syncCharacteristic = nil
        serviceAdded = false
        subscribers.removeAll()
        syncSubscribers.removeAll()
        syncQueue.removeAll()
        notifyPending = false
    }

    private func setUpIfReady() {
        guard let manager = manager, manager.state == .poweredOn, !serviceAdded,
              let serviceUUID = serviceUUID, let characteristicUUID = characteristicUUID
        else { return }
        // Value nil: reads come to the delegate, so they always get the latest state.
        let char = CBMutableCharacteristic(type: characteristicUUID, properties: [.read, .notify], value: nil, permissions: [.readable])
        let service = CBMutableService(type: serviceUUID, primary: true)
        service.characteristics = [char]
        if let syncUUID = syncUUID, !key.isEmpty {
            let sync = CBMutableCharacteristic(type: syncUUID, properties: [.read, .write, .notify], value: nil, permissions: [.readable, .writeable])
            service.characteristics?.append(sync)
            syncCharacteristic = sync
        }
        characteristic = char
        serviceAdded = true
        manager.add(service)
    }

    private func sendSync(_ data: Data, to centrals: [CBCentral]?) {
        guard let manager = manager, let char = syncCharacteristic, !syncSubscribers.isEmpty else { return }
        if !syncQueue.isEmpty || !manager.updateValue(data, for: char, onSubscribedCentrals: centrals) {
            // A late pong only gives a slow sample (the app keeps the fastest); keep the queue short.
            if syncQueue.count >= 8 { syncQueue.removeFirst() }
            syncQueue.append((data, centrals))
        }
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
            syncCharacteristic = nil
            subscribers.removeAll()
            syncSubscribers.removeAll()
            syncQueue.removeAll()
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
        let current: Data
        if request.characteristic.uuid == characteristicUUID {
            current = value
        } else if let syncUUID = syncUUID, request.characteristic.uuid == syncUUID {
            current = syncValue
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

    /// A member's ping: answered at once, to that member only, with this phone's clock.
    public func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        // Stamped first, before any other work.
        let t1 = StageBlePlugin.clockMs() + clockOffset
        guard let first = requests.first else { return }
        guard let syncUUID = syncUUID, requests.allSatisfy({ $0.characteristic.uuid == syncUUID }) else {
            peripheral.respond(to: first, withResult: .writeNotPermitted)
            return
        }
        peripheral.respond(to: first, withResult: .success)
        for request in requests {
            guard let v = request.value, v.count == 4, v[v.startIndex] == 3, v[v.startIndex + 1] == 1, !key.isEmpty else { continue }
            let nonce = UInt16(v[v.startIndex + 2]) << 8 | UInt16(v[v.startIndex + 3])
            sendSync(StageBlePlugin.pong(nonce: nonce, t1: t1, key: key), to: [request.central])
        }
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
        if let syncUUID = syncUUID, characteristic.uuid == syncUUID {
            if !syncSubscribers.contains(where: { $0.identifier == central.identifier }) { syncSubscribers.append(central) }
            return
        }
        if !subscribers.contains(where: { $0.identifier == central.identifier }) { subscribers.append(central) }
        sendNotify()
        emitState()
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
        if let syncUUID = syncUUID, characteristic.uuid == syncUUID {
            syncSubscribers.removeAll { $0.identifier == central.identifier }
            return
        }
        subscribers.removeAll { $0.identifier == central.identifier }
        emitState()
    }

    public func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        if notifyPending { sendNotify() }
        guard let char = syncCharacteristic else { return }
        while let (data, centrals) = syncQueue.first {
            if !peripheral.updateValue(data, for: char, onSubscribedCentrals: centrals) { break }
            syncQueue.removeFirst()
        }
    }
}

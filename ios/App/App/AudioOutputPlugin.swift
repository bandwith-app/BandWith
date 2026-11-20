import AVFoundation
import Capacitor

/// Stage manager mode (the Regia): where the device's audio comes out, and
/// the audio session that keeps a song playing on stage.
///
/// Most iPads and every iPhone since the 7 have no headphone jack, so the
/// Regia reaches the mixer through USB-C (an adapter, an audio interface or
/// the mixer's own USB input). If that cable comes out, iOS moves the sound
/// to the built-in speaker without a word; the Regia's bar shows the output
/// so that is seen at once.
///
/// JS (src/lib/audioOutput.ts):
/// - `current()` → `{ kind, name }`, kind one of usb | wired | hdmi |
///   airplay | bluetooth | speaker | other.
/// - `change` event with the same shape when the route changes.
/// - `setPlayback({ on })`: the "playback" category while the Regia is on
///   (the silent switch doesn't mute it, it keeps playing with the screen
///   locked thanks to the `audio` background mode), back to the default after.
@objc(AudioOutputPlugin)
public class AudioOutputPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AudioOutputPlugin"
    public let jsName = "BwAudioOutput"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "current", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPlayback", returnType: CAPPluginReturnPromise),
    ]

    private var observer: NSObjectProtocol?

    override public func load() {
        observer = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.notifyListeners("change", data: Self.route())
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    @objc func current(_ call: CAPPluginCall) {
        call.resolve(Self.route())
    }

    @objc func setPlayback(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        let session = AVAudioSession.sharedInstance()
        do {
            if on {
                try session.setCategory(.playback, mode: .default, options: [])
                try session.setActive(true)
            } else {
                try session.setCategory(.soloAmbient, mode: .default, options: [])
            }
            call.resolve(Self.route())
        } catch {
            call.reject("audio session: \(error.localizedDescription)")
        }
    }

    private static func route() -> [String: Any] {
        guard let out = AVAudioSession.sharedInstance().currentRoute.outputs.first else {
            return ["kind": "other", "name": ""]
        }
        return ["kind": kind(out.portType), "name": out.portName]
    }

    private static func kind(_ port: AVAudioSession.Port) -> String {
        switch port {
        case .usbAudio: return "usb"
        case .headphones, .lineOut: return "wired"
        case .HDMI, .displayPort: return "hdmi"
        case .airPlay: return "airplay"
        case .bluetoothA2DP, .bluetoothLE, .bluetoothHFP: return "bluetooth"
        case .builtInSpeaker, .builtInReceiver: return "speaker"
        default: return "other"
        }
    }
}

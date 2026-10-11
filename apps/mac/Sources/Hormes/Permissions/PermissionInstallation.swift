import Foundation

/// Records that installation's permission requests were started, not that any
/// permission was granted. Only macOS readback may establish a grant. Persist
/// before requesting so a denial, cancellation or relaunch never repeats dialogs
/// on every ordinary launch. The installer and an explicit retry can start again.
enum PermissionInstallation {
    private struct Attempt: Codable {
        let startedAt: Date
    }

    static func claim(stateDir: URL, explicit: Bool = false, disabled: Bool = false) -> Bool {
        guard !disabled else { return false }
        let record = stateDir.appendingPathComponent("permission-installation.json")
        if !explicit, FileManager.default.fileExists(atPath: record.path) { return false }
        do {
            try FileManager.default.createDirectory(at: stateDir, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(Attempt(startedAt: Date()))
            try data.write(to: record, options: .atomic)
            return true
        } catch {
            NSLog("Permission installation not started: could not record the attempt (%@)", error.localizedDescription)
            return false
        }
    }
}

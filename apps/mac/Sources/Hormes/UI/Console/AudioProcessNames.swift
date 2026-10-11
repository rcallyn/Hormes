import AppKit

/// Resolves audio sharing process IDs for the engine readback.
enum AudioProcessNames {
    static func processName(_ id: String) -> String {
        if id.hasPrefix("pid:"), let pid = Int32(id.dropFirst(4)) {
            return NSRunningApplication(processIdentifier: pid)?.localizedName ?? id
        }
        return NSRunningApplication.runningApplications(withBundleIdentifier: id).first?.localizedName ?? id
    }
}

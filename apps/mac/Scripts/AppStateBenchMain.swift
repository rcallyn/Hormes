import Foundation

/// Headless model acceptance checks. No window, permission prompt, daemon or voice session.
@main
struct AppStateBenchMain {
    static func main() {
        MainActor.assumeIsolated {
            let lines = AppStateBench.run()
            for line in lines { print(line) }
            let checks = lines.filter { $0.hasPrefix("ok") || $0.hasPrefix("FAIL") }
            let failed = checks.filter { $0.hasPrefix("FAIL") }.count
            print(failed == 0 ? "ok · \(checks.count) checks" : "FAIL · \(failed) of \(checks.count) checks")
            exit(failed == 0 ? 0 : 1)
        }
    }
}

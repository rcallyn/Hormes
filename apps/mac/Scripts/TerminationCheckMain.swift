import AppKit
import Foundation

/// An empty test app: no workspace, documents, daemon, microphone or provider.
/// Its async save/decline handshake exercises the production signal scheduler.
@MainActor
private final class TerminationDelegate: NSObject, NSApplicationDelegate {
    private var sources: [DispatchSourceSignal] = []
    private var attempts = 0
    func applicationDidFinishLaunching(_ notification: Notification) {
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { MainActor.assumeIsolated { QuitRequest.schedule() } }
            source.resume(); sources.append(source)
        }
        print("ready"); fflush(stdout)
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        attempts += 1
        let decline = CommandLine.arguments.last == "decline" && attempts == 1
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 50_000_000)
            print(decline ? "save declined" : "save acknowledged"); fflush(stdout)
            sender.reply(toApplicationShouldTerminate: !decline)
        }
        return .terminateLater
    }
    func applicationWillTerminate(_ notification: Notification) {
        print("clean exit"); fflush(stdout)
    }
}

private final class CapturedOutput: @unchecked Sendable {
    private let lock = NSLock()
    private var value = ""
    func append(_ bytes: Data) { lock.lock(); defer { lock.unlock() }; value += String(decoding: bytes, as: UTF8.self) }
    func contains(_ words: String) -> Bool { lock.lock(); defer { lock.unlock() }; return value.contains(words) }
}

@main
private struct TerminationCheck {
    @MainActor static func main() {
        if CommandLine.arguments.contains("--child") {
            let app = NSApplication.shared
            app.setActivationPolicy(.prohibited)
            let delegate = TerminationDelegate(); app.delegate = delegate
            app.run()
            return
        }
        var passed = true
        for (name, number) in [("terminate", SIGTERM), ("interrupt", SIGINT), ("decline", SIGTERM)] {
            passed = probe(name: name, number: number) && passed
        }
        print(passed ? "termination-check: all ok" : "termination-check: FAILED")
        exit(passed ? 0 : 1)
    }

    private static func probe(name: String, number: Int32) -> Bool {
        let process = Process(), pipe = Pipe(), output = CapturedOutput()
        process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        process.arguments = ["--child", name]
        process.standardOutput = pipe; process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { handle in output.append(handle.availableData) }
        func wait(_ predicate: () -> Bool) -> Bool {
            let end = Date().addingTimeInterval(5)
            while !predicate() && Date() < end { Thread.sleep(forTimeInterval: 0.01) }
            return predicate()
        }
        func check(_ value: Bool, _ words: String) -> Bool {
            print("check: \(value ? "ok" : "FAIL") \(name): \(words)")
            return value
        }
        do { try process.run() } catch { return check(false, "could not launch test child: \(error)") }
        defer {
            // Only this empty child is disposable. Never target the real app.
            if process.isRunning { kill(process.processIdentifier, SIGKILL); process.waitUntilExit() }
            pipe.fileHandleForReading.readabilityHandler = nil
        }
        guard check(wait { output.contains("ready") || !process.isRunning } && process.isRunning, "empty app ready") else { return false }
        kill(process.processIdentifier, number)
        if name == "decline" {
            guard check(wait { output.contains("save declined") || !process.isRunning } && process.isRunning,
                        "save refusal cancels quit and keeps the app alive") else { return false }
            kill(process.processIdentifier, number)
        }
        guard check(wait { !process.isRunning }, "asynchronous save can finish after the signal callback") else { return false }
        return check(process.terminationStatus == 0 && wait { output.contains("save acknowledged") && output.contains("clean exit") },
                     "acknowledged save precedes clean exit")
    }
}

// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "Hormes",
    platforms: [.macOS(.v14)],
    targets: [
        // Objective-C shim: `JHTry` catches the NSExceptions AVFoundation raises (a tap on a
        // stale format, a player started on a stopped engine) so Swift can log and retry
        // instead of the process aborting. Public header in include/, module map alongside.
        .target(
            name: "HormesObjC",
            path: "Sources/HormesObjC"
        ),
        .executableTarget(
            name: "Hormes",
            dependencies: ["HormesObjC"],
            path: "Sources/Hormes",
            swiftSettings: [.unsafeFlags(["-Onone"], .when(configuration: .debug))]
        ),
    ]
)

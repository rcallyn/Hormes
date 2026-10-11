// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Hormes",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "Hormes",
            path: "Sources/Hormes",
            swiftSettings: [.unsafeFlags(["-Onone"], .when(configuration: .debug))]
        ),
    ]
)

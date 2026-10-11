import CoreImage.CIFilterBuiltins
import SwiftUI

/// Phone pairing is an explicit user action; the phone receives quizzes and saves choices only.
struct PhonePairingSection: View {
    @EnvironmentObject private var state: AppState
    @State private var showingCode = false
    @State private var previousDevices = Set<String>()
    @State private var showingPushSetup = false
    @State private var teamId = ""
    @State private var keyId = ""
    @State private var pushEnvironment = "sandbox"
    @State private var keyFile: URL?
    @State private var setupError: String?
    @State private var savingPush = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ConsoleHairline(weight: .row)
            HStack {
                Label("iPhone", systemImage: "iphone").font(ConsoleTheme.sans(13, .medium))
                Spacer()
                Button("Pair iPhone") {
                    previousDevices = Set(state.phone.devices.map(\.id))
                    showingCode = true
                    state.phoneCommand("pair", nil)
                }.buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(!state.connected)
            }
            Text("Your class review appears in Dynamic Island automatically. Pair once; saved answers sync when your phone reconnects.")
                .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3).lineSpacing(3)
            ForEach(state.phone.devices) { device in
                HStack {
                    Text(device.name).font(ConsoleTheme.sans(12))
                    Spacer()
                    if device.automaticDelivery == true { Image(systemName: "capsule").foregroundStyle(ConsoleTheme.fg3).help("Automatic delivery is ready") }
                    Button("Remove") { state.phoneCommand("revoke", device.id) }
                        .buttonStyle(ConsoleButtonStyle(kind: .plain))
                }
            }
            HStack {
                Text(state.phone.pushConfigured == true ? "Automatic delivery configured" : "Automatic delivery needs Apple Push setup")
                    .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3)
                Spacer()
                Button(state.phone.pushConfigured == true ? "Configure" : "Set up") { showingPushSetup = true }
                    .buttonStyle(ConsoleButtonStyle(kind: .plain)).disabled(!state.connected)
            }
            if let error = state.phone.error { Text(error).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg2) }
        }.padding(16)
            .task { state.phoneCommand("status", nil) }
            .sheet(isPresented: $showingCode) {
                VStack(alignment: .center, spacing: 18) {
                    Text("Pair your iPhone").font(.title2.weight(.medium))
                    Text("Open Hormes on your iPhone and scan this code. Keep both devices on the same Wi-Fi.")
                        .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    if let pairing = state.phone.pairing, pairing.expiresAt > Date().timeIntervalSince1970 * 1000 {
                        if let image = Self.qr(pairing.url) {
                            Image(nsImage: image).interpolation(.none).resizable().frame(width: 240, height: 240).padding(12).background(.white, in: RoundedRectangle(cornerRadius: 12))
                        }
                        Text("Code expires after two minutes.").font(.caption).foregroundStyle(.secondary)
                        DisclosureGroup("Copy pairing link") {
                            Text(pairing.url).font(.system(size: 9, design: .monospaced)).textSelection(.enabled).lineLimit(5)
                        }
                    } else if state.phone.devices.contains(where: { !previousDevices.contains($0.id) }), state.phone.error == nil {
                        Label("iPhone paired", systemImage: "checkmark.circle").font(.headline)
                        Text("New reviews appear automatically after delivery is set up.").font(.callout).foregroundStyle(.secondary)
                    } else {
                        Text(state.phone.error ?? "Preparing a secure connection…").font(.callout).foregroundStyle(.secondary)
                        Button("Generate new code") { state.phoneCommand("pair", nil) }
                    }
                    Button("Done") { showingCode = false }.keyboardShortcut(.defaultAction)
                }.padding(28).frame(width: 390)
                    .onDisappear { state.phoneCommand("cancel", nil) }
            }
            .sheet(isPresented: $showingPushSetup) { pushSetup }
    }
    private var pushSetup: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Automatic iPhone delivery").font(.title2.weight(.medium))
            Text("Add an Apple Push key once. Hormes can then place new class reviews in Dynamic Island while the iPhone app is closed.")
                .font(.callout).foregroundStyle(.secondary)
            Link("Create an Apple Push key", destination: URL(string: "https://developer.apple.com/account/resources/authkeys/list")!)
            TextField("Apple Team ID", text: $teamId)
            TextField("Key ID", text: $keyId)
            Picker("Delivery environment", selection: $pushEnvironment) {
                Text("Development build").tag("sandbox")
                Text("App Store / TestFlight").tag("production")
            }
            Button(keyFile?.lastPathComponent ?? "Choose .p8 key…") {
                let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
                panel.title = "Choose your Apple Push authentication key"
                if panel.runModal() == .OK { keyFile = panel.url }
            }
            Text("The private key stays on this Mac. Short reviews arrive encrypted for your paired iPhone.")
                .font(.caption).foregroundStyle(.secondary)
            if let error = setupError ?? state.phone.error { Text(error).font(.caption).foregroundStyle(.secondary) }
            HStack {
                Button("Cancel") { showingPushSetup = false }
                Spacer()
                Button("Save setup") {
                    do {
                        guard let keyFile, (try keyFile.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 4097) <= 4096 else { throw CocoaError(.fileReadTooLarge) }
                        let key = try String(contentsOf: keyFile, encoding: .utf8)
                        state.phoneConfigurePush(teamId.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(), keyId.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(), key, pushEnvironment)
                        savingPush = true
                        setupError = nil
                    } catch { setupError = "Choose a readable Apple Push .p8 key file." }
                }.keyboardShortcut(.defaultAction).disabled(keyFile == nil || teamId.count != 10 || keyId.count != 10)
            }
        }.padding(28).frame(width: 420)
            .onReceive(state.$phone) { phone in
                guard savingPush else { return }
                savingPush = false
                if let error = phone.error { setupError = error }
                else if phone.pushConfigured == true { showingPushSetup = false }
            }
    }
    private static func qr(_ text: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 6, y: 6)),
              let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
    }
}

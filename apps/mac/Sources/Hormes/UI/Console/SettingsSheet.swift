import SwiftUI
import AVFoundation

/// Configuration needed for the demo. Writes still go through the engine's existing commands.
struct SettingsSheet: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.consoleActions) private var actions
    @Environment(\.dismiss) private var dismiss
    @State private var mics: [MicDevice] = []
    @State private var model = ""
    @State private var server = ""
    @State private var phrases = ""
    @State private var passphrase = ""
    @State private var passphraseError = false
    private var settings: Settings { state.snapshot.settings }
    private var setup: SetupStatus { state.snapshot.setup }

    var body: some View {
        VStack(spacing: 0) {
            HStack { Text("Settings").font(.headline); Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction).buttonStyle(.plain) }.padding(20)
            Divider()
            Form {
                Section("Voice and models") {
                    Picker("Voice service", selection: Binding(get: { settings.voiceProvider ?? "openai" }, set: { value in
                        var patch = SettingsPatch(); patch.voiceProvider = value; send(patch)
                    })) { Text("Gemini").tag("gemini"); Text("OpenAI").tag("openai") }
                    CredentialField(label: "Gemini key", key: "GEMINI_API_KEY", present: setup.secrets.gemini ?? false)
                    CredentialField(label: "OpenAI key", key: "OPENAI_API_KEY", present: setup.secrets.openai)
                    Picker("Reasoning", selection: Binding(get: { settings.brain }, set: { kind in
                        model = ""; server = ""; send(SettingsPatch(brain: kind, brainModel: "", brainBaseUrl: .some(nil)))
                    })) {
                        Text("GPT").tag(BrainKind.openaiResponses)
                        Text("Qwen / local model").tag(BrainKind.local)
                        Text("Claude Code").tag(BrainKind.claudeCode)
                        // Keep a saved backend reachable without offering all inherited permutations.
                        if ![BrainKind.openaiResponses, .local, .claudeCode].contains(settings.brain) { Text(settings.brain.label).tag(settings.brain) }
                    }
                    if settings.brain == .local {
                        Picker("Model", selection: Binding(get: { settings.brainModel }, set: { send(SettingsPatch(brainModel: $0)) })) {
                            Text("Automatic").tag("")
                            ForEach(setup.local.models.filter { !$0.cloud && $0.hasTools }) { Text($0.id).tag($0.id) }
                            if !settings.brainModel.isEmpty && !setup.local.models.contains(where: { $0.id == settings.brainModel }) { Text(settings.brainModel).tag(settings.brainModel) }
                        }
                        TextField("Local server (optional)", text: $server).onSubmit { saveModel() }
                    } else {
                        TextField("Model (blank uses default)", text: $model).onSubmit { saveModel() }
                    }
                    Button("Save model") { saveModel() }
                    Text(setup.brainDetail.isEmpty ? setup.brain.rawValue : setup.brainDetail).font(.caption).foregroundStyle(.secondary)
                    Text("Forge uses your connected coding sessions. Sign in to Claude Code in its own app or CLI.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Microphone and wake") {
                    Picker("Microphone", selection: Binding(get: { settings.micDeviceId ?? "" }, set: { send(SettingsPatch(micDeviceId: .some($0.isEmpty ? nil : $0))) })) {
                        Text("Automatic").tag("")
                        ForEach(mics) { Text($0.name).tag($0.id) }
                        if let id = settings.micDeviceId, !mics.contains(where: { $0.id == id }) { Text("Unavailable microphone").tag(id) }
                    }
                    Toggle("Wake detection", isOn: Binding(get: { settings.wake.enabled }, set: { enabled in var wake = settings.wake; wake.enabled = enabled; send(SettingsPatch(wake: wake)) }))
                    Picker("Wake with", selection: Binding(get: { settings.wake.trigger ?? .word }, set: { trigger in var wake = settings.wake; wake.trigger = trigger; send(SettingsPatch(wake: wake)) })) {
                        ForEach(WakeTrigger.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    if settings.wake.trigger != .clap {
                        HStack { TextField("Wake phrases, separated by commas", text: $phrases); Button("Save") {
                            let values = phrases.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
                            guard !values.isEmpty else { return }; var wake = settings.wake; wake.phrases = values; send(SettingsPatch(wake: wake))
                        } }
                    }
                    Picker("Wake authentication", selection: Binding(get: { settings.wake.auth }, set: { auth in var wake = settings.wake; wake.auth = auth; send(SettingsPatch(wake: wake)) })) {
                        ForEach(WakeAuth.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    if settings.wake.auth == .passphrase || settings.wake.auth == .either {
                        HStack { SecureField(state.wakePassphraseSet ? "Change passphrase" : "Set passphrase", text: $passphrase); Button("Save") {
                            passphraseError = !actions.setWakePassphrase(passphrase)
                            if !passphraseError { passphrase = "" }
                        }.disabled(passphrase.isEmpty) }
                        if passphraseError { Text("Use two words or more.").font(.caption) }
                    }
                    Text("Wake authentication does not replace owner approval for sensitive actions.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Permissions") {
                    if let sweep = state.permissionSweep, sweep.running {
                        PermissionSweepConsoleRow(progress: sweep, next: { state.permissionSweepNext() }, stop: { state.permissionSweepCancel() })
                    }
                    ForEach(state.snapshot.permissions.all.filter { $0.required || [.calendars, .notifications, .speechRecognition].contains($0.kind) }) { permission in
                        HStack {
                            Text(permission.label)
                            Spacer()
                            if permission.grant == .granted { Text("Granted").foregroundStyle(.secondary) }
                            else { Button(permission.ask == .settings ? "Open Settings" : "Allow") { actions.send(.requestPermission(permission.kind.rawValue)) } }
                        }.help(permission.why)
                    }
                    Button("Set up permissions") { actions.send(.requestPermission("all")) }
                }
                PhonePairingSection()
            }.formStyle(.grouped)
        }
        .frame(width: 560, height: 690)
        .preferredColorScheme(.dark)
        .onAppear { mics = MicDevice.enumerate(); model = settings.brainModel; server = settings.brainBaseUrl ?? ""; phrases = settings.wake.phrases.joined(separator: ", ") }
        .onChange(of: settings.brainModel) { model = settings.brainModel }
        .onChange(of: settings.brainBaseUrl) { server = settings.brainBaseUrl ?? "" }
        .onChange(of: settings.wake.phrases) { phrases = settings.wake.phrases.joined(separator: ", ") }
    }
    private func send(_ patch: SettingsPatch) { actions.send(.setSettings(patch)) }
    private func saveModel() {
        send(SettingsPatch(brainModel: model.trimmingCharacters(in: .whitespacesAndNewlines), brainBaseUrl: .some(server.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : server.trimmingCharacters(in: .whitespacesAndNewlines))))
    }
}

private struct CredentialField: View {
    let label: String
    let key: String
    let present: Bool
    @State private var value = ""
    @Environment(\.consoleActions) private var actions
    var body: some View {
        HStack {
            SecureField(label + (present ? " (saved)" : ""), text: $value)
            Button("Save") { actions.send(.setSecrets([key: value])); value = "" }.disabled(value.isEmpty)
        }
    }
}

struct MicDevice: Identifiable {
    let id: String
    let name: String
    static func enumerate() -> [MicDevice] {
        AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified)
            .devices.map { MicDevice(id: $0.uniqueID, name: $0.localizedName) }
    }
}

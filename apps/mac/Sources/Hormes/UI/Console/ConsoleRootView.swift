import SwiftUI

struct ConsoleRootView: View {
    @EnvironmentObject private var state: AppState
    @EnvironmentObject private var session: ConsoleSession
    @Environment(\.consoleActions) private var actions
    @State private var showsAgents = false
    @State private var chains: [HormesChain] = []

    nonisolated static func walkOrder(_ ids: [String]) -> [String] { ids.filter { $0 != "main" } }

    var body: some View {
        VStack(spacing: 0) {
            ConsoleHeader(phase: state.phase, connected: state.connected, daemonDetail: state.daemonDetail).equatable()
            HStack(spacing: 28) {
                navigation("Tasks", selected: session.showsTasks) { session.showTasks(); showsAgents = false; refreshWork() }
                navigation("Library", selected: session.showsWork && !session.viewingAgentWork) { session.showNow(); session.showsWork = true; showsAgents = false; refreshWork() }
                navigation("Education", selected: session.showsEducation) { session.showEducation(); showsAgents = false; refreshWork() }
                navigation("Agents", selected: showsAgents || session.viewingAgentWork || session.openAgentId != nil) { session.showNow(); showsAgents = true }
                navigation("Activity", selected: !session.showsTasks && !session.showsEducation && !session.showsWork && !showsAgents && session.openAgentId == nil) { session.showNow(); showsAgents = false }
                Spacer()
            }.padding(.horizontal, 28).frame(height: 46)
            Divider()
            if let suggestion = state.snapshot.suggestions?.first { SuggestionCard(suggestion: suggestion, awake: state.snapshot.session != nil) }
            if let approval = state.snapshot.approval, approval.requiresOwner {
                Text("Sensitive action waiting: press Allow and authenticate with Touch ID or your Mac password.")
                    .font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted).padding(8)
            }
            HStack(spacing: 0) {
                if !session.showsWork && !session.showsEducation && !session.showsTasks && !showsAgents {
                    SessionList(chains: chains, threads: state.orderedThreads)
                        .frame(width: 230)
                    Divider()
                }
                centre.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(ConsoleTheme.ground)
        .preferredColorScheme(.dark)
        .environment(\.consoleActions, routedActions)
        .overlay(alignment: .topTrailing) { ToastStack(toasts: state.toasts).padding(.top, 66).padding(.trailing, 16) }
        .sheet(isPresented: $session.showsSystem) { SettingsSheet() }
        .sheet(item: $session.lightbox) { item in LightboxView(item: item) { session.lightbox = nil } }
        .onAppear { refreshWork(); state.refreshHormesSessions(); rebuildChains() }
        .onChange(of: state.hormesSessions) { rebuildChains() }
        .onChange(of: session.windowVisible) { _, visible in
            if visible { refreshWork(); state.refreshHormesSessions() }
        }
        .onChange(of: session.openThreadId, initial: true) { _, id in
            if id != nil { showsAgents = false }
            state.heldThreadIds = Set([id].compactMap { $0 })
            if let id { state.noteThreadStoreUsed(id) }
            state.evictThreadStores(keep: state.heldThreadIds)
        }
        .onChange(of: session.openAgentId) { _, id in
            if let id { state.noteTranscriptOpened(id) }
            state.evictTranscripts(keep: Set([id].compactMap { $0 }))
        }
        .onChange(of: session.openHormesSessionId) { _, id in
            if id != nil { showsAgents = false }
        }
        .onReceive(NotificationCenter.default.publisher(for: ConsoleSession.openHormesSessionNotification)) { note in
            guard let id = note.userInfo?["sessionId"] as? String, let chain = chains.first(where: { $0.contains(id) }) else { return }
            Task { await session.openHormes(chain, from: state) }
        }
        .frame(minWidth: ConsoleLayout.minWidth, minHeight: ConsoleLayout.minHeight)
        .ignoresSafeArea(.container, edges: .top)
    }

    @ViewBuilder private var centre: some View {
        let snap = state.snapshot
        if session.showsTasks { TasksPane() }
        else if session.showsEducation { EducationPane() }
        else if session.showsWork { WorkPane() }
        else if let id = session.openAgentId, let agent = snap.agents.first(where: { $0.id == id }) {
            ConversationPane(agent: agent, transcript: state.transcripts[id], connected: state.connected, loaded: state.prependedCount[id] ?? 0).equatable().id(id)
        } else if let id = session.openHormesSessionId, let chain = chains.first(where: { $0.id == id }) {
            SavedConversationPane(chain: chain, entries: session.hormesEntries, loading: session.hormesLoading, truncated: session.hormesTruncated)
        } else if let id = session.openThreadId, let thread = state.threads[id] {
            ThreadPane(thread: thread, store: state.threadStores[id], phase: snap.phase, connected: state.connected, typedWakes: snap.settings.typedWakes, skewed: ComposerHold.skewed(snap.problems)).equatable().id(id)
        } else if showsAgents {
            AgentsOverview(agents: snap.agents, work: state.work, connected: state.connected, inspect: { state.workActionHandler(HormesWorkCommand(action: "inspect", sessionId: $0)) }).equatable()
        } else {
            StreamPane(transcript: snap.transcript, delegations: snap.delegations, phase: snap.phase, hasSession: snap.session != nil, connected: state.connected, threads: state.orderedThreads.filter { $0.id != "main" }, typedWakes: snap.settings.typedWakes, skewed: ComposerHold.skewed(snap.problems)).equatable()
        }
    }
    private func navigation(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).font(ConsoleTheme.sans(12, selected ? .medium : .regular)).foregroundStyle(selected ? ConsoleTheme.fg : ConsoleTheme.fg3) }
            .buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : [])
    }
    private func refreshWork() { state.send(.work(HormesWorkCommand(action: "refresh"))) }
    private func rebuildChains() { chains = HormesChain.build(state.hormesSessions).filter { !$0.isTrashed && !$0.isEmptyConversation } }
    private var routedActions: ConsoleActions {
        var result = actions
        result.openHormesConversation = { chain in Task { await session.openHormes(chain, from: state) } }
        result.showNow = { session.showNow() }
        let open = result.open
        result.open = { target in
            if target.lowercased().hasPrefix("hormes://settings") { state.openSettings() } else { open(target) }
        }
        return result
    }
}

struct SessionList: View {
    let chains: [HormesChain]
    let threads: [WorkThread]
    @EnvironmentObject private var state: AppState
    @EnvironmentObject private var session: ConsoleSession

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Button("Current activity") { session.showNow() }.buttonStyle(.plain)
                ForEach(threads.filter { $0.id != "main" }) { thread in
                    Button { session.openThread(thread.id) } label: {
                        row(thread.name, detail: thread.status.orbWord, selected: session.openThreadId == thread.id)
                    }.buttonStyle(.plain)
                }
                Divider()
                Text("Saved sessions").font(.caption).foregroundStyle(.secondary)
                if chains.isEmpty { Text("No saved sessions yet").font(.caption).foregroundStyle(.secondary) }
                ForEach(chains) { chain in
                    Button { Task { await session.openHormes(chain, from: state) } } label: {
                        row(chain.displayTitle.isEmpty ? "Conversation" : chain.displayTitle,
                            detail: ConsoleFormat.fullDate(chain.startedAt) + " · " + (chain.isOpen ? "open" : ConsoleFormat.closeReason(chain.reason)),
                            selected: session.openHormesSessionId == chain.id)
                    }.buttonStyle(.plain)
                }
            }.padding(16)
        }
    }
    private func row(_ title: String, detail: String, selected: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.callout).lineLimit(2)
            Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
            .background(selected ? Color.white.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 6))
    }
}

struct ConsoleHeader: View, Equatable {
    @EnvironmentObject private var session: ConsoleSession
    let phase: Phase
    let connected: Bool
    let daemonDetail: String

    static func == (a: ConsoleHeader, b: ConsoleHeader) -> Bool {
        a.phase == b.phase && a.connected == b.connected && a.daemonDetail == b.daemonDetail
    }

    var body: some View {
        let meta = ConsoleTheme.phase(phase)
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                HStack(spacing: 6) {
                    // The voice bars beside the wordmark.
                    HormesMark(size: 22)
                    Text("HORMES").font(ConsoleTheme.sans(12, .medium)).tracking(3).foregroundStyle(ConsoleTheme.fg)
                }
                .accessibilityElement(children: .combine)
                HStack(spacing: 7) {
                    ConsoleDot(color: meta.color, live: ConsoleTheme.livePhases.contains(phase), size: 6)
                    Text(meta.label).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
                        .contentTransition(.opacity)
                        .animation(Motion.fade, value: phase)
                }
                .help(meta.hint)
                .accessibilityElement(children: .combine)
                Spacer()
                Text(connected ? "Connected" : "Connecting")
                    .font(ConsoleTheme.sans(10)).foregroundStyle(ConsoleTheme.fg3)
                    .help(connected ? "Connected" : daemonDetail)
                Button {
                    withAnimation(Motion.gentle) { session.showsSystem.toggle() }
                } label: { Image(systemName: "slider.horizontal.3") }
                    .buttonStyle(ConsoleButtonStyle(kind: .plain, iconOnly: true))
                    .accessibilityLabel("Settings")

            }
            .padding(.leading, 84) // room for the traffic lights in the transparent titlebar
            .padding(.trailing, 16)
            .frame(height: 64)
            ConsoleHairline()
        }
    }
}

/// Toasts arrive with a fade and a rise (a little life), leave with a fade and a drop
/// gaining speed; the ones left behind reflow under `Motion.gentle`.
struct ToastStack: View {
    let toasts: [Toast]

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            ForEach(toasts) { toast in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    ConsoleIcon(name: symbol(toast.tone), tint: color(toast.tone))
                    Text(toast.text)
                        .font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(EdgeInsets(top: 7, leading: 8, bottom: 7, trailing: 12))
                .frame(maxWidth: 420, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 6).fill(ConsoleTheme.raised))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(ConsoleTheme.hair, lineWidth: 1))
                .transition(ConsoleMotion.arriveLeave)
            }
        }
        .fixedSize()
        .animation(Motion.gentle, value: toasts)
        .allowsHitTesting(false)
    }

    private func color(_ tone: Toast.Tone) -> Color {
        switch tone {
        case .info: return ConsoleTheme.titanium
        case .warn: return ConsoleTheme.speaking
        case .error: return ConsoleTheme.error
        }
    }

    private func symbol(_ tone: Toast.Tone) -> String {
        switch tone {
        case .info: return "info.circle.fill"
        case .warn: return "hand.raised.fill"
        case .error: return "exclamationmark.triangle.fill"
        }
    }
}

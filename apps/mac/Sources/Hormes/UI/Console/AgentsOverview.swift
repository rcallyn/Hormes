import SwiftUI

/// Stable product identities; session modes decide where saved work belongs.
enum HormesAgentRole: String, CaseIterable, Identifiable {
    case forge, sage, relay
    var id: String { rawValue }
    var name: String { rawValue.capitalized }
    var purpose: String {
        switch self {
        case .forge: return "Coding"
        case .sage: return "Tutoring"
        case .relay: return "Meetings"
        }
    }
    var symbol: String {
        switch self {
        case .forge: return "chevron.left.forwardslash.chevron.right"
        case .sage: return "graduationcap"
        case .relay: return "person.2"
        }
    }
    func owns(_ mode: String) -> Bool {
        switch self {
        case .forge: return mode == "coding"
        case .sage: return ["class", "review", "study", "exam"].contains(mode)
        case .relay: return mode == "meeting"
        }
    }
}

/// Named agents sit above their real session records. Opening saved work reads
/// its existing library record; it does not start a new voice session or task.
struct AgentsOverview: View, Equatable {
    let agents: [AgentInfo]
    let work: HormesWorkState
    let connected: Bool
    let inspect: (String) -> Void
    @EnvironmentObject private var session: ConsoleSession

    static func == (a: AgentsOverview, b: AgentsOverview) -> Bool {
        a.agents == b.agents && a.work == b.work && a.connected == b.connected
    }

    private var role: HormesAgentRole { session.selectedAgentRole }
    private func saved(_ role: HormesAgentRole) -> [HormesSession] {
        work.sessions.filter { role.owns($0.mode) }.sorted { $0.createdAt > $1.createdAt }
    }
    private func count(_ role: HormesAgentRole) -> Int {
        saved(role).count + (role == .forge ? agents.count : 0)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Agents").font(ConsoleTheme.sans(28, .light)).foregroundStyle(ConsoleTheme.fg)
                    Text(connected ? "Coding, learning, and meetings." : "Disconnected · showing saved work and the last received status.")
                        .font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
                }
                HStack(alignment: .top, spacing: 16) {
                    ForEach(HormesAgentRole.allCases) { agent in agentCard(agent) }
                }
                VStack(alignment: .leading, spacing: 18) {
                    section("\(role.name.uppercased()) · SESSIONS", count: count(role))
                    if count(role) == 0 {
                        Text("No sessions yet.")
                            .font(ConsoleTheme.sans(13)).foregroundStyle(ConsoleTheme.fg3).padding(.vertical, 16)
                    }
                    LazyVStack(alignment: .leading, spacing: 18) {
                        ForEach(saved(role)) { record in
                            taskRow(title: record.title, status: record.state, detail: recordDetail(record),
                                    note: record.next, at: record.createdAt, symbol: role.symbol) {
                                session.openWork(record.id)
                                inspect(record.id)
                            }
                        }
                    }
                    if role == .forge {
                        if !agents.isEmpty {
                            section("CONNECTED CODING SESSIONS", count: agents.count)
                            LazyVStack(alignment: .leading, spacing: 18) {
                                ForEach(agents.sorted { $0.updatedAt > $1.updatedAt }) { agent in
                                    taskRow(title: agent.name, status: agent.status.rawValue,
                                            detail: agent.detail ?? agent.cwd ?? "", note: agent.hint,
                                            at: agent.updatedAt, symbol: "terminal") {
                                        session.openAgent(agent.id)
                                    }
                                }
                            }
                        }
                    }
                }
            }.padding(30).frame(maxWidth: .infinity, alignment: .leading)
        }.background(ConsoleTheme.ground)
    }

    private func agentCard(_ agent: HormesAgentRole) -> some View {
        let selected = role == agent
        return Button { session.selectedAgentRole = agent } label: {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: agent.symbol).font(.system(size: 20, weight: .light))
                    .foregroundStyle(selected ? ConsoleTheme.fg : ConsoleTheme.fg3).frame(height: 24)
                VStack(alignment: .leading, spacing: 6) {
                    Text(agent.name).font(ConsoleTheme.sans(22, .light)).foregroundStyle(ConsoleTheme.fg)
                    Text(agent.purpose).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2)
                }
                Text("\(count(agent)) \(count(agent) == 1 ? "session" : "sessions")")
                    .font(ConsoleTheme.mono(10)).foregroundStyle(ConsoleTheme.fg3)
                Rectangle().fill(selected ? ConsoleTheme.fg : ConsoleTheme.hairRow).frame(height: 1)
            }.padding(.top, 16).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }.buttonStyle(.plain)
            .accessibilityLabel("\(agent.name), \(agent.purpose), \(count(agent)) sessions")
            .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func recordDetail(_ record: HormesSession) -> String {
        var parts = [WorkWords.mode(record.mode)]
        if let course = (work.courses ?? []).first(where: { $0.id == record.courseId }) { parts.append(course.title) }
        if record.demo { parts.append("Demo") }
        return parts.joined(separator: " · ")
    }

    private func section(_ title: String, count: Int) -> some View {
        HStack {
            Text(title).font(ConsoleTheme.sans(9, .medium)).tracking(1.8)
            Spacer()
            Text(String(count)).font(ConsoleTheme.mono(10))
        }.foregroundStyle(ConsoleTheme.fg3)
    }

    private func taskRow(title: String, status: String, detail: String, note: String?, at: Double, symbol: String,
                         open: @escaping () -> Void) -> some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top, spacing: 16) {
                    Image(systemName: symbol).font(.system(size: 17, weight: .light)).foregroundStyle(ConsoleTheme.fg2).frame(width: 24, height: 24)
                    VStack(alignment: .leading, spacing: 7) {
                        Text(title).font(ConsoleTheme.sans(15, .medium)).foregroundStyle(ConsoleTheme.fg).lineLimit(2)
                        if !detail.isEmpty { Text(detail).font(ConsoleTheme.sans(12)).foregroundStyle(ConsoleTheme.fg2).lineLimit(3) }
                        if let note, !note.isEmpty { Text(note).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.fg3).lineLimit(2) }
                    }
                    Spacer(minLength: 20)
                    VStack(alignment: .trailing, spacing: 8) {
                        Text(status.capitalized).font(ConsoleTheme.sans(11, .medium)).foregroundStyle(ConsoleTheme.fg2)
                        Text(WorkWords.date(at).formatted(date: .abbreviated, time: .shortened))
                            .font(ConsoleTheme.sans(10)).foregroundStyle(ConsoleTheme.fg3)
                    }
                    Image(systemName: "arrow.up.right").font(.system(size: 10)).foregroundStyle(ConsoleTheme.fg3).padding(.top, 3)
                }
                ConsoleHairline(weight: .row)
            }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}

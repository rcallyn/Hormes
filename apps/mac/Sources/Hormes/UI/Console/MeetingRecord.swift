import SwiftUI
import AppKit

enum MeetingWords {
    static let briefing = "Meeting briefing"
    static let followUp = "Follow-up email"
    static let original = "Original meeting capture and recaps"
    static let review = "AI draft · review against the original meeting"
    static let pending = "Email unsent · recipient and reconnect time still pending"
    static let open = "Open prepared email"
}

struct MeetingRecord: View {
    let meeting: HormesMeeting
    let sources: [HormesSource]
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let brief = meeting.brief {
                ConsoleGroupHead(title: MeetingWords.briefing)
                Text(WorkWords.stamp(brief.at)).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
                Text(brief.text).font(ConsoleTheme.sans(13)).textSelection(.enabled)
            }
            if let draft = meeting.followUp {
                ConsoleGroupHead(title: MeetingWords.followUp)
                Text("\(WorkWords.stamp(draft.at)) · \(MeetingWords.review)\(draft.revision == meeting.revision ? "" : " · Earlier draft")").font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
                Text(draft.subject).font(ConsoleTheme.sans(13)).bold()
                Text(draft.body).font(ConsoleTheme.sans(13)).textSelection(.enabled)
                ForEach(Array(draft.requests.enumerated()), id: \.offset) { item in Text(item.element).font(ConsoleTheme.sans(12)) }
                if let reconnect = draft.reconnect { Text(reconnect).font(ConsoleTheme.sans(12)) }
                Text(MeetingWords.pending).font(ConsoleTheme.sans(11)).foregroundStyle(ConsoleTheme.muted)
                if draft.reviewedAt != nil, draft.revision == meeting.revision, let path = draft.exportPath {
                    Button(MeetingWords.open) { NSWorkspace.shared.open(URL(fileURLWithPath: path)) }.buttonStyle(ConsoleButtonStyle(kind: .plain))
                }
            }
            ForEach(meeting.attachments) { file in
                Button("\(file.name) · \(file.version)\(file.demo ? " · synthetic demo" : "")") { NSWorkspace.shared.open(URL(fileURLWithPath: file.path)) }.buttonStyle(ConsoleButtonStyle(kind: .plain))
            }
            if let source = sources.first(where: { $0.id == meeting.sourceId }), !source.text.isEmpty {
                DisclosureGroup(MeetingWords.original) { Text(source.text).font(ConsoleTheme.sans(12)).textSelection(.enabled) }
            }
        }
    }
}

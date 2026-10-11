import Foundation

/// Explicit external-computer-use rehearsal status. This never changes WorkStore,
/// supplies internal browser receipts, marks a task done or represents a purchase.
struct GroceryNotchEvent: Codable {
    var version: Int
    var source: String
    var rehearsal: Bool
    var runId, taskId, sessionId, phase: String
    var at: Double
    var reviewURL, evidenceSummary: String?
    var verifiedAt: Double?
}

struct GroceryNotchPresentation: Equatable {
    var runId, taskId, sessionId, title, phase: String
    var startedAt, expiresAt: Double
    var reviewURL: URL?
    var detail: String
    var isWorking: Bool { phase == "working" }
    var isReady: Bool { phase == "ready" }

    static func boundTask(_ event: GroceryNotchEvent, work: HormesWorkState) -> HormesWorkTask? {
        guard let task = work.tasks?.first(where: { $0.id == event.taskId }), task.supersededAt == nil,
              task.sessionId == event.sessionId,
              work.sessions.contains(where: { $0.id == event.sessionId && $0.mode == "grocery" })
                || (work.active?.id == event.sessionId && work.active?.mode == "grocery") else { return nil }
        return task
    }

    static func transition(_ event: GroceryNotchEvent, previous: Self?, work: HormesWorkState, now: Double) -> Self? {
        guard event.version == 1, event.source == "external-computer-use", event.rehearsal,
              UUID(uuidString: event.runId) != nil, event.at.isFinite, abs(now - event.at) <= 15_000,
              let task = boundTask(event, work: work), !work.quiet else { return nil }
        let title = task.text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"^[-*•]\s+"#, with: "", options: .regularExpression)
        guard !title.isEmpty else { return nil }
        if event.phase == "working" {
            // A new run is explicit. A completed/blocked run cannot silently reopen.
            if let previous, previous.runId == event.runId { return nil }
            return Self(runId: event.runId, taskId: task.id, sessionId: event.sessionId,
                        title: title, phase: "working", startedAt: now, expiresAt: now + 180_000,
                        reviewURL: nil, detail: "Preparing cart · external agent")
        }
        guard let previous, previous.runId == event.runId, previous.taskId == task.id,
              previous.sessionId == event.sessionId, previous.isWorking, now <= previous.expiresAt else { return nil }
        if event.phase == "blocked" {
            let detail = String((event.evidenceSummary ?? "Needs attention").prefix(200))
            return Self(runId: previous.runId, taskId: task.id, sessionId: event.sessionId, title: title,
                        phase: "blocked", startedAt: previous.startedAt, expiresAt: now + 120_000,
                        reviewURL: nil, detail: detail)
        }
        guard event.phase == "ready", let checked = event.verifiedAt, checked.isFinite,
              checked >= previous.startedAt, checked <= now + 1000, now - checked <= 60_000,
              let summary = event.evidenceSummary, !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let rawURL = event.reviewURL, let url = URL(string: rawURL),
              url.scheme == "https", ["instacart.com", "www.instacart.com"].contains(url.host?.lowercased() ?? ""),
              url.user == nil, url.password == nil, url.port == nil,
              !["checkout", "payment", "orders"].contains(where: { url.path.lowercased().split(separator: "/").contains(Substring($0)) }) else { return nil }
        return Self(runId: previous.runId, taskId: task.id, sessionId: event.sessionId, title: title,
                    phase: "ready", startedAt: previous.startedAt, expiresAt: now + 120_000,
                    reviewURL: url, detail: "Cart ready for review")
    }
}

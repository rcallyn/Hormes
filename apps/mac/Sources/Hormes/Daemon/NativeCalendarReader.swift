import Foundation
import EventKit

/// Data-only seam: headless checks exercise date bounds, calendar filtering, and permission behavior.
@MainActor
protocol NativeCalendarSource {
    var permission: String { get }
    func requestPermission() async throws -> Bool
    func refresh()
    func calendars() -> [CalendarReadSource]
    func events(start: Date, end: Date, calendarIds: Set<String>) -> [CalendarReadEvent]
}

@MainActor
private final class EventKitCalendarSource: NativeCalendarSource {
    private let store = EKEventStore()
    var permission: String {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess: return "granted"
        case .notDetermined: return "not-determined"
        default: return "denied"
        }
    }
    func requestPermission() async throws -> Bool { try await store.requestFullAccessToEvents() }
    func refresh() { store.reset() }
    func calendars() -> [CalendarReadSource] {
        store.calendars(for: .event).map {
            CalendarReadSource(id: String($0.calendarIdentifier.prefix(512)), title: String($0.title.prefix(2000)), account: String($0.source.title.prefix(2000)))
        }
    }
    func events(start: Date, end: Date, calendarIds: Set<String>) -> [CalendarReadEvent] {
        let selected = store.calendars(for: .event).filter { calendarIds.contains($0.calendarIdentifier) }
        // Passing nil/empty to EventKit means all calendars. Never widen a failed selected-ID lookup.
        guard !selected.isEmpty else { return [] }
        return store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: selected)).compactMap { event in
            guard let id = event.eventIdentifier, let start = event.startDate, let end = event.endDate, let calendar = event.calendar else { return nil }
            return CalendarReadEvent(id: String(id.prefix(512)), title: String((event.title ?? "Calendar event").prefix(2000)),
                startsAt: (start.timeIntervalSince1970 * 1000).rounded(), endsAt: (end.timeIntervalSince1970 * 1000).rounded(),
                calendar: String(calendar.title.prefix(2000)), sourceCalendarId: String(calendar.calendarIdentifier.prefix(512)), allDay: event.isAllDay)
        }
    }
}

@MainActor
enum NativeCalendarReader {
    static func window(_ request: CalendarReadRequest, now: Date, timeZone: TimeZone) -> DateInterval? {
        guard !request.id.isEmpty, request.id.count <= 512, (1...7).contains(request.days), request.calendarIds.count <= 200,
              request.calendarIds.allSatisfy({ !$0.isEmpty && $0.count <= 512 }) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let start: Date
        if let raw = request.startDate {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = calendar; formatter.timeZone = timeZone
            formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
            guard raw.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
                  let parsed = formatter.date(from: raw), formatter.string(from: parsed) == raw else { return nil }
            start = calendar.startOfDay(for: parsed)
        } else { start = calendar.startOfDay(for: now) }
        guard let end = calendar.date(byAdding: .day, value: request.days, to: start) else { return nil }
        return DateInterval(start: start, end: end)
    }

    static func read(_ request: CalendarReadRequest, source: (any NativeCalendarSource)? = nil,
                     now: Date = Date(), timeZone: TimeZone = .current) async -> CalendarReadResult {
        var result = CalendarReadResult(id: request.id, ok: false, error: nil, permission: nil,
            timeZone: timeZone.identifier, startsAt: 0, endsAt: 0, readAt: (now.timeIntervalSince1970 * 1000).rounded(), calendars: [], events: [], truncated: false)
        guard let window = window(request, now: now, timeZone: timeZone) else {
            result.error = "Calendar query needs a valid local date and a range of 1–7 days."; return result
        }
        result.startsAt = (window.start.timeIntervalSince1970 * 1000).rounded()
        result.endsAt = (window.end.timeIntervalSince1970 * 1000).rounded()
        let source = source ?? EventKitCalendarSource()
        result.permission = source.permission
        do {
            if source.permission == "not-determined" {
                _ = try await source.requestPermission()
                result.permission = source.permission
            }
            guard source.permission == "granted" else {
                result.error = "Calendar read access is unavailable. Enable full Calendar access for Hormes in macOS Privacy & Security."; return result
            }
            source.refresh()
            let available = source.calendars().sorted { ($0.account, $0.title, $0.id) < ($1.account, $1.title, $1.id) }
            let requested = Set(request.calendarIds)
            if !requested.isEmpty && !requested.isSubset(of: Set(available.map(\.id))) {
                result.error = "A selected calendar is no longer available. Refresh the calendar selection before retrying."; return result
            }
            let matching = requested.isEmpty ? available : available.filter { requested.contains($0.id) }
            result.calendars = Array(matching.prefix(200))
            let selected = Set(result.calendars.map(\.id))
            let events = selected.isEmpty ? [] : source.events(start: window.start, end: window.end, calendarIds: selected)
                .filter { selected.contains($0.sourceCalendarId) && $0.startsAt.isFinite && $0.endsAt.isFinite && $0.endsAt >= $0.startsAt && $0.startsAt < result.endsAt && $0.endsAt >= result.startsAt }
                .sorted { ($0.startsAt, $0.endsAt, $0.id, $0.title) < ($1.startsAt, $1.endsAt, $1.id, $1.title) }
            result.events = Array(events.prefix(200))
            result.truncated = matching.count > 200 || events.count > 200
            result.readAt = (Date().timeIntervalSince1970 * 1000).rounded()
            result.ok = true
            return result
        } catch {
            result.error = String("Calendar could not be read: \(error.localizedDescription)".prefix(2000)); return result
        }
    }
}

import Foundation

@MainActor final class FakeCalendarSource: NativeCalendarSource {
    var permission = "granted"
    var requests = 0, refreshes = 0, reads = 0
    var readIds = Set<String>()
    var available = [CalendarReadSource(id: "school", title: "Classes", account: "Local"), CalendarReadSource(id: "personal", title: "Personal", account: "Local")]
    var rows: [CalendarReadEvent] = []
    func requestPermission() async throws -> Bool { requests += 1; permission = "granted"; return true }
    func refresh() { refreshes += 1 }
    func calendars() -> [CalendarReadSource] { available }
    func events(start: Date, end: Date, calendarIds: Set<String>) -> [CalendarReadEvent] { reads += 1; readIds = calendarIds; return rows }
}
@main struct CalendarReadChecks {
    @MainActor static func main() async {
        var checks = 0
        func check(_ value: Bool, _ message: String) {
            guard value else { fatalError("FAIL: " + message) }
            checks += 1; print("PASS: " + message)
        }
        let zone = TimeZone(identifier: "America/New_York")!
        let now = Date(timeIntervalSince1970: 1772950000)
        var query = CalendarReadRequest(id: "query", startDate: "2026-03-08", days: 1, calendarIds: [])
        let window = NativeCalendarReader.window(query, now: now, timeZone: zone)!
        check(window.duration == 23 * 3600, "local calendar day respects spring DST instead of adding 24 hours")
        query.startDate = "2026-11-01"
        check(NativeCalendarReader.window(query, now: now, timeZone: zone)!.duration == 25 * 3600, "fall DST query covers 25-hour local day")
        query.startDate = "2026-02-30"
        check(NativeCalendarReader.window(query, now: now, timeZone: zone) == nil, "impossible local date rejected")
        query.startDate = "2026-03-08"; query.days = 8
        let invalid = FakeCalendarSource(); invalid.permission = "not-determined"
        let rejected = await NativeCalendarReader.read(query, source: invalid, now: now, timeZone: zone)
        check(!rejected.ok && invalid.requests == 0 && invalid.reads == 0, "invalid queries neither prompt nor read")
        query.days = 1
        let source = FakeCalendarSource()
        var receipt = await NativeCalendarReader.read(query, source: source, now: now, timeZone: zone)
        check(receipt.ok && source.requests == 0 && source.refreshes == 1, "existing access reads freshly without permission prompt")
        check(source.readIds == Set(["school", "personal"]), "explicit unselected query reads all available calendars")
        query.calendarIds = ["school"]
        receipt = await NativeCalendarReader.read(query, source: source, now: now, timeZone: zone)
        check(receipt.ok && source.readIds == Set(["school"]), "selected calendar query remains confined")
        query.calendarIds = ["missing"]
        let before = source.reads
        receipt = await NativeCalendarReader.read(query, source: source, now: now, timeZone: zone)
        check(!receipt.ok && source.reads == before, "stale selected calendar never widens to all calendars")
        query.calendarIds = []
        let denied = FakeCalendarSource(); denied.permission = "denied"
        receipt = await NativeCalendarReader.read(query, source: denied, now: now, timeZone: zone)
        check(!receipt.ok && receipt.permission == "denied" && denied.requests == 0 && denied.reads == 0, "denied access reports error without repeated permission request")
        let first = FakeCalendarSource(); first.permission = "not-determined"
        receipt = await NativeCalendarReader.read(query, source: first, now: now, timeZone: zone)
        check(receipt.ok && first.requests == 1, "only undetermined access requests permission")
        source.rows = (0..<201).map { CalendarReadEvent(id: String($0), title: "Class", startsAt: window.start.timeIntervalSince1970 * 1000 + Double($0), endsAt: window.end.timeIntervalSince1970 * 1000, calendar: "Classes", sourceCalendarId: "school", allDay: false) }
        receipt = await NativeCalendarReader.read(query, source: source, now: now, timeZone: zone)
        check(receipt.events.count == 200 && receipt.truncated, "oversized query explicitly reports truncation")
        let encoded = EngineCommand.calendarResult(receipt).json
        check(encoded["type"] as? String == "calendar.result" && (encoded["result"] as? [String: Any])?["readAt"] != nil, "wire receipt carries correlated fresh timestamp")
        source.available = []
        receipt = await NativeCalendarReader.read(query, source: source, now: now, timeZone: zone)
        check(receipt.ok && receipt.events.isEmpty && receipt.calendars.isEmpty, "no calendars yields genuine empty result without nil-filter broadening")
        print("\(checks)/\(checks) native calendar checks passed; fake source only, no EventKit access or app launched")
    }
}

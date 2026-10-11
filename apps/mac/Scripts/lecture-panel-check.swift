import Foundation

public struct LedgerHit: Equatable {}

@main struct LecturePanelChecks {
    static func main() throws {
        var checks = 0
        func check(_ value: Bool, _ message: String) {
            guard value else { fatalError("FAIL: " + message) }
            checks += 1; print("PASS: " + message)
        }
        let json = #"{"status":"recording","sourceId":"lecture-source","revision":2,"captureId":"capture-1","draft":"The teacher keeps speaking.","answer":{"requestId":"question-1","question":"Why do prices clear the market?","status":"ready","text":"Prices adjust until supply and demand match.","at":1234,"sourceIds":["lecture-source"]}}"#
        let lecture = try JSONDecoder().decode(HormesLecture.self, from: Data(json.utf8))
        check(lecture.status == "recording" && lecture.captureId == "capture-1", "written answer preserves the recording state and capture identity")
        check(lecture.draft == "The teacher keeps speaking.", "teacher captions coexist with a separate answer")
        check(lecture.answer?.text == "Prices adjust until supply and demand match." && lecture.answer?.sourceIds == ["lecture-source"], "answer text and original source provenance decode")
        let restored = try JSONDecoder().decode(HormesLecture.self, from: JSONEncoder().encode(lecture))
        check(restored == lecture, "caption, capture and written answer round-trip")
        let old = try JSONDecoder().decode(HormesLecture.self, from: Data(#"{"status":"recording","sourceId":"old-source","revision":1}"#.utf8))
        check(old.answer == nil, "existing saved lectures need no fabricated answer")
        check(LecturePanelLayout.height(230, sessionId: "s", activeId: "s", mode: "class") == 260, "short caption uses compact notch size")
        check(LecturePanelLayout.height(451.2, sessionId: "s", activeId: "s", mode: "class") == 452, "answer content grows panel by measured height")
        check(LecturePanelLayout.height(100_000, sessionId: "s", activeId: "s", mode: "class") == 640, "large answers cannot create an unbounded native panel")
        check(LecturePanelLayout.height(.infinity, sessionId: "s", activeId: "s", mode: "class") == nil && LecturePanelLayout.height(.nan, sessionId: "s", activeId: "s", mode: "class") == nil, "nonfinite web measurements are rejected")
        check(LecturePanelLayout.height(-1, sessionId: "s", activeId: "s", mode: "class") == nil, "negative measurements are rejected")
        check(LecturePanelLayout.height(450, sessionId: "old", activeId: "new", mode: "class") == nil, "late measurements cannot resize a new session")
        check(LecturePanelLayout.height(450, sessionId: "s", activeId: "s", mode: "study") == nil, "lecture measurement cannot resize an unrelated workspace")
        check(!LecturePanelLayout.allowsSpeech(mode: "class"), "class written replies cannot use native fallback speech")
        check(LecturePanelLayout.allowsSpeech(mode: "study") && LecturePanelLayout.allowsSpeech(mode: "meeting"), "unrelated mode speech behavior is retained")
        print("\(checks) lecture protocol and panel checks passed")
    }
}

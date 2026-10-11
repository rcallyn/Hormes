import XCTest
@testable import HormesPhone

final class ReviewStoreTests: XCTestCase {
    @MainActor func fixture() -> (ReviewStore, URL, PhoneQuiz) {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("reviews.json")
        let quiz = PhoneQuiz(version: 1, id: "quiz", sessionId: "session", deckId: "deck", title: "Economics", demo: false, issuedAt: 1, goalVersion: 1, cards: [
            QuizCard(id: "one", front: "What is opportunity cost?", options: ["Best alternative forgone", "All expenditure"], correctOption: 0, explanation: "The best alternative forgone."),
            QuizCard(id: "two", front: "A budget describes…", options: ["Affordability", "Desire"], correctOption: 0, explanation: "Affordable combinations.")
        ], answers: [], limitation: "Review, not mastery")
        return (ReviewStore(file: file), file, quiz)
    }
    @MainActor func testOfflineAnswerSurvivesRelaunchAndDuplicateTap() throws {
        let (store, file, quiz) = fixture()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        try store.accept(quiz)
        try store.answer(quizId: quiz.id, cardId: "one", choice: 0)
        try store.answer(quizId: quiz.id, cardId: "one", choice: 0)
        XCTAssertEqual(store.pendingCount, 1)
        XCTAssertThrowsError(try store.answer(quizId: quiz.id, cardId: "one", choice: 1))
        let restored = ReviewStore(file: file)
        XCTAssertEqual(restored.current?.selected?.submission.choiceIndex, 0)
        XCTAssertEqual(restored.pendingCount, 1)
        XCTAssertEqual(restored.current?.selected?.submission.attemptId, store.current?.selected?.submission.attemptId)
        try restored.advance(quizId: quiz.id, cardId: "one")
        XCTAssertEqual(restored.current?.current?.id, "two")
        XCTAssertThrowsError(try restored.advance(quizId: quiz.id, cardId: "two"))
    }
    @MainActor func testActivityStateHasNoAnswerKeyAndLargeQuestionOpensApp() throws {
        let (store, file, quiz) = fixture()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        try store.accept(quiz)
        let state = store.content(for: store.current!)
        let json = String(data: try JSONEncoder().encode(state), encoding: .utf8)!
        XCTAssertFalse(json.contains("correctOption"))
        XCTAssertFalse(json.contains("explanation"))
        XCTAssertEqual(state.feedback, "")
        XCTAssertLessThan(try JSONEncoder().encode(state).count, 3000)
        var long = quiz
        long.id = "long"; long.cards[0].front = String(repeating: "word ", count: 100)
        try store.accept(long); try store.select(long.id)
        XCTAssertTrue(store.content(for: store.current!).needsApp)
        XCTAssertTrue(store.content(for: store.current!).options.isEmpty)
    }
    @MainActor func testRemoteAnswersAreRetainedAndUnsyncedReviewsAreNotEvicted() throws {
        let (store, file, quiz) = fixture()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        var remote = quiz
        remote.answers = [QuizReferenceAnswer(cardId: "one", choiceIndex: 1, result: "incorrect", assisted: true)]
        try store.accept(remote)
        XCTAssertEqual(store.current?.current?.id, "two")
        XCTAssertTrue(store.current!.answers[0].synced)
        XCTAssertTrue(store.current!.answers[0].assisted)
        try store.answer(quizId: quiz.id, cardId: "two", choice: 0)
        for n in 0..<25 { var another = quiz; another.id = "quiz_\(n)"; try store.accept(another) }
        XCTAssertTrue(store.cache.reviews.contains { $0.id == quiz.id })
        XCTAssertEqual(store.pendingCount, 1)
    }
    /// Optional local fixture check: never contacts a production pairing.
    @MainActor func testPairedMacSync() async throws {
        guard let text = ProcessInfo.processInfo.environment["HORMES_TEST_PHONE_PAIR_LINK"], let url = URL(string: text),
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.queryItems?.contains(where: { $0.name == "host" && $0.value == "127.0.0.1" }) == true,
              parts.queryItems?.contains(where: { $0.name == "port" && $0.value == "47839" }) == true,
              PhoneKeychain.read() == nil else { throw XCTSkip("Run the explicit loopback integration fixture with an unpaired simulator.") }
        defer { PhoneKeychain.delete() }
        await ReviewStore.shared.pair(url)
        let store = ReviewStore.shared
        guard store.paired else { return XCTFail(store.message ?? "Pairing could not complete") }
        try await store.synchronize()
        guard let review = store.cache.reviews.first(where: { $0.quiz.title == "Phone integration fixture" }) else { return XCTFail("The paired Mac quiz was not downloaded") }
        try store.select(review.id)
        for card in review.quiz.cards {
            try store.answer(quizId: review.id, cardId: card.id, choice: 0)
            try store.advance(quizId: review.id, cardId: card.id)
        }
        try await store.synchronize()
        XCTAssertTrue(store.current!.answers.allSatisfy(\.synced))
        XCTAssertEqual(store.current!.completed, 2)
        struct Download: Decodable { var quiz: PhoneQuiz? }
        let scoped: Download = try await PhoneConnection(pairing: PhoneKeychain.read()!).request("/v1/quiz?id=\(review.id)")
        XCTAssertEqual(scoped.quiz?.id, review.id)
        let ids = store.current!.answers.map { $0.submission.attemptId }
        try await store.synchronize()
        XCTAssertEqual(store.current!.answers.map { $0.submission.attemptId }, ids)
    }

    func testMacEncryptedDeliveryDecodesOnlyForItsPairedPhone() throws {
        let sealed = "v1.FEEGWbfFSRILOyo3ZQ67AuMIZtvdKoMDXjLvlzyvfWzHhGaO8ltfW3GRr3ibkEwd4A3+dqI1/Eu/v6I0w4t20hCMkaq5nVXtCSjU963lga4jv9TmKl0nDXKrHfIosdF24Hc62+9ovQMPY4CAdteFBhHe0K8gOEkOKS9yW3OudteMBFNBWBlujecMXMaqPkXApv92IvzoqOalY8jrPsyWjnykdsIZWX2TgUbLxBHaz8DxpjweGJpcNjlJJtsQwm3IJ10605g5QtXy7CifGwy5/lyPDe8qcQh6oXj7G4Pd9LceIA=="
        let id = "phone_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let quiz = try ReviewDeliveryCodec.decode(sealed, token: "test-pairing-token", quizId: id)
        XCTAssertEqual(quiz.title, "Delivery fixture")
        XCTAssertEqual(quiz.cards[0].correctOption, 1)
        XCTAssertThrowsError(try ReviewDeliveryCodec.decode(sealed, token: "another-phone", quizId: id))
        XCTAssertThrowsError(try ReviewDeliveryCodec.decode(sealed, token: "test-pairing-token", quizId: "different-review"))
    }

    @MainActor func testUnreadableCacheIsPreserved() throws {
        let (store, file, quiz) = fixture()
        _ = store
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let original = Data("damaged cache".utf8)
        try original.write(to: file)
        let restored = ReviewStore(file: file)
        XCTAssertThrowsError(try restored.accept(quiz))
        XCTAssertEqual(try Data(contentsOf: file), original)
    }
}

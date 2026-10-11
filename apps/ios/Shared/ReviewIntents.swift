import AppIntents
import Foundation

struct AnswerReviewIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Answer review question"
    static var openAppWhenRun = false
    @Parameter(title: "Review") var quizId: String
    @Parameter(title: "Question") var cardId: String
    @Parameter(title: "Choice") var choice: Int
    init() {}
    init(quizId: String, cardId: String, choice: Int) { self.quizId = quizId; self.cardId = cardId; self.choice = choice }
    func perform() async throws -> some IntentResult {
        // LiveActivityIntent runs in the app process; the widget has no answer key or storage access.
        #if HORMES_PHONE_APP
        let store = await ReviewStore.shared
        await store.prepareDelivery(quizId: quizId)
        do {
            try await store.answer(quizId: quizId, cardId: cardId, choice: choice)
            await store.updateActivity()
            try? await store.synchronize()
        } catch { await MainActor.run { store.message = error.localizedDescription } }
        #endif
        return .result()
    }
}
struct NextReviewIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Next review question"
    static var openAppWhenRun = false
    @Parameter(title: "Review") var quizId: String
    @Parameter(title: "Question") var cardId: String
    init() {}
    init(quizId: String, cardId: String) { self.quizId = quizId; self.cardId = cardId }
    func perform() async throws -> some IntentResult {
        #if HORMES_PHONE_APP
        let store = await ReviewStore.shared
        await store.prepareDelivery(quizId: quizId)
        do { try await store.advance(quizId: quizId, cardId: cardId); await store.updateActivity() }
        catch { await MainActor.run { store.message = error.localizedDescription } }
        #endif
        return .result()
    }
}

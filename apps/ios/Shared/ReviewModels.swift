import ActivityKit
import Foundation

struct QuizCard: Codable, Equatable, Identifiable {
    var id: String
    var front: String
    var options: [String]
    var correctOption: Int
    var explanation: String
}
struct QuizReferenceAnswer: Codable, Equatable {
    var cardId: String
    var choiceIndex: Int
    var result: String
    var assisted: Bool
}
struct PhoneQuiz: Codable, Equatable, Identifiable {
    var version: Int
    var id, sessionId, deckId, title: String
    var demo: Bool
    var issuedAt: Double
    var goalVersion: Int
    var cards: [QuizCard]
    var answers: [QuizReferenceAnswer]
    var limitation: String
    func validate() throws {
        guard version == 1, !id.isEmpty, cards.count > 0, cards.count <= 20,
              Set(cards.map(\.id)).count == cards.count,
              cards.allSatisfy({ !$0.front.isEmpty && $0.options.count >= 2 && $0.options.count <= 6 && $0.options.indices.contains($0.correctOption) }) else {
            throw PhoneError.message("This review could not be downloaded. Refresh it from the Mac.")
        }
    }
}
struct PhoneAnswer: Codable, Equatable {
    var attemptId, quizId, cardId: String
    var choiceIndex: Int
    var answeredAt: Double
}
struct SavedAnswer: Codable, Equatable {
    var submission: PhoneAnswer
    var synced: Bool
    var assisted = false
    var error: String?
}
struct CachedReview: Codable, Equatable, Identifiable {
    var quiz: PhoneQuiz
    var macFingerprint: String?
    var cursor = 0
    var answers: [SavedAnswer] = []
    var id: String { quiz.id }
    var completed: Int { answers.count }
    var current: QuizCard? { quiz.cards.indices.contains(cursor) ? quiz.cards[cursor] : nil }
    var selected: SavedAnswer? { current.flatMap { c in answers.first { $0.submission.cardId == c.id } } }
}
struct PhoneCache: Codable {
    var reviews: [CachedReview] = []
    var currentId: String?
}
struct Pairing: Codable {
    var host: String
    var port: Int
    var fingerprint: String
    var token: String
    var deviceId: String
}
enum PhoneError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

struct ReviewActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var cardId: String
        var title: String
        var question: String
        var options: [String]
        var index, total, completed: Int
        var answered: Bool
        var correct: Bool
        var feedback: String
        var demo: Bool
        var needsApp: Bool
    }
    var quizId: String
    var sealedQuiz: String? = nil
}

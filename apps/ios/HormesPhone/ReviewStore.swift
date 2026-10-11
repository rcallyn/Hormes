import ActivityKit
import Combine
import Foundation
import UIKit

@MainActor
final class ReviewStore: ObservableObject {
    static let shared = ReviewStore()
    @Published private(set) var cache = PhoneCache()
    @Published private(set) var paired = false
    @Published var message: String?
    @Published private(set) var busy = false
    @Published var automaticDeliveryReady = false
    @Published private(set) var islandActive = false
    var deliveryStarted = false
    var deliveryToken: String?
    private let file: URL
    private var readable = true
    private var syncing = false
    private var generation = 0
    init(file: URL? = nil) {
        self.file = file ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("phone-reviews.json")
        paired = PhoneKeychain.read() != nil
        if FileManager.default.fileExists(atPath: self.file.path) {
            do { cache = try JSONDecoder().decode(PhoneCache.self, from: Data(contentsOf: self.file)) }
            catch { readable = false; message = "Saved reviews could not be read. Your original file has been preserved." }
        }
    }
    var current: CachedReview? { cache.reviews.first { $0.id == cache.currentId } }
    var pendingCount: Int { cache.reviews.flatMap(\.answers).filter { !$0.synced }.count }
    private func save(_ next: PhoneCache) throws {
        guard readable else { throw PhoneError.message("Saved reviews could not be read. Your original file has been preserved.") }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(next).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        cache = next
    }
    func accept(_ quiz: PhoneQuiz) throws {
        try quiz.validate()
        var next = cache
        if let index = next.reviews.firstIndex(where: { $0.id == quiz.id }) {
            guard next.reviews[index].quiz.cards == quiz.cards else { throw PhoneError.message("The saved review changed unexpectedly. Keep your answers and refresh from the Mac.") }
            for remote in quiz.answers where !next.reviews[index].answers.contains(where: { $0.submission.cardId == remote.cardId }) {
                guard quiz.cards.contains(where: { $0.id == remote.cardId && $0.options.indices.contains(remote.choiceIndex) }) else { continue }
                next.reviews[index].answers.append(SavedAnswer(submission: PhoneAnswer(attemptId: UUID().uuidString, quizId: quiz.id, cardId: remote.cardId, choiceIndex: remote.choiceIndex, answeredAt: Date().timeIntervalSince1970 * 1000), synced: true, assisted: remote.assisted))
            }
        } else {
            var review = CachedReview(quiz: quiz, macFingerprint: PhoneKeychain.read()?.fingerprint)
            for remote in quiz.answers {
                guard quiz.cards.contains(where: { $0.id == remote.cardId && $0.options.indices.contains(remote.choiceIndex) }) else { continue }
                review.answers.append(SavedAnswer(submission: PhoneAnswer(attemptId: UUID().uuidString, quizId: quiz.id, cardId: remote.cardId, choiceIndex: remote.choiceIndex, answeredAt: Date().timeIntervalSince1970 * 1000), synced: true, assisted: remote.assisted))
            }
            review.cursor = quiz.cards.firstIndex(where: { card in !review.answers.contains { $0.submission.cardId == card.id } }) ?? quiz.cards.count
            next.reviews.append(review)
        }
        next.currentId = quiz.id
        // Never evict a review with an answer awaiting acknowledgement.
        if next.reviews.count > 20 {
            let removable = next.reviews.filter { $0.id != next.currentId && $0.completed == $0.quiz.cards.count && $0.answers.allSatisfy(\.synced) }.prefix(next.reviews.count - 20).map(\.id)
            next.reviews.removeAll { removable.contains($0.id) }
        }
        try save(next)
    }
    #if DEBUG
    func resetDemo() throws {
        var next = cache
        next.reviews.removeAll { $0.id == "phone_demo" }
        if next.currentId == "phone_demo" { next.currentId = nil }
        try save(next)
    }
    #endif
    func select(_ id: String) throws {
        guard cache.reviews.contains(where: { $0.id == id }) else { return }
        var next = cache; next.currentId = id; try save(next)
    }
    func answer(quizId: String, cardId: String, choice: Int) throws {
        guard let index = cache.reviews.firstIndex(where: { $0.id == quizId }),
              let card = cache.reviews[index].current, card.id == cardId, card.options.indices.contains(choice) else { throw PhoneError.message("This question changed. Open the current review.") }
        if let saved = cache.reviews[index].answers.first(where: { $0.submission.cardId == cardId }) {
            guard saved.submission.choiceIndex == choice else { throw PhoneError.message("Your first answer is already saved.") }
            return
        }
        var next = cache
        next.reviews[index].answers.append(SavedAnswer(submission: PhoneAnswer(attemptId: UUID().uuidString, quizId: quizId, cardId: cardId, choiceIndex: choice, answeredAt: Date().timeIntervalSince1970 * 1000), synced: false))
        try save(next)
        message = "Saved on this iPhone."
    }
    func advance(quizId: String, cardId: String) throws {
        guard let index = cache.reviews.firstIndex(where: { $0.id == quizId }), cache.reviews[index].current?.id == cardId,
              cache.reviews[index].selected != nil else { throw PhoneError.message("Answer the current question first.") }
        var next = cache
        next.reviews[index].cursor += 1
        try save(next)
    }
    func pair(_ url: URL) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do {
            guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), parts.scheme == "hormes", parts.host == "pair" else { throw PhoneError.message("Scan the pairing QR code in Hormes on your Mac.") }
            let items = parts.queryItems ?? []
            func get(_ name: String) -> String? { items.first { $0.name == name }?.value }
            guard let host = get("host"), host.split(separator: ".").count == 4, host.split(separator: ".").allSatisfy({ UInt8($0) != nil }),
                  let portText = get("port"), let port = Int(portText), (1...65535).contains(port),
                  let fingerprint = get("fingerprint"), fingerprint.count == 64, fingerprint.allSatisfy({ $0.isHexDigit }),
                  let code = get("code"), code.count >= 32 else { throw PhoneError.message("The pairing QR code is invalid. Generate a fresh one on the Mac.") }
            var credentials = Pairing(host: host, port: port, fingerprint: fingerprint.lowercased(), token: "", deviceId: "")
            struct Request: Encodable { var code: String; var name: String }
            struct Reply: Decodable { var deviceId, token: String }
            let reply: Reply = try await PhoneConnection(pairing: credentials).request("/v1/pair", body: JSONEncoder().encode(Request(code: code, name: UIDevice.current.name)))
            credentials.deviceId = reply.deviceId; credentials.token = reply.token
            generation += 1
            try PhoneKeychain.save(credentials)
            paired = true; message = "Paired with your Mac."
            try await synchronize()
            await updateActivity(startIfNeeded: true)
            await registerDelivery()
        } catch { message = error.localizedDescription }
    }
    func refresh() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do { try await synchronize(); await registerDelivery() }
        catch { message = "\(error.localizedDescription) Your saved answers are still on this iPhone." }
        await updateActivity(startIfNeeded: true)
    }
    func synchronize() async throws {
        guard !syncing else { return }
        guard let pairing = PhoneKeychain.read() else { throw PhoneError.message("Pair this iPhone in Hormes on your Mac.") }
        syncing = true; defer { syncing = false }
        let revision = generation, connection = PhoneConnection(pairing: pairing)
        struct Batch: Encodable { var answers: [PhoneAnswer] }
        struct Receipt: Decodable { var attemptId, recordId, cardId, result: String; var assisted: Bool }
        struct Rejected: Decodable { var attemptId, error: String }
        struct Acknowledgement: Decodable { var receipts: [Receipt]; var rejected: [Rejected] }
        let pending = cache.reviews.filter { $0.macFingerprint == pairing.fingerprint }.flatMap(\.answers).filter { !$0.synced && $0.error == nil }.map(\.submission)
        for offset in stride(from: 0, to: pending.count, by: 20) {
            let batch = Array(pending[offset..<min(offset + 20, pending.count)])
            let reply: Acknowledgement = try await connection.request("/v1/answers", body: JSONEncoder().encode(Batch(answers: batch)))
            guard generation == revision else { return }
            var next = cache
            for r in next.reviews.indices {
                for a in next.reviews[r].answers.indices {
                    let attemptId = next.reviews[r].answers[a].submission.attemptId
                    if let receipt = reply.receipts.first(where: { $0.attemptId == attemptId }) {
                        next.reviews[r].answers[a].synced = true
                        next.reviews[r].answers[a].assisted = receipt.assisted
                    }
                    if let rejected = reply.rejected.first(where: { $0.attemptId == attemptId }) { next.reviews[r].answers[a].error = rejected.error }
                }
            }
            try save(next)
        }
        struct Download: Decodable { var quiz: PhoneQuiz? }
        let download: Download = try await connection.request("/v1/quiz")
        guard generation == revision else { return }
        if let quiz = download.quiz { try accept(quiz) }
        let rejected = cache.reviews.flatMap(\.answers).first { $0.error != nil }
        message = rejected?.error ?? (pendingCount == 0 ? "Synced with your Mac." : "Some answers need review before syncing.")
    }
    func disconnect() async {
        generation += 1; PhoneKeychain.delete(); paired = false; automaticDeliveryReady = false
        for activity in Activity<ReviewActivityAttributes>.activities { await activity.end(nil, dismissalPolicy: .immediate) }
        message = "Disconnected. Saved reviews and answers are still on this iPhone."
    }
    func content(for review: CachedReview) -> ReviewActivityAttributes.ContentState {
        let card = review.current, selected = review.selected
        let fits = card.map { $0.front.count <= 150 && $0.options.count <= 4 && $0.options.allSatisfy { $0.count <= 42 } } ?? true
        var state = ReviewActivityAttributes.ContentState(cardId: card?.id ?? "", title: String(review.quiz.title.prefix(60)), question: String((card?.front ?? "Review complete").prefix(180)), options: fits ? card?.options ?? [] : [], index: min(review.cursor + 1, review.quiz.cards.count), total: review.quiz.cards.count, completed: review.completed, answered: selected != nil || card == nil, correct: card.map { $0.correctOption == selected?.submission.choiceIndex } ?? true, feedback: selected == nil ? "" : String((card?.explanation ?? "").prefix(160)), demo: review.quiz.demo, needsApp: !fits)
        if (try? JSONEncoder().encode(state).count) ?? 4096 > 3200 {
            state.title = "Hormes review"
            state.question = "Open this question on your iPhone"
            state.options = []
            state.feedback = "Your answer is saved. Open the app for the explanation."
            state.needsApp = true
        }
        return state
    }
    func updateActivity(startIfNeeded: Bool = false) async {
        guard let review = current else { islandActive = false; return }
        var state = content(for: review)
        let existing = Activity<ReviewActivityAttributes>.activities.first { $0.attributes.quizId == review.id }
        let attributes = existing?.attributes ?? ReviewActivityAttributes(quizId: review.id)
        let attributeBytes = (try? JSONEncoder().encode(attributes).count) ?? 4000
        func fits() -> Bool { ((try? JSONEncoder().encode(state).count) ?? 4000) + attributeBytes < 4000 }
        if !fits() { state.feedback = "" }
        if !fits() { state.options = []; state.question = "Review question"; state.title = "Class review"; state.needsApp = !state.answered }
        // The private answer key never enters the public Live Activity state.
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(30 * 60))
        for activity in Activity<ReviewActivityAttributes>.activities where activity.attributes.quizId != review.id { await activity.end(nil, dismissalPolicy: .immediate) }
        if let activity = Activity<ReviewActivityAttributes>.activities.first(where: { $0.attributes.quizId == review.id }) {
            if review.current == nil { await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(300))); islandActive = false }
            else { await activity.update(content); islandActive = true }
        } else if startIfNeeded, review.current != nil, UIApplication.shared.applicationState == .active {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { message = "Enable Live Activities for Hormes in iPhone Settings. Your quiz also works here."; return }
            do { _ = try Activity.request(attributes: ReviewActivityAttributes(quizId: review.id), content: content, pushType: nil); islandActive = true }
            catch { message = "The review is saved. Dynamic Island could not start: \(error.localizedDescription)" }
        }
    }
}

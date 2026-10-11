import ActivityKit
import CryptoKit
import Foundation

enum ReviewDeliveryCodec {
    static func decode(_ sealed: String, token: String, quizId: String) throws -> PhoneQuiz {
        guard sealed.hasPrefix("v1."), let data = Data(base64Encoded: String(sealed.dropFirst(3))), data.count <= 4000 else { throw PhoneError.message("The delivered review could not be read.") }
        let key = SymmetricKey(data: SHA256.hash(data: Data(token.utf8)))
        let compressed = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key)
        let plain = try (compressed as NSData).decompressed(using: .zlib) as Data
        guard plain.count <= 128_000 else { throw PhoneError.message("The delivered review is too large.") }
        let quiz = try JSONDecoder().decode(PhoneQuiz.self, from: plain)
        try quiz.validate()
        guard quiz.id == quizId else { throw PhoneError.message("This delivery belongs to a different review.") }
        return quiz
    }
}

extension ReviewStore {
    /// Observers run at process launch, including Apple's background push-to-start launch.
    func startDelivery() {
        guard !deliveryStarted else { return }
        deliveryStarted = true
        Task {
            for activity in Activity<ReviewActivityAttributes>.activities { await receive(activity) }
            for await activity in Activity<ReviewActivityAttributes>.activityUpdates { await receive(activity) }
        }
        if #available(iOS 17.2, *) {
            Task {
                for await token in Activity<ReviewActivityAttributes>.pushToStartTokenUpdates {
                    deliveryToken = token.map { String(format: "%02x", $0) }.joined()
                    await registerDelivery()
                }
            }
        }
    }
    func registerDelivery() async {
        guard let pairing = PhoneKeychain.read() else { return }
        if #available(iOS 17.2, *), deliveryToken == nil {
            deliveryToken = Activity<ReviewActivityAttributes>.pushToStartToken?.map { String(format: "%02x", $0) }.joined()
        }
        guard let token = deliveryToken else { return }
        struct Registration: Encodable { let token: String; let runningQuizId: String? }
        struct Reply: Decodable { let configured: Bool }
        let running = Activity<ReviewActivityAttributes>.activities.first?.attributes.quizId
        do {
            let reply: Reply = try await PhoneConnection(pairing: pairing).request("/v1/push-token", body: JSONEncoder().encode(Registration(token: token, runningQuizId: running)))
            automaticDeliveryReady = reply.configured
        } catch { /* Offline answers and cached activities do not depend on registration. */ }
    }
    func prepareDelivery(quizId: String) async {
        if !cache.reviews.contains(where: { $0.id == quizId }), let activity = Activity<ReviewActivityAttributes>.activities.first(where: { $0.attributes.quizId == quizId }) {
            await receive(activity)
        }
    }
    private func receive(_ activity: Activity<ReviewActivityAttributes>) async {
        guard let pairing = PhoneKeychain.read() else { return }
        let id = activity.attributes.quizId
        do {
            if let sealed = activity.attributes.sealedQuiz {
                try accept(ReviewDeliveryCodec.decode(sealed, token: pairing.token, quizId: id))
            } else if !cache.reviews.contains(where: { $0.id == id }) {
                struct Download: Decodable { var quiz: PhoneQuiz? }
                let reply: Download = try await PhoneConnection(pairing: pairing).request("/v1/quiz?id=\(id)")
                guard let quiz = reply.quiz, quiz.id == id else { throw PhoneError.message("Reconnect to your Mac to download this review.") }
                try accept(quiz)
            }
            guard cache.reviews.contains(where: { $0.id == id && $0.macFingerprint == pairing.fingerprint }) else { return }
            try select(id)
            await updateActivity()
        } catch { message = "This review could not download. \(error.localizedDescription)" }
    }
}

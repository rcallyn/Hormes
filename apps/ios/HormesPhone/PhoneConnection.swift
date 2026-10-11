import CryptoKit
import Foundation
import Security

/// Only the pinned Mac certificate is trusted, including during the first QR exchange.
final class PinnedMacSession: NSObject, URLSessionDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    let fingerprint: String
    let host: String
    init(host: String, fingerprint: String) { self.host = host; self.fingerprint = fingerprint }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host == host,
              let trust = challenge.protectionSpace.serverTrust,
              let certificates = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let cert = certificates.first else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        let actual = SHA256.hash(data: SecCertificateCopyData(cert) as Data).map { String(format: "%02x", $0) }.joined()
        guard actual == fingerprint else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct PhoneFailure: Decodable { var error: String }

struct PhoneConnection {
    let pairing: Pairing
    func request<T: Decodable>(_ path: String, body: Data? = nil) async throws -> T {
        guard var parts = URLComponents(string: "https://\(pairing.host):\(pairing.port)") else { throw PhoneError.message("Pair this iPhone again from Mac Settings.") }
        guard let route = URLComponents(string: path), route.scheme == nil, route.host == nil else { throw PhoneError.message("The review request is invalid.") }
        parts.path = route.path
        parts.query = route.query
        guard let url = parts.url else { throw PhoneError.message("The Mac address is invalid.") }
        var request = URLRequest(url: url)
        request.timeoutInterval = 5
        request.httpMethod = body == nil ? "GET" : "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !pairing.token.isEmpty { request.setValue("Bearer \(pairing.token)", forHTTPHeaderField: "Authorization") }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 5
        config.timeoutIntervalForResource = 8
        let session = URLSession(configuration: config, delegate: PinnedMacSession(host: pairing.host, fingerprint: pairing.fingerprint), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
            throw PhoneError.message((try? JSONDecoder().decode(PhoneFailure.self, from: data).error) ?? "The Mac could not accept this request.")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

enum PhoneKeychain {
    static let service = "com.hormes.phone.pairing"
    static func read() -> Pairing? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "mac", kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var value: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess, let data = value as? Data else { return nil }
        return try? JSONDecoder().decode(Pairing.self, from: data)
    }
    static func save(_ pairing: Pairing) throws {
        let key: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "mac"]
        let data = try JSONEncoder().encode(pairing)
        let status = SecItemUpdate(key as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = key
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw PhoneError.message("The phone could not save the pairing securely.") }
        } else if status != errSecSuccess { throw PhoneError.message("The phone could not update the pairing securely.") }
    }
    static func delete() { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "mac"] as CFDictionary) }
}

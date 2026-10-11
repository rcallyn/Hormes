import Foundation
import LocalAuthentication

/// Internal engine operation; absent from every brain's tool table. A fresh context
/// for one pending action, no reused wake authentication and no speech/password input.
func opOwnerApproval(_ params: Params) throws -> JSONObject {
    let id = try params.requireString("pendingId")
    let description = try params.requireString("description")
    guard !id.isEmpty, !description.isEmpty else { throw HandsError.badRequest("missing approval target") }
    let context = LAContext()
    context.touchIDAuthenticationAllowableReuseDuration = 0
    context.localizedCancelTitle = "Deny"
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
        return ["pendingId": id, "approved": false]
    }
    let done = DispatchSemaphore(value: 0)
    let lock = NSLock()
    var approved = false
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: String(description.prefix(240))) { ok, _ in
        lock.lock(); approved = ok; lock.unlock()
        done.signal()
    }
    guard done.wait(timeout: .now() + 45) == .success else {
        context.invalidate()
        return ["pendingId": id, "approved": false]
    }
    lock.lock(); let result = approved; lock.unlock()
    return ["pendingId": id, "approved": result]
}

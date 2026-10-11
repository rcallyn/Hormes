import XCTest

final class PhoneFlowTests: XCTestCase {
    /// Explicit physical-device acceptance check; ordinary simulator runs skip it.
    @MainActor func testPhysicalPushStartsReviewWhileAppIsBackgrounded() throws {
        guard ProcessInfo.processInfo.environment["HORMES_TEST_PHYSICAL_PUSH"] == "1" else {
            throw XCTSkip("Run explicitly on a provisioned iPhone with Apple Push configured.")
        }
        let app = XCUIApplication()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        addUIInterruptionMonitor(withDescription: "Hormes local network permission") { alert in
            guard alert.label.contains("Hormes") || alert.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'local network'")).count > 0,
                  alert.buttons["Allow"].exists else { return false }
            alert.buttons["Allow"].tap()
            return true
        }
        app.launch()
        if springboard.alerts.buttons["Allow"].waitForExistence(timeout: 2) {
            springboard.alerts.buttons["Allow"].tap()
        }
        if let text = ProcessInfo.processInfo.environment["HORMES_TEST_PHYSICAL_PAIR_LINK"], let url = URL(string: text), url.scheme == "hormes", url.host == "pair" {
            app.open(url)
            if springboard.alerts.buttons["Allow"].waitForExistence(timeout: 2) {
                springboard.alerts.buttons["Allow"].tap()
            }
        }
        XCTAssertTrue(app.buttons["Connection settings"].waitForExistence(timeout: 10))
        app.buttons["Connection settings"].tap()
        guard app.staticTexts["Mac paired"].waitForExistence(timeout: 20) else {
            app.buttons["Done"].tap()
            let failure = XCTAttachment(screenshot: app.screenshot())
            failure.name = "Physical pairing error"; failure.lifetime = .keepAlways; add(failure)
            let visible = app.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " · ")
            XCTFail("The initial local pairing must succeed: \(visible)")
            return
        }
        app.buttons["Done"].tap()
        XCUIDevice.shared.press(.home)
        print("HORMES_PHYSICAL_PUSH_WAITING")
        // The host sends an explicitly labelled demo through real APNs after this marker.
        var delivered = false
        for _ in 0..<20 {
            springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.04)).press(forDuration: 1.2)
            if springboard.buttons["Apple Push"].waitForExistence(timeout: 2) { delivered = true; break }
        }
        let island = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        island.name = "Physical automatic Dynamic Island delivery"; island.lifetime = .keepAlways; add(island)
        XCTAssertTrue(delivered, "Apple Push must start the review without opening the phone app")
        XCTAssertTrue(springboard.wait(for: .runningForeground, timeout: 5))
        app.activate()
        XCTAssertTrue(app.staticTexts["Which service started this review?"].waitForExistence(timeout: 10), "The encrypted review must be cached after background delivery")
    }

    @MainActor func testOfflineQuizAndDynamicIsland() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--demo-review", "--reset-demo"]
        app.launch()
        XCTAssertTrue(app.buttons["answer-0"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["start-island"].exists, "A review must appear automatically, without a start button")
        let phone = XCTAttachment(screenshot: app.screenshot()); phone.name = "Before Dynamic Island"; phone.lifetime = .keepAlways; add(phone)
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        // Dynamic Island is at the top center; expand the running review.
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.04)).press(forDuration: 1.2)
        let option = springboard.buttons["Best forgone alternative"]
        let expanded = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        expanded.name = "Dynamic Island question"; expanded.lifetime = .keepAlways; add(expanded)
        XCTAssertTrue(option.waitForExistence(timeout: 8), "The expanded island must offer answer buttons")
        XCTAssertTrue(springboard.buttons["Total revenue"].isHittable, "The fourth answer must fit inside the expanded island")
        option.tap()
        // A LiveActivityIntent must save the answer without opening the app.
        XCTAssertTrue(springboard.wait(for: .runningForeground, timeout: 5))
        app.activate()
        XCTAssertTrue(app.staticTexts["Correct"].waitForExistence(timeout: 8))
        let answer = XCTAttachment(screenshot: app.screenshot()); answer.name = "Offline answer saved"; answer.lifetime = .keepAlways; add(answer)
        app.swipeUp()
        XCTAssertTrue(app.buttons["next-question"].waitForExistence(timeout: 5)); app.buttons["next-question"].tap()
        XCTAssertTrue(app.staticTexts["A budget constraint describes…"].waitForExistence(timeout: 5))
        app.terminate(); app.launchArguments = ["--demo-review"]; app.launch()
        XCTAssertTrue(app.staticTexts["A budget constraint describes…"].waitForExistence(timeout: 8), "Progress must survive terminating the phone app")
    }
}

import XCTest

/**
 * The demo's "Your Linden sign-in code" (482913) carries its code card in
 * the inbox and in the reader. Copy says "Copied" without opening the
 * conversation, the row still opens it and still swipes.
 */
final class SignInCodeUITests: XCTestCase {
    private let subject = "Your Linden sign-in code"
    private let code = "482913"

    override func setUpWithError() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["OTTER_COPIED_SECONDS"] = "0"
        app.launch()
        let demo = app.buttons["Try the demo mailbox"]
        if demo.waitForExistence(timeout: 3) { demo.tap() }
        XCTAssertTrue(app.buttons["All places"].waitForExistence(timeout: 8), "the inbox didn't open")
    }

    func testCodeCardInInboxAndReader() {
        let app = XCUIApplication()

        XCTAssertTrue(app.buttons["otp-copy"].firstMatch.waitForExistence(timeout: 8), "no code card in the inbox")
        XCTAssertTrue(app.staticTexts[code].exists, "the card shows the wrong code")
        let copyButton = app.buttons["otp-copy"].firstMatch
        XCTAssertGreaterThanOrEqual(copyButton.frame.height, 44, "Copy is smaller than a 44pt target")
        copy(app, "in the inbox")
        XCTAssertTrue(app.buttons["All places"].exists, "Copy opened the conversation")

        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", subject)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "code mail missing from the inbox")
        row.tap()
        XCTAssertTrue(app.staticTexts[subject].waitForExistence(timeout: 5), "tapping the row didn't open the conversation")
        XCTAssertTrue(app.staticTexts[code].waitForExistence(timeout: 5), "no code card in the reader")
        XCTAssertEqual(app.otherElements.matching(identifier: "otp-card").count, 1, "the reader repeats the card")
        copy(app, "in the reader")

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["All places"].waitForExistence(timeout: 5), "didn't come back to the inbox")
        let card = app.otherElements.matching(identifier: "otp-card").allElementsBoundByIndex.first(where: { $0.isHittable })
        XCTAssertNotNil(card, "the read row lost its code card")
        card?.swipeRight()
        XCTAssertTrue(gone(row), "swiping the row on its card didn't archive it")
    }

    private func copy(_ app: XCUIApplication, _ place: String) {
        let buttons = app.buttons.matching(identifier: "otp-copy")
        guard let button = buttons.allElementsBoundByIndex.first(where: { $0.isHittable && $0.label == "Copy code" }) else {
            return XCTFail("no Copy \(place)")
        }
        let copied = buttons.matching(NSPredicate(format: "label == %@", "Copied"))
        let before = copied.count
        button.tap()
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count > %d", before), object: copied)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed, "Copy didn't say Copied \(place)")
    }

    private func gone(_ element: XCUIElement) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter.wait(for: [expectation], timeout: 5) == .completed
    }
}

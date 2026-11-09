import XCTest

/**
 * The demo's "Your Linden sign-in code" (482913) shows its code on a card under
 * the row's subject, with Copy & trash; the reader's card has it too. Each
 * copies the code and trashes the conversation, with Undo.
 */
final class SignInCodeUITests: XCTestCase {
    private let subject = "Your Linden sign-in code"
    private let code = "482913"

    override func setUpWithError() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let demo = app.buttons["Try the demo mailbox"]
        if demo.waitForExistence(timeout: 3) { demo.tap() }
        XCTAssertTrue(app.buttons["All places"].waitForExistence(timeout: 8), "the inbox didn't open")
    }

    func testCopyAndTrashFromTheInboxAndTheReader() {
        let app = XCUIApplication()
        let row = rowButton(app, subject)
        XCTAssertTrue(row.waitForExistence(timeout: 8), "code mail missing from the inbox")
        let cell = cell(app, subject)
        XCTAssertTrue(cell.staticTexts[code].exists, "the row doesn't show the code")

        let button = cell.buttons["otp-copy"]
        XCTAssertEqual(button.label, "Copy code and trash")
        XCTAssertTrue(button.isHittable, "Copy & trash can't be tapped")
        XCTAssertGreaterThanOrEqual(button.frame.width, 44, "Copy & trash is narrower than a 44pt target")
        XCTAssertGreaterThanOrEqual(button.frame.height, 44, "Copy & trash is shorter than a 44pt target")
        XCTAssertTrue(cell.frame.contains(button.frame), "Copy & trash overhangs its row")

        row.tap()
        XCTAssertTrue(app.staticTexts[subject].waitForExistence(timeout: 5), "tapping the row didn't open the conversation")
        XCTAssertEqual(app.otherElements.matching(identifier: "otp-card").count, 1, "the reader repeats the card")
        UIPasteboard.general.string = ""
        app.otherElements["otp-card"].buttons["otp-copy"].tap()
        XCTAssertTrue(gone(app.staticTexts[subject]), "Copy & trash didn't leave the reader")
        if !app.buttons["All places"].exists { app.navigationBars.buttons.element(boundBy: 0).tap() }
        XCTAssertTrue(app.buttons["All places"].waitForExistence(timeout: 5), "didn't come back to the inbox")
        XCTAssertTrue(gone(row), "the reader's Copy & trash didn't trash the conversation")
        app.buttons["Undo"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5), "Undo didn't bring the conversation back")
        XCTAssertEqual(pasted(), code, "the reader's Copy & trash didn't copy the code")
        UIPasteboard.general.string = ""
        app.buttons["otp-copy"].firstMatch.tap()
        XCTAssertTrue(app.buttons["All places"].exists, "Copy & trash opened the conversation")
        XCTAssertTrue(gone(row), "Copy & trash didn't trash the conversation")
        XCTAssertTrue(app.staticTexts["Conversation trashed"].exists, "no Undo after Copy & trash")
        XCTAssertEqual(pasted(), code, "Copy & trash didn't copy the code")
    }

    private func rowButton(_ app: XCUIApplication, _ subject: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", subject)).firstMatch
    }

    /** The runner reading the app's copy asks "Allow Paste", which blocks the read until it's answered. */
    private func pasted() -> String? {
        var string: String?
        let read = expectation(description: "read the pasteboard")
        DispatchQueue.global().async {
            string = UIPasteboard.general.string
            read.fulfill()
        }
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow Paste"]
        if allow.waitForExistence(timeout: 5) { allow.tap() }
        wait(for: [read], timeout: 5)
        return string
    }

    private func cell(_ app: XCUIApplication, _ subject: String) -> XCUIElement {
        app.cells.containing(NSPredicate(format: "label CONTAINS %@", subject)).firstMatch
    }

    private func gone(_ element: XCUIElement) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter.wait(for: [expectation], timeout: 5) == .completed
    }
}

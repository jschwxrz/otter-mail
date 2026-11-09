import Foundation
import Testing
import UIKit
@testable import Otter_Mail

/** packages/shared/src/verification-code.test.ts's cases, and a few of the iPhone's own. Made-up mail only. */
struct VerificationCodeTests {
    @Test(arguments: [
        ("Your verification code", "Your verification code is 482913. It expires in 10 minutes.", "482913"),
        ("482913 is your Instagram code", "Hi Robin, someone tried to log in.", "482913"),
        ("Google verification", "G-482913 is your Google verification code.", "482913"),
        ("Slack confirmation code: Q5Z-7KJ", "Here it is.", "Q5Z-7KJ"),
        ("Sign in to Acme", "Your Acme sign-in code: K7P2QX", "K7P2QX"),
        ("Your verification code for Acme", "Your verification code for Acme is 551204", "551204"),
        ("Sign in to Acme", "Use the code below to sign in.\n\n  482 913  \n\nThis code expires in 10 minutes.", "482913"),
        ("Your one-time passcode", "Hi Robin,\n\n918273\n\nDon't share it with anyone.", "918273"),
        ("Code de vérification", "Votre code de vérification est : 739201", "739201"),
        ("Anmeldung", "Ihr Bestätigungscode lautet 5531.", "5531"),
        ("Verificación", "Tu código de verificación es 120934", "120934"),
        ("Login", "Code: 650 113", "650113"),
    ])
    func findsTheCode(subject: String, body: String, code: String) {
        #expect(VerificationCode.find(subject: subject, body: body) == code)
    }

    @Test(arguments: [
        ("Your flight to Lisbon is confirmed", "Booking reference: 7XQ2LM\n\nFlight TP 1352 · Fri 16 Oct"),
        ("20% off this week", "Use code SAVE20 for 20% off everything."),
        ("Your order has shipped", "Your order #482913 has shipped. Tracking: 1Z999AA10123456784"),
        ("Verify your phone", "Enter the code we texted to your phone.\n\nAcme Inc, 1600 Main Street"),
        ("Your verification code", "Your verification code expires on Oct 28, 2026."),
        ("Need help?", "Call us at (650) 253-0000 if you need a verification code."),
        ("Address", "Please confirm your zip code: 94043"),
        ("Deploy finished", "Your code runs 1000 times faster since the last deploy."),
        ("Weekly digest", "We rewrote your code review flow: 12000 lines in 3 weeks."),
        ("Dinner Saturday?", "Saturday at 7? Bring the bread from the corner bakery."),
        ("Your code", "Sign in with the link: https://acme.example/login?code=482913"),
    ])
    func findsNothing(subject: String, body: String) {
        #expect(VerificationCode.find(subject: subject, body: body) == nil)
    }

    @Test func tellsAPreviewThatNamesACode() {
        #expect(VerificationCode.mentioned(in: "Your Linden sign-in code\nHi, Use this code to sign in: 518306"))
        #expect(!VerificationCode.mentioned(in: "Dinner Saturday?\nBring the bread."))
    }

    @Test(arguments: [
        ("Your Linden sign-in code", "Hi Robin,\n\nUse this code to sign in to Linden:\n\n482913\n\nIt expires in 10 minutes.", "482913"),
        ("Microsoft account security code", "Please use the following security code for the Microsoft account ro***@example.com.\n\nSecurity code: 7291", "7291"),
        ("Apple Account", "Your code is: 120 934. Don't share it with anyone.", "120934"),
        ("GitHub", "Here is your GitHub launch code: 61842307", "61842307"),
        ("Zugangscode", "Ihr Zugangscode: 3381-9920", "33819920"),
        ("Codice", "Il tuo codice di verifica è 774102", "774102"),
        ("Inloggen", "Je verificatiecode is 445566", "445566"),
        ("Sign in", "Your verification code is\u{00A0}482913.", "482913"),
    ])
    func findsOtherSendersCodes(subject: String, body: String, code: String) {
        #expect(VerificationCode.find(subject: subject, body: body) == code)
    }

    @Test(arguments: [
        ("48 hours only: 30% off all hiking gear", "30% off everything for 48 hours. Use code AUTUMN30 at checkout."),
        ("Your gift card", "Your gift card code: 4821 7733"),
        ("Order confirmation", "Your order number is 48213. Use code WELCOME10 next time."),
        ("Your verification code", "Your verification code is 2026."),
        ("Your code", "Your code costs $4821 per seat."),
        ("Sign-in code", "Your sign-in code: 12:45 tomorrow"),
        // JavaScript's \d is ASCII only; so is the port's.
        ("Your code", "Your code is \u{0664}\u{0668}\u{0662}\u{0669}\u{0661}\u{0663}"),
    ])
    func leavesOtherCodesAlone(subject: String, body: String) {
        #expect(VerificationCode.find(subject: subject, body: body) == nil)
    }

    @Test func readsAnHTMLOnlyMessage() {
        let message = Message(
            id: "m", from: Person(name: "Linden", email: "no-reply@linden.example"), to: [], cc: [], date: .now,
            text: "", html: "<table><tr><td>Use this code to sign in to Linden:</td></tr><tr><td style=\"font:600 32px monospace\">482913</td></tr></table>",
            attachments: [], unread: true, starred: false, draft: false, headers: [:]
        )
        let thread = MailThread(id: "t", mailbox: "demo@otter.example", subject: "Your Linden sign-in code", labels: ["INBOX"], messages: [message])
        #expect(thread.verificationCode == "482913")
    }

    @Test func skipsADraftReply() {
        let code = Message(
            id: "m1", from: Person(name: "Linden", email: "no-reply@linden.example"), to: [], cc: [], date: .now,
            text: "Your verification code is 482913.", html: nil, attachments: [], unread: true, starred: false, draft: false, headers: [:]
        )
        var draft = code
        draft.id = "m2"
        draft.text = "Thanks!"
        draft.draft = true
        let thread = MailThread(id: "t2", mailbox: "demo@otter.example", subject: "Sign in", labels: ["INBOX"], messages: [code, draft])
        #expect(thread.verificationCode == "482913")
    }

    private func codeThread(id: String = "t", mailbox: String = "demo@otter.example", messageID: String = "m", subject: String, text: String, html: String? = nil) -> MailThread {
        let message = Message(
            id: messageID, from: Person(name: "Acme", email: "no-reply@acme.example"), to: [], cc: [], date: .now,
            text: text, html: html, attachments: [], unread: false, starred: false, draft: false, headers: [:]
        )
        return MailThread(id: id, mailbox: mailbox, subject: subject, labels: ["INBOX"], messages: [message])
    }

    @Test func readsAgainWhatChanged() {
        // Same message id and text length, other mailbox, other subject or other HTML: each is its own answer.
        #expect(codeThread(mailbox: "a@example.com", subject: "Sign in", text: "Your verification code is 482913.").verificationCode == "482913")
        #expect(codeThread(mailbox: "b@example.com", subject: "Sign in", text: "Your verification code is 551204.").verificationCode == "551204")
        #expect(codeThread(subject: "Your gift card", text: "Your card code: 482913").verificationCode == nil)
        #expect(codeThread(subject: "Your sign-in code", text: "Your card code: 482913").verificationCode == "482913")
        #expect(codeThread(subject: "Sign in", text: "", html: "<p>Your verification code is 739201.</p>").verificationCode == "739201")
        #expect(codeThread(subject: "Sign in", text: "", html: "<p>Your verification code is 120934.</p>").verificationCode == "120934")
        #expect(codeThread(subject: "Sign in", text: "", html: "<p>Dinner on Saturday?</p>").verificationCode == nil)
    }

    @Test func listsTheCodeOnlyWhileItIsFresh() {
        let thread = codeThread(subject: "Sign in", text: "Your verification code is 482913.")
        let sent = thread.messages[0].date
        #expect(thread.freshVerificationCode(now: sent.addingTimeInterval(10 * 60)) == "482913")
        #expect(thread.freshVerificationCode(now: sent.addingTimeInterval(MailThread.freshCodeAge)) == nil)
        #expect(thread.verificationCode == "482913")
    }

    @Test func copyPutsTheCodeOnThePasteboard() throws {
        let pasteboard = try #require(UIPasteboard(name: UIPasteboard.Name("otter-mail-tests.code"), create: true))
        defer { UIPasteboard.remove(withName: pasteboard.name) }
        CodeCard.copy("482913", to: pasteboard)
        #expect(pasteboard.string == "482913")
    }

    @Test func findsTheDemoMailboxesCode() {
        let threads = DemoMail.load().threads
        #expect(threads.first { $0.subject == "Your Linden sign-in code" }?.verificationCode == "482913")
        #expect(threads.first { $0.subject == "48 hours only: 30% off all hiking gear" }?.verificationCode == nil)
    }
}

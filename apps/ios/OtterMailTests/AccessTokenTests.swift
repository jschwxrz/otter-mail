import Foundation
import Testing
@testable import Otter_Mail

// The Keychain is a synchronous call to securityd. On the main actor, once per request, it hung the
// app for as long as securityd took to answer (OTTER-MAIL-IOS-6). Neither address is in the Keychain,
// so reading it here would sign the mailbox out instead of returning the token.
@MainActor
struct AccessTokenTests {
    @Test func outlookUsesItsTokenInMemoryWithoutTheKeychain() async throws {
        let email = "not-in-keychain-\(UUID().uuidString.lowercased())@contoso.com"
        let auth = MicrosoftAuth(tokens: [email: .init(accessToken: "graph-token", idToken: nil, expiresAt: .now.addingTimeInterval(600))])
        #expect(try await auth.accessToken(email.uppercased()) == "graph-token")
    }

    @Test func gmailUsesItsTokenInMemoryWithoutTheKeychain() async throws {
        let email = "not-in-keychain-\(UUID().uuidString.lowercased())@gmail.com"
        let auth = GoogleAuth(tokens: [email: .init(accessToken: "gmail-token", idToken: nil, expiresAt: .now.addingTimeInterval(600))])
        #expect(try await auth.accessToken(email) == "gmail-token")
    }
}

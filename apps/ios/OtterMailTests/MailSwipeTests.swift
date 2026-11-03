import Foundation
import Testing
@testable import Otter_Mail

struct MailSwipeTests {
    @Test func armsPastTheThreshold() {
        #expect(!MailSwipe.armed(offset: 100, width: 400))
        #expect(MailSwipe.armed(offset: 150, width: 400))
        #expect(MailSwipe.armed(offset: -150, width: 400))
        #expect(!MailSwipe.armed(offset: 300, width: 0))
    }

    @Test func commitsOnlyWhenArmedAndNotFlungBack() {
        #expect(!MailSwipe.commits(offset: -30, velocity: -1800, width: 400))
        #expect(MailSwipe.commits(offset: -200, velocity: 0, width: 400))
        #expect(MailSwipe.commits(offset: 200, velocity: 300, width: 400))
        #expect(!MailSwipe.commits(offset: -200, velocity: 1000, width: 400))
    }
}

import Sentry
import Testing
@testable import Otter_Mail

struct ErrorReportsTests {
    @Test func hangsComeFromMetricKitNotTheHangTracker() {
        let options = Options()
        ErrorReports.configure(options)
        #expect(!options.enableAppHangTracking)
        #expect(options.enableMetricKit)
    }

    @Test func reportsStayScrubbedAndMinimal() {
        let options = Options()
        ErrorReports.configure(options)
        #expect(!options.sendDefaultPii)
        #expect(!options.attachScreenshot)
        #expect(!options.attachViewHierarchy)
        #expect(!options.enableMetricKitRawPayload)
        #expect(options.beforeSend != nil)
    }
}

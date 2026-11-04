import Foundation
@_spi(Private) import Sentry
import Testing

struct ErrorReportsTests {
    // ErrorReports.start() runs in App.init, before UIApplication exists. Before 9.31.0
    // (getsentry/sentry-cocoa#8988) the SDK then took a background launch (app refresh) for an
    // active app, and reported its idle, suspended main thread as a fatal app hang (OTTER-MAIL-IOS-5).
    @Test func sdkKnowsABackgroundLaunchWhenStartedFromAppInit() {
        #expect(SentryMeta.versionString.compare("9.31.0", options: .numeric) != .orderedAscending)
    }
}

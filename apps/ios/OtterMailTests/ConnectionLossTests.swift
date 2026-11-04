import Foundation
import Network
import Security
import Testing
@testable import Otter_Mail

struct ConnectionLossTests {
    @Test func abortedIsLost() {
        let error = NWTransport.lost(.posix(.ECONNABORTED)) as? URLError
        #expect(error?.code == .networkConnectionLost)
        #expect(error?.userInfo[NSUnderlyingErrorKey] as? NWError == .posix(.ECONNABORTED))
        #expect((NWTransport.lost(.posix(.ECONNRESET)) as? URLError)?.code == .networkConnectionLost)
        #expect((NWTransport.lost(.posix(POSIXErrorCode(rawValue: 57)!)) as? URLError)?.code == .networkConnectionLost)
    }

    @Test func offlineAndTimeout() {
        #expect((NWTransport.lost(.posix(.ENETDOWN)) as? URLError)?.code == .notConnectedToInternet)
        #expect((NWTransport.lost(.posix(.ETIMEDOUT)) as? URLError)?.code == .timedOut)
    }

    @Test func othersStay() {
        #expect(NWTransport.lost(.posix(.ECANCELED)) as? NWError == .posix(.ECANCELED))
        #expect(NWTransport.lost(.posix(.ECONNREFUSED)) as? NWError == .posix(.ECONNREFUSED))
        #expect(NWTransport.lost(.tls(errSSLBadCert)) as? NWError == .tls(errSSLBadCert))
    }
}

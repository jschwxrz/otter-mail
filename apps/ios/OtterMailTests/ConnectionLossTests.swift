import Darwin
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

    @Test func cancelledAfterTheNetworkFailedItIsThatFailure() {
        #expect((NWTransport.lost(.posix(.ECANCELED), failure: .posix(.ECONNABORTED)) as? URLError)?.code == .networkConnectionLost)
        #expect((NWTransport.lost(.posix(.ECANCELED), failure: .posix(.ENETDOWN)) as? URLError)?.code == .notConnectedToInternet)
        #expect(NWTransport.lost(.posix(.ECANCELED), failure: .tls(errSSLBadCert)) as? NWError == .tls(errSSLBadCert))
        #expect((NWTransport.lost(.posix(.ECONNRESET), failure: .posix(.ENETDOWN)) as? URLError)?.code == .networkConnectionLost)
    }

    @Test func aRefusedConnectionIsStillAFailure() async {
        let transport = NWTransport(host: "127.0.0.1", port: 1)
        defer { transport.close() }
        await #expect(throws: NWError.posix(.ECONNREFUSED)) { try await transport.start() }
    }

    @Test func aConnectionResetWhileConnectingIsLost() async throws {
        let server = try ResettingServer()
        let transport = NWTransport(host: "127.0.0.1", port: server.port)
        defer {
            transport.close()
            withExtendedLifetime(server) {}
        }
        await #expect {
            try await transport.start()
        } throws: { error in
            (error as? URLError)?.code == .networkConnectionLost
        }
    }

    @Test func aServerHangingUpIsTheConnectionNotTheSync() {
        #expect(ImapError.closed.isConnectionFailure)
        #expect(ImapError.timedOut.isConnectionFailure)
        #expect(!ImapError.server("NO").isConnectionFailure)
        #expect(!ImapError.protocolError("Bad").isConnectionFailure)
    }

    @Test func onlyADroppedConnectionIsTriedAgain() {
        #expect(ImapProvider.lostConnection(ImapError.closed))
        #expect(ImapProvider.lostConnection(URLError(.networkConnectionLost)))
        #expect(!ImapProvider.lostConnection(ImapError.timedOut))
        #expect(!ImapProvider.lostConnection(ImapError.server("NO")))
        #expect(!ImapProvider.lostConnection(URLError(.cancelled)))
    }
}

/** Accepts one connection on loopback and resets it (RST, not FIN) before the TLS handshake can finish. */
private final class ResettingServer: Sendable {
    let port: Int
    private let fd: Int32

    init() throws {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        try #require(fd >= 0)
        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let bound = withUnsafeMutablePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { address in
                bind(fd, address, length) == 0 && listen(fd, 1) == 0 && getsockname(fd, address, &length) == 0
            }
        }
        try #require(bound)
        self.fd = fd
        port = Int(UInt16(bigEndian: address.sin_port))
        Thread.detachNewThread {
            let client = accept(fd, nil, nil)
            guard client >= 0 else { return }
            var reset = linger(l_onoff: 1, l_linger: 0)
            setsockopt(client, SOL_SOCKET, SO_LINGER, &reset, socklen_t(MemoryLayout<linger>.size))
            close(client)
        }
    }

    deinit { close(fd) }
}

import Foundation
import Network
import Synchronization
import Testing
@testable import Otter_Mail

struct MailSocketTests {
    /** Sends its chunks `gap` apart, then nothing; closing fails a pending read as NWConnection does. */
    nonisolated final class Server: MailTransport, Sendable {
        let chunks: Mutex<[Data]>
        let gap: Duration
        let closed = Mutex(false)

        init(_ chunks: [String], gap: Duration) {
            self.chunks = Mutex(chunks.map { Data($0.utf8) })
            self.gap = gap
        }

        func receive() async throws -> Data {
            if let next = chunks.withLock({ $0.isEmpty ? nil : $0.removeFirst() }) {
                try await Task.sleep(for: gap)
                return next
            }
            while !closed.withLock({ $0 }) { try await Task.sleep(for: .milliseconds(5)) }
            throw NWError.posix(.ECANCELED)
        }

        func start() async throws {}
        func send(_ data: Data) async throws {}
        func startTLS() async throws {}
        func close() { closed.withLock { $0 = true } }
    }

    @Test func aServerThatStopsAnsweringTimesOut() async throws {
        let server = Server([], gap: .zero)
        let socket = MailSocket(server)
        socket.timeout = .milliseconds(100)
        await #expect(throws: ImapError.timedOut) { try await socket.readLine() }
        #expect(server.closed.withLock { $0 })
        await #expect(throws: ImapError.timedOut) { try await socket.readLine() }
    }

    @Test func aSlowServerStillSendingIsntCutOff() async throws {
        let server = Server(Array(repeating: "a", count: 10) + ["\r\n"], gap: .milliseconds(30))
        let socket = MailSocket(server)
        socket.timeout = .milliseconds(200)
        #expect(try await socket.readLine() == Data(String(repeating: "a", count: 10).utf8))
        #expect(!server.closed.withLock { $0 })
    }

    @Test func closingOnPurposeIsntATimeout() async throws {
        let server = Server([], gap: .zero)
        let socket = MailSocket(server)
        socket.timeout = .seconds(60)
        Task {
            try await Task.sleep(for: .milliseconds(50))
            server.close()
        }
        await #expect(throws: NWError.self) { try await socket.readLine() }
    }
}

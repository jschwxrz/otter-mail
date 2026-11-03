import Foundation
import Testing
import UserNotifications
@testable import Otter_Mail

/** Alias mailboxes (a mailbox's address with a mailbox of its own) and sending from a mailbox's other addresses. */
@MainActor
struct AliasMailboxTests {
    private let parent = "robin@icloud.example"
    private let me = "me@robin.example", studio = "mail@robin.example", accounts = "accounts@robin.example"
    private let ines = Person(name: "Inês", email: "ines@duarte.example")
    /** The parent's other addresses (its Send from). */
    private var others: Set<String> { [me, studio, accounts] }

    private func mailbox(_ email: String = "robin@icloud.example", imap: Bool = true) -> Mailbox {
        Mailbox(email: email, name: "Robin", displayName: email == parent ? "iCloud" : "Other", color: "#336699", signature: "<div>Robin</div>",
                labels: [], hasArchive: true,
                imap: imap ? ImapSettings(username: email, imap: .init(host: "imap.example", port: 993, security: .tls),
                                          smtp: .init(host: "smtp.example", port: 587, security: .starttls)) : nil)
    }

    private func message(_ id: String, from: Person? = nil, to: [String] = [], cc: [String] = [], deliveredTo: String? = nil,
                         headers more: [String: String] = [:], messageID: String? = nil, unread: Bool = true, draft: Bool = false,
                         hoursAgo: Double = 1) -> Message {
        var headers = more
        if let deliveredTo { headers["Original-Recipient"] = "rfc822;\(deliveredTo)" }
        headers["Message-ID"] = messageID ?? "<\(id)@example.com>"
        return Message(id: id, from: from ?? ines, to: to.map { Person(name: "", email: $0) }, cc: cc.map { Person(name: "", email: $0) },
                       date: Date(timeIntervalSince1970: 1_790_000_000 - hoursAgo * 3600), text: "Hello", html: nil, attachments: [],
                       unread: unread, starred: false, draft: draft, headers: headers)
    }

    private func thread(_ id: String, _ labels: Set<String> = ["INBOX"], _ messages: [Message]) -> MailThread {
        MailThread(id: id, mailbox: parent, subject: id, labels: labels, messages: messages)
    }

    private func store(_ threads: [MailThread], mailboxes: [Mailbox]? = nil) -> MailStore {
        let store = MailStore(preferences: Preferences(defaults: UserDefaults(suiteName: "AliasMailboxTests-\(UUID())")!),
                              mailboxes: mailboxes ?? [mailbox()], threads: threads)
        store.otherAddresses = MailAddresses(
            sendAs: [parent: [me, studio, accounts]],
            aliasMailboxes: [parent: [AliasMailbox(address: me), AliasMailbox(address: studio, name: "Studio", color: "#f97316", signature: "<div>Studio</div>")]]
        )
        return store
    }

    // The two copies iCloud files for a message sent To mail@ with Bcc me@: alike but for Original-Recipient.
    private var copies: MailThread {
        thread("open-day", ["INBOX"], [
            message("copy-studio", to: [studio], deliveredTo: studio, messageID: "<open-day@duarte.example>"),
            message("copy-me", to: [studio], deliveredTo: me, messageID: "<open-day@duarte.example>"),
        ])
    }

    @Test func deliveredToIsTheTopmostOfEachHeader() {
        let block = "Delivered-To: robin@icloud.example\r\nOriginal-Recipient: rfc822;Me@Robin.example\r\nOriginal-Recipient: rfc822;robin@icloud.example\r\n\r\n"
        #expect(AliasMailbox.deliveredTo { MailDecoding.header($0, in: block) } == [me, parent])
        #expect(AliasMailbox.deliveredTo { ["Delivered-To": " <mail@robin.example> ", "X-Original-To": me][$0] } == [studio, me])
        #expect(AliasMailbox.deliveredTo { ["Delivered-To": me, "X-Original-To": "ME@robin.example"][$0] } == [me])
        #expect(AliasMailbox.deliveredTo { _ in nil } == [])
        #expect(message("a").deliveredTo == [])
    }

    @Test func eachCopyGoesToTheAliasItWasDeliveredTo() {
        #expect(MailStore.belongs(copies, to: me, in: .inbox, others: others))
        #expect(MailStore.belongs(copies, to: studio, in: .inbox, others: others))
        let one = thread("one", ["INBOX"], [message("a", to: [studio], deliveredTo: me)])
        #expect(MailStore.belongs(one, to: me, in: .inbox, others: others))
        // The delivered-to address decides over To.
        #expect(!MailStore.belongs(one, to: studio, in: .inbox, others: others))
        #expect(!MailStore.belongs(one, to: studio, in: .junk, others: others))
    }

    @Test func postfixDeliversToTheMailboxAndNamesTheAliasInXOriginalTo() {
        let postfix = thread("postfix", ["INBOX"], [message("a", to: [studio], headers: ["Delivered-To": parent, "X-Original-To": me])])
        #expect(MailStore.belongs(postfix, to: me, in: .inbox, others: others))
        #expect(!MailStore.belongs(postfix, to: studio, in: .inbox, others: others))
        #expect(MailStore.belongs(postfix, to: me, in: .trash, others: others))
    }

    @Test func mailToTheMailboxItselfIsNoAliasesUnlessToOrCcSaysSo() {
        let primary = thread("primary", ["INBOX"], [message("a", to: [parent], deliveredTo: parent)])
        #expect(!MailStore.belongs(primary, to: me, in: .inbox, others: others))
        #expect(!MailStore.belongs(primary, to: studio, in: .inbox, others: others))
        let delivered = thread("delivered", ["INBOX"], [message("b", to: [me], headers: ["Delivered-To": parent])])
        #expect(MailStore.belongs(delivered, to: me, in: .inbox, others: others))
        // Delivered to one of the mailbox's addresses that has no mailbox of its own: no alias's.
        let accountsMail = thread("accounts", ["INBOX"], [message("c", to: [me], deliveredTo: accounts)])
        #expect(!MailStore.belongs(accountsMail, to: me, in: .inbox, others: others))
    }

    @Test func mailWithoutDeliveredToFallsBackToToAndCc() {
        #expect(MailStore.belongs(thread("to", ["INBOX"], [message("a", to: [me])]), to: me, in: .inbox, others: others))
        #expect(MailStore.belongs(thread("cc", ["INBOX"], [message("a", to: ["kai@example.com"], cc: [me])]), to: me, in: .inbox, others: others))
        #expect(!MailStore.belongs(thread("other", ["INBOX"], [message("a", to: [parent])]), to: me, in: .inbox, others: others))
    }

    @Test func sentAndDraftsAreWhatTheAliasWrote() {
        let sent = thread("sent", ["SENT"], [message("a", from: Person(name: "Robin", email: me), to: [ines.email], unread: false)])
        #expect(MailStore.belongs(sent, to: me, in: .sent, others: others))
        #expect(!MailStore.belongs(sent, to: studio, in: .sent, others: others))
        #expect(!MailStore.belongs(sent, to: me, in: .drafts, others: others))
        let draft = thread("draft", [], [message("d", from: Person(name: "Robin", email: studio), to: [ines.email], draft: true)])
        #expect(MailStore.belongs(draft, to: studio, in: .drafts, others: others))
        #expect(!MailStore.belongs(draft, to: studio, in: .sent, others: others))
        // Archive, Trash and Flagged take either.
        let archived = thread("archived", ["ARCHIVE"], [message("r", to: [me], deliveredTo: me)])
        #expect(MailStore.belongs(archived, to: me, in: .archive, others: others))
        #expect(MailStore.belongs(sent, to: me, in: .archive, others: others))
    }

    @Test func aliasPlacesFilterTheParentWhichStaysWhole() {
        let toParent = thread("parent", ["INBOX"], [message("p", to: [parent], deliveredTo: parent)])
        let toMe = thread("me", ["INBOX"], [message("m", to: [me])])
        let sent = thread("sent", ["SENT"], [message("s", from: Person(name: "Robin", email: studio), to: [ines.email], unread: false)])
        let store = store([toParent, toMe, copies, sent])
        #expect(Set(store.threads(in: .inbox, scope: me).map(\.id)) == ["me", "open-day"])
        #expect(store.threads(in: .inbox, scope: studio).map(\.id) == ["open-day"])
        #expect(Set(store.threads(in: .inbox, scope: parent).map(\.id)) == ["parent", "me", "open-day"])
        #expect(store.threads(in: .sent, scope: studio).map(\.id) == ["sent"])
        #expect(store.threads(in: .sent, scope: me).isEmpty)
        #expect(store.unreadCount(in: .inbox, scope: me) == 2)
        #expect(store.unreadCount(in: .inbox, scope: studio) == 1)
        // The icon's badge counts each thread once: the aliases' mail is the parent's.
        #expect(store.appBadge == 3)
        // Both copies are one message to read; an alias mailbox reads its own copy.
        #expect(copies.distinctMessages().map(\.id) == ["copy-studio"])
        #expect(copies.distinctMessages(preferring: me).map(\.id) == ["copy-me"])
    }

    @Test func sentShowsMailFromEveryAddressOfTheMailbox() {
        let fromAlias = thread("alias", ["SENT"], [message("a", from: Person(name: "Robin", email: me), to: [ines.email], unread: false)])
        let fromSendAs = thread("send-as", ["SENT"], [message("b", from: Person(name: "Robin", email: accounts), to: [ines.email], unread: false)])
        let fromOwn = thread("own", ["SENT"], [message("c", from: Person(name: "Robin", email: parent), to: [ines.email], unread: false)])
        let received = thread("received", ["INBOX"], [message("d", to: [me])])
        let store = store([fromAlias, fromSendAs, fromOwn, received])
        #expect(Set(store.threads(in: .sent, scope: parent).map(\.id)) == ["alias", "send-as", "own"])
        store.otherAddresses = MailAddresses()
        #expect(store.threads(in: .sent, scope: parent).map(\.id) == ["own"])
    }

    @Test func aliasMailboxesFollowTheirParentInTheSwitcher() {
        let gmail = mailbox("robin@gmail.example", imap: false)
        let store = store([], mailboxes: [mailbox(), gmail])
        #expect(store.shownScopes.map(\.email) == [parent, me, studio, gmail.email])
        #expect(store.shownMailboxes.map(\.email) == [parent, gmail.email])
        let studioBox = store.alias(studio)
        #expect(studioBox?.displayName == "Studio")
        #expect(studioBox?.color == "#f97316")
        #expect(studioBox?.source == parent)
        #expect(store.alias(me)?.displayName == "Me")
        #expect(store.alias(me)?.color == Session.defaultColor(me))
        #expect(store.alias(me)?.signature == "<div>Robin</div>")
        // mail:mailboxes orders the mailboxes, and alias mailboxes only among their parent's: always right after it.
        store.preferences.arrangement.order = [gmail.email, studio, parent]
        #expect(store.shownScopes.map(\.email) == [gmail.email, parent, studio, me])
        store.setOn(false, store.alias(studio)!)
        #expect(store.shownScopes.map(\.email) == [gmail.email, parent, me])
        store.setOn(false, mailbox())
        #expect(store.shownScopes.map(\.email) == [gmail.email])
        #expect(store.preferences.arrangement.off == [parent, studio])
        // Gmail's Send mail as comes later: only IMAP mailboxes have alias mailboxes for now.
        store.otherAddresses.sendAs[gmail.email] = ["alias@gmail.example"]
        store.otherAddresses.aliasMailboxes[gmail.email] = [AliasMailbox(address: "alias@gmail.example")]
        #expect(store.aliases(of: gmail).isEmpty)
    }

    @Test func reorderingKeepsAliasMailboxesWithTheirParent() {
        let gmail = mailbox("robin@gmail.example", imap: false)
        let store = store([], mailboxes: [mailbox(), gmail])
        #expect(store.arrangedScopes.map(\.email) == [parent, me, studio, gmail.email])
        // Studio above Me: among its parent's.
        store.move(from: [2], to: 1)
        #expect(store.arrangedScopes.map(\.email) == [parent, studio, me, gmail.email])
        // Dragged past the Gmail mailbox, it goes back after its parent.
        store.move(from: [1], to: 4)
        #expect(store.arrangedScopes.map(\.email) == [parent, me, studio, gmail.email])
        // A mailbox takes its alias mailboxes along.
        store.move(from: [3], to: 0)
        #expect(store.arrangedScopes.map(\.email) == [gmail.email, parent, me, studio])
    }

    @Test func flaggingFlagsEveryCopy() {
        let store = store([copies])
        store.toggleStar(copies.id)
        #expect(store.thread(copies.id)?.messages.allSatisfy(\.starred) == true)
        #expect(store.threads(in: .starred, scope: me).map(\.id) == [copies.id])
        #expect(store.threads(in: .starred, scope: studio).map(\.id) == [copies.id])
        store.toggleStar(copies.id)
        #expect(store.thread(copies.id)?.messages.contains(where: \.starred) == false)
    }

    @Test func anAliasMailboxIsOneOfTheAddressesItSendsFrom() {
        let other = mailbox("robin@mail.example")
        let store = store([], mailboxes: [mailbox(), other])
        // Taken out of Send from on the Mac, it's no longer a mailbox here, nor a From.
        store.otherAddresses.sendAs[parent] = [me, accounts]
        #expect(store.aliases(of: mailbox()).map(\.email) == [me])
        #expect(store.alias(studio) == nil)
        #expect(!store.addresses(of: parent).contains(studio))
        // An address two mailboxes list is the first one's.
        store.otherAddresses.sendAs[other.email] = [me]
        store.otherAddresses.aliasMailboxes[other.email] = [AliasMailbox(address: "ME@robin.example")]
        #expect(store.aliases(of: other).isEmpty)
        #expect(store.alias(me)?.source == parent)
        // A mailbox's own address is never an alias mailbox.
        store.otherAddresses.sendAs[parent] = [me, other.email]
        store.otherAddresses.aliasMailboxes[parent] = [AliasMailbox(address: me), AliasMailbox(address: other.email)]
        #expect(store.aliases(of: mailbox()).map(\.email) == [me])
    }

    @Test func syncedSectionsSkipWhatIsntAnEntry() {
        let addresses = MailAddresses(
            sendAs: [parent: [me, 42, " ", studio] as [Any], "bad": "x"] as [String: Any],
            aliasMailboxes: [parent: [
                ["address": me, "color": 7] as [String: Any], ["name": "No address"], "x",
                ["address": studio, "name": "Studio", "signature": "<div>S</div>"],
            ] as [Any]] as [String: Any]
        )
        #expect(addresses.sendAs[parent] == [me, studio])
        #expect(addresses.sendAs["bad"] == [])
        #expect(addresses.aliasMailboxes[parent] == [AliasMailbox(address: me), AliasMailbox(address: studio, name: "Studio", signature: "<div>S</div>")])
        #expect(MailAddresses(sendAs: nil, aliasMailboxes: "nope") == MailAddresses())
    }

    @Test func repliesGoFromTheAddressTheMailWasFor() {
        let addresses = [parent, me, studio, accounts]
        let mine = message("m", from: Person(name: "Robin", email: accounts), to: [ines.email])
        #expect(Draft.replyAddress(mine, addresses) == accounts)
        #expect(Draft.replyAddress(message("a", to: ["kai@example.com", studio], cc: [me]), addresses) == studio)
        #expect(Draft.replyAddress(message("b", to: ["kai@example.com"], cc: [me]), addresses) == me)
        #expect(Draft.replyAddress(message("c", to: ["list@example.com"], deliveredTo: me), addresses) == me)
        #expect(Draft.replyAddress(message("d", to: ["list@example.com"]), addresses) == parent)
    }

    @Test func draftsStartFromTheAliasWithItsSignature() throws {
        let thread = thread("t", ["INBOX"], [message("a", to: [studio, "kai@example.com"], cc: [me], deliveredTo: studio)])
        let store = store([thread])
        // In the parent, a reply goes from the address the mail was for, signed as its alias mailbox.
        let reply = try #require(store.reply(to: thread, in: parent, all: true))
        #expect(reply.from == parent)
        #expect(reply.address == studio)
        #expect(reply.body.hasPrefix("\n\nStudio"))
        #expect(Draft.people(reply.to).map(\.email) == [ines.email])
        #expect(Draft.people(reply.cc).map(\.email) == ["kai@example.com"])
        // In an alias mailbox, from that alias; one without a signature of its own signs as the parent.
        let fromMe = try #require(store.reply(to: thread, in: me, all: false))
        #expect(fromMe.address == me)
        #expect(fromMe.body.hasPrefix("\n\nRobin"))
        let new = try #require(store.mailbox(for: studio).map { Draft.new(from: $0) })
        #expect(new.from == parent)
        #expect(new.address == studio)
        #expect(store.signature(of: new) == "<div>Studio</div>")
        #expect(Draft.new(from: mailbox()).address == nil)
        // The address goes out only while it's still one of the mailbox's.
        #expect(store.sendingAddress(new, of: mailbox()) == studio)
        #expect(store.sendingAddress(Draft(from: parent, address: "someone@else.example"), of: mailbox()) == parent)
        // A saved draft resumes from the address it was written from.
        let saved = MailThread(id: "d", mailbox: parent, subject: "Draft", labels: [],
                               messages: [message("d", from: Person(name: "Robin", email: studio), to: [ines.email], draft: true)])
        #expect(Draft.resume(saved.latest, in: saved).address == studio)
    }

    @Test func aliasDraftsAreItsOwn() throws {
        let store = store([thread("d", [], [message("d", from: Person(name: "Robin", email: studio), to: [ines.email], draft: true)])])
        #expect(store.badge(in: .drafts, scope: studio) == 1)
        #expect(store.badge(in: .drafts, scope: me) == 0)
        #expect(store.badge(in: .drafts, scope: parent) == 1)
    }

    @Test func newMailIsAnnouncedAsItsAlias() throws {
        let aliases = [AliasMailbox(address: me), AliasMailbox(address: studio, name: "Studio")]
        #expect(AliasMailbox.announced(to: [studio], cc: [me], deliveredTo: [me], among: aliases)?.id == studio)
        #expect(AliasMailbox.announced(to: ["kai@example.com"], cc: [me], deliveredTo: [studio], among: aliases)?.id == me)
        #expect(AliasMailbox.announced(to: [parent], cc: [], deliveredTo: [parent, "Mail@Robin.example"], among: aliases)?.id == studio)
        #expect(AliasMailbox.announced(to: [parent], cc: [], deliveredTo: [parent], among: aliases) == nil)

        let store = store([copies])
        let sync = MailSync(store: store, google: GoogleAuth(), cache: MailCache(folder: URL.temporaryDirectory.appending(path: "AliasAlerts-\(UUID())")))
        let alert = sync.alert(copies.messages[1], in: copies)
        #expect(alert.subtitle == "Studio · open-day")
        #expect(alert.userInfo["mailbox"] as? String == studio)
        #expect(alert.userInfo["thread"] as? String == copies.id)
        let plain = thread("p", ["INBOX"], [message("p", to: [parent], deliveredTo: parent)])
        #expect(sync.alert(plain.latest, in: plain).subtitle == "iCloud · p")
        #expect(sync.alert(plain.latest, in: plain).userInfo["mailbox"] as? String == parent)
        // One mailbox and no aliases: the subject alone.
        store.otherAddresses = MailAddresses()
        #expect(sync.alert(plain.latest, in: plain).subtitle == "p")
    }

    @Test func theNotificationServiceNamesAndOpensTheAlias() {
        let address = { (mailbox: String, host: String) -> ImapValue in .list([.none, .none, .atom(mailbox), .atom(host)]) }
        var envelope = [ImapValue](repeating: .none, count: 10)
        envelope[5] = .list([address("mail", "robin.example")])
        let fields: [String: ImapValue] = [
            "BODY[HEADER.FIELDS (\(VerifiedNotification.deliveredToFields))]": .string(Data("Original-Recipient: rfc822;me@robin.example\r\n\r\n".utf8)),
        ]
        let aliases = [AliasMailbox(address: me, name: "Me")]
        #expect(VerifiedNotification.alias(envelope, fields, among: aliases)?.id == me)
        #expect(VerifiedNotification.alias(envelope, [:], among: aliases) == nil)
        #expect(VerifiedNotification.alias(envelope, fields, among: []) == nil)

        let config = PushState.Configuration(userId: "u", mode: "inbox", mailboxes: [parent], aliases: [parent: aliases], names: [parent: "iCloud"])
        #expect(config.name(parent, alias: aliases[0]) == "Me")
        #expect(config.name(parent, alias: nil) == "iCloud")
        #expect(PushState.Configuration(userId: "u", mode: "inbox", mailboxes: [parent]).name(parent, alias: aliases[0]) == nil)
        #expect(PushState.subtitle("Lunch", mailbox: "Me") == "Me · Lunch")
        #expect(PushState.subtitle("Lunch", mailbox: nil) == "Lunch")
        #expect(PushState.subtitle("", mailbox: "Me") == "Me")
    }

    @Test func anAliasPlacePagesItsParentUntilItHasAPageOfItsOwn() async {
        let provider = PagedProvider(alias: me, parent: parent)
        let store = store([])
        let folder = URL.temporaryDirectory.appending(path: "AliasPaging-\(UUID())")
        defer { try? FileManager.default.removeItem(at: folder) }
        let sync = MailSync(store: store, google: GoogleAuth(), cache: MailCache(folder: folder), providers: [parent: provider])
        await sync.loadMore(.inbox, scope: me)
        // 5 of each page's 30 are the alias's: 4 pages make the 20 it wants.
        #expect(provider.pages == 4)
        #expect(sync.listed(store.threads(in: .inbox, scope: me), in: .inbox).count == 20)
        #expect(sync.hasMore(.inbox, scope: me))
        // The parent's own list pages one at a time, as before.
        await sync.loadMore(.inbox, scope: parent)
        #expect(provider.pages == 5)
        // At the end of the parent's pages it stops, short of a full page.
        await sync.loadMore(.inbox, scope: me)
        #expect(provider.pages == 6)
        #expect(!sync.hasMore(.inbox, scope: me))
        #expect(store.threads(in: .inbox, scope: me).count == 30)
    }

    @Test func aSparseAliasPlaceStopsAtItsLimitAndWaitsToBeAsked() async {
        let provider = PagedProvider(alias: me, parent: parent, count: 30, aliasEvery: 100)
        let store = store([])
        let folder = URL.temporaryDirectory.appending(path: "AliasPaging-\(UUID())")
        defer { try? FileManager.default.removeItem(at: folder) }
        let sync = MailSync(store: store, google: GoogleAuth(), cache: MailCache(folder: folder), providers: [parent: provider])
        await sync.loadMore(.inbox, scope: me)
        #expect(provider.pages == MailSync.aliasPageLimit)
        #expect(sync.paused(.inbox, scope: me))
        #expect(sync.hasMore(.inbox, scope: me))
        // Asked again, it looks through as many more.
        await sync.loadMore(.inbox, scope: me)
        #expect(provider.pages == 2 * MailSync.aliasPageLimit)
    }
}

/** A parent's inbox in pages of 30 (6 of them unless said), every sixth thread (or `aliasEvery`th) delivered to the alias. */
@MainActor
private final class PagedProvider: MailProvider {
    let alias: String, parent: String, count: Int, aliasEvery: Int
    private(set) var pages = 0
    init(alias: String, parent: String, count: Int = 6, aliasEvery: Int = 6) {
        self.alias = alias; self.parent = parent; self.count = count; self.aliasEvery = aliasEvery
    }

    var capabilities: MailCapabilities { .imap }
    var takesTurns: Bool { false }
    var hasArchive: Bool { true }

    func loadMore(_ folder: Folder, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta {
        let page = pages
        pages += 1
        let threads = (0..<30).map { i -> MailThread in
            let n = page * 30 + i
            let to = n % aliasEvery == 0 ? alias : parent
            let message = Message(id: "m\(n)", from: Person(name: "", email: "sender@example.com"), to: [Person(name: "", email: to)], cc: [],
                                  date: Date(timeIntervalSince1970: 1_790_000_000 - Double(n) * 3600), text: "", html: nil, attachments: [],
                                  unread: false, starred: false, draft: false, headers: ["Original-Recipient": "rfc822;\(to)"])
            return MailThread(id: "t\(n)", mailbox: parent, subject: "\(n)", labels: ["INBOX"], messages: [message])
        }
        state.paged(MailSync.key(folder), next: page < count - 1 ? "page-\(page + 1)" : nil, oldest: threads.map(\.latest.date).min())
        return MailDelta(threads: threads)
    }

    func sync(_ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func search(_ query: String, known: [MailThread]) async throws -> (ids: [String], threads: [MailThread]) { ([], []) }
    func labels() async throws -> [MailLabel] { [] }
    func signature() async throws -> String? { nil }
    func setSignature(_ html: String) async throws -> String { html }
    func apply(_ change: MailStore.Change, to thread: MailThread, _ state: inout MailboxState) async throws -> MailDelta { MailDelta() }
    func refresh(_ thread: MailThread, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func send(_ message: Outgoing, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func saveDraft(_ message: Outgoing, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func deleteDraft(_ messageID: String, _ state: inout MailboxState) async throws {}
    func attachment(_ attachment: Otter_Mail.Attachment, of message: Message) async throws -> Data { Data() }
    func watch(pushTopic: String?, _ state: inout MailboxState, onChange: @escaping () -> Void) async -> Task<Void, Never>? { nil }
}

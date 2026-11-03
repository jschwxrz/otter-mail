import Foundation

/**
 * The mail the app shows, shaped like Gmail's: mailboxes (the Gmail, IMAP and
 * Outlook accounts on the Otter account), their labels, and threads of
 * messages. Label ids are Gmail's (`INBOX`, `STARRED`, …) or a user label's;
 * an IMAP folder is a label (docs/imap.md), and so are Outlook's folders and
 * categories (docs/outlook.md).
 */

nonisolated struct Mailbox: Identifiable, Hashable, Codable {
    var email: String
    var name: String
    var displayName: String
    var color: String
    var signature: String
    var labels: [MailLabel]
    var hasArchive: Bool? = nil
    var picture: String? = nil
    var signedOut = false
    var imap: ImapSettings? = nil
    var outlook: Bool? = nil
    /**
     * Set on an alias mailbox (`MailStore.alias`): the mailbox it's an address
     * of, whose mail and server it uses. Never in `MailStore.mailboxes`.
     */
    var parent: String? = nil

    var id: String { email }
    /** The mailbox whose server has its mail: the parent's, for an alias mailbox. */
    var source: String { parent ?? email }
    var me: Person { Person(name: name, email: email) }
    var provider: MailProviderKind { imap != nil ? .imap : outlook == true ? .outlook : .gmail }
    var capabilities: MailCapabilities {
        switch provider {
        case .gmail: .gmail
        case .imap: .imap
        case .outlook: .outlook
        }
    }

    var mark: String { capabilities.flags ? "flag" : "star" }

    var folders: [Folder] {
        Folder.system.filter { folder in
            switch folder {
            case .important: capabilities.categories
            case .allMail: !capabilities.archiveFolder
            case .archive: hasArchive == true
            default: true
            }
        }
    }
}

/**
 * The mailboxes' addresses besides their own, as the Mac and the web set them
 * (the account's `sendAs` and `aliasMailboxes` sections; read here, never written).
 */
nonisolated struct MailAddresses: Codable, Equatable {
    /** The other addresses each mailbox sends from, by its lower-cased address. */
    var sendAs: [String: [String]] = [:]
    /** Those with a mailbox of their own, by their parent's lower-cased address. */
    var aliasMailboxes: [String: [AliasMailbox]] = [:]

    init(sendAs: [String: [String]] = [:], aliasMailboxes: [String: [AliasMailbox]] = [:]) {
        self.sendAs = sendAs
        self.aliasMailboxes = aliasMailboxes
    }

    /** The sections as synced (JSON), an entry that isn't one skipped, as core's parseAliasMailboxes skips it. */
    init(sendAs: Any?, aliasMailboxes: Any?) {
        let text = { (value: Any?) in (value as? String).flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } }
        self.sendAs = ((sendAs as? [String: Any]) ?? [:]).mapValues { ($0 as? [Any] ?? []).compactMap(text) }
        self.aliasMailboxes = ((aliasMailboxes as? [String: Any]) ?? [:]).mapValues { entries in
            (entries as? [Any] ?? []).compactMap { $0 as? [String: Any] }.compactMap { entry in
                text(entry["address"]).map { AliasMailbox(address: $0, name: text(entry["name"]), color: text(entry["color"]), signature: text(entry["signature"])) }
            }
        }
    }
}

nonisolated enum MailProviderKind: String, Codable {
    case gmail, imap, outlook
}

nonisolated struct MailCapabilities: Hashable {
    var categories: Bool
    var multipleLabels: Bool
    var labelColors: Bool
    /** Signatures kept by the server (Gmail's settings) rather than on this iPhone. */
    var serverSignatures: Bool
    var calendar: Bool
    /** New mail arrives by push through the relay (Gmail, Outlook); otherwise the iPhone watches itself. */
    var relayPush: Bool
    /**
     * Archive is a folder of its own (Outlook, IMAP): archived mail carries
     * `ARCHIVE`. Without it (Gmail), archived mail just lacks `INBOX`: it's in All Mail.
     */
    var archiveFolder: Bool
    /** Mail is flagged (Outlook's flag, IMAP's \Flagged) rather than starred: `STARRED` is "Flagged". */
    var flags: Bool

    static let gmail = MailCapabilities(categories: true, multipleLabels: true, labelColors: true, serverSignatures: true, calendar: true, relayPush: true, archiveFolder: false, flags: false)
    static let imap = MailCapabilities(categories: false, multipleLabels: false, labelColors: false, serverSignatures: false, calendar: false, relayPush: false, archiveFolder: true, flags: true)
    /** Categories are its labels (colored), folders move mail; Graph doesn't expose Outlook's signatures. */
    static let outlook = MailCapabilities(categories: false, multipleLabels: true, labelColors: true, serverSignatures: false, calendar: false, relayPush: true, archiveFolder: true, flags: true)
}

nonisolated struct MailLabel: Identifiable, Hashable, Codable {
    var id: String
    var name: String
    var color: String?

    var leaf: String { name.split(separator: "/").last.map(String.init) ?? name }
    var depth: Int { name.split(separator: "/").count - 1 }
}

nonisolated struct Attachment: Hashable, Codable {
    var id: String? = nil
    var filename: String
    var mimeType: String
    var size: Int
    /** Set on an image the HTML shows inline (`cid:` + this), rather than a file. */
    var contentID: String? = nil
}

nonisolated struct Message: Identifiable, Hashable, Codable {
    var id: String
    var from: Person
    var to: [Person]
    var cc: [Person]
    var date: Date
    var text: String
    var html: String?
    var attachments: [Attachment]
    var inline: [Attachment]? = nil
    var unread: Bool
    var starred: Bool
    var draft: Bool
    /**
     * The ones replies and unsubscribing need (Message-ID, References,
     * List-Unsubscribe), and where IMAP delivered it (Original-Recipient,
     * Delivered-To, X-Original-To; mail cached before has none).
     */
    var headers: [String: String]

    /** The address this copy was delivered to (`AliasMailbox.deliveredTo`), lower-cased. */
    var deliveredTo: String? { AliasMailbox.deliveredTo { headers[$0] } }

    var snippet: String {
        // A one-line preview must not scan megabytes of newsletter or quoted history while scrolling.
        let body = Quote.split(String(text.prefix(4096))).body
        return MailDecoding.preview(body.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix(">") }
            .joined(separator: " "))
    }
}

nonisolated struct MailThread: Identifiable, Hashable, Codable {
    var id: String
    var mailbox: String
    var subject: String
    var labels: Set<String>
    var messages: [Message]

    var latest: Message { messages.last! }
    var unread: Bool { messages.contains(where: \.unread) }
    var starred: Bool { messages.contains(where: \.starred) }
    var hasAttachments: Bool { messages.contains { !$0.attachments.isEmpty } }
    var isDraft: Bool { messages.allSatisfy(\.draft) }
    var sent: [Message] { messages.filter { !$0.draft } }

    /**
     * Its messages with each Message-ID once: iCloud files a copy for each of
     * the addresses it was delivered to. `address`'s copy (an alias mailbox's) is the one kept.
     */
    func distinctMessages(preferring address: String? = nil) -> [Message] {
        var kept: [String: Int] = [:]
        var distinct: [Message] = []
        for message in messages {
            guard !message.draft, let id = message.headers["Message-ID"] else { distinct.append(message); continue }
            if let i = kept[id] {
                if let address, message.deliveredTo == address, distinct[i].deliveredTo != address { distinct[i] = message }
            } else {
                kept[id] = distinct.count
                distinct.append(message)
            }
        }
        return distinct
    }

    /** Where mail is (the inbox, a folder) rather than how it is (flags, Outlook's categories). */
    static func isFolder(_ label: String) -> Bool {
        !["UNREAD", "STARRED", "IMPORTANT"].contains(label) && !label.hasPrefix(OutlookFolders.categoryPrefix)
    }

    /** Folders mail leaves for the Archive: the inbox and the user's own (not Sent, Junk, …). */
    static func archivesFrom(_ label: String) -> Bool {
        isFolder(label) && !["SENT", "DRAFT", "SPAM", "TRASH", "ARCHIVE"].contains(label)
    }

    func archivable(archiveFolder: Bool) -> Set<String> {
        labels.filter { $0 == "INBOX" || archiveFolder && Self.archivesFrom($0) }
    }

    /**
     * A label change as it lands, before the server has it (contracts'
     * landLabelChange). Where Archive is a folder (`archiveFolder`), a
     * message sits in one folder: put in another, the conversation leaves
     * the inbox, the Archive and the user's folders; taken out of them into
     * none, it lands in the Archive. Its own mail stays in Sent and Drafts.
     * Elsewhere (Gmail) a change lands as it is.
     */
    mutating func land(add: [String], remove: [String], archiveFolder: Bool) {
        let had = labels
        labels.subtract(remove)
        if archiveFolder {
            if add.contains(where: Self.isFolder) {
                labels = labels.filter { !Self.archivesFrom($0) && $0 != "ARCHIVE" }
            } else if remove.contains(where: { had.contains($0) && Self.archivesFrom($0) }) {
                labels.insert("ARCHIVE")
            }
        }
        labels.formUnion(add)
    }
}

nonisolated enum Folder: Hashable {
    case inbox, starred, sent, drafts, important, allMail, archive, junk, trash
    case label(id: String, name: String)

    static let system: [Folder] = [.inbox, .starred, .sent, .drafts, .important, .allMail, .archive, .junk, .trash]

    var title: String {
        switch self {
        case .inbox: "Inbox"
        case .starred: "Starred"
        case .sent: "Sent"
        case .drafts: "Drafts"
        case .important: "Important"
        case .allMail: "All Mail"
        case .archive: "Archive"
        case .junk: "Junk"
        case .trash: "Trash"
        case .label(let id, let name): id.hasPrefix(OutlookFolders.categoryPrefix) ? name : name.split(separator: "/").last.map(String.init) ?? name
        }
    }

    var symbol: String {
        switch self {
        case .inbox: "tray"
        case .starred: "star"
        case .sent: "paperplane"
        case .drafts: "doc"
        case .important: "bookmark"
        case .allMail: "tray.full"
        case .archive: "archivebox"
        case .junk: "xmark.bin"
        case .trash: "trash"
        case .label(let id, _): id.hasPrefix(OutlookFolders.folderPrefix) ? "folder" : "tag"
        }
    }

    func title(in mailbox: Mailbox?) -> String {
        self == .starred && mailbox?.capabilities.flags == true ? "Flagged" : title
    }

    func symbol(in mailbox: Mailbox?) -> String {
        self == .starred && mailbox?.capabilities.flags == true ? "flag" : symbol
    }
}

nonisolated enum Quote {
    static func split(_ text: String) -> (body: String, quote: String?) {
        let pattern = /\n+(On .{4,200}wrote:\s*\n|>)/
        guard let match = text.firstMatch(of: pattern), text[match.range.upperBound...].contains(">") || match.output.1 == ">" else {
            return (text, nil)
        }
        let body = String(text[..<match.range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        return body.isEmpty ? (text, nil) : (body, String(text[match.range.lowerBound...]))
    }
}

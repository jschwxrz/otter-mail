import Foundation

/**
 * One of a mailbox's addresses with a mailbox of its own (the account's
 * `aliasMailboxes` section, by the parent's lower-cased address; made on the
 * Mac and the web). Its mail is the parent's: the copies delivered to it and
 * what it sent. The parent still shows all of it.
 */
nonisolated struct AliasMailbox: Codable, Hashable, Sendable {
    var address: String
    var name: String?
    var color: String?
    var signature: String?

    var id: String { address.lowercased() }

    /** Its name, else its address's local part, capitalized (me@ → "Me"). */
    var title: String {
        if let name = name?.trimmingCharacters(in: .whitespaces), !name.isEmpty { return name }
        let local = address.split(separator: "@").first.map(String.init) ?? address
        return local.prefix(1).uppercased() + local.dropFirst()
    }

    /**
     * The addresses a copy was delivered to, lower-cased, each once: the
     * topmost Original-Recipient (iCloud adds it to each copy, after
     * `rfc822;`), Delivered-To and X-Original-To. `header` gives a header's topmost value.
     */
    static func deliveredTo(_ header: (String) -> String?) -> [String] {
        var addresses: [String] = []
        for name in ["Original-Recipient", "Delivered-To", "X-Original-To"] {
            guard var value = header(name)?.trimmingCharacters(in: .whitespaces) else { continue }
            if value.lowercased().hasPrefix("rfc822;") { value = String(value.dropFirst(7)) }
            value = value.trimmingCharacters(in: .whitespaces.union(["<", ">"])).lowercased()
            if !value.isEmpty && !addresses.contains(value) { addresses.append(value) }
        }
        return addresses
    }

    /**
     * Whether a received copy is the alias `address`'s. Delivered to any of
     * the mailbox's other addresses (`others`, its Send from), it's theirs
     * alone; otherwise (delivered to none of them, or to the mailbox's own
     * address: Postfix's Delivered-To) To and Cc decide.
     */
    static func receives(_ address: String, deliveredTo: [String], recipients: [String], others: Set<String>) -> Bool {
        let named = deliveredTo.filter(others.contains)
        return named.isEmpty ? recipients.contains { $0.lowercased() == address } : named.contains(address)
    }

    /** The alias mailbox new mail is announced as: the first of `aliases` in To, then Cc, then where it was delivered. */
    static func announced(to: [String], cc: [String], deliveredTo: [String], among aliases: [AliasMailbox]) -> AliasMailbox? {
        for address in to + cc + deliveredTo {
            if let alias = aliases.first(where: { $0.id == address.lowercased() }) { return alias }
        }
        return nil
    }
}

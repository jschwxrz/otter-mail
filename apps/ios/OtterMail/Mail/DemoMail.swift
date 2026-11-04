import Foundation

/**
 * The demo mailbox: the same pretend Gmail accounts as `pnpm dev:fake`
 * (apps/web/src/web/demo/seed.ts), exported to Resources/DemoMailboxes.json
 * by `pnpm ios:resources`. Messages are placed `hoursAgo` before launch, so
 * the mail always looks recent.
 */
enum DemoMail {
    static func load(now: Date = .now) -> (mailboxes: [Mailbox], threads: [MailThread]) {
        guard
            let url = Bundle.main.url(forResource: "DemoMailboxes", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let seed = try? JSONDecoder().decode([SeedAccount].self, from: data)
        else { return ([], []) }

        var mailboxes: [Mailbox] = []
        var threads: [MailThread] = []
        for account in seed {
            let me = Person(name: account.name, email: account.email)
            mailboxes.append(Mailbox(
                email: account.email,
                name: account.name,
                displayName: account.displayName,
                color: account.color,
                signature: account.signature,
                labels: account.labels.map { MailLabel(id: $0.name, name: $0.name, color: $0.color?.backgroundColor) }
            ))
            for (t, thread) in account.threads.enumerated() {
                let firstSender = thread.messages.compactMap(\.from).first
                let threadID = "\(account.email)/\(t)"
                threads.append(MailThread(
                    id: threadID,
                    mailbox: account.email,
                    subject: thread.subject,
                    labels: Set(thread.labels),
                    messages: thread.messages.enumerated().map { m, message in
                        let from = message.from ?? me
                        return Message(
                            id: "\(threadID)/\(m)",
                            from: from,
                            to: message.to ?? (from == me ? [firstSender].compactMap { $0 } : [me]),
                            cc: message.cc ?? [],
                            date: now.addingTimeInterval(-message.hoursAgo * 3600),
                            text: message.text,
                            html: message.html,
                            attachments: message.attachments ?? [],
                            unread: message.unread ?? false,
                            starred: message.starred ?? false,
                            draft: message.draft ?? false,
                            headers: message.headers ?? [:]
                        )
                    }
                ))
            }
        }
        #if DEBUG
        // OTTER_DEMO_MAILBOX_PICTURE=<data URL> at launch shows a chosen picture on the first mailbox.
        if let picture = ProcessInfo.processInfo.environment["OTTER_DEMO_MAILBOX_PICTURE"], !mailboxes.isEmpty {
            mailboxes[0].customPicture = picture
        }
        #endif
        return (mailboxes, threads)
    }

    private struct SeedAccount: Decodable {
        var email: String
        var name: String
        var displayName: String
        var color: String
        var signature: String
        var labels: [SeedLabel]
        var threads: [SeedThread]
    }

    private struct SeedLabel: Decodable {
        struct Color: Decodable { var backgroundColor: String }
        var name: String
        var color: Color?
    }

    private struct SeedThread: Decodable {
        var subject: String
        var labels: [String]
        var messages: [SeedMessage]
    }

    private struct SeedMessage: Decodable {
        var from: Person?
        var to: [Person]?
        var cc: [Person]?
        var hoursAgo: Double
        var text: String
        var html: String?
        var attachments: [Attachment]?
        var unread: Bool?
        var starred: Bool?
        var draft: Bool?
        var headers: [String: String]?
    }
}

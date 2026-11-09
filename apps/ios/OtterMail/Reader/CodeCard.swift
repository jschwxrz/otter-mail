import SwiftUI
import UIKit

/**
 * The sign-in code a mail carries, with Copy & trash (extensions/sign-in-codes'
 * CodeCard), which copies it and trashes its conversation, as the Mac and web
 * do. The button is borderless so, in a list row, it takes its own tap and not the row's.
 */
struct CodeCard: View {
    @Environment(\.palette) private var palette
    let code: String
    var onTrash: (() -> Void)?

    @State private var copied = false

    var body: some View {
        HStack(spacing: 12) {
            Text(code)
                .font(.system(.title3, design: .monospaced).weight(.semibold))
                .tracking(1.5)
                .foregroundStyle(palette.text)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 8)
            Button(action: copy) {
                Label(copied ? "Copied" : onTrash == nil ? "Copy" : "Copy & trash", systemImage: copied ? "checkmark" : "doc.on.doc")
                    .font(.inter(.subheadline).weight(.medium))
                    .foregroundStyle(palette.text)
                    .labelStyle(.titleAndIcon)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .background(palette.text.opacity(0.08), in: .capsule)
                    .contentShape(.capsule)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(copied ? "Copied" : onTrash == nil ? "Copy code" : "Copy code and trash")
            .accessibilityIdentifier("otp-copy")
        }
        .padding(.leading, 16)
        .padding([.vertical, .trailing], 8)
        .background(palette.card, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(palette.border))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("otp-card")
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(1.5))
            if !Task.isCancelled { copied = false }
        }
    }

    private func copy() {
        Self.copy(code, to: .general)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        copied = true
        onTrash?()
    }

    static func copy(_ code: String, to pasteboard: UIPasteboard) {
        pasteboard.string = code
    }
}

private let codes: NSCache<NSString, NSString> = {
    let cache = NSCache<NSString, NSString>()
    cache.countLimit = 500
    return cache
}()

extension MailThread {
    /** How long a code stays worth offering in a list: codes expire within minutes. */
    static let freshCodeAge: TimeInterval = 30 * 60

    /** The code its latest message (not a draft) carries, remembered by what it's read from. */
    var verificationCode: String? {
        guard let message = sent.last else { return nil }
        let source = message.text.isEmpty ? message.html ?? "" : message.text
        let key = "\(message.text.isEmpty ? "html" : "text")\u{0}\(subject)\u{0}\(source)" as NSString
        if let known = codes.object(forKey: key) { return known.length == 0 ? nil : known as String }
        let body = message.text.isEmpty ? message.html.map(HTMLText.plain) ?? "" : message.text
        let code = VerificationCode.find(subject: subject, body: body)
        codes.setObject((code ?? "") as NSString, forKey: key)
        return code
    }

    /**
     * The code, while it can still be used. The reader offers it on any
     * message, as the Mac and web do; a list only offers it on new mail, the
     * way the Mac's notifications announce codes only as mail arrives.
     */
    func freshVerificationCode(now: Date = .now) -> String? {
        guard let message = sent.last, now.timeIntervalSince(message.date) < Self.freshCodeAge else { return nil }
        return verificationCode
    }
}

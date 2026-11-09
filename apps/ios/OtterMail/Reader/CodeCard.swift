import SwiftUI
import UIKit

/**
 * The sign-in code a mail carries, with Copy (extensions/sign-in-codes'
 * CodeCard). Copying says so on the button for a moment. The button is
 * borderless so, in a list row, it takes its own tap and not the row's.
 */
struct CodeCard: View {
    @Environment(\.palette) private var palette
    let code: String

    @State private var copied = false

    static let confirmation: Duration? = {
        #if DEBUG
        // XCUITest's wait for the app to idle after a tap outlasts 1.5s, so UI tests set
        // OTTER_COPIED_SECONDS=0 to keep "Copied" up (another number is that many seconds).
        if let seconds = ProcessInfo.processInfo.environment["OTTER_COPIED_SECONDS"].flatMap(Double.init) {
            return seconds > 0 ? .seconds(seconds) : nil
        }
        #endif
        return .seconds(1.5)
    }()

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "key.horizontal")
                .font(.system(size: 15))
                .foregroundStyle(palette.muted)
                .frame(width: 40, height: 40)
                .background(palette.text.opacity(0.06), in: .rect(cornerRadius: 12))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Verification code")
                    .font(.inter(.footnote))
                    .foregroundStyle(palette.muted)
                Text(code)
                    .font(.system(.title3, design: .monospaced).weight(.semibold))
                    .tracking(1.5)
                    .foregroundStyle(palette.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 8)
            Button(action: copy) {
                Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
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
            .accessibilityLabel(copied ? "Copied" : "Copy code")
            .accessibilityIdentifier("otp-copy")
        }
        .padding(12)
        .background(palette.card, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(palette.border))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("otp-card")
        .task(id: copied) {
            guard copied, let confirmation = Self.confirmation else { return }
            try? await Task.sleep(for: confirmation)
            if !Task.isCancelled { copied = false }
        }
    }

    private func copy() {
        Self.copy(code, to: .general)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        copied = true
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

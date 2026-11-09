import Foundation

/**
 * The one-time code a sign-in or verification email carries, as the Mac and
 * web apps find it (packages/shared/src/verification-code.ts, kept in step
 * with it): the mail has to name a code, and the code has to be right beside
 * the name ("code: 482913", "482913 is your code") or on its own line just
 * after it. Promo, order, booking and postal codes are left alone.
 *
 * Indices are UTF-16, as in JavaScript. `\d` is spelled [0-9] (JavaScript's),
 * `$` is `\z` (ICU's `$` also matches before a final newline), and `[` and
 * `$` in a class are escaped (ICU nests sets).
 */
nonisolated enum VerificationCode {
    private static let start = #"(?<![\p{L}\p{N}])"#
    private static let end = #"(?![\p{L}\p{N}])"#

    private static let names = regex(start + "(?:" + [
        #"(?:verification|verify|security|confirmation|authentication|auth|log-?in|sign[- ]?in|sign[- ]?up|one-time|single-use|temporary|access|activation|2fa|mfa|otp|reset|recovery|approval|identity)[ -](?:code|pin|passcode|password)"#,
        #"passcode|otp"#,
        #"code (?:de vérification|de sécurité|de confirmation|d['’]accès|d['’]activation|de connexion|d['’]authentification|à usage unique|temporaire)"#,
        #"mot de passe (?:à usage unique|temporaire)"#,
        #"(?:bestätigungs|sicherheits|verifizierungs|verifikations|anmelde|einmal|zugangs|freischalt|aktivierungs|authentifizierungs|login-?)code|einmal(?:passwort|kennwort)"#,
        #"código de (?:verificación|verificação|seguridad|segurança|confirmación|confirmação|acceso|acesso|activación|inicio de sesión)"#,
        #"codice (?:di verifica|di sicurezza|di conferma|di accesso|monouso)"#,
        #"(?:verificatie|beveiligings|inlog|bevestigings|toegangs)code"#,
    ].joined(separator: "|") + ")" + end, ignoringCase: true)

    private static let plainNames = regex(start + "(?:" + [
        #"(?:your|enter|use|following)(?: [\p{L}\p{N}'’.-]+)? code|code(?=\s*:)"#,
        #"(?:votre|ton) code|(?:saisissez|entrez|utilisez|voici) (?:le|ce|votre) code"#,
        #"(?:ihr|dein|diesen|folgenden) code"#,
        #"(?:tu|su|seu|este) código|(?:il tuo|questo) codice|(?:je|uw) code"#,
    ].joined(separator: "|") + ")" + end, ignoringCase: true)

    private static let otherCodes = regex(
        #"promo|coupon|discount|voucher|% off|checkout|gift|referral|invit|zip|postal|post ?code|postleitzahl|tracking|order (?:number|no|#)|booking|reservation|réservation|buchung|itinerary|flight|invoice|qr|bar ?code|source code|error code|status code|area code|country code|dress code|réduction|rabatt|gutschein|descuento|cupón|sconto"#,
        ignoringCase: true
    )

    private static let code = #"[0-9]{3}[ -][0-9]{3}|[0-9]{4}[ -][0-9]{4}|[0-9]{4,8}|(?=[A-Z0-9-]*[0-9])(?=[A-Z0-9-]*[A-Z])[A-Z0-9]{3}-[A-Z0-9]{3}|(?=[A-Z0-9]*[0-9])(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,8}"#

    /** A code among words: not part of a longer number, a price, a date or a time. */
    private static let codeInText = regex(#"(?<![\p{L}\p{N}\$€£¥#+/.,_]|[0-9]-)(?:"# + code + #")(?![\p{L}\p{N}%€\$£_]|[.,:/\-][0-9])"#)

    private static let codeLine = regex(#"^[\s*"'“”«»()\[\]]*("# + code + #")[\s*"'“”«».()\[\]]*\z"#)

    private static let rightBeside = regex(#"^\s*(?:is|est|ist|lautet|es|é|è)?\s*:?\s*\z"#, ignoringCase: true)

    private static let close = regex(#"^[^.!?。]{0,40}\z"#)

    /** Before the name, the code leads the sentence: "482913 is your code". */
    private static let leads = regex(#"^\s*(?:is|est|ist|es|é|è|är|[-–—:|])\s[^.!?。\n]{0,30}\z"#, ignoringCase: true)

    private static let urls = regex(#"(?:https?://|www\.)\S+"#, ignoringCase: true)
    private static let spaces = regex("[\u{00A0}\u{2007}\u{202F}]")
    private static let digits = regex(#"^[0-9 -]+\z"#)
    private static let year = regex(#"^(?:19|20)[0-9][0-9]\z"#)

    private struct Found {
        let code: String
        let index: Int
    }

    static func mentioned(in text: String) -> Bool {
        let text = text as NSString
        return first(names, in: text) != nil || first(plainNames, in: text) != nil
    }

    static func find(subject: String, body: String) -> String? {
        let joined = "\(subject)\n\n\(body)" as NSString
        let cleaned = replace(spaces, in: replace(urls, in: joined.substring(to: min(6000, joined.length))))
        let text = cleaned as NSString
        let all = NSRange(location: 0, length: text.length)

        let candidates = names.matches(in: cleaned, range: all).map { ($0.range, close) }
            + plainNames.matches(in: cleaned, range: all).map { ($0.range, rightBeside) }
        for (name, gap) in candidates {
            let start = name.location
            let end = NSMaxRange(name)
            guard let found = codeAfter(text, end, gap) ?? codeBefore(text, start) ?? codeOnLineAfter(text, end) else { continue }
            let from = max(0, min(start, found.index) - 40)
            let to = min(text.length, max(end, found.index + (found.code as NSString).length) + 40)
            if first(otherCodes, in: text.substring(with: NSRange(location: from, length: to - from)) as NSString) != nil { continue }
            return tests(digits, found.code)
                ? found.code.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "-", with: "")
                : found.code
        }
        return nil
    }

    private static func codeAfter(_ text: NSString, _ end: Int, _ gap: NSRegularExpression) -> Found? {
        guard let match = codeInText.firstMatch(in: text as String, options: .withTransparentBounds, range: NSRange(location: end, length: text.length - end)) else { return nil }
        let code = text.substring(with: match.range)
        guard isCode(code), tests(gap, slice(text, end, match.range.location)) else { return nil }
        return Found(code: code, index: match.range.location)
    }

    private static func codeBefore(_ text: NSString, _ start: Int) -> Found? {
        let from = max(0, start - 50)
        var last: NSRange?
        codeInText.enumerateMatches(in: text as String, options: .withTransparentBounds, range: NSRange(location: from, length: text.length - from)) { match, _, stop in
            guard let match, match.range.location < start else { stop.pointee = true; return }
            last = match.range
        }
        guard let last else { return nil }
        let code = text.substring(with: last)
        guard isCode(code), tests(leads, slice(text, NSMaxRange(last), start)) else { return nil }
        return Found(code: code, index: last.location)
    }

    private static func codeOnLineAfter(_ text: NSString, _ end: Int) -> Found? {
        let newline = text.range(of: "\n", range: NSRange(location: end, length: text.length - end))
        guard newline.location != NSNotFound else { return nil }
        var index = NSMaxRange(newline)
        let lines = slice(text, index, index + 400).components(separatedBy: "\n").prefix(8)
        for line in lines {
            let line = line as NSString
            if let match = codeLine.firstMatch(in: line as String, range: NSRange(location: 0, length: line.length)) {
                let code = line.substring(with: match.range(at: 1))
                if isCode(code) { return Found(code: code, index: index + line.range(of: code).location) }
            }
            index += line.length + 1
        }
        return nil
    }

    private static func isCode(_ code: String) -> Bool { !tests(year, code) }

    /** JavaScript's `slice`: clamped, and empty when the end comes first. */
    private static func slice(_ text: NSString, _ from: Int, _ to: Int) -> String {
        let from = min(max(0, from), text.length)
        let to = min(max(0, to), text.length)
        return to > from ? text.substring(with: NSRange(location: from, length: to - from)) : ""
    }

    private static func replace(_ regex: NSRegularExpression, in text: String) -> String {
        regex.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length), withTemplate: " ")
    }

    private static func tests(_ regex: NSRegularExpression, _ text: String) -> Bool {
        first(regex, in: text as NSString) != nil
    }

    private static func first(_ regex: NSRegularExpression, in text: NSString) -> NSTextCheckingResult? {
        regex.firstMatch(in: text as String, range: NSRange(location: 0, length: text.length))
    }

    private static func regex(_ pattern: String, ignoringCase: Bool = false) -> NSRegularExpression {
        try! NSRegularExpression(pattern: pattern, options: ignoringCase ? .caseInsensitive : [])
    }
}

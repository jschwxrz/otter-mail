import { useEffect, useState } from "react";
import type { CountryCode } from "libphonenumber-js";

export type PhoneMatch = { start: number; end: number; text: string; number: string };

export type FindPhones = (text: string) => PhoneMatch[];

const CANDIDATE = /\d[\d\s()./-]{5,}\d/;
const NOT_A_PHONE =
  /,|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}/;

const digitGroups = (text: string) => text.match(/\d+/g)?.join(" ");

let finder: Promise<FindPhones> | null = null;

/**
 * Phone numbers as people write them: international (+…), with the national
 * prefix (0…), or grouped the way the country writes them ((415) 555-0132).
 * Order numbers, build numbers, dates, times and years parse as valid numbers
 * too, but aren't written that way.
 */
export function loadPhoneFinder(): Promise<FindPhones> {
  finder ??= Promise.all([
    import("libphonenumber-js/max"),
    window.desktopBridge.region().catch(() => undefined),
  ]).then(([{ findNumbers }, region]) => {
    // `leniency` is supported but missing from the library's types.
    const options = { defaultCountry: region as CountryCode, v2: true, leniency: "VALID" } as {
      defaultCountry?: CountryCode;
      v2: true;
    };
    return (text) => {
      if (!CANDIDATE.test(text)) return [];
      return findNumbers(text, options).flatMap((m) => {
        const raw = text.slice(m.startsAt, m.endsAt);
        const written =
          /^\(?[+0]/.test(raw) || digitGroups(raw) === digitGroups(m.number.formatNational());
        const balanced = raw.includes("(") === raw.includes(")");
        if (!written || !balanced || NOT_A_PHONE.test(raw)) return [];
        return [{ start: m.startsAt, end: m.endsAt, text: raw, number: m.number.number }];
      });
    };
  });
  return finder;
}

export function usePhoneFinder(): FindPhones | null {
  const [find, setFind] = useState<FindPhones | null>(null);
  useEffect(() => {
    let live = true;
    void loadPhoneFinder().then((loaded) => live && setFind(() => loaded));
    return () => {
      live = false;
    };
  }, []);
  return find;
}

const SKIP = "a, script, style, textarea, input, select, button, [data-otter-phone]";

/** Wraps each phone number in the email's text in `<span data-otter-phone>`. */
export function markPhones(doc: Document, find: FindPhones): void {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const found: [Text, PhoneMatch[]][] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.parentElement?.closest(SKIP)) continue;
    const matches = find(text.data);
    if (matches.length > 0) found.push([text, matches]);
  }
  for (const [text, matches] of found) {
    for (const match of matches.toReversed()) {
      text.splitText(match.end);
      const middle = text.splitText(match.start);
      const span = doc.createElement("span");
      span.dataset.otterPhone = match.number;
      span.textContent = middle.data;
      middle.replaceWith(span);
    }
  }
}

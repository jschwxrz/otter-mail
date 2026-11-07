import type { Chat, ChatTab } from "@otter-mail/contracts/chats";

export type ChatShelf = "pinned" | "active" | "snoozed" | "settled";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const SETTLE_AFTER_MS = 7 * DAY_MS;

/**
 * `working`: a turn runs in it here, so it doesn't settle for being idle.
 * `needsYou`: the agent asks for an approval or an answer, which outranks a
 * snooze or settling. A pinned chat never settles on its own.
 */
export function chatShelf(
  chat: Pick<Chat, "updatedAt" | "snoozedUntil" | "settledAt" | "pinnedAt">,
  { working, needsYou, now }: { working: boolean; needsYou: boolean; now: number },
): ChatShelf {
  const pinned = chat.pinnedAt != null;
  if (needsYou) return pinned ? "pinned" : "active";
  if (chat.snoozedUntil != null && chat.snoozedUntil > now) return "snoozed";
  if (chat.settledAt != null) return "settled";
  if (pinned) return "pinned";
  if (!working && now - chat.updatedAt > SETTLE_AFTER_MS) return "settled";
  return "active";
}

/**
 * Where it sits among the active chats: when you made it, wrote in it or
 * brought it back, or its snooze ran out. Replies, renames and tabs don't move it.
 */
export function chatReturnedAt(
  chat: Pick<Chat, "updatedAt" | "returnedAt" | "snoozedUntil">,
  now: number,
) {
  const woke = chat.snoozedUntil != null && chat.snoozedUntil <= now ? chat.snoozedUntil : 0;
  return Math.max(chat.returnedAt ?? chat.updatedAt, woke);
}

export type SnoozePreset = { id: string; label: string; when: string; until: number };

const timeOfDay = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function atHour(base: Date, days: number, hour: number): Date {
  const next = new Date(base);
  // Calendar days, not 24 hours, so a DST change can't skip a day.
  next.setDate(next.getDate() + days);
  next.setHours(hour, 0, 0, 0);
  return next;
}

export function snoozePresets(now: Date): SnoozePreset[] {
  const inHours = (hours: number) => new Date(now.getTime() + hours * HOUR_MS);
  const presets = [
    { id: "hour", label: "In 1 hour", date: inHours(1) },
    { id: "three-hours", label: "In 3 hours", date: inHours(3) },
  ];
  const evening = atHour(now, 0, 18);
  if (evening.getTime() - now.getTime() > HOUR_MS)
    presets.push({ id: "evening", label: "This evening", date: evening });
  const tomorrow = atHour(now, 1, 9);
  presets.push({ id: "tomorrow", label: "Tomorrow", date: tomorrow });
  const nextWeek = atHour(now, (1 - now.getDay() + 7) % 7 || 7, 9);
  if (nextWeek.getTime() !== tomorrow.getTime())
    presets.push({ id: "next-week", label: "Next week", date: nextWeek });
  return presets.map(({ id, label, date }) => ({
    id,
    label,
    when:
      id === "next-week"
        ? `${date.toLocaleDateString(undefined, { weekday: "short" })} ${timeOfDay(date)}`
        : timeOfDay(date),
    until: date.getTime(),
  }));
}

export function wakesIn(until: number, now: number): string {
  const left = until - now;
  if (left <= 0) return "now";
  if (left < HOUR_MS) return `${Math.max(1, Math.ceil(left / 60_000))}m`;
  if (left < DAY_MS) return `${Math.ceil(left / HOUR_MS)}h`;
  return `${Math.ceil(left / DAY_MS)}d`;
}

export function shortAgo(at: number, now: number): string {
  const mins = Math.floor((now - at) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

const TAB_NOUNS = [
  ["draft", "draft"],
  ["thread", "email"],
  ["file", "file"],
  ["page", "page"],
] as const;

/** What the chat used and made, from its tabs: "1 draft · 3 emails". */
export function tabsSummary(tabs: ChatTab[]): string {
  return TAB_NOUNS.flatMap(([kind, noun]) => {
    const n = tabs.filter((t) => t.ref.kind === kind).length;
    return n ? [`${n} ${noun}${n === 1 ? "" : "s"}`] : [];
  }).join(" · ");
}

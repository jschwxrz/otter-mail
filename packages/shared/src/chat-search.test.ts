import { describe, expect, it } from "vite-plus/test";
import {
  findTokenRanges,
  matchMessage,
  matchTitle,
  messageSnippet,
  messageTokens,
  rankChatTitles,
  searchTokens,
} from "./chat-search.ts";

describe("matchTitle", () => {
  it("matches every word at a word start, ignoring case and accents", () => {
    expect(matchTitle("Café invoices for March", searchTokens("cafe mar"))?.ranges).toEqual([
      { start: 0, end: 4 },
      { start: 18, end: 21 },
    ]);
    expect(matchTitle("Reply to Ana", searchTokens("ana bob"))).toBeNull();
  });

  it("matches inside a word only for longer words", () => {
    expect(matchTitle("Pick a model", searchTokens("del"))).toBeNull();
    expect(matchTitle("Reschedule standup", searchTokens("schedule"))).not.toBeNull();
  });
});

describe("rankChatTitles", () => {
  const now = Date.UTC(2026, 10, 8);
  it("puts whole words and exact titles above prefixes and mid-word hits", () => {
    const chats = [
      { title: "Rescheduled", updatedAt: now },
      { title: "Schedules for Q4", updatedAt: now },
      { title: "Schedule", updatedAt: now - 30 * 86_400_000 },
    ];
    expect(rankChatTitles(chats, "schedule", now).map((r) => r.chat.title)).toEqual([
      "Schedule",
      "Schedules for Q4",
      "Rescheduled",
    ]);
  });

  it("lifts recent chats among equal matches", () => {
    const chats = [
      { title: "Draft the reply", updatedAt: now - 60 * 86_400_000 },
      { title: "Draft the memo", updatedAt: now },
    ];
    expect(rankChatTitles(chats, "draft", now)[0]?.chat.title).toBe("Draft the memo");
  });
});

describe("messages", () => {
  it("skips words too short to search and needs every other word", () => {
    expect(messageTokens("an invoice")).toEqual(["invoice"]);
    expect(matchMessage("The invoice is attached.", ["invoice", "march"])).toBeNull();
    expect(matchMessage("The invoice is attached.", ["invoice"])).toEqual({
      quality: 1,
      offset: 4,
    });
  });

  it("shows one line around the match, cut at a word", () => {
    const text = `${"lorem ipsum ".repeat(10)}the invoice\nis attached`;
    const snippet = messageSnippet(text, text.indexOf("invoice"));
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet).toContain("the invoice is attached");
    expect(findTokenRanges(snippet, ["invoice"])).toHaveLength(1);
  });

  it("leaves markdown's bold and code marks out of the snippet", () => {
    expect(messageSnippet("Move the **pallets** with `forklift`", 9)).toBe(
      "Move the pallets with forklift",
    );
  });
});

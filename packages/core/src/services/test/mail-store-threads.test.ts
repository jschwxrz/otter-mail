import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Platform, SqlDatabase } from "../../platform.js";
import type { MessageSummary } from "../../types.js";

let database: DatabaseSync;
let store: typeof import("../mail-store.js");

const row = (id: string, threadId: string, date: number, labels: string[]): MessageSummary => ({
  id,
  threadId,
  subject: threadId,
  fromEmail: "them@example.com",
  fromName: "Them",
  to: "me@example.com",
  snippet: "",
  date,
  unread: false,
  starred: false,
  labelIds: labels,
  hasAttachments: false,
});

beforeEach(async () => {
  vi.resetModules();
  database = new DatabaseSync(":memory:");
  const { setPlatform } = await import("../../platform.js");
  setPlatform({
    database: () => database as unknown as SqlDatabase,
    broadcast: () => {},
    onResume: () => () => {},
    log: () => {},
  } as unknown as Platform);
  store = await import("../mail-store.js");
  store.upsertMessages("me", [
    row("old", "replied", 100, ["INBOX"]),
    row("draft", "replied", 300, ["DRAFT"]),
    row("newer", "other", 200, ["INBOX"]),
    row("compose", "new", 400, ["DRAFT"]),
  ]);
});
afterEach(() => database.close());

it("a draft doesn't move its thread up the list", () => {
  const inbox = store.getThreadsPage("me", "INBOX", 0, 10).messages;
  expect(inbox.map((m) => [m.threadId, m.id, m.date])).toEqual([
    ["other", "newer", 200],
    ["replied", "draft", 100],
  ]);
});

it("the Drafts view sorts by the drafts themselves", () => {
  const drafts = store.getThreadsPage("me", "DRAFT", 0, 10).messages;
  expect(drafts.map((m) => [m.threadId, m.date])).toEqual([
    ["new", 400],
    ["replied", 300],
  ]);
});

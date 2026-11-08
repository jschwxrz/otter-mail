import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useNodePlatform } from "../../providers/imap/test/node-platform.ts";
import type { MailAccount, MessageSummary } from "../../types.ts";
import { validAliasMailboxes } from "@otter/contracts";
import { aliasMailboxFor, parseAliasMailboxes } from "../alias-mailboxes.ts";
import * as store from "../mail-store.ts";
import { firstCopy } from "../notifier.ts";

useNodePlatform();

const ME = "me@riverbank.example";
const MAIL = "mail@riverbank.example";
let account = "";
let n = 0;

function put(labelIds: string[], fields: Partial<MessageSummary> = {}): MessageSummary {
  const id = `m${++n}`;
  const message: MessageSummary = {
    id,
    threadId: id,
    fromName: "Sam",
    fromEmail: "sam@mail.example",
    to: "",
    subject: `Subject ${id}`,
    snippet: "",
    date: n,
    unread: true,
    starred: false,
    labelIds,
    hasAttachments: false,
    ...fields,
  };
  store.upsertMessages(account, [message]);
  return message;
}

/** The parent sends from these besides its own address (`account`). */
const scope = (address: string) => ({ address, sendAs: [ME, MAIL] });

const threads = (labelId: string, alias?: string) =>
  store
    .getThreadsPage(account, labelId, 0, 50, alias ? scope(alias) : undefined)
    .messages.map((m) => m.id);

const folder = (id: string, alias: string) =>
  store.getAliasLabels(account, scope(alias)).find((l) => l.id === id);

beforeEach(() => {
  account = `robin${++n}@cloud.example`;
  store.upsertLabels(
    account,
    ["INBOX", "SENT", "DRAFT", "ARCHIVE", "SPAM", "TRASH", "STARRED", "UNREAD"].map((id) => ({
      id,
      name: id,
      type: "system" as const,
    })),
  );
});

describe("an alias mailbox's mail", () => {
  it("in the inbox: a copy delivered to one of its addresses is that one's only (iCloud's Bcc copy)", () => {
    const forMe = put(["INBOX", "UNREAD"], { to: MAIL, deliveredTo: [ME, account] });
    expect(threads("INBOX", ME)).toEqual([forMe.id]);
    expect(threads("INBOX", MAIL)).toEqual([]);
  });

  it("Postfix's: delivered to the mailbox's own address, the alias in X-Original-To", () => {
    const viaList = put(["INBOX"], { to: "list@mail.example", deliveredTo: [account, ME] });
    expect(threads("INBOX", ME)).toEqual([viaList.id]);
    expect(threads("INBOX", MAIL)).toEqual([]);
  });

  it("is none of mail to the mailbox's own address", () => {
    put(["INBOX"], { to: account, deliveredTo: [account] });
    expect(threads("INBOX", ME)).toEqual([]);
    expect(threads("INBOX", MAIL)).toEqual([]);
  });

  it("delivered to none of its addresses, goes by To and Cc", () => {
    const to = put(["INBOX"], { to: `Me <${ME}>`, deliveredTo: [account] });
    const cc = put(["INBOX"], { to: "ana@mail.example", cc: `"Mail, the" <${MAIL}>` });
    expect(threads("INBOX", ME)).toEqual([to.id]);
    expect(threads("INBOX", MAIL)).toEqual([cc.id]);
  });

  it("matches addresses exactly", () => {
    put(["INBOX"], { to: "xme@riverbank.example" });
    put(["INBOX"], { deliveredTo: ["me@riverbank.example.org"] });
    put(["INBOX"], { to: "ana@mail.example", deliveredTo: ["xme@riverbank.example"] });
    expect(threads("INBOX", ME)).toEqual([]);
  });

  it("in Sent and Drafts: what it's from", () => {
    const sent = put(["SENT"], { fromEmail: "Me@Riverbank.example", to: MAIL });
    const draft = put(["DRAFT"], { fromEmail: ME });
    put(["SENT"], { fromEmail: "robin@cloud.example", to: ME });
    expect(threads("SENT", ME)).toEqual([sent.id]);
    expect(threads("SENT", MAIL)).toEqual([]);
    expect(threads("DRAFT", ME)).toEqual([draft.id]);
  });

  it("in Archive, Trash and Flagged: either", () => {
    const from = put(["ARCHIVE"], { fromEmail: ME, to: "ana@mail.example" });
    const delivered = put(["ARCHIVE"], { to: "list@mail.example", deliveredTo: [ME] });
    put(["ARCHIVE"], { deliveredTo: [MAIL], to: ME });
    expect(threads("ARCHIVE", ME).toSorted()).toEqual([from.id, delivered.id].toSorted());
    const trashed = put(["TRASH"], { deliveredTo: [ME] });
    expect(threads("TRASH", ME)).toEqual([trashed.id]);
  });

  it("counts its own unread mail, and Drafts' total", () => {
    put(["INBOX", "UNREAD"], { deliveredTo: [ME] });
    put(["INBOX"], { deliveredTo: [ME], unread: false });
    put(["INBOX", "UNREAD"], { deliveredTo: [MAIL] });
    put(["DRAFT"], { fromEmail: ME, unread: false });
    expect(folder("INBOX", ME)).toMatchObject({ unread: 1, total: 2 });
    expect(folder("INBOX", MAIL)).toMatchObject({ unread: 1, total: 1 });
    expect(folder("DRAFT", ME)).toMatchObject({ unread: 0, total: 1 });
    // Only the parent's own folders: no user folders.
    expect(store.getAliasLabels(account, scope(ME)).map((l) => l.id)).toEqual([
      "INBOX",
      "STARRED",
      "SENT",
      "DRAFT",
      "ARCHIVE",
      "SPAM",
      "TRASH",
    ]);
  });
});

describe("the parent's tab, its alias mailboxes' mail set apart", () => {
  // Me has a mailbox of its own; Mail is only an address the parent sends from.
  const rest = { aliases: [ME], sendAs: [ME, MAIL] };
  const own = (labelId: string) =>
    store.getThreadsPage(account, labelId, 0, 50, rest).messages.map((m) => m.id);

  it("has the rest of its mail", () => {
    put(["INBOX", "UNREAD"], { to: ME, deliveredTo: [ME] });
    put(["INBOX"], { to: "list@mail.example", deliveredTo: [account, ME] });
    const forMail = put(["INBOX", "UNREAD"], { to: MAIL, deliveredTo: [MAIL] });
    const forParent = put(["INBOX"], { to: account, deliveredTo: [account] });
    put(["SENT"], { fromEmail: ME, to: "ana@mail.example" });
    const fromParent = put(["SENT"], { fromEmail: account, to: ME });
    expect(own("INBOX").toSorted()).toEqual([forMail.id, forParent.id].toSorted());
    expect(own("SENT")).toEqual([fromParent.id]);
  });

  it("counts without it, taken off the server's counts (they include mail not cached yet)", () => {
    put(["INBOX", "UNREAD"], { deliveredTo: [ME] });
    put(["INBOX"], { deliveredTo: [ME], unread: false });
    put(["INBOX", "UNREAD"], { deliveredTo: [MAIL] });
    const inbox = { id: "INBOX", name: "INBOX", type: "system" as const, unread: 7, total: 40 };
    const receipts = { id: "folder:Receipts", name: "Receipts", type: "user" as const, unread: 2 };
    expect(store.withoutAliasMail(account, [inbox, receipts], rest)).toEqual([
      { ...inbox, unread: 6, total: 38 },
      receipts,
    ]);
  });
});

describe("copies of one message", () => {
  // Sent To: mail@ with Bcc: me@, it arrives twice, alike but for where it was delivered.
  const bcc = () => {
    const header = { messageIdHeader: "<bcc@mail.example>", to: MAIL, threadId: "t-bcc" };
    const forMail = put(["INBOX", "UNREAD"], { ...header, deliveredTo: [MAIL] });
    const forMe = put(["INBOX", "UNREAD"], { ...header, deliveredTo: [ME] });
    return { forMail, forMe };
  };

  it("land one in each alias mailbox, and once in the parent", () => {
    const { forMail, forMe } = bcc();
    expect(folder("INBOX", ME)).toMatchObject({ unread: 1, total: 1 });
    expect(folder("INBOX", MAIL)).toMatchObject({ unread: 1, total: 1 });
    const parent = store.getThreadsPage(account, "INBOX", 0, 50).messages;
    expect(parent).toHaveLength(1);
    expect(parent[0]?.threadCount).toBe(1);
    expect(store.getThreadForReading(account, "t-bcc", ME).map((m) => m.id)).toEqual([forMe.id]);
    expect(store.getThreadForReading(account, "t-bcc", MAIL).map((m) => m.id)).toEqual([
      forMail.id,
    ]);
    expect(store.getThreadForReading(account, "t-bcc")).toHaveLength(1);
    expect(store.getCopies(account, forMe.id).toSorted()).toEqual(
      [forMail.id, forMe.id].toSorted(),
    );
  });

  it("move together only with the copies beside them, not your own in Sent", () => {
    const header = { messageIdHeader: "<self@mail.example>", threadId: "t-self", fromEmail: ME };
    const sent = put(["SENT"], { ...header, unread: false });
    const arrived = put(["INBOX", "UNREAD"], { ...header, to: ME, deliveredTo: [ME] });
    expect(store.getCopies(account, arrived.id).toSorted()).toEqual(
      [sent.id, arrived.id].toSorted(),
    );
    expect(store.getCopies(account, arrived.id, true)).toEqual([arrived.id]);
  });

  it("count once on the badge, and are unread to the reader while any is", () => {
    const before = store.countInboxUnreadAll();
    const { forMail } = bcc();
    expect(store.countInboxUnreadAll() - before).toBe(1);
    store.applyLabelChange(account, forMail.id, [], ["UNREAD"]);
    expect(store.getThreadForReading(account, "t-bcc", MAIL)[0]?.unread).toBe(true);
  });
});

describe("the delivery-headers backfill", () => {
  it("fills the delivered-to address and the recipients of mail cached before", () => {
    const old = put(["INBOX"], { to: "ana@mail.example" });
    store.upsertMessageDetail(account, {
      ...old,
      cc: MAIL,
      bodyHtml: null,
      bodyText: "",
      attachments: [],
    });
    expect(threads("INBOX", MAIL)).toEqual([old.id]);
    store.setDeliveredTo(account, [{ id: old.id, deliveredTo: [account, ME] }]);
    expect(threads("INBOX", MAIL)).toEqual([]);
    expect(threads("INBOX", ME)).toEqual([old.id]);
  });
});

describe("validAliasMailboxes", () => {
  const parent: MailAccount = {
    id: "robin@cloud.example",
    email: "robin@cloud.example",
    name: "Robin",
    provider: "imap",
    sendAs: ["Me@riverbank.example", MAIL, "side@other.example"],
    aliasMailboxes: parseAliasMailboxes([
      { address: ME, name: " ", color: "#ff9500" },
      { address: MAIL },
      { address: "gone@riverbank.example" },
      { address: "side@other.example" },
      { address: "ME@riverbank.example" },
      { nothing: true },
    ]),
  };

  it("keeps addresses it sends from, once each, that aren't mailboxes of their own", () => {
    expect(validAliasMailboxes(parent, [parent.email, "side@other.example"])).toEqual([
      { address: ME, color: "#ff9500" },
      { address: MAIL },
    ]);
  });
});

describe("notifications", () => {
  const aliases = [{ address: ME }, { address: MAIL }];

  it("are named after the first alias mailbox in To, then Cc, then where it was delivered", () => {
    expect(aliasMailboxFor(aliases, { to: `ana@mail.example, ${MAIL}`, cc: ME })).toEqual({
      address: MAIL,
    });
    expect(aliasMailboxFor(aliases, { to: "ana@mail.example", cc: `Me <${ME}>` })).toEqual({
      address: ME,
    });
    expect(
      aliasMailboxFor(aliases, {
        to: "list@mail.example",
        deliveredTo: ["robin@cloud.example", ME],
      }),
    ).toEqual({
      address: ME,
    });
    expect(aliasMailboxFor(aliases, { to: "xme@riverbank.example" })).toBeUndefined();
  });

  it("go out once per Message-ID, copies arriving apart", () => {
    const copy = { messageIdHeader: "<once@mail.example>" } as MessageSummary;
    expect(firstCopy("robin@cloud.example", copy, 1_000)).toBe(true);
    expect(firstCopy("robin@cloud.example", copy, 60_000)).toBe(false);
    expect(firstCopy("other@cloud.example", copy, 60_000)).toBe(true);
    expect(firstCopy("robin@cloud.example", {} as MessageSummary, 60_000)).toBe(true);
    expect(firstCopy("robin@cloud.example", {} as MessageSummary, 60_000)).toBe(true);
    // Long after, it's mail again (a resend).
    expect(firstCopy("robin@cloud.example", copy, 60 * 60_000)).toBe(true);
  });
});

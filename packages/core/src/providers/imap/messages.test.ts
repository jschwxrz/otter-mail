import { describe, expect, it } from "vite-plus/test";

import { utf8Encode } from "../../bytes.ts";
import { parseResponse } from "../../protocols/imap/parser.ts";
import { parseFetch } from "../../protocols/imap/structures.ts";
import { deliveryAddressesOf, toSummary } from "./messages.ts";
import type { Folder } from "./folders.ts";

/** A FETCH of the delivery headers, as the server sends them: the topmost first. */
function fetched(headers: string[], envelope = 'NIL "Hi" NIL NIL NIL NIL NIL NIL NIL NIL') {
  const block = `${headers.join("\r\n")}\r\n\r\n`;
  return parseFetch(
    parseResponse(
      utf8Encode(
        `* 1 FETCH (UID 7 ENVELOPE (${envelope}) BODY[HEADER.FIELDS (REFERENCES ORIGINAL-RECIPIENT DELIVERED-TO X-ORIGINAL-TO)] {${block.length}}\r\n${block})\r\n`,
      ),
    ),
  );
}

describe("deliveryAddressesOf", () => {
  it("keeps each header's topmost address, lower-cased, without rfc822;", () => {
    const message = fetched([
      "Original-recipient: rfc822;Mail@Riverbank.example",
      "Delivered-To: robin@cloud.example",
      "Original-Recipient: rfc822;older@riverbank.example",
    ]);
    expect(deliveryAddressesOf(message.headers)).toEqual([
      "mail@riverbank.example",
      "robin@cloud.example",
    ]);
  });

  it("keeps Postfix's two: the mailbox's own address and the alias it came to", () => {
    const message = fetched([
      "X-Original-To: me@riverbank.example",
      "Delivered-To: <robin@cloud.example>",
    ]);
    expect(deliveryAddressesOf(message.headers)).toEqual([
      "robin@cloud.example",
      "me@riverbank.example",
    ]);
  });

  it("is empty without any of them", () => {
    expect(deliveryAddressesOf(fetched(["References: <a@b.example>"]).headers)).toEqual([]);
    expect(deliveryAddressesOf(undefined)).toEqual([]);
  });
});

describe("toSummary", () => {
  const inbox: Folder = {
    path: "INBOX",
    delimiter: "/",
    name: "INBOX",
    role: "INBOX",
    labelId: "INBOX",
  };

  it("keeps Cc and the delivered-to address", async () => {
    const cc = '(("Sam Lee" NIL "sam" "mail.example")("Ana" NIL "ana" "mail.example"))';
    const to = '(("Mail" NIL "mail" "riverbank.example"))';
    const message = fetched(
      ["Original-Recipient: rfc822;me@riverbank.example"],
      `NIL "Hi" NIL NIL NIL ${to} ${cc} NIL NIL "<x@mail.example>"`,
    );
    const summary = await toSummary(inbox, 1, message);
    expect(summary.to).toBe("Mail <mail@riverbank.example>");
    expect(summary.cc).toBe("Sam Lee <sam@mail.example>, Ana <ana@mail.example>");
    expect(summary.deliveredTo).toEqual(["me@riverbank.example"]);
    expect(summary.messageIdHeader).toBe("<x@mail.example>");
  });
});

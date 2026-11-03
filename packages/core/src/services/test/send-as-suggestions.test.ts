import { describe, expect, it } from "vite-plus/test";
import { suggestSendAs } from "../send-as-suggestions.ts";

const counts = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("suggestSendAs", () => {
  it("offers what it sent from, and its own domain's addresses mail came to", () => {
    expect(
      suggestSendAs(["me@icloud.com"], {
        sentFrom: counts({ "me@icloud.com": 9, "hello@shop.dev": 2 }),
        receivedAt: counts({
          "me@icloud.com": 30,
          "hello@shop.dev": 5,
          "orders@shop.dev": 3,
          "once@shop.dev": 1,
          "friend@icloud.com": 4,
          "list@lists.example.org": 12,
        }),
      }),
    ).toEqual(["hello@shop.dev", "orders@shop.dev"]);
  });

  it("knows a custom domain from the mailbox's own address, and skips addresses it has", () => {
    expect(
      suggestSendAs(["me@shop.dev", "hello@shop.dev"], {
        sentFrom: counts({}),
        receivedAt: counts({ "hello@shop.dev": 8, "team@shop.dev": 2, "x@gmail.com": 5 }),
      }),
    ).toEqual(["team@shop.dev"]);
  });

  it("never offers something that isn't one address", () => {
    expect(
      suggestSendAs(["me@shop.dev"], {
        sentFrom: counts({ "undisclosed-recipients:;": 3 }),
        receivedAt: counts({ "a b@shop.dev": 3 }),
      }),
    ).toEqual([]);
  });
});

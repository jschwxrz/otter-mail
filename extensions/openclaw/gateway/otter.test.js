import { describe, expect, it, vi } from "vite-plus/test";
import {
  accountOf,
  chatOf,
  chatTarget,
  inboxKey,
  isNewChat,
  isOwnerConfigured,
  messageOf,
  newChatKey,
  otterTargetsNote,
  pointerOf,
  sessionOf,
  targetOf,
  tell,
} from "./otter.js";

describe("the Otter channel plugin", () => {
  it("keeps what's sent to one of Otter's chats in that chat, and anything else in the inbox", () => {
    const chat = "agent:main:otter-mail:c-1";
    expect(chatOf(chatTarget(chat))).toBe(chat);
    expect(chatOf(`otter:${chatTarget(chat)}`)).toBe(chat);
    expect(chatOf("inbox")).toBeUndefined();
    expect(chatOf("chat:not-a-session")).toBeUndefined();
    expect(sessionOf(chatTarget(chat), "main")).toBe(chat);
    expect(sessionOf("inbox", "main")).toBe(inboxKey("main"));
    expect(pointerOf({ sessionKey: "agent:main:cron:1", to: chatTarget(chat), at: 4 })).toEqual({
      kind: "message",
      agentId: "main",
      sessionKey: chat,
      at: 4,
    });
  });

  it('starts a chat with each delivery to "new", like a post to a channel rather than a thread', () => {
    expect(targetOf("new")).toBe("new");
    expect(targetOf("otter:new")).toBe("new");
    expect(isNewChat("new")).toBe(true);
    expect(targetOf("chat:agent:main:otter-mail:c-1")).toBe("chat:agent:main:otter-mail:c-1");
    expect(targetOf("inbox")).toBe("inbox");
    expect(targetOf(undefined)).toBe("inbox");
    // The gateway routes the delivery to a new chat's session, and sends it with that key.
    const chat = newChatKey("rowan", "n-1");
    expect(chat).toBe("agent:rowan:otter-mail:n-1");
    expect(pointerOf({ sessionKey: chat, to: "new", at: 6 })).toEqual({
      kind: "message",
      agentId: "rowan",
      sessionKey: chat,
      at: 6,
    });
  });

  it("tells an agent in an Otter chat where it can deliver, this chat included", () => {
    const note = otterTargetsNote("agent:main:otter-mail:c-1");
    expect(note).toContain('"chat:agent:main:otter-mail:c-1": this chat');
    expect(note).toContain('"new"');
    expect(note).toContain('"inbox"');
    expect(otterTargetsNote(undefined)).toContain('"chat:<session key>": this chat');
  });

  it("sends as the owner only once commands.ownerAllowFrom lists otter:owner", () => {
    expect(isOwnerConfigured({})).toBe(false);
    expect(isOwnerConfigured({ commands: { ownerAllowFrom: ["telegram:1", "*"] } })).toBe(false);
    expect(isOwnerConfigured({ commands: { ownerAllowFrom: ["telegram:1", "otter:owner"] } })).toBe(
      true,
    );
  });

  it("takes a message for an agent's session, with its key, text or files", () => {
    const sessionKey = "agent:rowan:otter-mail:c-1";
    expect(messageOf({ sessionKey, message: "Hi", idempotencyKey: "k-1" })).toEqual({
      sessionKey,
      agentId: "rowan",
      text: "Hi",
      messageId: "k-1",
      files: [],
    });
    const file = { content: "aGk=", mimeType: "image/png", fileName: "a.png" };
    expect(messageOf({ sessionKey, idempotencyKey: "k-2", attachments: [file] }).files).toEqual([
      file,
    ]);
    expect(() => messageOf({ sessionKey: "main", message: "Hi", idempotencyKey: "k" })).toThrow();
    expect(() => messageOf({ sessionKey, message: "Hi" })).toThrow();
    expect(() => messageOf({ sessionKey, message: " ", idempotencyKey: "k" })).toThrow();
    expect(() =>
      messageOf({ sessionKey, idempotencyKey: "k", attachments: [{ content: "x" }] }),
    ).toThrow();
  });

  it("points at where a cron job's message is kept, never sending its text", () => {
    const pointer = pointerOf({
      sessionKey: "agent:rowan:cron:job-1",
      payload: { text: "Your bank statement is ready." },
      at: 5,
    });
    expect(pointer).toEqual({
      kind: "message",
      agentId: "rowan",
      sessionKey: inboxKey("rowan"),
      at: 5,
    });
    expect(JSON.stringify(pointer)).not.toContain("bank");
  });

  it("points at an approval or a question by its id, in the session that asked", () => {
    expect(
      pointerOf({
        payload: {
          text: "Allow rm -rf build?",
          channelData: {
            execApproval: {
              approvalId: "ap-1",
              approvalKind: "exec",
              agentId: "main",
              sessionKey: "agent:main:otter-mail:c-1",
              state: "pending",
            },
          },
        },
        at: 1,
      }),
    ).toEqual({
      kind: "approval",
      agentId: "main",
      sessionKey: "agent:main:otter-mail:c-1",
      approvalId: "ap-1",
      approvalKind: "exec",
      resolved: false,
      at: 1,
    });
    expect(
      pointerOf({
        sessionKey: "agent:main:main",
        payload: { channelData: { askUser: { questionId: "q-1" } } },
        at: 2,
      }),
    ).toEqual({
      kind: "question",
      agentId: "main",
      sessionKey: "agent:main:main",
      questionId: "q-1",
      at: 2,
    });
  });

  it("tells the relay with the channel's token, and nothing without one", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 202 }));
    const account = accountOf({
      channels: { otter: { relayUrl: "https://relay.test/", token: "otter_ch_x" } },
    });
    const pointer = pointerOf({ sessionKey: "agent:main:cron:1", at: 3 });
    expect(await tell(account, pointer, { fetch })).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://relay.test/channel/v1/pointers", {
      method: "POST",
      signal: undefined,
      headers: { "content-type": "application/json", authorization: "Bearer otter_ch_x" },
      body: JSON.stringify(pointer),
    });
    expect(await tell(accountOf({ channels: { otter: {} } }), pointer, { fetch })).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

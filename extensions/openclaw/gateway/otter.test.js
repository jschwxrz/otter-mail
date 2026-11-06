import { describe, expect, it, vi } from "vite-plus/test";
import { accountOf, inboxKey, pointerOf, tell } from "./otter.js";

describe("the Otter channel plugin", () => {
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

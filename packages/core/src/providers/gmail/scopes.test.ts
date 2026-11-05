import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { GMAIL_ACCESS_MISSING_MESSAGE } from "../../google.ts";
import { logger } from "../../logger.ts";
import { setPlatform, type Platform } from "../../platform.ts";
import { describeError, errorKind, getSendAs, GmailApiError, listLabelNames } from "./api.ts";
import { gmailProvider } from "./index.ts";

const insufficientScopes = {
  error: {
    code: 403,
    message: "Request had insufficient authentication scopes.",
    errors: [{ reason: "insufficientPermissions" }],
    status: "PERMISSION_DENIED",
    details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
  },
};

let logged: { level: string; message: string }[];

beforeEach(() => {
  logged = [];
  let current: unknown;
  setPlatform({
    google: { getAccessToken: async () => "token" },
    log: (level: string, _scope: string, message: string) => logged.push({ level, message }),
    asyncContext: () => ({
      run: (value: unknown, fn: () => unknown) => {
        current = value;
        return fn();
      },
      get: () => current,
    }),
  } as unknown as Platform);
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify(insufficientScopes), { status: 403 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a Gmail grant without access to mail", () => {
  it("asks to sign in again instead of failing as a Gmail error", async () => {
    const err = await listLabelNames("me@example.com").catch((e: unknown) => e);
    expect((err as Error).message).toBe(GMAIL_ACCESS_MISSING_MESSAGE);
    expect((err as Error).cause).toBeInstanceOf(GmailApiError);
    expect(errorKind(err)).toBe("auth");
    expect(describeError(err)).toBe(GMAIL_ACCESS_MISSING_MESSAGE);
  });

  it("is logged as a warning, not an error to report", async () => {
    const err = await listLabelNames("me@example.com").catch((e: unknown) => e);
    logger.failure("handlers", "gmail:labels failed", err);
    expect(logged).toEqual([{ level: "warn", message: "gmail:labels failed" }]);
  });

  it("keeps a missing settings scope for the signature to explain", async () => {
    expect(
      await getSendAs("me@example.com", "me@example.com").catch((e: unknown) => e),
    ).toBeInstanceOf(GmailApiError);
    const err = await gmailProvider
      .signatures!.set("me@example.com", "me@example.com", "<b>x</b>")
      .then(() => null)
      .catch((e: unknown) => e as Error);
    expect(err?.message).not.toBe(GMAIL_ACCESS_MISSING_MESSAGE);
    expect(err?.cause).toBeInstanceOf(GmailApiError);
  });
});

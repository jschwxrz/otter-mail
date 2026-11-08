import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const { requestMain, saved, stateDir } = vi.hoisted(() => ({
  requestMain: vi.fn(),
  saved: [] as unknown[],
  stateDir: { path: "" },
}));

vi.mock("../main-link.js", () => ({ requestMain }));
vi.mock("../backend-protocol.js", () => ({ appInfo: () => ({ stateDir: stateDir.path }) }));
vi.mock("./credentials-store.js", () => ({
  getCredentials: async () => ({ clientId: "client", clientSecret: "secret" }),
}));
vi.mock("@otter/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otter/core")>()),
  accountStore: {
    getAccount: async () => undefined,
    addAccount: async (account: unknown) => void saved.push(account),
  },
}));

import { GMAIL_ACCESS_MISSING_MESSAGE } from "@otter/core";

import { googleAuth } from "./gmail-oauth.js";

const realFetch = globalThis.fetch;
let grantedScope = "";

beforeEach(async () => {
  stateDir.path = await fs.mkdtemp(path.join(os.tmpdir(), "gmail-oauth-"));
  saved.length = 0;
  requestMain.mockImplementation(async (kind: string, params: { url?: string; text?: string }) => {
    if (kind === "seal") return params.text;
    if (kind === "openExternal") {
      const consent = new URL(params.url!).searchParams;
      await realFetch(`${consent.get("redirect_uri")}?state=${consent.get("state")}&code=code`);
    }
  });
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        scope: grantedScope,
      });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/userinfo") {
      return Response.json({ email: "me@example.com", name: "Me" });
    }
    return realFetch(input, init);
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(stateDir.path, { recursive: true, force: true });
});

it("refuses a grant where Gmail access was unticked", async () => {
  grantedScope = "openid email profile https://www.googleapis.com/auth/calendar.readonly";
  await expect(googleAuth.addAccount("me@example.com")).rejects.toThrow(
    GMAIL_ACCESS_MISSING_MESSAGE,
  );
  expect(saved).toEqual([]);
});

it("adds a mailbox that allowed Gmail, even without the optional permissions", async () => {
  grantedScope = "openid email profile https://mail.google.com/";
  await expect(googleAuth.addAccount("me@example.com")).resolves.toMatchObject({
    id: "me@example.com",
  });
  expect(saved).toHaveLength(1);
});

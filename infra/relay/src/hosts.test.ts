import { describe, expect, it } from "vite-plus/test";

import { forHost } from "./hosts.ts";

const env = {
  BETTER_AUTH_URL: "https://relay.mail.otterware.app",
  APP_ORIGIN: "https://mail.otterware.app",
  COOKIE_DOMAIN: "mail.otterware.app",
  RELAY_HOSTS: JSON.stringify({
    "https://relay.otterware.app": { app: "https://otter.otterware.app" },
  }),
};

describe("relay hosts", () => {
  it("keeps the env on BETTER_AUTH_URL's host", () => {
    expect(forHost(env, "https://relay.mail.otterware.app/v1/me")).toBe(env);
  });

  it("gives a listed host its own callbacks, web app and host-only cookies", () => {
    expect(forHost(env, "https://relay.otterware.app/v1/auth/callback/otter?state=x")).toEqual({
      ...env,
      BETTER_AUTH_URL: "https://relay.otterware.app",
      APP_ORIGIN: "https://otter.otterware.app",
      COOKIE_DOMAIN: undefined,
    });
  });

  it("keeps the env for a host it doesn't list", () => {
    expect(forHost(env, "https://relay.mail.otterware.dev/v1/me")).toBe(env);
    expect(forHost({ ...env, RELAY_HOSTS: undefined }, "https://relay.otterware.app/")).toEqual({
      ...env,
      RELAY_HOSTS: undefined,
    });
  });
});

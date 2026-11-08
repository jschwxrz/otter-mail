/**
 * What a development run opens on: `pnpm dev[:desktop][:fake|:demo|:real]` (scripts/dev-runner.ts,
 * docs/development.md#what-a-dev-run-opens-on). The runner tells the desktop app with
 * OTTER_DEV_DATA; a packaged app ignores it.
 *
 * - `empty`: a new sandbox with nothing in it. Add what you need.
 * - `fake`: made-up mailboxes from pretend services (@otter/core/fake), no accounts or network.
 * - `demo`: the real demo accounts made for development (./demo.ts), signed in.
 * - `real`: a copy of the user's installed desktop app, signed in to their own mail. Only when
 *   the user asks for it, and nothing lasting without their say (AGENTS.md).
 */
export const DEV_DATA_ENV = "OTTER_DEV_DATA";

export const DEV_DATA = ["empty", "fake", "demo", "real"] as const;
export type DevData = (typeof DEV_DATA)[number];

export function devDataFrom(env: Record<string, string | undefined>): DevData {
  const value = env[DEV_DATA_ENV];
  return DEV_DATA.find((data) => data === value) ?? "empty";
}

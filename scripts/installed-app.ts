// The user's installed desktop app, which `pnpm dev:desktop:real` runs a copy of
// (docs/development.md#what-a-dev-run-opens-on). Data flows one way, out of it: nothing here
// writes to the installed app's own data.

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { DatabaseSync } from "node:sqlite";

import { otterHome } from "../apps/desktop/scripts/dev-home.mjs";

/** Its data (`~/.otter/userdata`; apps/desktop/src/paths.ts). */
export const installedStateDir = (): string => NodePath.join(otterHome(), "userdata");

const BUNDLES = [
  "/Applications/Otter.app/Contents/Resources/app.asar",
  "/Applications/Otter Mail.app/Contents/Resources/app.asar",
  NodePath.join(NodeOS.homedir(), "Applications/Otter.app/Contents/Resources/app.asar"),
  NodePath.join(NodeOS.homedir(), "Applications/Otter Mail.app/Contents/Resources/app.asar"),
  "/opt/otter-mail/resources/app.asar",
];

/**
 * The OAuth clients built into the installed app (the Release workflow's OTTER_* variables).
 * Its Google and Microsoft sign-ins only refresh with the client that made them, and a dev
 * checkout's `.env.local` has its own. Read from its bundle, where the build put them: a desktop
 * app's client secret is public (apps/desktop/src/services/credentials-store.ts).
 */
export function installedOAuthClients(): Record<string, string> {
  const bundle = BUNDLES.find((file) => NodeFS.existsSync(file));
  if (!bundle) throw new Error(`No installed Otter app found (looked for ${BUNDLES.join(", ")}).`);
  const code = NodeFS.readFileSync(bundle, "latin1");
  const clients: Record<string, string> = {};
  for (const name of [
    "OTTER_GOOGLE_CLIENT_ID",
    "OTTER_GOOGLE_CLIENT_SECRET",
    "OTTER_MICROSOFT_CLIENT_ID",
  ]) {
    // What Vite left of `process.env.NAME?.trim() || __NAME__` in its main process.
    const found = new RegExp(`process\\.env\\.${name}\\?\\.trim\\(\\)\\s*\\|\\|\\s*"([^"]*)"`).exec(
      code,
    )?.[1];
    if (found) clients[name] = found;
  }
  if (!clients.OTTER_GOOGLE_CLIENT_ID) {
    throw new Error(`Couldn't find the Google OAuth client in ${bundle}.`);
  }
  return clients;
}

/** Left in the installed app: what would act as the user beyond their mail, or is only its own. */
const LEFT_BEHIND = new Set([
  // The Otter account (its session is in secrets.json too, below): it syncs both ways.
  "otter-account.json",
  // The browser's profile (about a gigabyte) and its extensions.
  "chromium",
  "Extensions",
  // Its own: the agents' MCP server's port, its error reports, caches, logs, a running app's locks.
  "mcp-server.json",
  "error-reports.json",
  "attachment-cache",
  "translation-cache",
  "logs",
  "sentry",
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
  "mail-cache.db",
  "mail-cache.db-wal",
  "mail-cache.db-shm",
]);

/**
 * Makes `target` a copy of the installed app's data, signed in to the same mailboxes, calendars,
 * agents and services, but not to the Otter account. Its secrets stay sealed under the
 * installed app's Keychain key, which the dev app uses for this data (apps/desktop/src/paths.ts).
 */
export function copyInstalledData(target: string): void {
  const source = installedStateDir();
  if (!NodeFS.existsSync(source)) throw new Error(`The installed app has no data at ${source}.`);
  if (NodePath.resolve(target) === NodePath.resolve(source)) {
    throw new Error(`Refusing to copy the installed app's data onto itself (${source}).`);
  }
  NodeFS.rmSync(target, { recursive: true, force: true });
  NodeFS.mkdirSync(target, { recursive: true });
  for (const name of NodeFS.readdirSync(source)) {
    if (LEFT_BEHIND.has(name)) continue;
    NodeFS.cpSync(NodePath.join(source, name), NodePath.join(target, name), { recursive: true });
  }

  const secrets = readJson(NodePath.join(target, "secrets.json"));
  if (secrets) {
    delete secrets["otter-session"];
    writeJson(NodePath.join(target, "secrets.json"), secrets);
  }
  const settings = readJson(NodePath.join(target, "settings.json"));
  if (settings)
    writeJson(NodePath.join(target, "settings.json"), { ...settings, launchAtLogin: false });

  copyMailCache(NodePath.join(source, "mail-cache.db"), NodePath.join(target, "mail-cache.db"));
}

/**
 * A consistent snapshot of the open cache (VACUUM INTO reads through the installed app's
 * writes), less what only the installed app may act on: its scheduled sends (both would send
 * them), its push watches, and which mailboxes it linked to the Otter account.
 */
function copyMailCache(source: string, target: string): void {
  const from = new DatabaseSync(source, { readOnly: true });
  try {
    from.prepare("VACUUM INTO ?").run(target);
  } finally {
    from.close();
  }
  const cache = new DatabaseSync(target);
  try {
    cache.exec(`
      DELETE FROM mail_schedule;
      DELETE FROM kv WHERE key = 'otter:linkedAccounts'
        OR key LIKE 'gmailWatch:%' OR key LIKE 'outlookSubscription:%';
    `);
  } finally {
    cache.close();
  }
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  NodeFS.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

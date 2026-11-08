#!/usr/bin/env node
// Copies the installed app's mail and settings into a dev data home, one way. Nothing that could
// act as the user comes along: no sign-ins or secrets (sealed under the installed app's Keychain
// key anyway, agents' keys included), no Otter account (it would sync both ways), no push
// watches, no scheduled sends.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

import { otterHome, resolveDevHome } from "../apps/desktop/scripts/dev-home.mjs";
import { repoRoot } from "./build-translator.ts";

const CACHE = "mail-cache.db";
const COPIED = [
  "accounts.json",
  "views.json",
  "appearance.json",
  "ui-preferences.json",
  "keybindings.json",
  "assistant-providers.json",
];

export const installedStateDir = (): string => NodePath.join(otterHome(), "userdata");

/** Where `pnpm dev:desktop` keeps its data for this checkout (apps/desktop/src/paths.ts). */
export function devStateDir(dataHome: string | undefined): string {
  return dataHome ? NodePath.join(dataHome, "userdata") : NodePath.join(otterHome(), "dev");
}

export function needsSeed(stateDir: string): boolean {
  return !NodeFS.existsSync(NodePath.join(stateDir, CACHE));
}

export function seedDevHome(target: string, source = installedStateDir()): void {
  if (NodePath.resolve(target) === NodePath.resolve(source)) {
    throw new Error(`Refusing to seed the installed app's own data (${source}).`);
  }
  if (devAppRunning(target)) {
    throw new Error(`The dev app is running on ${target}. Quit it first.`);
  }
  NodeFS.mkdirSync(target, { recursive: true });

  for (const suffix of ["", "-wal", "-shm"]) {
    NodeFS.rmSync(NodePath.join(target, CACHE + suffix), { force: true });
  }
  const from = new DatabaseSync(NodePath.join(source, CACHE), { readOnly: true });
  try {
    from.prepare("VACUUM INTO ?").run(NodePath.join(target, CACHE));
  } finally {
    from.close();
  }
  const cache = new DatabaseSync(NodePath.join(target, CACHE));
  try {
    cache.exec(`
      DELETE FROM mail_schedule;
      DELETE FROM kv WHERE key = 'otter:linkedAccounts'
        OR key LIKE 'gmailWatch:%' OR key LIKE 'outlookSubscription:%';
    `);
  } finally {
    cache.close();
  }

  for (const name of COPIED) {
    const file = NodePath.join(source, name);
    if (NodeFS.existsSync(file)) NodeFS.copyFileSync(file, NodePath.join(target, name));
  }
  const settings = readJson(NodePath.join(source, "settings.json"));
  if (settings)
    writeJson(NodePath.join(target, "settings.json"), { ...settings, launchAtLogin: false });
  const chats = readJson(NodePath.join(source, "chats.json"));
  if (chats)
    writeJson(NodePath.join(target, "chats.json"), { chats: chats.chats ?? [], pending: [] });
}

/** Electron's SingletonLock links to "<host>-<pid>" while an app has the directory open. */
function devAppRunning(stateDir: string): boolean {
  let lock: string;
  try {
    lock = NodeFS.readlinkSync(NodePath.join(stateDir, "SingletonLock"));
  } catch {
    return false;
  }
  const pid = Number(lock.slice(lock.lastIndexOf("-") + 1));
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJson(file: string): Record<string, any> | null {
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  NodeFS.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { home: { type: "string" } } });
  const target = devStateDir(resolveDevHome({ cwd: repoRoot, explicitHome: values.home }));
  seedDevHome(target);
  console.log(`[dev] Seeded ${target} from ${installedStateDir()}.`);
}

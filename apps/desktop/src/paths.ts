import { app } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { devDataFrom } from "@otter/contracts/dev-data";

/** Must run before `ready` and before anything reads app paths. */
export function configureAppPaths(): string {
  // Electron names the Keychain (macOS) and libsecret (Linux) key after the name the app has when
  // its startup code is done: this one, the name its secrets were sealed under. `nameApp` renames it at ready.
  // A dev run on a copy of the installed app's data (`pnpm dev:desktop:real`) opens them with its key.
  const installedKey = app.isPackaged || devDataFrom(process.env) === "real";
  app.setName(installedKey ? "Otter Mail" : "Otter Mail (Dev)");
  const configuredHome = (process.env.OTTER_HOME ?? process.env.OTTER_MAIL_HOME)?.trim();
  const home = configuredHome ? path.resolve(configuredHome) : otterHome();
  const useDevDir = !app.isPackaged && !configuredHome;
  const stateDir = path.join(home, useDevDir ? "dev" : "userdata");
  app.setPath("userData", stateDir);
  app.setPath("sessionData", path.join(stateDir, "chromium"));
  app.setAppLogsPath(path.join(stateDir, "logs"));
  return stateDir;
}

export function nameApp(): void {
  app.setName(app.isPackaged ? "Otter" : "Otter (Dev)");
}

/**
 * ~/.otter; an install from before the rename keeps ~/.otter-mail. Never moved: Claude files its
 * chats under the workspace's real path, and an older copy may still have it open.
 */
function otterHome(): string {
  const legacy = path.join(os.homedir(), ".otter-mail");
  return fs.existsSync(legacy) ? legacy : path.join(os.homedir(), ".otter");
}

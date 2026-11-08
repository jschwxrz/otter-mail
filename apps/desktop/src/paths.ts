import { app } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Must run before `ready` and before anything reads app paths. */
export function configureAppPaths(): string {
  // Electron names the Keychain (macOS) and libsecret (Linux) key after the name the app has when
  // its startup code is done: this one, the name its secrets were sealed under. `nameApp` renames it at ready.
  app.setName(app.isPackaged ? "Otter Mail" : "Otter Mail (Dev)");
  const configuredHome = process.env.OTTER_HOME?.trim();
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

/** ~/.otter, moved from Otter Mail's ~/.otter-mail with a link left there for what still points at it. */
function otterHome(): string {
  const home = path.join(os.homedir(), ".otter");
  const legacy = path.join(os.homedir(), ".otter-mail");
  if (fs.existsSync(home) || !fs.existsSync(legacy)) return home;
  try {
    fs.renameSync(legacy, home);
    fs.symlinkSync(home, legacy);
    return home;
  } catch {
    return fs.existsSync(home) ? home : legacy;
  }
}

import { app } from "electron";
import * as os from "node:os";
import * as path from "node:path";

/** Must run before `ready` and before anything reads app paths. */
export function configureAppPaths(): string {
  // Electron names the Keychain (macOS) and libsecret (Linux) key after the name the app has when
  // its startup code is done: this one, the name its secrets were sealed under. `nameApp` renames it at ready.
  app.setName(app.isPackaged ? "Otter Mail" : "Otter Mail (Dev)");
  const configuredHome = process.env.OTTER_MAIL_HOME?.trim();
  const home = configuredHome
    ? path.resolve(configuredHome)
    : path.join(os.homedir(), ".otter-mail");
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

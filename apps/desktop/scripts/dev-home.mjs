// A worktree home must override inherited OTTER_HOME (or OTTER_MAIL_HOME) to protect the installed app's database.

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export function resolveLinkedWorktree(cwd) {
  let directory = NodePath.resolve(cwd);
  for (;;) {
    const gitPath = NodePath.join(directory, ".git");
    let stat = null;
    try {
      stat = NodeFS.statSync(gitPath);
    } catch {
      // Keep walking up.
    }
    if (stat) {
      if (!stat.isFile()) return undefined;
      const gitdir = NodeFS.readFileSync(gitPath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith("gitdir:"))
        ?.slice("gitdir:".length)
        .trim();
      const segments = (gitdir ?? "").split(/[/\\]/).filter(Boolean);
      return segments.length >= 3 && segments.at(-2) === "worktrees" ? directory : undefined;
    }
    const parent = NodePath.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function resolveDevHome({ cwd, explicitHome, env = process.env }) {
  const explicit = explicitHome?.trim();
  if (explicit) return NodePath.resolve(explicit);
  const worktree = resolveLinkedWorktree(cwd);
  if (worktree)
    return keepLegacyHome(
      NodePath.join(worktree, ".otter-mail"),
      NodePath.join(worktree, ".otter"),
    );
  const ambient = (env.OTTER_HOME ?? env.OTTER_MAIL_HOME)?.trim();
  return ambient ? NodePath.resolve(ambient) : undefined;
}

/** ~/.otter, as the app finds it (apps/desktop/src/paths.ts). */
export function otterHome() {
  return keepLegacyHome(
    NodePath.join(NodeOS.homedir(), ".otter-mail"),
    NodePath.join(NodeOS.homedir(), ".otter"),
  );
}

/** A home from before the rename to Otter stays where it is (apps/desktop/src/paths.ts says why). */
function keepLegacyHome(legacy, home) {
  return NodeFS.existsSync(legacy) ? legacy : home;
}

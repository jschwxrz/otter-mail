import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  MAX_SUPPORT_BODY,
  parseSupportDraft,
  SUPPORT_PLATFORMS,
  type SupportDraft,
  type SupportReport,
  type SupportSession,
} from "@otter/shared/support";

export function supportDirectory(home: string, id: unknown): string {
  if (typeof id !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
    throw new Error("Invalid support session.");
  return path.join(home, "support", id);
}

export function validSupportReport(value: unknown): value is SupportReport {
  const report = value as SupportReport | undefined;
  return (
    !!report &&
    (report.kind === undefined || report.kind === "bug" || report.kind === "feature") &&
    (report.platform === undefined || Object.hasOwn(SUPPORT_PLATFORMS, report.platform)) &&
    [report.title, report.happened, report.expected, report.steps].every(
      (field, index) =>
        typeof field === "string" && field.length <= [160, 6_000, 4_000, 4_000][index]!,
    ) &&
    !!report.title.trim() &&
    report.title.length <= 160
  );
}

/** Bound reads and refuse links: agents can write drafts, never redirect reads elsewhere. */
async function readFile(file: string, maxCharacters = MAX_SUPPORT_BODY): Promise<string> {
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    const limit = maxCharacters * 4 + 4_096;
    if (!stat.isFile() || stat.size > limit)
      throw new Error("The support file is too large or invalid.");
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > limit) throw new Error("The support file is too large.");
    return bytes.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function checkedDirectory(home: string, id: unknown): Promise<string> {
  const directory = supportDirectory(home, id);
  if (!(await fs.lstat(directory)).isDirectory()) throw new Error("Invalid support session.");
  return directory;
}

export async function rememberSupportSession(home: string, session: SupportSession): Promise<void> {
  const directory = await checkedDirectory(home, session.id);
  await fs.writeFile(path.join(directory, "session.json"), JSON.stringify(session), {
    mode: 0o600,
  });
  await fs.writeFile(path.join(home, "support", "active.json"), JSON.stringify(session.id), {
    mode: 0o600,
  });
}

export async function resumeSupportSession(home: string): Promise<SupportSession | null> {
  try {
    const id: unknown = JSON.parse(await readFile(path.join(home, "support", "active.json")));
    const directory = await checkedDirectory(home, id);
    const session = JSON.parse(
      await readFile(path.join(directory, "session.json"), MAX_SUPPORT_BODY * 2 + 15_000),
    ) as SupportSession;
    if (
      session.id !== id ||
      (session.agent !== "claude" && session.agent !== "codex") ||
      !validSupportReport(session.report) ||
      typeof session.body !== "string" ||
      session.body.length > MAX_SUPPORT_BODY
    )
      return null;
    return session;
  } catch {
    return null;
  }
}

export async function readSupportDraft(home: string, id: unknown): Promise<SupportDraft | null> {
  const directory = await checkedDirectory(home, id);
  for (const kind of ["issue", "findings"] as const) {
    try {
      return parseSupportDraft(await readFile(path.join(directory, `${kind}.md`)), kind);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return null;
}

export async function forgetSupportSession(home: string, id: unknown): Promise<void> {
  supportDirectory(home, id);
  const current = await resumeSupportSession(home);
  if (current?.id === id) await fs.rm(path.join(home, "support", "active.json"), { force: true });
}

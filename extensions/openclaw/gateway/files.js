import { open, realpath } from "node:fs/promises";
import path from "node:path";

/** Sent base64 in one gateway message (16 MB at most). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** A file in the agent's workspace, whole: the gateway's own reader stops at images and small text. */
export async function readWorkspaceFile(workspace, requested) {
  const root = await realpath(workspace);
  const file = await realpath(path.resolve(root, requested)).catch(() => {
    throw new Error("file not found");
  });
  if (!file.startsWith(root + path.sep)) throw new Error("file is outside the agent's workspace");
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("file not found");
    if (stat.size > MAX_FILE_BYTES) throw new Error("file is too large (10 MB max)");
    const data = await handle.readFile();
    return { name: path.basename(file), size: data.length, content: data.toString("base64") };
  } finally {
    await handle.close();
  }
}

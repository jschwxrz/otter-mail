import { mkdir, mkdtemp, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { MAX_FILE_BYTES, readWorkspaceFile } from "./files.js";

describe("otter.files.get", () => {
  it("reads any file in the workspace whole, and nothing outside it", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "otter-files-"));
    const workspace = path.join(base, "workspace");
    await mkdir(path.join(workspace, "artifacts"), { recursive: true });
    const pdf = Buffer.from("%PDF-1.7 lease");
    await writeFile(path.join(workspace, "artifacts", "lease.pdf"), pdf);
    await writeFile(path.join(base, "secret.txt"), "no");
    await symlink(path.join(base, "secret.txt"), path.join(workspace, "link.txt"));

    const file = await readWorkspaceFile(workspace, "artifacts/lease.pdf");
    expect(file).toEqual({ name: "lease.pdf", size: pdf.length, content: pdf.toString("base64") });
    expect(await readWorkspaceFile(workspace, path.join(workspace, "artifacts/lease.pdf"))).toEqual(
      file,
    );
    await expect(readWorkspaceFile(workspace, "../secret.txt")).rejects.toThrow(/outside/);
    await expect(readWorkspaceFile(workspace, "link.txt")).rejects.toThrow(/outside/);
    await expect(readWorkspaceFile(workspace, "/etc/hostname")).rejects.toThrow(
      /outside|not found/,
    );
    await expect(readWorkspaceFile(workspace, "missing.pdf")).rejects.toThrow(/not found/);
    await expect(readWorkspaceFile(workspace, "artifacts")).rejects.toThrow(/not found/);
  });

  it("sends only what fits in one gateway message, base64", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "otter-files-"));
    await writeFile(path.join(workspace, "big.bin"), "");
    await truncate(path.join(workspace, "big.bin"), MAX_FILE_BYTES + 1);
    await expect(readWorkspaceFile(workspace, "big.bin")).rejects.toThrow(/too large/);
    expect(Math.ceil(MAX_FILE_BYTES / 3) * 4).toBeLessThan(16 * 1024 * 1024);
  });
});

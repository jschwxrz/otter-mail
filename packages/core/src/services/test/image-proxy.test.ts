import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { proxyRemoteImage } from "../image-proxy.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function serve(body: BodyInit, headers: Record<string, string> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { headers })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("proxyRemoteImage", () => {
  it("shows an image its server didn't label", async () => {
    serve(PNG);
    const { dataUrl } = await proxyRemoteImage("https://example.com/logo");
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("shows one labeled application/octet-stream", async () => {
    serve(PNG, { "content-type": "application/octet-stream" });
    expect((await proxyRemoteImage("https://example.com/logo")).dataUrl).toMatch(
      /^data:image\/png;/,
    );
  });

  it("keeps the type the server gave", async () => {
    serve("<svg/>", { "content-type": "image/svg+xml; charset=utf-8" });
    expect((await proxyRemoteImage("https://example.com/logo.svg")).dataUrl).toMatch(
      /^data:image\/svg\+xml;base64,/,
    );
  });

  it("refuses what isn't an image", async () => {
    serve("<html></html>", { "content-type": "text/html" });
    await expect(proxyRemoteImage("https://example.com/page")).rejects.toThrow(/not an image/);
  });
});

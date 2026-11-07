import { afterEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  updateExtensions: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("electron", () => ({ app: {}, session: {} }));
vi.mock("electron-chrome-web-store", () => ({
  installChromeWebStore: vi.fn(),
  updateExtensions: mocks.updateExtensions,
}));
vi.mock("../ipc.js", () => ({ broadcast: vi.fn() }));
vi.mock("../logger.js", () => ({ logger: mocks.logger }));
vi.mock("./extensions.js", () => ({}));
vi.mock("./mailto-target.js", () => ({}));
vi.mock("../os/index.js", () => ({ hostOS: {} }));
vi.mock("../windows/context-menu.js", () => ({}));

const session = {} as Electron.Session;

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function checkOnce(rejection: unknown) {
  mocks.updateExtensions.mockRejectedValueOnce(rejection);
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  const { keepExtensionsUpdated } = await import("./browser.ts");
  keepExtensionsUpdated(session);
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.off("unhandledRejection", unhandled);
  expect(mocks.updateExtensions).toHaveBeenCalledOnce();
  expect(unhandled).not.toHaveBeenCalled();
}

it("warns, and doesn't leave unhandled, an update check the network failed", async () => {
  const timeout = Object.assign(new Error("Connect Timeout Error"), {
    name: "ConnectTimeoutError",
  });
  await checkOnce(new TypeError("fetch failed", { cause: timeout }));
  expect(mocks.logger.warn).toHaveBeenCalledWith(
    "browser",
    "Couldn't check for extension updates",
    { error: "ConnectTimeoutError: Connect Timeout Error" },
  );
  expect(mocks.logger.error).not.toHaveBeenCalled();
});

it("reports any other update failure", async () => {
  const error = new SyntaxError("Unexpected token");
  await checkOnce(error);
  expect(mocks.logger.error).toHaveBeenCalledWith("browser", "Extension update failed", error);
});

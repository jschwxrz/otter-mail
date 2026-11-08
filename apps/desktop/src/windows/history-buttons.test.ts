import type { BrowserWindow, WebContents } from "electron";
import { describe, expect, it, vi } from "vite-plus/test";

import { followHistoryButtons, followPageHistoryButtons } from "./history-buttons";

type Listener = (...args: any[]) => void;

function fakeContents() {
  const listeners = new Map<string, Listener>();
  return {
    listeners,
    on: (name: string, listener: Listener) => listeners.set(name, listener),
    send: vi.fn(),
    navigationHistory: { goBack: vi.fn(), goForward: vi.fn() },
  };
}

function fakeWindow() {
  const contents = fakeContents();
  const listeners = new Map<string, Listener>();
  const win = {
    webContents: contents,
    isDestroyed: () => false,
    on: (name: string, listener: Listener) => listeners.set(name, listener),
  };
  return { win, contents, listeners };
}

describe("followHistoryButtons", () => {
  it("steps the app's history on the mouse's back and forward buttons", () => {
    const { win, contents } = fakeWindow();
    followHistoryButtons(win as unknown as BrowserWindow, () => null);
    const mouse = contents.listeners.get("before-mouse-event")!;
    mouse({}, { type: "mouseUp", button: "back" });
    mouse({}, { type: "mouseUp", button: "forward" });
    mouse({}, { type: "mouseDown", button: "back" });
    mouse({}, { type: "mouseUp", button: "left" });
    expect(contents.send.mock.calls).toEqual([["nav:back"], ["nav:forward"]]);
  });

  it("reads Logi Options+'s swipes as Chrome does: left is back", () => {
    const { win, contents, listeners } = fakeWindow();
    followHistoryButtons(win as unknown as BrowserWindow, () => null);
    const swipe = listeners.get("swipe")!;
    swipe({}, "left");
    swipe({}, "right");
    swipe({}, "up");
    expect(contents.send.mock.calls).toEqual([["nav:back"], ["nav:forward"]]);
  });

  it("swipes the focused browser tab in this window rather than the app", () => {
    const { win, contents, listeners } = fakeWindow();
    const page = { ...fakeContents(), hostWebContents: contents };
    followHistoryButtons(win as unknown as BrowserWindow, () => page as unknown as WebContents);
    listeners.get("swipe")!({}, "left");
    expect(page.navigationHistory.goBack).toHaveBeenCalledOnce();
    expect(contents.send).not.toHaveBeenCalled();
  });
});

describe("followPageHistoryButtons", () => {
  it("steps a browser tab's own history", () => {
    const page = fakeContents();
    followPageHistoryButtons(page as unknown as WebContents);
    const mouse = page.listeners.get("before-mouse-event")!;
    mouse({}, { type: "mouseUp", button: "back" });
    mouse({}, { type: "mouseUp", button: "forward" });
    expect(page.navigationHistory.goBack).toHaveBeenCalledOnce();
    expect(page.navigationHistory.goForward).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from "vite-plus/test";
import { CONTROL_TTL_MS, cdpInput, createBrowserControl } from "./control.js";

const fixture = () => {
  let time = 1000;
  const sent = [];
  const page = {
    open: () => true,
    send: (method, params) => sent.push([method, params]),
    close() {},
  };
  const control = createBrowserControl({
    cdpUrlFor: async () => "http://127.0.0.1:18800/",
    connect: async () => page,
    now: () => time,
  });
  return { control, sent, advance: (ms) => (time += ms) };
};
const text = (t) => ({ type: "text", text: t });

describe("taking control of the agent's browser", () => {
  it("replays input only while held, and in the order it was sent", async () => {
    const { control, sent } = fixture();
    await expect(control.input("tab", undefined, 1, [text("a")])).rejects.toThrow(/Take control/);
    control.take("tab");
    expect(control.anyHeld()).toBe(true);
    await control.input("tab", undefined, 2, [text("b")]);
    expect(sent).toEqual([]);
    await control.input("tab", undefined, 1, [text("a")]);
    expect(sent.map(([, p]) => p.text)).toEqual(["a", "b"]);
    control.release("tab");
    expect(control.anyHeld()).toBe(false);
  });

  it("lets go of a tab nobody has touched for a while", () => {
    const { control, advance } = fixture();
    control.take("tab");
    advance(CONTROL_TTL_MS + 1);
    expect(control.anyHeld()).toBe(false);
  });

  it("goes on without a batch that never arrives", async () => {
    vi.useFakeTimers();
    const { control, sent } = fixture();
    control.take("tab");
    await control.input("tab", undefined, 2, [text("b")]);
    vi.advanceTimersByTime(200);
    expect(sent.map(([, p]) => p.text)).toEqual(["b"]);
    vi.useRealTimers();
  });

  it("sends keys and clicks as a person's", () => {
    expect(
      cdpInput({ type: "key", action: "down", key: "a", code: "KeyA", keyCode: 65, text: "a" }),
    ).toEqual([
      "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "keyDown", text: "a", windowsVirtualKeyCode: 65 }),
    ]);
    expect(
      cdpInput({ type: "key", action: "down", key: "Enter", code: "Enter", keyCode: 13 })?.[1],
    ).toMatchObject({ type: "rawKeyDown" });
    expect(
      cdpInput({ type: "mouse", action: "down", x: 3, y: 4, button: "left", buttons: 1 }),
    ).toEqual([
      "Input.dispatchMouseEvent",
      expect.objectContaining({ type: "mousePressed", x: 3, y: 4, button: "left" }),
    ]);
    expect(cdpInput({ type: "eval", code: "x" })).toBeNull();
  });
});

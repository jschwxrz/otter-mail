type InputEvent = { type: string; [key: string]: unknown };
type FrameSize = { cssWidth: number; cssHeight: number };

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const BUTTONS = ["left", "middle", "right"] as const;
const DOUBLE_CLICK_MS = 500;

/** DevTools' bits: Alt 1, Ctrl 2, Meta 4, Shift 8. ⌘ on a Mac is Ctrl in the agent's browser. */
function modifiers(event: KeyboardEvent | MouseEvent): number {
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey || (isMac && event.metaKey) ? 2 : 0) |
    (!isMac && event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}

/**
 * Sends what you do on the live view to the agent's tab, in page CSS px. Moves and wheel
 * turns are merged into one batch an animation frame; presses, keys and pastes go at once.
 * Returns `send`, for what doesn't come from the canvas (a pop-up's answer, going back), and
 * `detach`.
 */
export function controlBrowser(
  canvas: HTMLCanvasElement,
  {
    frameSize,
    send,
    onLost,
  }: {
    frameSize: () => FrameSize | null;
    send: (seq: number, events: InputEvent[]) => Promise<unknown>;
    onLost: (error: unknown) => void;
  },
): { send: (event: InputEvent) => void; detach: () => void } {
  let seq = 0;
  let scheduled = 0;
  const queue: InputEvent[] = [];
  const flush = () => {
    cancelAnimationFrame(scheduled);
    scheduled = 0;
    if (queue.length === 0) return;
    send(++seq, queue.splice(0)).catch(onLost);
  };
  const push = (event: InputEvent, now = false) => {
    const last = queue.at(-1);
    if (event.type === "mouse" && event.action === "move" && last?.action === "move")
      queue[queue.length - 1] = event;
    else if (event.type === "wheel" && last?.type === "wheel")
      queue[queue.length - 1] = {
        ...event,
        deltaX: (last.deltaX as number) + (event.deltaX as number),
        deltaY: (last.deltaY as number) + (event.deltaY as number),
      };
    else queue.push(event);
    if (now) flush();
    else scheduled ||= requestAnimationFrame(flush);
  };

  const point = (event: MouseEvent) => {
    const size = frameSize();
    if (!size || !canvas.width || !canvas.height) return null;
    const box = canvas.getBoundingClientRect();
    const scale = Math.min(box.width / canvas.width, box.height / canvas.height);
    const width = canvas.width * scale;
    const height = canvas.height * scale;
    const left = box.left + (box.width - width) / 2;
    const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
    return {
      x: clamp(((event.clientX - left) / width) * size.cssWidth, size.cssWidth),
      y: clamp(((event.clientY - box.top) / height) * size.cssHeight, size.cssHeight),
    };
  };

  let lastDown = { at: 0, x: 0, y: 0, count: 0 };
  const mouse = (action: "down" | "up" | "move", event: PointerEvent) => {
    const at = point(event);
    if (!at) return;
    const button = action === "move" ? "none" : (BUTTONS[event.button] ?? "none");
    let clickCount = 0;
    if (action === "down") {
      const near = Math.abs(at.x - lastDown.x) < 4 && Math.abs(at.y - lastDown.y) < 4;
      const count =
        near && event.timeStamp - lastDown.at < DOUBLE_CLICK_MS ? lastDown.count + 1 : 1;
      lastDown = { at: event.timeStamp, ...at, count };
    }
    if (action !== "move") clickCount = lastDown.count;
    push(
      {
        type: "mouse",
        action,
        ...at,
        button,
        buttons: event.buttons,
        clickCount,
        modifiers: modifiers(event),
      },
      action !== "move",
    );
  };

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    mouse("down", event);
  };
  const onPointerMove = (event: PointerEvent) => mouse("move", event);
  const onPointerUp = (event: PointerEvent) => mouse("up", event);
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const at = point(event);
    if (!at) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    push({
      type: "wheel",
      ...at,
      deltaX: event.deltaX * unit,
      deltaY: event.deltaY * unit,
      modifiers: modifiers(event),
    });
  };
  const key = (action: "down" | "up", event: KeyboardEvent) => {
    const shortcut = event.ctrlKey || event.metaKey;
    // The paste event that follows carries the text.
    if (shortcut && event.key.toLowerCase() === "v") return;
    event.preventDefault();
    const text =
      action === "up" || event.isComposing
        ? undefined
        : event.key === "Enter"
          ? "\r"
          : event.key.length === 1 && !shortcut
            ? event.key
            : undefined;
    push(
      {
        type: "key",
        action,
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        ...(text ? { text } : {}),
        modifiers: modifiers(event),
      },
      true,
    );
  };
  const onKeyDown = (event: KeyboardEvent) => key("down", event);
  const onKeyUp = (event: KeyboardEvent) => key("up", event);
  const onPaste = (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text/plain");
    event.preventDefault();
    if (text) push({ type: "text", text }, true);
  };
  const onContextMenu = (event: Event) => event.preventDefault();

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("paste", onPaste);
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.focus({ preventScroll: true });
  return {
    send: (event) => push(event, true),
    detach: () => {
      flush();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("paste", onPaste);
      canvas.removeEventListener("contextmenu", onContextMenu);
    },
  };
}

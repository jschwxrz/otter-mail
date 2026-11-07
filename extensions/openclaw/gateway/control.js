/** A held tab is released this long after Otter last sent input or a heartbeat (it quit, say). */
export const CONTROL_TTL_MS = 30_000;
/** How long a batch waits for one sent before it, before giving up on that one. */
const GAP_MS = 150;

const MOUSE_TYPES = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" };
const BUTTONS = new Set(["none", "left", "middle", "right"]);
const num = (value) => (Number.isFinite(value) ? value : 0);

/** The DevTools call that replays one of Otter's input events, as a person's input. */
export function cdpInput(event) {
  const modifiers = num(event?.modifiers);
  switch (event?.type) {
    case "mouse":
      if (!MOUSE_TYPES[event.action]) return null;
      return [
        "Input.dispatchMouseEvent",
        {
          type: MOUSE_TYPES[event.action],
          x: num(event.x),
          y: num(event.y),
          button: BUTTONS.has(event.button) ? event.button : "none",
          buttons: num(event.buttons),
          clickCount: num(event.clickCount),
          modifiers,
        },
      ];
    case "wheel":
      return [
        "Input.dispatchMouseEvent",
        {
          type: "mouseWheel",
          x: num(event.x),
          y: num(event.y),
          deltaX: num(event.deltaX),
          deltaY: num(event.deltaY),
          modifiers,
        },
      ];
    case "key": {
      if (typeof event.key !== "string" || typeof event.code !== "string") return null;
      const text = typeof event.text === "string" ? event.text : undefined;
      return [
        "Input.dispatchKeyEvent",
        {
          type: event.action === "up" ? "keyUp" : text ? "keyDown" : "rawKeyDown",
          key: event.key,
          code: event.code,
          windowsVirtualKeyCode: num(event.keyCode),
          nativeVirtualKeyCode: num(event.keyCode),
          ...(text ? { text, unmodifiedText: text } : {}),
          modifiers,
        },
      ];
    }
    case "text":
      return typeof event.text === "string"
        ? ["Input.insertText", { text: event.text.slice(0, 10_000) }]
        : null;
    default:
      return null;
  }
}

/** A page's own DevTools connection: input is sent without waiting for Chromium's replies. */
export async function connectTarget(cdpUrl, targetId) {
  const list = await fetch(new URL("/json/list", cdpUrl), { signal: AbortSignal.timeout(5000) })
    .then((response) => response.json())
    .catch(() => {
      throw new Error("Couldn't reach the agent's browser.");
    });
  const target = Array.isArray(list) ? list.find((t) => t?.id === targetId) : undefined;
  if (typeof target?.webSocketDebuggerUrl !== "string") throw new Error("That tab has closed.");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("Couldn't reach the agent's browser.")),
      {
        once: true,
      },
    );
  });
  let id = 0;
  return {
    open: () => socket.readyState === WebSocket.OPEN,
    send: (method, params) => socket.send(JSON.stringify({ id: ++id, method, params })),
    close: () => socket.close(),
  };
}

/**
 * Who holds which of the agent's tabs, and their input. Batches carry a sequence number, so
 * they're replayed in the order Otter sent them however the gateway runs its requests.
 */
export function createBrowserControl({ cdpUrlFor, connect = connectTarget, now = Date.now }) {
  const held = new Map();

  const holding = (targetId) => {
    const tab = held.get(targetId);
    if (tab && tab.until > now()) return tab;
    if (tab) drop(targetId);
    return undefined;
  };
  const drop = (targetId) => {
    const tab = held.get(targetId);
    held.delete(targetId);
    clearTimeout(tab?.gap);
    void tab?.page?.then((page) => page.close()).catch(() => {});
  };
  const open = (targetId, profile) => cdpUrlFor(profile).then((url) => connect(url, targetId));
  const pageOf = async (tab, targetId, profile) => {
    tab.page ??= open(targetId, profile);
    const page = await tab.page.catch(() => null);
    if (page?.open()) return page;
    tab.page = open(targetId, profile);
    return tab.page;
  };
  const flush = (tab, page) => {
    const missing = tab.next;
    while (tab.waiting.has(tab.next)) {
      for (const event of tab.waiting.get(tab.next)) {
        const call = cdpInput(event);
        if (call) page.send(...call);
      }
      tab.waiting.delete(tab.next);
      tab.next += 1;
    }
    // A batch is missing: let it arrive, then go on without it. Batches arriving behind it
    // don't push that back.
    if (tab.gap && tab.next === missing && tab.waiting.size > 0) return;
    clearTimeout(tab.gap);
    tab.gap = undefined;
    if (tab.waiting.size === 0) return;
    tab.gap = setTimeout(() => {
      tab.gap = undefined;
      tab.next = Math.min(...tab.waiting.keys());
      flush(tab, page);
    }, GAP_MS);
  };

  return {
    anyHeld: () => [...held.keys()].some((targetId) => holding(targetId)),
    take(targetId) {
      const tab = holding(targetId);
      if (tab) tab.until = now() + CONTROL_TTL_MS;
      else held.set(targetId, { until: now() + CONTROL_TTL_MS, next: 1, waiting: new Map() });
    },
    release: drop,
    async input(targetId, profile, seq, events) {
      const tab = holding(targetId);
      if (!tab) throw new Error("Take control of this tab first.");
      tab.until = now() + CONTROL_TTL_MS;
      if (!Number.isInteger(seq) || seq < tab.next || !Array.isArray(events)) return;
      tab.waiting.set(seq, events.slice(0, 200));
      const page = await pageOf(tab, targetId, profile);
      if (held.get(targetId) === tab) flush(tab, page);
    },
  };
}

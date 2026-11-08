import type { BrowserWindow, MouseInputEvent, WebContents } from "electron";

export type HistoryStep = "back" | "forward";

/** Back or forward in the focused browser page, else in the app's own history. */
export function stepHistory(
  win: BrowserWindow | null | undefined,
  page: WebContents | null,
  step: HistoryStep,
): void {
  if (page && (!win || page.hostWebContents === win.webContents)) {
    stepPage(page, step);
    return;
  }
  if (win && !win.isDestroyed()) win.webContents.send(`nav:${step}`);
}

/**
 * The mouse's back and forward buttons, anywhere in the window (a message's
 * iframe included). On a Mac, Logi Options+ sends them as a swipe instead
 * (deltaX +1 is back, which Electron calls "left"), as Chrome and Safari read it.
 */
export function followHistoryButtons(
  win: BrowserWindow,
  focusedPage: () => WebContents | null,
): void {
  win.webContents.on("before-mouse-event", (_event, mouse) => {
    const step = buttonStep(mouse);
    if (step && !win.isDestroyed()) win.webContents.send(`nav:${step}`);
  });
  win.on("swipe", (_event, direction) => {
    if (direction === "left") stepHistory(win, focusedPage(), "back");
    else if (direction === "right") stepHistory(win, focusedPage(), "forward");
  });
}

/** A browser tab's page takes the buttons itself, so they move its own history. */
export function followPageHistoryButtons(page: WebContents): void {
  page.on("before-mouse-event", (_event, mouse) => {
    const step = buttonStep(mouse);
    if (step) stepPage(page, step);
  });
}

function stepPage(page: WebContents, step: HistoryStep): void {
  if (step === "back") page.navigationHistory.goBack();
  else page.navigationHistory.goForward();
}

function buttonStep(mouse: MouseInputEvent): HistoryStep | null {
  if (mouse.type !== "mouseUp") return null;
  // Electron reports these buttons though its types list only left, middle and right.
  const button = mouse.button as string | undefined;
  return button === "back" || button === "forward" ? button : null;
}

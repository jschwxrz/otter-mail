let popup: Window | null = null;
export function prepareTodoistPopup(): void {
  popup?.close();
  popup = window.open("about:blank", "otter-todoist-sign-in", "popup,width=600,height=760");
  if (!popup) throw new Error("Allow popups for Otter, then connect Todoist again.");
  popup.document.title = "Connecting Todoist…";
  popup.document.body.textContent = "Opening Todoist sign-in…";
}
export function closeTodoistPopup(): void {
  popup?.close();
  popup = null;
}
export function authorizeTodoistPopup(url: string): Promise<string> {
  const target = popup;
  if (!target || target.closed)
    return Promise.reject(new Error("Todoist sign-in was cancelled. Try connecting again."));
  const auth = new URL(url);
  if (auth.origin !== "https://app.todoist.com" || auth.pathname !== "/oauth/authorize")
    return Promise.reject(new Error("Invalid Todoist sign-in URL."));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(closed);
      clearTimeout(timeout);
      closeTodoistPopup();
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== target ||
        event.origin !== location.origin ||
        event.data?.type !== "otter:todoist-sign-in" ||
        typeof event.data.url !== "string"
      )
        return;
      cleanup();
      resolve(event.data.url);
    };
    const closed = setInterval(() => {
      if (target.closed) {
        cleanup();
        reject(new Error("Todoist sign-in was cancelled."));
      }
    }, 500);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Todoist sign-in timed out. Try again."));
    }, 300000);
    window.addEventListener("message", onMessage);
    target.location.href = url;
  });
}

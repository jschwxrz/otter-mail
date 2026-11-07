import { useEffect, useRef, useState } from "react";
import { GlobeIcon, LoaderCircleIcon, MonitorOffIcon } from "lucide-react";
import { mailApi, type ProviderKind } from "./api";

type ViewState =
  | { status: "connecting"; page?: string }
  | { status: "live"; page?: string }
  | { status: "closed" }
  | { status: "failed"; message: string };

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/**
 * The agent's browser tab, live: OpenClaw's screencast (a WebSocket of JPEG frames, about 20 a
 * second) straight from the gateway, decoded off the main thread and handed to the canvas
 * without a copy. A frame that arrives while one decodes replaces the one waiting, so a slow
 * machine skips frames rather than falling behind; nothing streams while the page is hidden.
 * `activity` changes when the agent browses again: it may have moved to another tab.
 */
export function AgentBrowser({
  provider,
  sessionId,
  agentName,
  activity,
}: {
  provider: ProviderKind;
  sessionId: string;
  agentName: string;
  activity: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef<string | null>(null);
  const [state, setState] = useState<ViewState>({ status: "connecting" });
  const [connection, setConnection] = useState(0);
  const visible = usePageVisible();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("bitmaprenderer");
    if (!visible || !canvas || !context) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let decoding = false;
    let waiting: Blob | null = null;
    let shown = false;

    const draw = (frame: Blob) => {
      if (decoding) {
        waiting = frame;
        return;
      }
      decoding = true;
      createImageBitmap(frame)
        .then(
          (bitmap) => {
            if (stopped) return bitmap.close();
            if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
            if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
            context.transferFromImageBitmap(bitmap);
            if (!shown) {
              shown = true;
              failures = 0;
              setState((s) => ({ status: "live", page: "page" in s ? s.page : undefined }));
            }
          },
          () => {},
        )
        .finally(() => {
          decoding = false;
          const next = waiting;
          waiting = null;
          if (next && !stopped) draw(next);
        });
    };

    const connect = () => {
      const box = canvas.parentElement?.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      mailApi
        .agentBrowserView(provider, sessionId, {
          width: Math.round((box?.width ?? 1280) * scale),
          height: Math.round((box?.height ?? 800) * scale),
        })
        .then(
          (view) => {
            if (stopped) return;
            if (!view?.url) {
              targetRef.current = null;
              setState({ status: "closed" });
              return;
            }
            targetRef.current = view.targetId;
            shown = false;
            setState({ status: "connecting", page: view.page });
            const opened = new WebSocket(view.url);
            socket = opened;
            opened.binaryType = "arraybuffer";
            opened.addEventListener("message", ({ data }) => {
              if (typeof data === "string") {
                const message = JSON.parse(data) as { type?: string; url?: string };
                if (message.url && (message.type === "ready" || message.type === "meta"))
                  setState((s) =>
                    s.status === "live" ? { status: "live", page: message.url } : s,
                  );
                return;
              }
              const buffer = data as ArrayBuffer;
              const header = new DataView(buffer).getUint32(0);
              draw(new Blob([new Uint8Array(buffer, 4 + header)], { type: "image/jpeg" }));
            });
            opened.addEventListener("close", ({ code }) => {
              socket = null;
              if (stopped) return;
              if (code === 4003) {
                setState({
                  status: "failed",
                  message: "OpenClaw stopped the view: it doesn't allow that address.",
                });
                return;
              }
              if (code === 4005) {
                setState({ status: "failed", message: "This browser can't be watched live." });
                return;
              }
              // The tab closed (4004) or the stream dropped: ask again, as often as it keeps working.
              failures += 1;
              retry = setTimeout(
                connect,
                code === 4004 ? 300 : Math.min(1000 * 2 ** failures, 15000),
              );
            });
          },
          (error: unknown) => {
            if (stopped) return;
            failures += 1;
            setState({
              status: "failed",
              message: error instanceof Error ? error.message : "Couldn't open the live view.",
            });
            retry = setTimeout(connect, Math.min(2000 * 2 ** failures, 30000));
          },
        );
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `connection` asks for a new stream.
  }, [visible, provider, sessionId, connection]);

  // The agent browsed again: reconnect only when it's on another tab, or the view had closed.
  useEffect(() => {
    if (activity === 0) return;
    const current = targetRef.current;
    if (!current) {
      setConnection((n) => n + 1);
      return;
    }
    let cancelled = false;
    mailApi
      .agentBrowserView(provider, sessionId, { width: 320, height: 320, except: current })
      .then(
        (view) => {
          if (!cancelled && view?.targetId !== current) setConnection((n) => n + 1);
        },
        () => {},
      );
    return () => {
      cancelled = true;
    };
  }, [activity, provider, sessionId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        {state.status === "live" ? (
          <span className="size-1.5 shrink-0 rounded-full bg-red-500" aria-label="Live" />
        ) : (
          <GlobeIcon className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {"page" in state && state.page ? state.page : `${agentName}'s browser`}
        </span>
      </div>
      <div className="relative min-h-0 flex-1 bg-muted/40">
        <canvas
          ref={canvasRef}
          className={
            state.status === "live" ? "size-full object-contain object-top" : "invisible size-full"
          }
        />
        {state.status === "live" ? null : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            {state.status === "connecting" ? (
              <LoaderCircleIcon className="size-5 animate-spin" />
            ) : (
              <>
                <MonitorOffIcon className="size-5" />
                <p>
                  {state.status === "closed"
                    ? `${agentName}'s browser is closed. It shows here when ${agentName} browses again.`
                    : state.message}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

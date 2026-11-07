import { useEffect, useRef, useState } from "react";
import { GlobeIcon, LoaderCircleIcon, MonitorOffIcon } from "lucide-react";
import { mailApi, type ProviderKind } from "./api";
import { controlBrowser } from "./agent-browser-input";
import { cn } from "./ui";

/** Held tabs are let go a while after the last heartbeat, so a closed app never keeps one. */
const HEARTBEAT_MS = 10_000;

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
 * `activity` changes when the agent browses again, and when that step's result has named its tab:
 * it may have moved to another one. Taking control sends your mouse and keys to the tab (the
 * Otter plugin on the gateway replays them), and the agent's browser waits until you hand it back.
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
  const frameRef = useRef<{ cssWidth: number; cssHeight: number } | null>(null);
  const [tab, setTab] = useState<{ targetId: string; profile?: string } | null>(null);
  const [controlling, setControlling] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
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
    const decoder = new TextDecoder();

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
            setTab((t) =>
              t?.targetId === view.targetId
                ? t
                : { targetId: view.targetId, profile: view.profile },
            );
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
              const meta = JSON.parse(decoder.decode(new Uint8Array(buffer, 4, header))) as {
                cssWidth?: number;
                cssHeight?: number;
              };
              if (meta.cssWidth && meta.cssHeight)
                frameRef.current = { cssWidth: meta.cssWidth, cssHeight: meta.cssHeight };
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

  const live = state.status === "live";
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!controlling || !live || !tab || !canvas) return;
    const input = (request: { take?: boolean; seq?: number; events?: unknown[] }) =>
      mailApi.agentBrowserInput(provider, { ...tab, ...request });
    const lost = (error: unknown) => {
      setControlling(false);
      setControlError(error instanceof Error ? error.message : "Lost control of the tab.");
    };
    let held = true;
    input({ take: true }).catch(lost);
    const heartbeat = setInterval(() => input({ take: true }).catch(lost), HEARTBEAT_MS);
    const detach = controlBrowser(canvas, {
      frameSize: () => frameRef.current,
      send: (seq, events) => input({ seq, events }),
      onLost: (error) => held && lost(error),
    });
    return () => {
      held = false;
      clearInterval(heartbeat);
      detach();
      void input({ take: false }).catch(() => {});
    };
  }, [controlling, live, tab, provider]);

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
        {controlError && !controlling ? (
          <span className="min-w-0 max-w-[50%] truncate text-destructive" title={controlError}>
            {controlError}
          </span>
        ) : null}
        {controlling && live ? (
          <span className="shrink-0 text-foreground">You have control</span>
        ) : null}
        {live && tab ? (
          <button
            type="button"
            onClick={() => {
              setControlError(null);
              setControlling((on) => !on);
            }}
            className="shrink-0 cursor-pointer rounded-md border px-2 py-0.5 font-medium text-foreground hover:bg-foreground/[0.06]"
          >
            {controlling ? "Release control" : "Take control"}
          </button>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 bg-muted/40">
        <canvas
          ref={canvasRef}
          tabIndex={controlling ? 0 : -1}
          aria-label={controlling ? `${agentName}'s browser, under your control` : undefined}
          className={cn(
            live ? "size-full object-contain object-top" : "invisible size-full",
            controlling && "cursor-default outline-none ring-2 ring-focus-ring ring-inset",
          )}
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

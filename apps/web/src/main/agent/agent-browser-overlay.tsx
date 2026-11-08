import { useEffect, useState } from "react";
import { MousePointer2Icon } from "lucide-react";
import { Btn, cn } from "../mail/ui";

/** Where a point of the page (CSS px) is over the canvas, which shows the frame `object-contain object-top`. */
export type Placer = (x: number, y: number) => { left: number; top: number; scale: number } | null;

export type PagePointer = { x: number; y: number; clicks: number; at: number };
export type PageField = { x: number; y: number; width: number; height: number; at: number };
export type PageDialog = { dialogType: string; message: string; defaultPrompt: string };

const SHOWN_MS = 1800;

/** Fades out a while after `at`, the last thing the agent did. */
function useRecent(at: number | undefined): boolean {
  const [faded, setFaded] = useState<number | undefined>();
  useEffect(() => {
    if (!at) return;
    const timer = setTimeout(() => setFaded(at), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [at]);
  return at !== undefined && faded !== at;
}

/**
 * The agent's pointer, gliding to where it moved or clicked (a pulse for a click), and an outline
 * on the field it's typing in. Drawn over the stream, never into the page.
 */
export function AgentCursor({
  pointer,
  field,
  place,
}: {
  pointer: PagePointer | null;
  field: PageField | null;
  place: Placer;
}) {
  const pointerShown = useRecent(pointer?.at);
  const fieldShown = useRecent(field?.at);
  const at = pointer ? place(pointer.x, pointer.y) : null;
  const box = field ? place(field.x, field.y) : null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {box && field ? (
        <div
          className={cn(
            "absolute rounded-[3px] ring-2 ring-sky-500/80 transition-opacity duration-300",
            fieldShown ? "opacity-100" : "opacity-0",
          )}
          style={{
            left: box.left - 2,
            top: box.top - 2,
            width: field.width * box.scale + 4,
            height: field.height * box.scale + 4,
          }}
        />
      ) : null}
      {at && pointer ? (
        <div
          className={cn(
            "absolute top-0 left-0 transition-[transform,opacity] duration-200 ease-out",
            pointerShown ? "opacity-100" : "opacity-0",
          )}
          style={{ transform: `translate(${at.left}px, ${at.top}px)` }}
        >
          {pointer.clicks > 0 ? (
            <span
              key={pointer.clicks}
              className="absolute -top-3 -left-3 size-6 animate-[ping_0.6s_ease-out_1] rounded-full bg-sky-500/50"
            />
          ) : null}
          <MousePointer2Icon className="size-5 -translate-x-[3px] -translate-y-[2px] fill-sky-500 stroke-white drop-shadow" />
        </div>
      ) : null}
    </div>
  );
}

/** The page's alert, confirm or prompt: answered by whoever holds the tab. */
export function DialogBanner({
  dialog,
  agentName,
  controlling,
  onAnswer,
}: {
  dialog: PageDialog;
  agentName: string;
  controlling: boolean;
  onAnswer: (accept: boolean, promptText?: string) => void;
}) {
  const [text, setText] = useState(dialog.defaultPrompt);
  const prompt = dialog.dialogType === "prompt";
  return (
    <div className="absolute inset-x-3 top-3 z-10 mx-auto max-w-md rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg">
      <p className="whitespace-pre-wrap wrap-anywhere">{dialog.message || "The page is asking."}</p>
      {prompt ? (
        <input
          aria-label="Answer"
          value={text}
          disabled={!controlling}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAnswer(true, text);
          }}
          className="mt-2 h-8 w-full rounded-md border bg-transparent px-2 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        />
      ) : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        {controlling ? null : (
          <span className="mr-auto text-xs text-muted-foreground">
            Take control to answer, or {agentName} will.
          </span>
        )}
        {dialog.dialogType === "alert" ? null : (
          <Btn size="sm" variant="ghost" disabled={!controlling} onClick={() => onAnswer(false)}>
            Cancel
          </Btn>
        )}
        <Btn
          size="sm"
          variant="primary"
          disabled={!controlling}
          onClick={() => onAnswer(true, prompt ? text : undefined)}
        >
          OK
        </Btn>
      </div>
    </div>
  );
}

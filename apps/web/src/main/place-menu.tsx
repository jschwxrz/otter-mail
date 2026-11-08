import { useEffect, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./mail/menu";
import { inNewWindow } from "./new-window-click";

/** Marks a control whose click goes to a place: right-clicked, it offers to open there in a new window. */
export const PLACE = { "data-place": "" } as const;

/**
 * The menu of a place without one of its own (a row with its own menu
 * cancels the event first, and lists the same item itself).
 */
export function PlaceMenu() {
  const [at, setAt] = useState<{ x: number; y: number; place: HTMLElement } | null>(null);
  useEffect(() => {
    const open = (e: MouseEvent) => {
      if (e.defaultPrevented || !(e.target instanceof Element)) return;
      const place = e.target.closest<HTMLElement>("[data-place]");
      if (!place) return;
      e.preventDefault();
      setAt({ x: e.clientX, y: e.clientY, place });
    };
    window.addEventListener("contextmenu", open);
    return () => window.removeEventListener("contextmenu", open);
  }, []);
  return (
    <DropdownMenu open={at !== null} onOpenChange={(open) => !open && setAt(null)}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-0"
          style={{ left: at?.x ?? 0, top: at?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent sideOffset={0}>
        <DropdownMenuItem
          onSelect={() => {
            const place = at?.place;
            if (place) inNewWindow(() => place.click());
          }}
        >
          Open in New Window
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CONCEPTS, type ConceptId } from "../content/concepts";

const GAP = 6; // space between the button and the popup
const MARGIN = 8; // minimum space from the window edges

/**
 * A visible "What does this mean?" button that opens a small explanation.
 * Click / Enter / Space opens it; Esc or "Close" closes it and returns focus to the button.
 * Content comes from content/concepts.ts, so it can be reused elsewhere.
 *
 * The popup is rendered into document.body (a "portal") with fixed positioning.
 * Inside the experiment panel it would otherwise be clipped: that panel scrolls,
 * and a scrolling box cuts off anything that sticks out of it on any side.
 */
export function TermHelp({ concept, label = "What does this mean?" }: { concept: ConceptId; label?: string }) {
  const c = CONCEPTS[concept];
  const [open, setOpen] = useState(false);
  // Measured at opacity 0 (not visibility:hidden) so it can already receive focus.
  const [style, setStyle] = useState<CSSProperties>({ top: 0, left: 0, opacity: 0 });
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  // Place the popup next to the button, kept fully inside the window.
  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    const p = panel.current;
    if (!b || !p) return;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = Math.min(p.scrollWidth, vw - 2 * MARGIN);
    const left = Math.min(Math.max(MARGIN, b.right - width), vw - width - MARGIN);
    const below = vh - b.bottom - GAP - MARGIN;
    const above = b.top - GAP - MARGIN;
    const natural = p.scrollHeight;
    // Prefer below; flip above when there is clearly more room there.
    const showAbove = natural > below && above > below;
    const maxHeight = Math.max(120, showAbove ? above : below);
    setStyle({
      left,
      maxHeight,
      ...(showAbove ? { bottom: vh - b.top + GAP } : { top: b.bottom + GAP }),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place(); // measure, then show in place before the browser paints
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) close(false);
    };
    // Keep it attached to the button when anything scrolls (including the panel) or the window resizes.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, place, close]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full px-1.5 text-xs font-semibold text-accent underline decoration-dotted underline-offset-2 hover:bg-accent-soft"
      >
        {label}
        <span className="sr-only"> ({c.term})</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="region"
            aria-label={`About: ${c.term}`}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close(true);
              } else if (e.key === "Tab") {
                // The popup lives at the end of the page; leaving it with Tab goes back to its button.
                const focusables = panel.current?.querySelectorAll<HTMLElement>("a[href], button") ?? [];
                const last = focusables[focusables.length - 1];
                const leaving = e.shiftKey ? document.activeElement === panel.current || document.activeElement === focusables[0] : document.activeElement === last;
                if (leaving) {
                  e.preventDefault();
                  close(true);
                }
              }
            }}
            style={style}
            className="fixed z-50 w-[20rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl bg-white p-3 text-left text-sm font-normal break-words text-navy shadow-soft ring-1 ring-navy/10 motion-safe:animate-refresh"
          >
            <p className="font-display font-semibold">{c.term}</p>
            <p className="mt-1">{c.meaning}</p>
            {c.model && <p className="mt-1.5 text-xs text-navy-soft">{c.model}</p>}
            <div className="mt-2 flex items-center gap-3">
              {c.learnPath && (
                <a href={c.learnPath} className="text-xs font-semibold text-accent underline">
                  Learn more
                </a>
              )}
              <button
                type="button"
                onClick={() => close(true)}
                className="ml-auto rounded-full bg-surface-soft px-3 py-1 text-xs font-semibold hover:bg-accent-soft"
              >
                Close
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  placement?: "side" | "center";
}

/**
 * Built on the browser's native <dialog>. showModal() gives us, for free:
 * focus moves inside, Tab stays inside, Esc closes it, and the page behind is
 * hidden from screen readers. On close, focus returns to whatever opened it.
 */
export function Dialog({ title, subtitle, onClose, children, placement = "side" }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The element focused when we opened (the button the user pressed).
  const returnTo = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  // No cleanup that calls close(): React's StrictMode runs effects twice in
  // development, and close() would fire onClose and shut the dialog at once.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const handleClose = () => {
    onClose();
    const el = returnTo.current;
    requestAnimationFrame(() => el?.isConnected && el.focus());
  };

  const box =
    placement === "side"
      ? "m-0 ms-auto h-dvh max-h-dvh w-full max-w-md"
      : "m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg rounded-2xl";

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={handleClose}
      // A click on the dimmed backdrop lands on the <dialog> itself, outside the panel.
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className={`${box} bg-transparent p-0 text-navy backdrop:bg-navy/40`}
    >
      <div className={`flex flex-col overflow-y-auto bg-white p-5 shadow-xl ${placement === "side" ? "h-full" : "max-h-[85dvh] rounded-2xl"}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lg font-bold">
              {title}
            </h2>
            {subtitle && <div className="mt-1 text-sm text-navy-soft">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-100"
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}

"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function PlayerPropReaderDialog({
  ariaLabel,
  eyebrow = "Prop Reader",
  title,
  leading,
  onClose,
  children,
}: {
  ariaLabel: string;
  eyebrow?: string;
  title: string;
  leading?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <aside ref={dialogRef} role="dialog" aria-modal="true" aria-label={ariaLabel} className="h-[100dvh] w-full overflow-y-auto overscroll-contain border-gray-800 bg-gray-950 pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:max-w-[980px] sm:rounded-xl sm:border">
      <div className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b border-gray-800 bg-gray-950/95 px-4 py-2.5 backdrop-blur sm:px-6"><div className="flex min-w-0 items-center gap-3">{leading}<div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wider text-violet-300">{eyebrow}</p><h2 className="line-clamp-2 text-sm font-black leading-tight text-white sm:text-base">{title}</h2></div></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Close reader" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-700 bg-gray-900 text-xl text-gray-200 transition hover:border-violet-400 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300">×</button></div>
      {children}
    </aside>
  </div>;
}

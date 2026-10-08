"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type DevicePanel = "apple" | "android";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export default function AddToHomeScreenGuide() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const syncAvailability = () => {
      const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const standalone = standaloneQuery.matches || iosStandalone;
      setIsAvailable(!standalone);
      if (standalone) setOpen(false);
    };

    syncAvailability();
    standaloneQuery.addEventListener("change", syncAvailability);
    return () => standaloneQuery.removeEventListener("change", syncAvailability);
  }, []);

  if (!isAvailable) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md py-2 text-left text-xs font-medium text-gray-300 transition-colors hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
      >
        <PhoneIcon className="h-[18px] w-[18px] text-gray-400" />
        <span>Add to Home Screen</span>
      </button>
      {open ? <HomeScreenGuideSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function HomeScreenGuideSheet({ onClose }: { onClose: () => void }) {
  const [device, setDevice] = useState<DevicePanel>(detectPreferredDevicePanel);
  const dialogRef = useRef<HTMLElement>(null);
  const portalRootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const applePanelId = useId();
  const androidPanelId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const portalRoot = portalRootRef.current;
    if (!portalRoot) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const backgroundStates = new Map<HTMLElement, { hadInertAttribute: boolean; ariaHidden: string | null }>();
    const makeBackgroundInert = (element: HTMLElement) => {
      if (element === portalRoot || backgroundStates.has(element)) return;
      backgroundStates.set(element, {
        hadInertAttribute: element.hasAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden"),
      });
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    };

    document.body.style.overflow = "hidden";
    for (const element of document.body.children) makeBackgroundInert(element as HTMLElement);
    const bodyObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) makeBackgroundInert(node);
        }
      }
    });
    bodyObserver.observe(document.body, { childList: true });

    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const desktopQuery = window.matchMedia("(min-width: 640px)");

    const onDesktopChange = (event: MediaQueryListEvent) => {
      if (event.matches) onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])]
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    desktopQuery.addEventListener("change", onDesktopChange);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      bodyObserver.disconnect();
      desktopQuery.removeEventListener("change", onDesktopChange);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      for (const [element, { hadInertAttribute, ariaHidden }] of backgroundStates) {
        if (hadInertAttribute) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={portalRootRef}
      data-home-screen-guide-portal=""
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:hidden"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(90dvh,44rem)] w-full flex-col overflow-hidden rounded-t-[28px] border border-b-0 border-gray-700/80 bg-gray-950 shadow-[0_-18px_55px_rgba(0,0,0,0.55)]"
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-gray-700" />

        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-3 pt-2">
          <div className="min-w-0 pt-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300">Quick access</p>
            <h2 id={titleId} className="mt-1 text-xl font-black leading-tight text-white">
              Add OddSphere to your Home Screen
            </h2>
            <p className="mt-1 text-sm leading-5 text-gray-300">Keep Daily Edge a tap away.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close Add to Home Screen guide"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gray-700 text-2xl leading-none text-gray-300 transition-colors hover:border-gray-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div
            role="tablist"
            aria-label="Device instructions"
            className="grid grid-cols-2 gap-1 rounded-xl border border-gray-800 bg-gray-900/70 p-1"
          >
            <DeviceTab
              active={device === "apple"}
              controls={applePanelId}
              onClick={() => setDevice("apple")}
            >
              iPhone / iPad
            </DeviceTab>
            <DeviceTab
              active={device === "android"}
              controls={androidPanelId}
              onClick={() => setDevice("android")}
            >
              Android
            </DeviceTab>
          </div>

          {device === "apple" ? (
            <InstructionPanel id={applePanelId} labelledBy="iPhone / iPad">
              <InstructionStep number={1}>Open OddSphere in <strong>Safari</strong>.</InstructionStep>
              <InstructionStep number={2} icon={<ShareIcon />}>
                Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
              </InstructionStep>
              <InstructionStep number={3} icon={<PlusIcon />}>
                If shown, turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.
              </InstructionStep>
            </InstructionPanel>
          ) : (
            <InstructionPanel id={androidPanelId} labelledBy="Android">
              <InstructionStep number={1}>Open OddSphere in <strong>Chrome</strong>.</InstructionStep>
              <InstructionStep number={2} icon={<MoreIcon />}>
                Tap the <strong>three-dot menu</strong>. Look for <strong>Install and create shortcut</strong>, <strong>Add to Home screen</strong>, or <strong>Install app</strong>.
              </InstructionStep>
              <InstructionStep number={3} icon={<PlusIcon />}>
                Choose <strong>Install</strong> or <strong>Create shortcut</strong>, then follow the prompts.
              </InstructionStep>
            </InstructionPanel>
          )}

          <p className="mt-3 text-sm leading-5 text-gray-300">
            You may need to sign in when you open it the first time.
          </p>

          <details className="group mt-3 rounded-xl border border-gray-800 bg-gray-900/40">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm font-bold text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400 [&::-webkit-details-marker]:hidden">
              Need help?
              <span aria-hidden="true" className="text-lg text-violet-300 transition-transform group-open:rotate-45">+</span>
            </summary>
            <ul className="space-y-2 border-t border-gray-800 px-4 py-3 text-xs leading-5 text-gray-300">
              <li>Safari’s <strong className="text-gray-100">Share</strong> control may be inside the page menu, depending on its layout.</li>
              <li>If <strong className="text-gray-100">Add to Home Screen</strong> is missing, check <strong className="text-gray-100">Edit Actions</strong> in Safari’s Share menu.</li>
              <li>From Instagram, X, Whop or another in-app browser, open OddSphere in <strong className="text-gray-100">Safari</strong> on Apple devices or <strong className="text-gray-100">Chrome</strong> on Android.</li>
              <li>Browser menu wording varies by version.</li>
            </ul>
          </details>

          <button
            type="button"
            onClick={onClose}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-black text-white shadow-[0_8px_24px_rgba(139,92,246,0.22)] transition-colors hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
          >
            Got it
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function detectPreferredDevicePanel(): DevicePanel {
  if (typeof navigator === "undefined") return "apple";
  if (/Android/i.test(navigator.userAgent)) return "android";
  return "apple";
}

function DeviceTab({
  active,
  controls,
  onClick,
  children,
}: {
  active: boolean;
  controls: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={`min-h-11 rounded-lg px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
        active
          ? "bg-violet-500/20 text-violet-100 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.35)]"
          : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

function InstructionPanel({
  id,
  labelledBy,
  children,
}: {
  id: string;
  labelledBy: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-label={`${labelledBy} instructions`}
      className="mt-3 rounded-2xl border border-gray-800 bg-gray-900/55 p-3"
    >
      <ol className="space-y-3">{children}</ol>
    </div>
  );
}

function InstructionStep({
  number,
  icon,
  children,
}: {
  number: number;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2.5 text-sm leading-5 text-gray-200 [&_strong]:font-bold [&_strong]:text-white">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-violet-400/30 bg-violet-400/10 text-xs font-black text-violet-200">
        {number}
      </span>
      <div className="pt-1">
        {icon ? <span className="mr-1.5 inline-flex align-[-0.2em] text-violet-300">{icon}</span> : null}
        {children}
      </div>
    </li>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className}>
      <rect x="7" y="2.75" width="10" height="18.5" rx="2.25" />
      <path d="M10 5.5h4M11 18.5h2" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="M12 15V3m0 0L8 7m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10.5v8.25A2.25 2.25 0 0 0 8.25 21h7.5A2.25 2.25 0 0 0 18 18.75V10.5" strokeLinecap="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" strokeLinecap="round" />
    </svg>
  );
}

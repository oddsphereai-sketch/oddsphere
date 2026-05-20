// Hidden internal route. Not linked from the Navbar; reachable only by
// typing /lab directly. UI preview of The Lab — fully mocked data, no
// backend wiring yet. Connection-status check stays here as a small
// footer note (not prominent).

import { Suspense } from "react";
import LabApp from "./LabApp";

export const metadata = {
  title: "The Lab — Oddsphere AI (Internal)",
  robots: { index: false, follow: false },
};

type ConnectionStatus = {
  state: "ok" | "missing" | "placeholder" | "error";
  detail?: string;
  host?: string;
};

async function checkSupabase(): Promise<ConnectionStatus> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return { state: "missing" };
  if (url.includes("YOUR_PROJECT_URL") || key.includes("YOUR_KEY_HERE")) {
    return { state: "placeholder" };
  }

  try {
    const mod = await import("./lib-shim");
    if (!mod.supabase || typeof mod.supabase.from !== "function") {
      return { state: "error", detail: "Supabase client export malformed." };
    }
    let host: string | undefined;
    try {
      host = new URL(url).host;
    } catch {
      host = url;
    }
    return { state: "ok", host };
  } catch (e) {
    return {
      state: "error",
      detail: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

function ConnectionPill({ status }: { status: ConnectionStatus }) {
  if (status.state === "ok") {
    return (
      <span className="inline-flex items-center gap-2 text-emerald-300/80">
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
        Supabase: connected
        {status.host && (
          <>
            {" "}
            <span className="text-gray-500">·</span>{" "}
            <span className="font-mono text-gray-400">{status.host}</span>
          </>
        )}
      </span>
    );
  }
  if (status.state === "missing" || status.state === "placeholder") {
    return (
      <span className="inline-flex items-center gap-2 text-yellow-300/80">
        <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" />
        Supabase: env vars not configured
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-rose-300/80">
      <span className="inline-block w-2 h-2 rounded-full bg-rose-400" />
      Supabase: error {status.detail && <>· {status.detail}</>}
    </span>
  );
}

export default async function LabPage() {
  const status = await checkSupabase();

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <header className="text-center mb-10 sm:mb-14">
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-black mb-3 tracking-tight">
          🔬 The Lab
        </h1>
        <p className="text-base sm:text-lg text-gray-300 max-w-2xl mx-auto">
          MLB player props research — sortable, filterable, and built on tested signals.
        </p>
      </header>

      <Suspense
        fallback={
          <div className="text-center text-gray-400 py-16">
            Loading research view…
          </div>
        }
      >
        <LabApp />
      </Suspense>

      <footer className="mt-16 pt-6 border-t border-gray-800/60 text-center text-xs text-gray-500 space-y-1">
        <ConnectionPill status={status} />
        <p>Route unlinked from public navigation. Internal preview only.</p>
      </footer>
    </main>
  );
}

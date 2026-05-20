// Hidden internal route. Not linked from the Navbar; reachable only by
// typing /lab directly. Used during build-out to confirm route works
// and Supabase env vars are wired correctly. Future home of the
// authenticated player-props research dashboard.

export const metadata = {
  title: "The Lab — Oddsphere AI (Internal)",
  robots: { index: false, follow: false },
};

type CheckResult =
  | { kind: "missing" }
  | { kind: "placeholder" }
  | { kind: "error"; message: string }
  | { kind: "ok" };

async function checkSupabase(): Promise<{
  url: string | undefined;
  result: CheckResult;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return { url, result: { kind: "missing" } };

  if (url.includes("YOUR_PROJECT_URL") || key.includes("YOUR_KEY_HERE")) {
    return { url, result: { kind: "placeholder" } };
  }

  // Client-init check: importing app/lib/supabase.ts throws if env vars are
  // missing, otherwise calls createClient() which constructs the client
  // without making a network request. A live query check will replace this
  // once we add our first table.
  try {
    const mod = await import("../lib/supabase");
    if (!mod.supabase || typeof mod.supabase.from !== "function") {
      return {
        url,
        result: {
          kind: "error",
          message: "Supabase client export is malformed.",
        },
      };
    }
    return { url, result: { kind: "ok" } };
  } catch (e) {
    return {
      url,
      result: {
        kind: "error",
        message: e instanceof Error ? e.message : "Unknown error",
      },
    };
  }
}

function StatusLine({ result }: { result: CheckResult }) {
  if (result.kind === "ok") {
    return (
      <span className="inline-flex items-center gap-2 text-green-300">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]" />
        Connected (client initialized)
      </span>
    );
  }
  if (result.kind === "missing") {
    return (
      <span className="inline-flex items-center gap-2 text-yellow-300">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" />
        Env vars not set
      </span>
    );
  }
  if (result.kind === "placeholder") {
    return (
      <span className="inline-flex items-center gap-2 text-yellow-300">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" />
        Placeholder values — fill in .env.local
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-red-300">
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]" />
      Error
    </span>
  );
}

export default async function LabPage() {
  const { url, result } = await checkSupabase();

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      <header className="text-center mb-12">
        <h1 className="text-5xl sm:text-6xl font-black mb-3 tracking-tight">
          🔬 The Lab
        </h1>
        <p className="text-base text-gray-300">
          Build environment — internal use only
        </p>
      </header>

      <section className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-6 sm:p-8 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
            Supabase Status
          </span>
          <StatusLine result={result} />
        </div>

        <div className="border-t border-gray-800 pt-4 space-y-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">
              Project URL
            </div>
            <div className="font-mono text-gray-100 break-all">
              {url ?? <span className="text-gray-500">— not set —</span>}
            </div>
          </div>

          {result.kind === "error" && (
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">
                Error
              </div>
              <div className="font-mono text-red-300">{result.message}</div>
            </div>
          )}

          {(result.kind === "missing" || result.kind === "placeholder") && (
            <div className="text-gray-200 leading-relaxed">
              Open <code className="font-mono text-violet-300">.env.local</code>{" "}
              in the project root and fill in your Supabase project URL and
              publishable anon key, then restart the dev server.
            </div>
          )}
        </div>

        <p className="border-t border-gray-800 pt-4 text-xs text-gray-400 italic leading-relaxed">
          Real database connection will be tested when we add tables in the next step.
        </p>
      </section>

      <p className="text-center text-xs text-gray-500 mt-8">
        Route loaded successfully. This page is unlinked and noindex.
      </p>
    </main>
  );
}

"use client";

import ProductAppFrame from "@/app/lab/components/ProductAppFrame";

export default function ExperiencePreviewError({ reset }: { reset: () => void }) {
  return (
    <ProductAppFrame>
      <div className="mx-auto max-w-xl py-20 text-center">
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-violet-300">OddSphere · Daily Edge</p>
        <h1 className="mt-3 text-2xl font-black text-white">The slate could not be loaded.</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-400">
          Your account and picks are unaffected. Try the read-only slate request again.
        </p>
        <button type="button" onClick={reset} className="mt-6 rounded-xl border border-violet-400/40 bg-violet-500/15 px-5 py-3 text-sm font-black text-violet-100 transition hover:bg-violet-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
          Retry Daily Edge
        </button>
      </div>
    </ProductAppFrame>
  );
}

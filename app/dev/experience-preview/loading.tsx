import ProductAppFrame from "@/app/lab/components/ProductAppFrame";

export default function ExperiencePreviewLoading() {
  return (
    <ProductAppFrame>
      <div className="space-y-5 pb-16" aria-busy="true" aria-label="Loading Daily Edge slate">
        <div className="animate-pulse px-1">
          <div className="h-2.5 w-28 rounded bg-violet-400/15" />
          <div className="mt-3 h-8 w-44 rounded bg-white/10" />
          <div className="mt-2 h-3 w-72 max-w-full rounded bg-white/[0.06]" />
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {Array.from({ length: 9 }, (_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.025]" />
          ))}
        </div>
        <div className="overflow-hidden rounded-2xl border border-violet-400/20 bg-[#100e18]">
          <div className="h-20 animate-pulse border-b border-white/[0.06] bg-white/[0.025]" />
          <div className="grid grid-cols-3 gap-2 border-b border-white/[0.06] p-2 sm:p-4">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-lg bg-white/[0.04]" />
            ))}
          </div>
          <div className="grid min-h-80 gap-px bg-white/[0.05] lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="animate-pulse bg-[#100e18] p-5">
                <div className="h-3 w-28 rounded bg-white/[0.07]" />
                <div className="mt-5 h-44 rounded-xl bg-white/[0.035]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </ProductAppFrame>
  );
}

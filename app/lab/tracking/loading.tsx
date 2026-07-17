export default function TrackingLoading() {
  return (
    <section className="mx-auto max-w-6xl animate-pulse py-2 sm:py-4" aria-label="Loading tracking">
      <div className="h-3 w-28 rounded bg-violet-400/20" />
      <div className="mt-4 h-9 w-56 rounded bg-white/10" />
      <div className="mt-3 h-4 w-80 max-w-full rounded bg-white/[0.06]" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-36 rounded-xl border border-white/[0.05] bg-white/[0.025]" />
        ))}
      </div>
      <div className="mt-6 h-64 rounded-xl border border-white/[0.05] bg-white/[0.025]" />
      <p className="mt-4 text-sm text-gray-500">Loading verified tracking results…</p>
    </section>
  );
}

"use client";

export default function MyBetsStub() {
  return (
    <div className="min-h-[420px] sm:min-h-[520px] flex items-center justify-center px-4">
      <div className="text-center max-w-md w-full bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl px-6 py-10 sm:py-14">
        <div className="text-6xl sm:text-7xl mb-6" aria-hidden="true">
          📊
        </div>
        <p className="inline-block text-[10px] font-bold uppercase tracking-wider text-gray-300 bg-gray-800/60 border border-gray-700 rounded-full px-3 py-1 mb-4">
          Coming soon · Phase 2C
        </p>
        <h2 className="text-2xl sm:text-3xl font-black mb-4 tracking-tight">
          My Bets
        </h2>
        <p className="text-base text-gray-200 leading-relaxed">
          Track your bets, measure your personal hit rate, and see your edge over time.
        </p>
      </div>
    </div>
  );
}

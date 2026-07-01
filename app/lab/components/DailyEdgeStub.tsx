"use client";

export default function DailyEdgeStub() {
  return (
    <div className="min-h-[420px] sm:min-h-[520px] flex items-center justify-center px-4">
      <div className="text-center max-w-md w-full bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl px-6 py-10 sm:py-14">
        <div className="text-6xl sm:text-7xl mb-6" aria-hidden="true">
          🎯
        </div>
        <p className="inline-block text-[10px] font-bold uppercase tracking-wider text-violet-300 bg-violet-900/40 border border-violet-700/50 rounded-full px-3 py-1 mb-4">
          Building this next
        </p>
        <h2 className="text-2xl sm:text-3xl font-black mb-4 tracking-tight">
          Daily Edge
        </h2>
        <p className="text-base text-gray-200 leading-relaxed">
          Coming next · Your model predictions across all 7 sports with market signals.
        </p>
      </div>
    </div>
  );
}

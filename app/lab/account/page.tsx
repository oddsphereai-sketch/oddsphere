"use client";

/**
 * /lab/account — V1 stub (Phase 6.2a).
 *
 * Real auth wiring (Whop OAuth + email magic link) lands in Phase 7. For V1
 * the page exists so the LabAppNav has a destination; future work fills in
 * the Account Settings panel per V2.1 spec Part 11.
 */

export default function AccountStubPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 sm:py-20">
      <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-8 sm:p-12">
        <p className="inline-block text-[10px] font-bold uppercase tracking-wider text-gray-300 bg-gray-800/60 border border-gray-700 rounded-full px-3 py-1 mb-4">
          Coming soon
        </p>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-3">
          Account &amp; Settings
        </h1>
        <p className="text-base text-gray-200 leading-relaxed mb-6">
          Membership management, preferred unit size, odds format, and
          timezone preferences live here once authentication ships.
        </p>
        <ul className="space-y-2 text-sm text-gray-300">
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="text-violet-400 mt-1">·</span>
            <span>Email + membership status — synced from Whop</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="text-violet-400 mt-1">·</span>
            <span>Unit size (default $25)</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="text-violet-400 mt-1">·</span>
            <span>Odds format (American / Decimal)</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="text-violet-400 mt-1">·</span>
            <span>Timezone</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="text-violet-400 mt-1">·</span>
            <span>Manage membership through Whop</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

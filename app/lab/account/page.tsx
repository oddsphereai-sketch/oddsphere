"use client";

/**
 * /lab/account — V1 stub (Phase 6.2a, polished in 6.2c).
 *
 * Per V2.1 Part 11 the V1 Account surface is intentionally simplified:
 *   Email · Membership status · Manage Membership through Whop ·
 *   Unit size ($25 default) · Odds format (American / Decimal) ·
 *   Timezone · Log out
 *
 * Real auth wiring (Whop OAuth + email magic link) lands in Phase 7. Until
 * then this page is a feature-preview stub so the LabAppNav has a real
 * destination and members can see what's coming. Order/wording below
 * mirror the spec verbatim — Phase 7 replaces it without changing the route.
 */

const ACCOUNT_PREVIEW = [
  { label: "Email", detail: "Synced from your sign-in method" },
  { label: "Membership status", detail: "Active · OddSphere Premium" },
  { label: "Manage membership through Whop", detail: "Update payment, pause, or cancel" },
  { label: "Unit size", detail: "Default $25 — adjustable" },
  { label: "Odds format", detail: "American / Decimal" },
  { label: "Timezone", detail: "Used for slate cutoffs and refresh times" },
  { label: "Log out", detail: "Sign out of this device" },
];

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
          Membership management plus your preferred unit size, odds format,
          and timezone — all live here once authentication ships.
        </p>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-300 mb-3">
          What you&rsquo;ll manage here
        </p>
        <ul className="space-y-3 text-sm">
          {ACCOUNT_PREVIEW.map((row) => (
            <li
              key={row.label}
              className="flex items-start gap-3 pb-3 border-b border-gray-800/60 last:border-b-0 last:pb-0"
            >
              <span aria-hidden="true" className="text-violet-400 mt-[3px]">·</span>
              <div className="min-w-0">
                <p className="font-semibold text-gray-100">{row.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{row.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-gray-500 italic mt-6 pt-4 border-t border-gray-800/60">
          Auth (Whop OAuth + email magic link) ships in Phase 7. Your
          subscription is managed through Whop today.
        </p>
      </div>
    </div>
  );
}

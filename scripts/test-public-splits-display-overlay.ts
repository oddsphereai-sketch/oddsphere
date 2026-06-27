import { overlayResolvedPublicSplits, type ResolvedDisplayByExtId } from "../lib/services/publicSplitsDisplayOverlay";
import type { DailyEdgeGameDto } from "../app/lab/lib/labTypes";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, details = "") {
  if (ok) {
    pass += 1;
    console.log(`ok - ${name}`);
  } else {
    fail += 1;
    console.error(`not ok - ${name}${details ? ` (${details})` : ""}`);
  }
}

function game(): DailyEdgeGameDto {
  return {
    external_id: 5059011,
    homeTeam: "BAL",
    awayTeam: "WSH",
    markets: {
      total: {
        pick: "Under 9",
        moneyPct: 28,
        betsPct: 71,
        publicSplits: [
          { side: "over", label: "Over", moneyPct: 72, betsPct: 29 },
          { side: "under", label: "Under", moneyPct: 28, betsPct: 71 },
        ],
      },
      moneyline: {
        pick: "WSH",
        moneyPct: 35,
        betsPct: 40,
        publicSplits: [
          { side: "home", label: "BAL", moneyPct: 65, betsPct: 60 },
          { side: "away", label: "WSH", moneyPct: 35, betsPct: 40 },
        ],
      },
    },
  } as DailyEdgeGameDto;
}

const resolved: ResolvedDisplayByExtId = new Map([
  [
    5059011,
    {
      total: {
        over: { moneyPct: 53, betsPct: 59, observedAt: "2026-06-27T16:27:32.238Z", isStale: false },
        under: { moneyPct: 47, betsPct: 41, observedAt: "2026-06-27T16:27:32.238Z", isStale: false },
      },
      moneyline: {
        home: { moneyPct: 44, betsPct: 45, observedAt: "2026-06-27T16:27:32.238Z", isStale: false },
        away: { moneyPct: 56, betsPct: 55, observedAt: "2026-06-27T16:27:32.238Z", isStale: false },
      },
    },
  ],
]);

const [out] = overlayResolvedPublicSplits([game()], resolved);
const total = out!.markets.total!;
const moneyline = out!.markets.moneyline!;

check("total publicSplits replaced by resolved display values", total.publicSplits[1]?.moneyPct === 47 && total.publicSplits[1]?.betsPct === 41);
check("total picked-side scalar mirrors displayed Under row", total.moneyPct === 47 && total.betsPct === 41);
check("total scalar timestamps mirror displayed Under row", total.moneyPctObservedAt === "2026-06-27T16:27:32.238Z" && total.betsPctObservedAt === "2026-06-27T16:27:32.238Z");
check("moneyline publicSplits replaced by resolved display values", moneyline.publicSplits[1]?.moneyPct === 56 && moneyline.publicSplits[1]?.betsPct === 55);
check("moneyline picked-side scalar mirrors displayed WSH row", moneyline.moneyPct === 56 && moneyline.betsPct === 55);

if (fail > 0) {
  console.error(`public splits display overlay tests: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

console.log(`public splits display overlay tests: ${pass} passed, ${fail} failed`);

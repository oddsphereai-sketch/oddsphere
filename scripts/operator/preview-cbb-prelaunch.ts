import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { matchCbbVenue, type EspnCbbEvent } from "../../lib/cbb/dataset";
import { fitCbbRatings, forecastCbbGame, cbbThresholdProbabilities } from "../../lib/cbb/model";
import { CBB_ACTIVATION, CBB_MODEL_RELEASE } from "../../lib/cbb/releases";
import { CBB_SCORE_RESEARCH_RELEASE } from "../../lib/cbb/scoreResearch";
import { cbbLaunchReadiness } from "../../lib/cbb/readiness";
import { buildCbbRosterContext } from "../../lib/cbb/rosterContext";
import { cbbPriceObservations, cbbSameBookMovement, normalizeCbbOdds, reviewCbbQuote } from "../../lib/cbb/marketEvidence";
import { bindCbbQuoteOrientation, normalizeCbbNamedBookOdds, type CbbNamedOddsRow } from "../../lib/cbb/namedBookOdds";
import type { CbbGame, CbbOdds, CbbPlayer, CbbPlayerSeason, CbbVenue } from "../../lib/cbb/types";
import { forecastCbbCandidateR2 } from "../../lib/cbb/candidateR2Runtime";

const args = process.argv.slice(2);
if (args.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("CBB preview cannot publish");
const dir = resolve(args.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const date = args.find(arg => arg.startsWith("--date="))?.slice(7) ?? "2026-11-01";
const candidateR2 = args.includes("--candidate=r2");
const read = async <T>(name: string): Promise<T> => JSON.parse(await readFile(resolve(dir, name), "utf8"));
const etDay = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
async function main() {
  const artifact = await read<Parameters<typeof fitCbbRatings>[1] & { uncertainty: Parameters<typeof forecastCbbGame>[2]; prior: NonNullable<Parameters<typeof fitCbbRatings>[1]["prior"]> }>("candidate-artifact.json");
  let report = await read<{ confirmation: { wins: number; losses: number; accuracy: number; teamScoreMae: number; marginMae: number; totalMae: number } }>("evaluation-report.json");
  if (candidateR2) report = { confirmation: (await read<{ diagnostic: typeof report.confirmation }>("score-improvement-report.json")).diagnostic };
  const schedule = await read<{ fetchedAt: string; data: CbbGame[] }>("games-2026.json");
  const roster = await read<{ data: CbbPlayer[] }>("active-players.json");
  const previousPlayers = await read<{ data: CbbPlayerSeason[] }>("players-2025.json");
  const opening = await read<{ fetchedAt: string; data: CbbOdds[] }>("odds-opening.json");
  const current = await read<{ fetchedAt: string; data: CbbOdds[] }>("odds-current.json");
  const sharp = await read<{ fetchedAt: string; data: CbbNamedOddsRow[] }>("sharp-event-odds.json").catch(() => ({ fetchedAt: new Date().toISOString(), data: [] }));
  const venues = await read<{ data: CbbVenue[] }>("venues-2026.json");
  const asOf = new Date().toISOString();
  const state = fitCbbRatings([], { season: 2026, asOf, config: artifact.config, prior: artifact.prior });
  const cards = [];
  for (const game of schedule.data.filter(game => etDay(game.date) === date && game.status === "pre")) {
    let venue = venues.data.find(row => row.gameId === game.id) ?? null;
    const espn = await read<{ fetchedAt: string; events: EspnCbbEvent[] }>(`espn-${date}.json`).catch(() => null);
    if (espn) venue = matchCbbVenue(game, espn.events, espn.fetchedAt);
    const r2 = candidateR2 ? forecastCbbCandidateR2({ id: game.id, date: game.date, season: game.season,
      homeId: game.home_team.id, awayId: game.visitor_team.id, neutral: venue?.neutral ?? null }, asOf) : null;
    const forecast = r2?.forecast ?? forecastCbbGame(state, { id: game.id, date: game.date, homeId: game.home_team.id,
      awayId: game.visitor_team.id, neutral: venue?.neutral ?? null }, artifact.uncertainty);
    const hRoster = buildCbbRosterContext(game.home_team.id, roster.data, previousPlayers.data, 2025);
    const aRoster = buildCbbRosterContext(game.visitor_team.id, roster.data, previousPlayers.data, 2025);
    const named = normalizeCbbNamedBookOdds(game, sharp.data, sharp.fetchedAt, asOf);
    const bdlCurrent = normalizeCbbOdds(current.data.filter(row => row.game_id === game.id), {
      gameId: game.id, startsAt: game.date, asOf, fetchedAt: current.fetchedAt, phase: "current",
    });
    const bdlOpening = normalizeCbbOdds(opening.data.filter(row => row.game_id === game.id), {
      gameId: game.id, startsAt: game.date, asOf, fetchedAt: opening.fetchedAt, phase: "opening",
    });
    const bindings = bdlCurrent.quotes.map(quote => bindCbbQuoteOrientation(quote, named.quotes));
    const authoritativeQuotes = named.quotes; // Named, exact-event selections own preview economics.
    cards.push({ game, venue, forecast, roster: { home: hRoster, away: aRoster },
      inputAsOf: { schedule: schedule.fetchedAt, prices: current.fetchedAt, sharp: sharp.fetchedAt },
      independentRatings: { home: (r2?.state ?? state).teams[game.home_team.id], away: (r2?.state ?? state).teams[game.visitor_team.id] },
      marketReview: authoritativeQuotes.map(quote => ({ ...reviewCbbQuote(forecast, quote),
        alternatives: quote.market === "moneyline" ? [] : [-6, -3, 0, 3, 6].map(delta => ({
          line: quote.line! + delta, ...cbbThresholdProbabilities(forecast, quote.market, quote.line! + delta),
          pricesAvailable: delta === 0,
        })) })),
      bdlOrientationBindings: bindings, rejectedNamedRows: named.rejected,
      rawProviderMovement: cbbSameBookMovement(bdlOpening.quotes, bdlCurrent.quotes),
      marketBrainObservations: cbbPriceObservations([...bdlOpening.quotes, ...bdlCurrent.quotes]),
      marketInference: { status: "qualification_pending", applied: false },
      issues: [...forecast.issues, ...(!venue?.timeConfirmed ? ["unconfirmed_start_time"] : []),
        "availability_unverified", "roster_impact_unvalidated", "market_reader_qualification_pending", "play_grade_calibration_pending"],
    });
  }
  const release = candidateR2 ? CBB_SCORE_RESEARCH_RELEASE : CBB_MODEL_RELEASE;
  const readiness = { ...cbbLaunchReadiness({ independent_confirmation: { passed: true, evidence: candidateR2
    ? "score-improvement-report.json: 2024 selection, opened 2025 paired diagnostic" : "evaluation-report.json: chronological 2025 confirmation" } }), release };
  const payload = { generatedAt: asOf, date, release, candidate: candidateR2 ? "r2" : "r1", activation: CBB_ACTIVATION, readiness, cards };
  await writeFile(resolve(dir, `preview-${date}.json`), JSON.stringify(payload, null, 2));
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OddsSphere CBB • Private candidate</title><style>
  *{box-sizing:border-box}body{margin:0;background:#0b111a;color:#e5eaf1;font:15px/1.5 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:40px 24px}h1{font-size:32px;margin:8px 0}.muted{color:#a2aec0}.tag{color:#64d8c6;font-size:12px;text-transform:uppercase;letter-spacing:1.5px}.summary{display:flex;gap:16px;flex-wrap:wrap;margin:26px 0}.stat,article{background:#131d2a;border:1px solid #293649;border-radius:14px;padding:20px}.stat{min-width:170px}.stat strong{display:block;font-size:25px}article{margin:22px 0}.teams{display:flex;justify-content:space-between;gap:12px}.teams h2{font-size:22px;margin:0}.score{font-size:32px;font-weight:700;white-space:nowrap}.metrics{display:flex;gap:26px;flex-wrap:wrap;margin:16px 0}.metrics span{color:#a2aec0}.metrics b{color:#e5eaf1;margin-left:8px}table{border-collapse:collapse;width:100%;margin-top:20px}td,th{text-align:left;border-bottom:1px solid #293649;padding:10px 8px}th{color:#a2aec0;font-size:12px}details{margin-top:18px}ul{padding-left:20px}.note{padding:14px 18px;border-left:3px solid #64d8c6;background:#15232c;margin:24px 0}a{color:#64d8c6}@media(max-width:600px){main{padding:24px 14px}.teams{display:block}.score{margin-top:10px}td,th{padding:8px 3px;font-size:12px}.stat{min-width:140px;flex:1}}
  </style><main><div class="tag">OddsSphere • Private prelaunch candidate</div><h1>College basketball</h1><p class="muted">${escape(date)} · Independent forecast and source verification · Publication disabled</p><div class="summary"><div class="stat"><strong>${pct(report.confirmation.accuracy)}</strong>Historical winner accuracy</div><div class="stat"><strong>${report.confirmation.wins}–${report.confirmation.losses}</strong>2025–26 confirmation</div><div class="stat"><strong>${report.confirmation.marginMae.toFixed(2)} points</strong>Average margin error</div><div class="stat"><strong>${report.confirmation.totalMae.toFixed(2)} points</strong>Average total error</div></div><div class="note">These are independent-model development results. Market-driven score corrections, injury/roster impact and Best Angle/Lean grades await CBB-specific validation. This preview creates no site changes, locks or wagers.</div>
  ${cards.map(card => `<article><div class="teams"><div><h2>${escape(card.game.visitor_team.full_name)}<br>${escape(card.game.home_team.full_name)}</h2><p class="muted">${escape(card.venue?.venue ?? "Venue unverified")} · ${card.venue?.neutral ? "Neutral site" : "Home venue"}</p></div><div class="score">${card.forecast.awayScore.toFixed(1)} – ${card.forecast.homeScore.toFixed(1)}</div></div><div class="metrics"><span>${escape(card.game.home_team.abbreviation)} win<b>${pct(card.forecast.homeWinProbability)}</b></span><span>Total<b>${card.forecast.total.toFixed(1)}</b></span><span>Possessions<b>${card.forecast.possessions.toFixed(1)}</b></span></div><table><thead><tr><th>Market</th><th>Named book</th><th>Forecast side</th><th>Price</th><th>Probability</th><th>Grade</th></tr></thead><tbody>${card.marketReview.map(row => `<tr><td>${row.quote.market}${row.quote.line !== null ? ` ${row.quote.line}` : ""}</td><td>${escape(row.quote.sportsbook)}</td><td>${row.quote.market === "total" ? row.selection === "first" ? "Over" : "Under" : escape(row.selection === "first" ? card.game.home_team.abbreviation : card.game.visitor_team.abbreviation)}</td><td>${row.selection === "first" ? row.quote.firstPrice : row.quote.secondPrice}</td><td>${pct(row.probability)}</td><td>Pending calibration</td></tr>`).join("") || '<tr><td colspan="6">Verified named-team prices unavailable</td></tr>'}</tbody></table><details><summary>Roster and input verification</summary><p>Returning minutes: ${escape(card.game.home_team.abbreviation)} ${card.roster.home.returningMinutesShare === null ? "unknown" : pct(card.roster.home.returningMinutesShare)}; ${escape(card.game.visitor_team.abbreviation)} ${card.roster.away.returningMinutesShare === null ? "unknown" : pct(card.roster.away.returningMinutesShare)}. Roster context is retained; no unvalidated numerical roster correction is applied.</p><ul>${card.issues.map(issue => `<li>${escape(issue.replaceAll("_", " "))}</li>`).join("")}</ul></details></article>`).join("")}
  <p class="muted">Private ${candidateR2 ? "r2 score-improvement" : "r1 baseline"} preview generated ${escape(asOf)}. Raw evidence, orientation receipts and alternate-line probabilities are included in the adjacent JSON file. ${candidateR2 ? "The 2025–26 comparison is an opened retrospective diagnostic, not a new untouched holdout." : ""}</p></main></html>`;
  await writeFile(resolve(dir, `preview-${date}.html`), html);
  console.log(JSON.stringify({ date, cards: cards.length, readiness: readiness.remaining, preview: resolve(dir, `preview-${date}.html`),
    forecasts: cards.map(card => ({ away: card.game.visitor_team.full_name, home: card.game.home_team.full_name, awayScore: card.forecast.awayScore, homeScore: card.forecast.homeScore,
      verifiedQuotes: card.marketReview.length, reversedPrices: card.bdlOrientationBindings.filter(binding => binding.orientation === "verified_reversed").length })) }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

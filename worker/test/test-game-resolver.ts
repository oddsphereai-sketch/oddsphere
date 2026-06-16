/**
 * Soccer game-name resolution (worker/src/gameResolver.ts).
 * Run: npx tsx worker/test/test-game-resolver.ts
 *
 * MLB resolves by abbreviation upstream; soccer arrives as full team NAMES and
 * is matched leniently across every team alias (name/display/location/abbr/slug)
 * plus a FIFA-variant alias map. These tests lock that behavior so the live MLB
 * abbrev path is never regressed and soccer name variants keep resolving.
 */
import { normalizeSoccerName, matchSoccerTeamId, internalSportKey, type SoccerTeamRow } from "../src/gameResolver";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

// Minimal pool mirroring real prod rows (id, name, abbreviation, slug, location…).
const POOL: SoccerTeamRow[] = [
  { id: 1695, name: "England", abbreviation: "ENG", slug: "eng", display_name: "England", short_display_name: "ENG", location: "ENG" },
  { id: 1696, name: "Croatia", abbreviation: "CRO", slug: "cro", display_name: "Croatia", short_display_name: "CRO", location: "CRO" },
  { id: 839, name: "USA", abbreviation: "USA", slug: "usa", display_name: "USA", short_display_name: "USA", location: "USA" },
  { id: 401, name: "South Korea", abbreviation: "KOR", slug: "kor", display_name: "South Korea", short_display_name: "KOR", location: "KOR" },
  { id: 402, name: "Türkiye", abbreviation: "TUR", slug: "tur", display_name: "Türkiye", short_display_name: "TUR", location: "TUR" },
  { id: 403, name: "Côte d'Ivoire", abbreviation: "CIV", slug: "civ", display_name: "Côte d'Ivoire", short_display_name: "CIV", location: "CIV" },
  { id: 404, name: "Bosnia & Herzegovina", abbreviation: "BIH", slug: "bih", display_name: "Bosnia & Herzegovina", short_display_name: "BIH", location: "BIH" },
];

// normalize
check("lowercases + trims", normalizeSoccerName("  England  ") === "england");
check("strips diacritics", normalizeSoccerName("Türkiye") === "turkiye");
check("apostrophe + diacritics", normalizeSoccerName("Côte d'Ivoire") === "cote divoire");
check("ampersand → and", normalizeSoccerName("Bosnia & Herzegovina") === "bosnia and herzegovina");

// direct name + abbreviation + case
check("exact name", matchSoccerTeamId(POOL, "England") === 1695);
check("abbreviation", matchSoccerTeamId(POOL, "CRO") === 1696);
check("case-insensitive", matchSoccerTeamId(POOL, "england") === 1695);

// FIFA-variant aliases → canonical DB name
check("United States → USA", matchSoccerTeamId(POOL, "United States") === 839);
check("Korea Republic → South Korea", matchSoccerTeamId(POOL, "Korea Republic") === 401);
check("Turkey → Türkiye", matchSoccerTeamId(POOL, "Turkey") === 402);
check("Ivory Coast → Côte d'Ivoire", matchSoccerTeamId(POOL, "Ivory Coast") === 403);
check("Bosnia and Herzegovina (and-form) matches & DB row", matchSoccerTeamId(POOL, "Bosnia and Herzegovina") === 404);

// no match / empty → null (never throws, no bad write)
check("unknown → null", matchSoccerTeamId(POOL, "Atlantis") === null);
check("empty → null", matchSoccerTeamId(POOL, "") === null);
check("null raw → null", matchSoccerTeamId(POOL, null) === null);

// sport key mapping unchanged
check("baseball → mlb", internalSportKey("baseball", null) === "mlb");
check("soccer → soccer", internalSportKey("soccer", "fifa_world_cup_matches") === "soccer");
check("football → soccer", internalSportKey("football", null) === "soccer");
check("unknown sport → null", internalSportKey("cricket", null) === null);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

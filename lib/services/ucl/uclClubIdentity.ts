/** Pure shared club identity rules. No provider, cache or database imports. */
export function normalizeUclEloClub(value: string): string {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(fc|cf|afc|calcio|football club|futbol club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    "paris saint germain": "paris sg",
    "internazionale": "inter",
    "manchester united": "man united",
    "manchester city": "man city",
    "bayern munich": "bayern",
    "real betis": "betis",
    "atletico madrid": "ath madrid",
    "sporting cp": "sp lisbon",
    "borussia dortmund": "dortmund",
    "as roma": "roma",
    "feyenoord rotterdam": "feyenoord",
    "bayer leverkusen": "leverkusen",
    "ac milan": "milan",
    "as monaco": "monaco",
    "vfb stuttgart": "stuttgart",
    "tottenham hotspur": "tottenham",
    "newcastle united": "newcastle",
    "athletic club": "ath bilbao",
    "ajax amsterdam": "ajax",
    "eintracht frankfurt": "ein frankfurt",
    "union st gilloise": "st gilloise",
    "olympiacos": "olympiakos",
    "psv eindhoven": "psv",
    "slavia prague": "slavia praha",
    "f c kobenhavn": "kobenhavn",
    "fc kobenhavn": "kobenhavn",
    "red star belgrade": "red star",
    "fk qarabag": "qarabag",
    "bodo glimt": "bodoe glimt",
    "shakhtar donetsk": "shakhtar",
    "aek athens": "aek",
    "lask linz": "lask",
    "viking fk": "viking",
  };
  return aliases[normalized] ?? normalized;
}


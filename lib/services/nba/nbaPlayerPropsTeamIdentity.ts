/** Exact NBA aliases already used by the ordinary collector. No fuzzy identities. */
const NBA_TEAM_ALIASES: Readonly<Record<string, string>> = {
  atlantahawks: "ATL", atl: "ATL", bostonceltics: "BOS", bos: "BOS", brooklynnets: "BKN", bkn: "BKN",
  charlottehornets: "CHA", cha: "CHA", chicagobulls: "CHI", chi: "CHI", clevelandcavaliers: "CLE", cle: "CLE",
  dallasmavericks: "DAL", dal: "DAL", denvernuggets: "DEN", den: "DEN", detroitpistons: "DET", det: "DET",
  goldenstatewarriors: "GSW", gsw: "GSW", houstonrockets: "HOU", hou: "HOU", indianapacers: "IND", ind: "IND",
  laclippers: "LAC", losangelesclippers: "LAC", lalakers: "LAL", losangeleslakers: "LAL", memphisgrizzlies: "MEM", mem: "MEM",
  miamiheat: "MIA", mia: "MIA", milwaukeebucks: "MIL", mil: "MIL", minnesotatimberwolves: "MIN", min: "MIN",
  neworleanspelicans: "NOP", nop: "NOP", newyorkknicks: "NYK", nyk: "NYK", oklahomacitythunder: "OKC", okc: "OKC",
  orlandomagic: "ORL", orl: "ORL", philadelphia76ers: "PHI", phi: "PHI", phoenixsuns: "PHX", phx: "PHX",
  portlandtrailblazers: "POR", por: "POR", sacramentokings: "SAC", sac: "SAC", sanantoniospurs: "SAS", sas: "SAS",
  torontoraptors: "TOR", tor: "TOR", utahjazz: "UTA", uta: "UTA", washingtonwizards: "WAS", was: "WAS",
};
export function canonicalNbaPropsTeam(value: string): string { return NBA_TEAM_ALIASES[normalizeName(value)] ?? normalizeName(value).toUpperCase(); }

function normalizeName(value:string){return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");}

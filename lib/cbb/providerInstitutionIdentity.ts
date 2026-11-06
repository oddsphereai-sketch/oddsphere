import { canonicalCbbTeamName } from "./dataset";

export const CBB_PROVIDER_IDENTITY_RELEASE = "cbb_provider_identity_2026_11_06_r7_current_board_source_aliases" as const;

// Provider spellings of named institutions, never mascot or substring guesses.
// Keep State and Saint distinct and preserve ambiguous schools (USC, Miami).
const stateInstitutions = [
  "Alabama State", "Alcorn State", "App State", "Arizona State", "Arkansas State", "Ball State", "Boise State",
  "Chicago State", "Cleveland State", "Colorado State", "Coppin State", "Delaware State", "East Tennessee State",
  "Florida State", "Fresno State", "Georgia State", "Grambling State", "Idaho State", "Illinois State", "Indiana State",
  "Iowa State", "Jackson State", "Jacksonville State", "Kansas State", "Kennesaw State", "Kent State", "Long Beach State",
  "Michigan State", "Mississippi State", "Mississippi Valley State", "Missouri State", "Montana State", "Morehead State",
  "Morgan State", "Murray State", "New Mexico State", "Norfolk State", "North Carolina State", "North Dakota State",
  "Northwestern State", "Ohio State", "Oklahoma State", "Oregon State", "Penn State", "Portland State", "Sacramento State",
  "Sam Houston State", "San Diego State", "San Jose State", "Savannah State", "South Carolina State", "South Dakota State",
  "Southeast Missouri State", "Tennessee State", "Texas State", "Utah State", "Washington State", "Weber State",
  "Wichita State", "Wright State", "Youngstown State",
];
const aliases = new Map<string,string>(stateInstitutions.map(name => [canonicalCbbTeamName(name.replace(/State$/, "St")), canonicalCbbTeamName(name)]));
for (const [source, institution] of [
  // Exact labels and matching native school IDs in the November 6 Owls receipt.
  ["N Colorado", "Northern Colorado"], ["SC State", "South Carolina State"],
  ["Miss Valley St", "Mississippi Valley State"], ["MTSU", "Middle Tennessee"],
  // Exact participant names in the 2026-11-05 current Owls receipt.
  ["Jax State", "Jacksonville State"], ["N Illinois", "Northern Illinois"],
  ["Penn", "Pennsylvania"],
  // Exact institution labels in the stored 2026-11-03 Owls discovery receipt.
  // IPFW/Purdue FW both identify Purdue Fort Wayne; State stays distinct.
  ["IPFW", "Purdue Fort Wayne"], ["Purdue FW", "Purdue Fort Wayne"],
  ["S Dakota St", "South Dakota State"],
  // Exact participant labels in the retained November 4 Owls response.
  ["N Dakota St", "North Dakota State"],
  ["CSU Northridge", "Cal State Northridge"], ["CS Northridge", "Cal State Northridge"],
  ["LMU", "Loyola Marymount"],
  ["AR-Pine Bluff", "Arkansas-Pine Bluff"], ["CA Baptist", "California Baptist"],
  ["Cal Baptist", "California Baptist"],
  ["N Arizona", "Northern Arizona"], ["Fullerton", "Cal State Fullerton"],
  ["Alabama Birmingham Blazers", "UAB Blazers"], ["New Jersey Tech Highlanders", "NJIT Highlanders"],
  ["Southern Methodist Mustangs", "SMU Mustangs"], ["Brigham Young Cougars", "BYU Cougars"],
  ["Texas A&M-CC", "Texas A&M-Corpus Christi"], ["ETSU", "East Tennessee State"],
  ["Western KY", "Western Kentucky"], ["C Michigan", "Central Michigan"],
  ["E Michigan", "Eastern Michigan"], ["Coastal", "Coastal Carolina"],
  ["Long Island", "Long Island University"], ["FAU", "Florida Atlantic"],
  ["Louisiana Monroe", "UL Monroe"], ["Texas San Antonio", "UTSA"],
  ["Texas San Antonio Roadrunners", "UTSA Roadrunners"], ["Indiana U.", "Indiana"],
  ["Appalachian St", "App State"], ["Appalachian State", "App State"],
  ["C Connecticut", "Central Connecticut"], ["Central Connecticut State", "Central Connecticut"],
  ["FGCU", "Florida Gulf Coast"], ["Boston U", "Boston University"], ["E Washington", "Eastern Washington"],
  ["SE Missouri", "Southeast Missouri State"], ["SE Missouri St", "Southeast Missouri State"],
  ["American", "American University"], ["Charleston So", "Charleston Southern"], ["UMass", "Massachusetts"],
  ["Abilene Chrstn", "Abilene Christian"], ["MD Eastern", "Maryland Eastern Shore"],
  ["Pitt", "Pittsburgh"], ["E Texas A&M", "East Texas A&M"], ["N Kentucky", "Northern Kentucky"],
  ["Loyola MD", "Loyola Maryland"], ["St Thomas (MN)", "St. Thomas-Minnesota"],
  ["E Illinois", "Eastern Illinois"], ["W Carolina", "Western Carolina"], ["G Washington", "George Washington"],
  ["GA Southern", "Georgia Southern"], ["W Michigan", "Western Michigan"], ["NC Central", "North Carolina Central"],
  ["W Illinois", "Western Illinois"], ["Bethune", "Bethune-Cookman"], ["FDU", "Fairleigh Dickinson"],
  ["UMKC", "Kansas City"], ["C Arkansas", "Central Arkansas"], ["N'Western St", "Northwestern State"],
  ["NC State", "North Carolina State"], ["NC St", "North Carolina State"],
  ["USC Upstate", "South Carolina Upstate"], ["Tennessee-Martin", "UT Martin"], ["Seattle", "Seattle U"],
] as const) aliases.set(canonicalCbbTeamName(source),canonicalCbbTeamName(institution));

export function cbbProviderInstitutionName(value:string):string {
  const normalized=canonicalCbbTeamName(value);
  return aliases.get(normalized)??normalized;
}

import { canonicalPokemonName } from "./meta.js";
import {
  championsStats,
  validateStatPoints,
  type Nature,
  type StatTable,
} from "./calculator.js";
import { pokemonVisual } from "./pokedex.js";

export interface TeamSlot {
  species: string;
  nickname?: string;
  gender?: "M" | "F";
  item?: string;
  ability?: string;
  teraType?: string;
  nature?: string;
  statPoints?: Partial<StatTable>;
  moves: string[];
  importErrors?: string[];
}

export interface ParsedTeam {
  slots: TeamSlot[];
  warnings: string[];
}

export interface LegalityRules {
  regulation: string;
  allowedPokemon?: readonly string[];
  allowedItems?: readonly string[];
  allowedMoves?: Readonly<Record<string, readonly string[]>>;
  allowedAbilities?: Readonly<Record<string, readonly string[]>>;
  allowedTeraTypes?: readonly string[];
  restrictedPokemon?: readonly string[];
  maxRestricted?: number;
  speciesClauseKeys?: Readonly<Record<string, string>>;
}

export interface LegalityIssue {
  code: string;
  slot?: number;
  message: string;
}

export interface RegistrationFields {
  playerName?: string;
  ageDivision?: string;
  trainerName?: string;
  playerId?: string;
  battleTeamNumber?: string;
  teamName?: string;
}

const STAT_NAMES: Readonly<Record<string, keyof StatTable>> = {
  HP: "hp",
  Atk: "attack",
  Def: "defense",
  SpA: "specialAttack",
  SpD: "specialDefense",
  Spe: "speed",
};

const PRINT_STATS: ReadonlyArray<readonly [string, keyof StatTable]> = [
  ["HP", "hp"],
  ["Atk", "attack"],
  ["Def", "defense"],
  ["Sp. Atk", "specialAttack"],
  ["Sp. Def", "specialDefense"],
  ["Speed", "speed"],
];

const PRINT_NATURES: Readonly<Record<string, Nature>> = {
  adamant: { name: "Adamant", plus: "attack", minus: "specialAttack" },
  bashful: { name: "Bashful" },
  bold: { name: "Bold", plus: "defense", minus: "attack" },
  brave: { name: "Brave", plus: "attack", minus: "speed" },
  calm: { name: "Calm", plus: "specialDefense", minus: "attack" },
  careful: { name: "Careful", plus: "specialDefense", minus: "specialAttack" },
  docile: { name: "Docile" },
  gentle: { name: "Gentle", plus: "specialDefense", minus: "defense" },
  hardy: { name: "Hardy" },
  hasty: { name: "Hasty", plus: "speed", minus: "defense" },
  impish: { name: "Impish", plus: "defense", minus: "specialAttack" },
  jolly: { name: "Jolly", plus: "speed", minus: "specialAttack" },
  lax: { name: "Lax", plus: "defense", minus: "specialDefense" },
  lonely: { name: "Lonely", plus: "attack", minus: "defense" },
  mild: { name: "Mild", plus: "specialAttack", minus: "defense" },
  modest: { name: "Modest", plus: "specialAttack", minus: "attack" },
  naive: { name: "Naive", plus: "speed", minus: "specialDefense" },
  naughty: { name: "Naughty", plus: "attack", minus: "specialDefense" },
  neutral: { name: "Neutral" },
  quiet: { name: "Quiet", plus: "specialAttack", minus: "speed" },
  quirky: { name: "Quirky" },
  rash: { name: "Rash", plus: "specialAttack", minus: "specialDefense" },
  relaxed: { name: "Relaxed", plus: "defense", minus: "speed" },
  sassy: { name: "Sassy", plus: "specialDefense", minus: "speed" },
  serious: { name: "Serious" },
  timid: { name: "Timid", plus: "speed", minus: "attack" },
};

function parseHeader(header: string): Omit<TeamSlot, "moves"> {
  const itemMarker = header.indexOf(" @ ");
  let identity =
    itemMarker < 0 ? header.trim() : header.slice(0, itemMarker).trim();
  const item =
    itemMarker < 0
      ? undefined
      : header.slice(itemMarker + 3).trim() || undefined;
  let gender: "M" | "F" | undefined;
  const genderMatch = identity.match(/ \(([MF])\)$/);
  if (genderMatch) {
    gender = genderMatch[1] as "M" | "F";
    identity = identity.slice(0, -4).trim();
  }
  const nicknameMatch = identity.match(/^(.+?) \(([^()]+)\)$/);
  return nicknameMatch
    ? {
        nickname: nicknameMatch[1]?.trim(),
        species: nicknameMatch[2]?.trim() ?? "",
        gender,
        item,
      }
    : { species: identity, gender, item };
}

function parseStatPoints(value: string): Partial<StatTable> | undefined {
  const points: Partial<StatTable> = {};
  for (const part of value.split("/")) {
    const match = part.trim().match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/i);
    if (!match) return undefined;
    const label = Object.keys(STAT_NAMES).find(
      (name) => name.toLowerCase() === match[2]?.toLowerCase(),
    );
    if (!label) return undefined;
    const stat = STAT_NAMES[label] as keyof StatTable;
    if (points[stat] !== undefined) return undefined;
    points[stat] = Number(match[1]);
  }
  return points;
}

export function parsePokepaste(text: string): ParsedTeam {
  const warnings: string[] = [];
  const slots = text
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((block, index): TeamSlot => {
      const lines = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const slot: TeamSlot = { ...parseHeader(lines.shift() ?? ""), moves: [] };
      const warningStart = warnings.length;
      for (const line of lines) {
        if (line.startsWith("Ability:")) slot.ability = line.slice(8).trim();
        else if (line.startsWith("Tera Type:"))
          slot.teraType = line.slice(10).trim();
        else if (/ Nature$/i.test(line)) slot.nature = line.slice(0, -7).trim();
        else if (/^(?:SPs|Stat Points|EVs):/i.test(line)) {
          const points = parseStatPoints(line.slice(line.indexOf(":") + 1));
          if (points && !validateStatPoints(points).length) slot.statPoints = points;
          else
            warnings.push(`Slot ${index + 1}: ignored malformed stat points`);
        } else if (line.startsWith("- ")) slot.moves.push(line.slice(2).trim());
        else if (!/^(?:Level|Shiny|Happiness|Friendship):/i.test(line))
          warnings.push(`Slot ${index + 1}: ignored “${line}”`);
      }
      if (warnings.length > warningStart)
        slot.importErrors = warnings.slice(warningStart);
      return slot;
    });
  return { slots, warnings };
}

function canonicalSet(
  values: readonly string[] | undefined,
): Set<string> | undefined {
  return values ? new Set(values.map(canonicalPokemonName)) : undefined;
}

interface LegalityIndex {
  allowedPokemon: Set<string> | undefined;
  allowedItems: Set<string> | undefined;
  restricted: Set<string> | undefined;
}

const legalityIndexes = new WeakMap<LegalityRules, LegalityIndex>();

function legalityIndex(rules: LegalityRules): LegalityIndex {
  const existing = legalityIndexes.get(rules);
  if (existing) return existing;
  const index = {
    allowedPokemon: canonicalSet(rules.allowedPokemon),
    allowedItems: rules.allowedItems
      ? new Set(rules.allowedItems.map((item) => item.toLowerCase()))
      : undefined,
    restricted: canonicalSet(rules.restrictedPokemon),
  };
  legalityIndexes.set(rules, index);
  return index;
}
export function legalityCatalogErrors(rules: LegalityRules): string[] {
  const errors: string[] = [];
  if (!rules.regulation?.trim()) errors.push("Regulation is missing");
  if (!rules.allowedPokemon?.length)
    errors.push("Pokémon legality catalog is missing");
  if (!rules.allowedItems) errors.push("Item legality catalog is missing");
  if (
    !rules.restrictedPokemon ||
    !Number.isInteger(rules.maxRestricted) ||
    (rules.maxRestricted ?? -1) < 0
  ) {
    errors.push("Restricted Pokémon rules are missing or invalid");
  }
  for (const name of rules.allowedPokemon ?? []) {
    const key = canonicalPokemonName(name);
    if (!rules.allowedMoves?.[key]?.length)
      errors.push(`Move catalog missing for ${name}`);
    if (!rules.allowedAbilities?.[key]?.length)
      errors.push(`Ability catalog missing for ${name}`);
    if (!rules.speciesClauseKeys?.[key])
      errors.push(`Species-clause mapping missing for ${name}`);
  }
  return errors;
}

export function validateTeam(
  slots: readonly TeamSlot[],
  rules: LegalityRules,
  partial = false,
  catalogValidated = false,
): LegalityIssue[] {
  const issues: LegalityIssue[] = catalogValidated
    ? []
    : legalityCatalogErrors(rules).map(
      (message) => ({ code: "catalog-incomplete", message }),
    );
  if ((!partial && slots.length !== 6) || slots.length > 6)
    issues.push({
      code: "team-size",
      message: "A tournament team must contain exactly six Pokémon",
    });
  const { allowedPokemon, allowedItems, restricted } = legalityIndex(rules);
  const seenSpecies = new Map<string, number>();
  const seenItems = new Map<string, number>();
  let restrictedCount = 0;

  slots.forEach((slot, index) => {
    const number = index + 1;
    const canonical = canonicalPokemonName(slot.species);
    const speciesKey = rules.speciesClauseKeys?.[canonical] ?? canonical;
    for (const message of slot.importErrors ?? [])
      issues.push({ code: "import-error", slot: number, message });
    if (!canonical)
      issues.push({
        code: "species-required",
        slot: number,
        message: `Slot ${number}: Pokémon is required`,
      });
    if (seenSpecies.has(speciesKey))
      issues.push({
        code: "species-clause",
        slot: number,
        message: `Slot ${number}: duplicate species`,
      });
    else seenSpecies.set(speciesKey, number);
    if (allowedPokemon && !allowedPokemon.has(canonical)) {
      issues.push({
        code: "pokemon-illegal",
        slot: number,
        message: `Slot ${number}: ${slot.species} is not legal in ${rules.regulation}`,
      });
    }
    if (restricted?.has(canonical)) restrictedCount += 1;

    if (slot.item) {
      const itemKey = slot.item.trim().toLowerCase();
      if (seenItems.has(itemKey))
        issues.push({
          code: "item-clause",
          slot: number,
          message: `Slot ${number}: duplicate item ${slot.item}`,
        });
      else seenItems.set(itemKey, number);
      if (allowedItems && !allowedItems.has(itemKey)) {
        issues.push({
          code: "item-illegal",
          slot: number,
          message: `Slot ${number}: ${slot.item} is not legal in ${rules.regulation}`,
        });
      }
    }
    if (!slot.ability?.trim())
      issues.push({
        code: "ability-required",
        slot: number,
        message: `Slot ${number}: ability is required`,
      });
    else if (
      rules.allowedAbilities?.[canonical] &&
      !rules.allowedAbilities[canonical].some(
        (ability) => ability.toLowerCase() === slot.ability?.toLowerCase(),
      )
    ) {
      issues.push({
        code: "ability-illegal",
        slot: number,
        message: `Slot ${number}: ${slot.ability} is not legal for ${slot.species}`,
      });
    }
    if ((rules.allowedTeraTypes?.length ?? 0) > 0 && !slot.teraType?.trim())
      issues.push({
        code: "tera-required",
        slot: number,
        message: `Slot ${number}: Tera Type is required`,
      });
    else if (
      slot.teraType &&
      rules.allowedTeraTypes &&
      !rules.allowedTeraTypes.some(
        (type) => type.toLowerCase() === slot.teraType?.toLowerCase(),
      )
    ) {
      issues.push({
        code: "tera-illegal",
        slot: number,
        message: `Slot ${number}: ${slot.teraType} is not a legal Tera Type`,
      });
    }
    if (slot.moves.length < 1 || slot.moves.length > 4) {
      issues.push({
        code: "move-count",
        slot: number,
        message: `Slot ${number}: enter one to four moves`,
      });
    }
    if (
      new Set(slot.moves.map((move) => move.toLowerCase())).size !==
      slot.moves.length
    ) {
      issues.push({
        code: "duplicate-move",
        slot: number,
        message: `Slot ${number}: duplicate move`,
      });
    }
    const allowedMoves = rules.allowedMoves?.[canonical];
    for (const move of slot.moves) {
      if (!move.trim())
        issues.push({
          code: "move-required",
          slot: number,
          message: `Slot ${number}: empty move`,
        });
      if (
        allowedMoves &&
        !allowedMoves.some(
          (allowed) => allowed.toLowerCase() === move.toLowerCase(),
        )
      ) {
        issues.push({
          code: "move-illegal",
          slot: number,
          message: `Slot ${number}: ${move} is not legal for ${slot.species}`,
        });
      }
    }
    for (const error of validateStatPoints(slot.statPoints ?? {})) {
      issues.push({
        code: "stat-points",
        slot: number,
        message: `Slot ${number}: ${error}`,
      });
    }
  });

  if (
    rules.maxRestricted !== undefined &&
    restrictedCount > rules.maxRestricted
  ) {
    issues.push({
      code: "restricted-limit",
      message: `${restrictedCount} restricted Pokémon exceeds the limit of ${rules.maxRestricted}`,
    });
  }
  return issues;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function display(value: string | undefined): string {
  return value ? escapeHtml(value) : "—";
}

function printNature(name: string | undefined): Nature | undefined {
  return name ? PRINT_NATURES[name.trim().toLowerCase()] : undefined;
}

function officialName(slot: TeamSlot): string {
  return display(slot.nickname ? `${slot.nickname} (${slot.species})` : slot.species);
}

function level50Stats(slot: TeamSlot): StatTable {
  const visual = pokemonVisual(slot.species);
  const nature = printNature(slot.nature);
  if (!visual || !nature || !slot.statPoints)
    throw new Error(`Cannot calculate printable stats for ${slot.species}`);
  return championsStats({
    name: visual.name,
    baseStats: visual.baseStats,
    nature,
    statPoints: slot.statPoints,
  });
}

function officialField(
  label: string,
  value: string | undefined,
  className = "",
): string {
  return `<div class="sheet-field ${className}"><span>${escapeHtml(label)}</span><strong>${display(value)}</strong></div>`;
}

function entryRows(slot: TeamSlot): string {
  const rows: ReadonlyArray<readonly [string, string | undefined]> = [
    ["Ability", slot.ability],
    ["Held Item", slot.item],
    ...Array.from(
      { length: 4 },
      (_, index) => [`Move ${index + 1}`, slot.moves[index]] as const,
    ),
  ];
  return rows
    .map(([label, value]) => `<div class="entry-row"><span>${escapeHtml(label)}</span><strong>${display(value)}</strong></div>`)
    .join("");
}

function entryHeader(slot: TeamSlot, showTera: boolean, showStats: boolean): string {
  let details = "";
  if (showStats)
    details = `Nature: ${display(slot.nature)}${showTera ? ` · Tera Type: ${display(slot.teraType)}` : ""}`;
  else if (showTera) details = `Tera Type: ${display(slot.teraType)}`;
  return `<header class="entry-name"><span>Pokémon</span><strong>${officialName(slot)}</strong>${details ? `<em>${details}</em>` : ""}${showStats ? "<b>Level 50 stats</b>" : ""}</header>`;
}

function statRows(stats: StatTable): string {
  return PRINT_STATS
    .map(([label, stat]) => `<div class="stat-row"><span>${label}</span><strong>${stats[stat]}</strong></div>`)
    .join("");
}

function staffEntry(slot: TeamSlot, showTera: boolean): string {
  return `<article class="team-entry staff-entry">${entryHeader(slot, showTera, true)}<div class="entry-rows">${entryRows(slot)}</div><div class="entry-stats">${statRows(level50Stats(slot))}</div></article>`;
}

function opponentEntry(slot: TeamSlot, showTera: boolean): string {
  return `<article class="team-entry opponent-entry">${entryHeader(slot, showTera, false)}<div class="entry-rows">${entryRows(slot)}</div></article>`;
}

export function renderTeamSheetHtml(
  slots: readonly TeamSlot[],
  rules: LegalityRules,
  registration: RegistrationFields = {},
): string {
  const issues = validateTeam(slots, rules);
  slots.forEach((slot, index) => {
    const number = index + 1;
    if (!slot.nature)
      issues.push({
        code: "nature-required",
        slot: number,
        message: `Slot ${number}: nature is required for the staff page`,
      });
    else if (!printNature(slot.nature))
      issues.push({
        code: "nature-unknown",
        slot: number,
        message: `Slot ${number}: ${slot.nature} is not a supported nature`,
      });
    if (!slot.statPoints)
      issues.push({
        code: "stat-points-required",
        slot: number,
        message: `Slot ${number}: stat points are required for the staff page`,
      });
    if (!pokemonVisual(slot.species))
      issues.push({
        code: "base-stats-unavailable",
        slot: number,
        message: `Slot ${number}: exact base stats are unavailable for ${slot.species}`,
      });
  });
  if (issues.length)
    throw new Error(issues.map(({ message }) => message).join("; "));

  const showTera = (rules.allowedTeraTypes?.length ?? 0) > 0;
  const staffFields = [
    ["Player Name", registration.playerName, "field-player"],
    ["Age Division", registration.ageDivision, "field-age"],
    ["Trainer Name in Game", registration.trainerName, "field-trainer"],
    ["Player ID", registration.playerId, "field-id"],
    ["Battle Team Number", registration.battleTeamNumber, "field-number"],
    ["Battle Team Name", registration.teamName, "field-team"],
  ] as const;
  const opponentFields = [
    ["Player Name", registration.playerName, "field-player"],
    ["Trainer Name in Game", registration.trainerName, "field-trainer"],
    ["Battle Team Number", registration.battleTeamNumber, "field-number"],
    ["Battle Team Name", registration.teamName, "field-team"],
  ] as const;
  const fields = (
    entries: ReadonlyArray<readonly [string, string | undefined, string]>,
  ) => entries.map(([label, value, className]) => officialField(label, value, className)).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pokémon Video Game Team List</title>
<style>
:root{color-scheme:light}
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}
html,body{margin:0}
body{background:#fff;color:#000;font-family:Calibri,Arial,sans-serif;font-size:9pt;line-height:1.15}
.official-sheet{display:flex;width:210mm;height:297mm;margin:0 auto;padding:10mm 6.5mm 8mm;flex-direction:column;overflow:hidden;background:#fff}
.sheet-header{flex:none;text-align:center}
.sheet-header h1{margin:0;font-size:15pt;line-height:1.1;font-weight:700}
.sheet-header p{margin:1.2mm 0 0;font-size:11pt;line-height:1.1}
.sheet-header p strong{font-weight:700}
.sheet-header p em{font-weight:700}
.sheet-instructions{flex:none;margin:2.2mm 0 4mm;text-align:center;font-size:8pt;line-height:1.2}
.registration{display:grid;flex:none;min-height:25mm;margin-bottom:4mm;align-content:start;column-gap:5mm;row-gap:3.2mm}
.staff-registration{grid-template-columns:1.2fr .8fr}
.opponent-registration{grid-template-columns:1fr 1fr}
.sheet-field{display:grid;min-width:0;min-height:5.8mm;grid-template-columns:auto minmax(0,1fr);align-items:end;gap:1.5mm;border-bottom:.25mm solid #000;padding:0 1mm .7mm}
.sheet-field span{font-size:8pt;font-weight:700;white-space:nowrap}
.sheet-field strong{min-width:0;font-size:8.5pt;font-weight:400;overflow-wrap:anywhere}
.staff-registration .field-player,.staff-registration .field-trainer,.staff-registration .field-number{grid-column:1}
.staff-registration .field-age,.staff-registration .field-id,.staff-registration .field-team{grid-column:2}
.opponent-registration .field-player,.opponent-registration .field-team{grid-column:1 / -1}
.team-grid{display:grid;min-height:0;flex:1;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(3,minmax(0,1fr));gap:2.5mm 4mm}
.team-entry{display:grid;min-width:0;min-height:0;border:.35mm solid #000;overflow:hidden}
.staff-entry{grid-template-columns:minmax(0,1fr) 19mm;grid-template-rows:9mm minmax(0,1fr)}
.opponent-entry{grid-template-columns:minmax(0,1fr);grid-template-rows:9mm minmax(0,1fr)}
.entry-name{display:grid;min-width:0;grid-column:1 / -1;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:1.4mm;border-bottom:.25mm solid #000;padding:0 1.8mm}
.entry-name>span,.entry-name>b{font-size:6.3pt;font-weight:700;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap}
.entry-name>strong{min-width:0;font-size:9.5pt;line-height:1.05;overflow-wrap:anywhere}
.entry-name em{min-width:0;font-size:6.6pt;font-style:normal;text-align:right;overflow-wrap:anywhere}
.entry-name>b{text-align:right}
.entry-rows{display:grid;min-height:0;grid-template-rows:repeat(6,minmax(0,1fr))}
.entry-row{display:grid;min-width:0;min-height:0;grid-template-columns:24mm minmax(0,1fr);align-items:center;gap:1.2mm;border-bottom:.2mm solid #000;padding:0 1.8mm}
.entry-row:last-child{border-bottom:0}
.entry-row span{font-size:8pt;font-weight:700;white-space:nowrap}
.entry-row strong{min-width:0;font-size:8.5pt;font-weight:400;overflow-wrap:anywhere}
.entry-stats{display:grid;min-height:0;grid-template-rows:repeat(6,minmax(0,1fr));border-left:.25mm solid #000}
.stat-row{display:grid;min-height:0;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:.7mm;border-bottom:.2mm solid #000;padding:0 1.2mm}
.stat-row:last-child{border-bottom:0}
.stat-row span{font-size:6.5pt;font-weight:700;line-height:1.05}
.stat-row strong{font-size:8.5pt;font-weight:700;font-variant-numeric:tabular-nums}
.page-note{flex:none;margin:2mm 0 0;text-align:center;font-size:6.5pt;line-height:1.1}
@media screen{body{background:#ececec}.official-sheet{margin-block:8mm;box-shadow:0 3mm 9mm rgba(0,0,0,.18)}}
@media print{.official-sheet{break-after:page;page-break-after:always}.official-sheet:last-child{break-after:auto;page-break-after:auto}}
</style>
</head>
<body>
<main>
<section class="official-sheet staff-sheet" aria-labelledby="staff-title">
<header class="sheet-header"><h1 id="staff-title">Pokémon Video Game Team List</h1><p><strong>1 of 2:</strong> <em>For Tournament Staff</em></p></header>
<p class="sheet-instructions">Complete both pages of this document. Submit this page to event staff before the tournament, at the time set by the Organizer.</p>
<div class="registration staff-registration">${fields(staffFields)}</div>
<div class="team-grid">${slots.map((slot) => staffEntry(slot, showTera)).join("")}</div>
</section>
<section class="official-sheet opponent-sheet" aria-labelledby="opponent-title">
<header class="sheet-header"><h1 id="opponent-title">Pokémon Video Game Team List</h1><p><strong>2 of 2:</strong> <em>For Opponents</em></p></header>
<p class="sheet-instructions">Do not lose this page! Keep it throughout the tournament, sharing it with your opponent each round.</p>
<div class="registration opponent-registration">${fields(opponentFields)}</div>
<div class="team-grid">${slots.map((slot) => opponentEntry(slot, showTera)).join("")}</div>
<p class="page-note">All Pokémon must be listed exactly as they appear in the Battle Team.</p>
</section>
</main>
</body>
</html>`;
}

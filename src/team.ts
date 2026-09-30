import { canonicalPokemonName } from "./meta.js";
import { validateStatPoints, type StatTable } from "./calculator.js";

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

function statPointText(points: Partial<StatTable> | undefined): string {
  if (!points) return "—";
  return Object.entries(STAT_NAMES)
    .map(([label, stat]) => `${points[stat] ?? 0} ${label}`)
    .join(" / ");
}

function officialName(slot: TeamSlot): string {
  return display(slot.nickname ? `${slot.nickname} (${slot.species})` : slot.species);
}

function officialMoves(slot: TeamSlot): string {
  return `<ol class="sheet-moves">${Array.from(
    { length: 4 },
    (_, index) => `<li>${display(slot.moves[index])}</li>`,
  ).join("")}</ol>`;
}

function officialField(label: string, value: string | undefined): string {
  return `<div class="sheet-field"><span>${escapeHtml(label)}</span><strong>${display(value)}</strong></div>`;
}

function entryFacts(
  facts: ReadonlyArray<readonly [string, string | undefined]>,
): string {
  return facts
    .map(([label, value]) => `<div class="entry-fact"><span>${escapeHtml(label)}</span><strong>${display(value)}</strong></div>`)
    .join("");
}

function staffEntry(slot: TeamSlot, index: number, showTera: boolean): string {
  return `<article class="staff-entry"><div class="entry-number">${index + 1}</div><div class="entry-body"><h3>${officialName(slot)}</h3><div class="entry-facts">${entryFacts([
    ["Ability", slot.ability],
    ["Held Item", slot.item],
    ["Nature", slot.nature],
    ...(showTera ? [["Tera Type", slot.teraType] as const] : []),
  ])}</div><div class="entry-moves"><span>Moves</span>${officialMoves(slot)}</div><div class="entry-points"><span>Champions Stat Points</span><strong>${escapeHtml(statPointText(slot.statPoints))}</strong></div></div></article>`;
}

function opponentEntry(slot: TeamSlot, index: number, showTera: boolean): string {
  return `<article class="opponent-entry"><div class="entry-number">${index + 1}</div><div class="entry-body"><h3>${officialName(slot)}</h3><div class="entry-facts">${entryFacts([
    ["Ability", slot.ability],
    ["Held Item", slot.item],
    ...(showTera ? [["Tera Type", slot.teraType] as const] : []),
  ])}</div><div class="entry-moves"><span>Moves</span>${officialMoves(slot)}</div></div></article>`;
}

export function renderTeamSheetHtml(
  slots: readonly TeamSlot[],
  rules: LegalityRules,
  registration: RegistrationFields = {},
): string {
  const issues = validateTeam(slots, rules);
  slots.forEach((slot, index) => {
    if (!slot.nature)
      issues.push({
        code: "nature-required",
        slot: index + 1,
        message: `Slot ${index + 1}: nature is required for the staff page`,
      });
    if (!slot.statPoints)
      issues.push({
        code: "stat-points-required",
        slot: index + 1,
        message: `Slot ${index + 1}: stat points are required for the staff page`,
      });
  });
  if (issues.length)
    throw new Error(issues.map(({ message }) => message).join("; "));
  const showTera = (rules.allowedTeraTypes?.length ?? 0) > 0;
  const staffFields = [
    ["Player Name", registration.playerName],
    ["Age Division", registration.ageDivision],
    ["Trainer Name in Game", registration.trainerName],
    ["Player ID", registration.playerId],
    ["Battle Team Number", registration.battleTeamNumber],
    ["Battle Team Name", registration.teamName],
  ] as const;
  const opponentFields = [
    ["Player Name", registration.playerName],
    ["Trainer Name in Game", registration.trainerName],
    ["Battle Team Number", registration.battleTeamNumber],
    ["Battle Team Name", registration.teamName],
  ] as const;
  const regulation = escapeHtml(rules.regulation);
  const opponentDetailNote = showTera
    ? "ability, held item, Tera Type when enabled, and moves only."
    : "ability, held item, and moves only.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pokémon Video Game Team List</title><style>:root{color-scheme:light}@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;background:#eef1ec;color:#101612;font-family:system-ui,sans-serif;font-size:9pt;line-height:1.25}.official-sheet{display:flex;width:210mm;min-height:297mm;margin:0 auto;padding:8mm 12mm 6mm;flex-direction:column;background:#fff}.sheet-header{display:grid;grid-template-columns:1fr auto;gap:6mm;align-items:end;border-block:2px solid #176b4d;padding-block:2mm}.sheet-header p{margin:0;color:#176b4d;font-size:7.5pt;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.sheet-header h1{margin:1mm 0 0;font-size:22pt;letter-spacing:-.025em;line-height:1}.sheet-header .sheet-mark{font-size:8pt;font-weight:800;text-align:right}.sheet-subhead{display:flex;justify-content:space-between;gap:4mm;margin:3mm 0;color:#33443a;font-size:8pt;font-weight:700}.sheet-subhead strong{color:#101612}.player-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2mm 4mm;margin:2.5mm 0 3mm}.sheet-field{min-height:8mm;border-bottom:1px solid #101612;padding-bottom:1mm}.sheet-field span,.entry-fact span,.entry-moves>span,.entry-points>span{display:block;color:#456052;font-size:6.5pt;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.sheet-field strong{display:block;min-height:4mm;margin-top:1mm;font-size:8.5pt;overflow-wrap:anywhere}.section-title{margin:0;border-bottom:2px solid #101612;padding:1.5mm 0;font-size:10pt;letter-spacing:.01em}.section-title small{float:right;color:#456052;font-size:7pt;font-weight:700;text-transform:uppercase}.staff-list,.opponent-list{display:block}.staff-entry,.opponent-entry{display:grid;grid-template-columns:8mm minmax(0,1fr);border:1px solid #101612;border-bottom:0;break-inside:avoid}.staff-entry:last-child,.opponent-entry:last-child{border-bottom:1px solid #101612}.entry-number{display:grid;place-items:center;border-right:1px solid #101612;background:#e2ece5;color:#176b4d;font-size:12pt;font-weight:800}.entry-body{min-width:0;padding:1.3mm 2mm}.entry-body h3{margin:0 0 .8mm;font-size:9pt;line-height:1.1;overflow-wrap:anywhere}.entry-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid #b5c4ba}.entry-fact{min-height:5.5mm;padding:.7mm 1mm;border-right:1px solid #b5c4ba;border-bottom:1px solid #b5c4ba}.entry-fact:nth-child(even){border-right:0}.entry-fact strong{display:block;margin-top:.3mm;font-size:7.5pt;overflow-wrap:anywhere}.entry-moves{display:grid;grid-template-columns:22mm minmax(0,1fr);gap:2mm;align-items:start;padding-top:.7mm}.sheet-moves{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8mm 3mm;margin:0;padding:0;list-style-position:inside}.sheet-moves li{min-width:0;overflow-wrap:anywhere}.entry-points{display:flex;gap:3mm;align-items:baseline;margin-top:.7mm;border-top:1px solid #b5c4ba;padding-top:.7mm}.entry-points strong{font-size:7pt;overflow-wrap:anywhere}.opponent-entry .entry-body{padding-block:2.7mm}.opponent-entry .entry-facts{grid-template-columns:repeat(3,minmax(0,1fr))}.opponent-entry .entry-fact:nth-child(even){border-right:1px solid #b5c4ba}.opponent-entry .entry-fact:last-child{border-right:0}.opponent-entry .entry-moves{margin-top:1mm}.sheet-footer{margin-top:auto;border-top:1px solid #101612;padding-top:2mm;color:#456052;font-size:7pt}.sheet-footer span:last-child{float:right}.opponent-note{margin:3mm 0 4mm;color:#33443a;font-size:8pt}.opponent-note strong{color:#176b4d}@media screen{.official-sheet{margin-block:10mm;box-shadow:0 4mm 10mm rgba(16,22,18,.16)}}@media print{body{background:#fff}.official-sheet{break-after:page;page-break-after:always}.official-sheet:last-child{break-after:auto;page-break-after:auto}}</style></head><body><main><section class="official-sheet staff-sheet" aria-labelledby="staff-title"><header class="sheet-header"><div><p>Pokémon Video Game</p><h1 id="staff-title">Team List</h1></div><div class="sheet-mark">Tournament Staff</div></header><div class="sheet-subhead"><span>Regulation <strong>${regulation}</strong></span><span>Staff copy · Page 1 of 2</span></div><div class="player-fields">${staffFields.map(([label, value]) => officialField(label, value)).join("")}</div><h2 class="section-title">Registered Battle Team <small>Complete set details</small></h2><div class="staff-list">${slots.map((slot, index) => staffEntry(slot, index, showTera)).join("")}</div><footer class="sheet-footer"><span>Keep this page with tournament staff.</span><span>Page 1 of 2</span></footer></section><section class="official-sheet opponent-sheet" aria-labelledby="opponent-title"><header class="sheet-header"><div><p>Pokémon Video Game</p><h1 id="opponent-title">Team List</h1></div><div class="sheet-mark">Opponent Copy</div></header><div class="sheet-subhead"><span>Regulation <strong>${regulation}</strong></span><span>Opponent copy · Page 2 of 2</span></div><div class="player-fields">${opponentFields.map(([label, value]) => officialField(label, value)).join("")}</div><p class="opponent-note"><strong>Battle preview:</strong> ${opponentDetailNote}</p><h2 class="section-title">Battle Team <small>Opponent-facing details</small></h2><div class="opponent-list">${slots.map((slot, index) => opponentEntry(slot, index, showTera)).join("")}</div><footer class="sheet-footer"><span>Nature and Champions stat points are kept on the staff page.</span><span>Page 2 of 2</span></footer></section></main></body></html>`;
}

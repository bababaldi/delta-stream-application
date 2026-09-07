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
  playerId?: string;
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
        else if (/^(?:SPs|Stat Points):/i.test(line)) {
          const points = parseStatPoints(line.slice(line.indexOf(":") + 1));
          if (points) slot.statPoints = points;
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
): LegalityIssue[] {
  const issues: LegalityIssue[] = legalityCatalogErrors(rules).map(
    (message) => ({ code: "catalog-incomplete", message }),
  );
  if ((!partial && slots.length !== 6) || slots.length > 6)
    issues.push({
      code: "team-size",
      message: "A tournament team must contain exactly six Pokémon",
    });
  const allowedPokemon = canonicalSet(rules.allowedPokemon);
  const allowedItems = rules.allowedItems
    ? new Set(rules.allowedItems.map((item) => item.toLowerCase()))
    : undefined;
  const restricted = canonicalSet(rules.restrictedPokemon);
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

export function renderTeamSheetHtml(
  slots: readonly TeamSlot[],
  audience: "open" | "staff",
  rules: LegalityRules,
  registration: RegistrationFields = {},
): string {
  const issues = validateTeam(slots, rules);
  if (audience === "staff") {
    slots.forEach((slot, index) => {
      if (!slot.nature)
        issues.push({
          code: "nature-required",
          slot: index + 1,
          message: `Slot ${index + 1}: nature is required for the staff sheet`,
        });
      if (!slot.statPoints)
        issues.push({
          code: "stat-points-required",
          slot: index + 1,
          message: `Slot ${index + 1}: stat points are required for the staff sheet`,
        });
    });
  }
  if (issues.length)
    throw new Error(issues.map(({ message }) => message).join("; "));
  const showTera = (rules.allowedTeraTypes?.length ?? 0) > 0;
  const privateHeaders =
    audience === "staff" ? "<th>Nature</th><th>Stat Points</th>" : "";
  const rows = slots
    .map(
      (slot) =>
        `<tr><th scope="row">${display(slot.species)}</th><td>${display(slot.item)}</td><td>${display(slot.ability)}</td>${showTera ? `<td>${display(slot.teraType)}</td>` : ""}<td>${slot.moves.map(escapeHtml).join("<br>")}</td>${audience === "staff" ? `<td>${display(slot.nature)}</td><td>${escapeHtml(statPointText(slot.statPoints))}</td>` : ""}</tr>`,
    )
    .join("");
  const registrationRows = Object.entries(registration)
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label.replace(/([A-Z])/g, " $1"))}</dt><dd>${display(value)}</dd></div>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${audience === "staff" ? "Staff" : "Open"} Team Sheet</title><style>@page{size:landscape;margin:12mm}body{font:12px system-ui,sans-serif;color:#111}h1{font-size:20px}dl{display:flex;gap:24px}dt{font-weight:700;text-transform:capitalize}dd{margin:2px 0}table{border-collapse:collapse;width:100%}th,td{border:1px solid #555;padding:7px;text-align:left;vertical-align:top}thead{background:#eee}</style></head><body><main><h1>${audience === "staff" ? "Staff" : "Open"} Team Sheet</h1><p>Regulation: ${escapeHtml(rules.regulation)}</p>${registrationRows ? `<dl>${registrationRows}</dl>` : ""}<table><thead><tr><th>Pokémon</th><th>Item</th><th>Ability</th>${showTera ? "<th>Tera Type</th>" : ""}<th>Moves</th>${privateHeaders}</tr></thead><tbody>${rows}</tbody></table></main></body></html>`;
}

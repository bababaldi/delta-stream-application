import "./styles.css";
import { startOfflineApp } from "./pwa.js";
import snapshotData from "../data/snapshot.json" with { type: "json" };
import legalityData from "../data/legality.json" with { type: "json" };
import roleData from "../data/roles.json" with { type: "json" };
import {
  calculateDamage,
  NEUTRAL_NATURE,
  solveDefensiveSpread,
  solveOffensiveSpread,
  type ChampionsPokemon,
  type DamageModifiers,
  type IncomingAttack,
  type Move,
  type SpreadResult,
  type StatTable,
} from "./calculator.js";
import {
  canonicalPokemonName,
  rankMeta,
  type MetaSnapshot,
  type RankedEntry,
  type Region,
  type TeamMember,
  type TournamentData,
} from "./meta.js";
import { CHAMPIONS_ITEMS } from "./items.js";
import {
  bundledSpriteUrl,
  itemVisual,
  pokemonPickerOptions,
  pokemonVisual,
} from "./pokedex.js";
import {
  recommendTeam,
  tournamentArchetypeCores,
  tournamentSetEvidence,
  type RoleProfile,
  type TeamCompletion,
} from "./assistant.js";
import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  parsePokepaste,
  renderTeamSheetHtml,
  validateTeam,
  legalityCatalogErrors,
  type LegalityRules,
  type TeamSlot,
} from "./team.js";

type Tab = "meta" | "calc" | "teams" | "assist";
type RankingKind = "pokemon" | "cores" | "teams";
type CalcGoal = "survive-one" | "survive-two" | "ko";

const snapshot = snapshotData as MetaSnapshot;
const rules = legalityData as LegalityRules;
const profiles = roleData.profiles as RoleProfile[];
const hasLegalityCatalog =
  rules.regulation === snapshot.activeRegulation &&
  legalityCatalogErrors(rules).length === 0;
const hasRoleCatalog = profiles.length > 0;
const nativePrint = registerPlugin<{
  print(options: { html: string }): Promise<void>;
}>("NativePrint");
const app =
  document.querySelector<HTMLDivElement>("#app") ??
  (() => {
    throw new Error("App root is missing");
  })();

let storageError = "";
function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    storageError =
      "Local storage is unavailable. Drafts will last only until this app closes; copy them before leaving.";
    return "";
  }
}
function saveDraft(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    storageError =
      "Draft could not be saved. Keep this screen open and copy your text before closing the app.";
  }
  const feedback = app.querySelector<HTMLElement>("#storage-feedback");
  if (feedback) {
    feedback.textContent = storageError;
    feedback.hidden = !storageError;
  }
}
const calcDraft = new Map<string, string | boolean>();
let calcResult = "";

const state: {
  tab: Tab;
  rankingKind: RankingKind;
  regions: Set<Region>;
  teamText: string;
  team: TeamSlot[];
  assistantText: string;
  completions: TeamCompletion[];
  message: string;
} = {
  tab: "meta",
  rankingKind: "pokemon",
  regions: new Set(["NA", "EU", "OCE", "OTHER"]),
  teamText: readDraft("delta-stream-team"),
  team: [],
  assistantText: readDraft("delta-stream-assist"),
  completions: [],
  message: "",
};

state.team = parsePokepaste(state.teamText).slots;

const icon = {
  meta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></svg>',
  calc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M7 6.5h10M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h4"/></svg>',
  teams:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l2 3v15H6V6l2-3Z"/><path d="M9 3v4h6V3M9 12h6M9 16h6"/></svg>',
  assist:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7v5c0 4.6 3.4 7.7 8 9 4.6-1.3 8-4.4 8-9V7l-8-4Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>',
} as const;

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setMarkup(element: Element, markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  element.replaceChildren(...parsed.body.childNodes);
}

function alertNode(title: string, message: string): HTMLDivElement {
  const alert = document.createElement("div");
  const strong = document.createElement("strong");
  const detail = document.createElement("span");
  alert.className = "inline-alert";
  alert.role = "alert";
  strong.textContent = title;
  detail.textContent = message;
  alert.append(strong, detail);
  return alert;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) || date.getUTCFullYear() === 1970
    ? "Not built"
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function shell(content: string): string {
  const labels: Array<[Tab, string]> = [
    ["meta", "Meta"],
    ["calc", "Calc"],
    ["teams", "Teams"],
    ["assist", "Assist"],
  ];
  const nav = labels
    .map(
      ([tab, label]) =>
        `<button class="nav-item" type="button" data-tab="${tab}" ${state.tab === tab ? 'aria-current="page"' : ""}>${icon[tab]}<span>${label}</span></button>`,
    )
    .join("");
  return `<div class="app-shell"><header class="app-bar"><img src="${import.meta.env.BASE_URL}delta-stream.jpg" alt="" width="48" height="48"><div><strong>Delta Stream VGC</strong><span>${escapeHtml(snapshot.activeRegulation.replaceAll("-", " "))}</span></div><span class="offline-badge">Local data</span></header><nav class="primary-nav" aria-label="Primary">${nav}</nav><main id="main" tabindex="-1"><p id="storage-feedback" role="status" class="status-line warning" ${storageError ? "" : "hidden"}>${escapeHtml(storageError)}</p><p id="feedback" role="status" ${state.message ? "" : "hidden"}>${escapeHtml(state.message)}</p>${content}</main></div>`;
}

function emptyState(title: string, body: string): string {
  return `<section class="empty-state" aria-labelledby="empty-title"><h2 id="empty-title">${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></section>`;
}

function pokemonSprite(name: string, className = "pokemon-sprite"): string {
  const visual = pokemonVisual(name);
  return visual
    ? `<img class="${className}" src="${escapeHtml(bundledSpriteUrl(visual.sprite))}" alt="" width="40" height="40" loading="lazy">`
    : `<span class="${className} sprite-fallback" aria-hidden="true">?</span>`;
}

function itemSprite(item: string | undefined): string {
  const visual = itemVisual(item);
  return visual?.sprite
    ? `<img class="item-sprite" src="${escapeHtml(bundledSpriteUrl(visual.sprite))}" alt="" width="24" height="24" loading="lazy">`
    : `<span class="item-sprite sprite-fallback" aria-hidden="true">?</span>`;
}

function rankSprites(names: readonly string[]): string {
  return `<span class="rank-sprites" role="img" aria-label="${escapeHtml(names.join(" + "))}">${names.map((name) => pokemonSprite(name)).join("")}</span>`;
}

function setPreview(member: TeamMember): string {
  const item = member.item ?? "No item published";
  const ability = member.ability ?? "No ability published";
  const nature = member.nature ?? "Nature not published";
  const moves = member.moves ?? [];
  const summary = moves.length
    ? `${member.pokemon}. Item: ${item}. Ability: ${ability}. Nature: ${nature}. Moves: ${moves.join(", ")}.`
    : `${member.pokemon}. Roster-only source; no item, ability, nature, or moves were published.`;
  return `<div class="set-preview" data-set-preview tabindex="0" role="group" aria-label="${escapeHtml(summary)}"><span class="set-sprite">${pokemonSprite(member.pokemon)}</span><span class="held-item">${member.item ? itemSprite(member.item) : ""}</span><div class="set-popover" aria-hidden="true"><strong>${escapeHtml(member.pokemon)}</strong><span>${escapeHtml(item)} · ${escapeHtml(ability)} · ${escapeHtml(nature)}</span>${moves.length ? `<ul>${moves.map((move) => `<li>${escapeHtml(move)}</li>`).join("")}</ul>` : "<p>Roster only — set not published.</p>"}</div></div>`;
}

type EvidenceTeam = {
  event: TournamentData["event"];
  team: TournamentData["teams"][number];
};

function matchingEvidenceTeams(entry: RankedEntry): EvidenceTeam[] {
  const ranked = entry.pokemon
    .map(canonicalPokemonName)
    .sort((left, right) => left.localeCompare(right));
  return snapshot.tournaments
    .flatMap(({ event, teams }) =>
      teams.flatMap((team) => {
        const members = team.roster
          .map(({ pokemon }) => canonicalPokemonName(pokemon))
          .sort((left, right) => left.localeCompare(right));
        let matches = members.length === ranked.length &&
          members.every((name, index) => name === ranked[index]);
        if (state.rankingKind === "pokemon")
          matches = members.includes(ranked[0] ?? "");
        else if (state.rankingKind === "cores")
          matches = ranked.every((name) => members.includes(name));
        return matches ? [{ event, team }] : [];
      }),
    )
    .sort(
      (left, right) =>
        Number(right.team.roster.some((member) => member.moves?.length)) -
          Number(left.team.roster.some((member) => member.moves?.length)) ||
        (left.team.publishedPlacement ?? left.team.placement) -
          (right.team.publishedPlacement ?? right.team.placement) ||
        right.event.date.localeCompare(left.event.date) ||
        left.team.player.localeCompare(right.team.player),
    );
}

function evidenceTeamRows(teams: readonly EvidenceTeam[]): string {
  return teams
    .map(({ event, team }) => `<li><div class="evidence-team-heading"><strong>${escapeHtml(team.player)}</strong><span>${escapeHtml(event.name)} · ${team.publishedPlacement ? `Placement #${team.publishedPlacement}` : `Top ${team.placement}`}</span></div><div class="visual-team">${team.roster.map(setPreview).join("")}</div></li>`)
    .join("");
}

function evidenceTeams(entry: RankedEntry): string {
  const teams = matchingEvidenceTeams(entry);
  if (!teams.length) return "";
  const visible = teams.slice(0, 6);
  const remaining = teams.slice(6);
  return `<p class="set-help">Hover or focus a Pokémon to inspect its published item and four moves. Roster-only evidence stays explicitly unknown.</p><ol class="evidence-team-list">${evidenceTeamRows(visible)}</ol>${remaining.length ? `<details class="evidence-more"><summary>Show ${remaining.length} more supporting team${remaining.length === 1 ? "" : "s"}</summary><ol class="evidence-team-list">${evidenceTeamRows(remaining)}</ol></details>` : ""}`;
}

function metaView(): string {
  const rankings = rankMeta(
    snapshot,
    snapshot.activeRegulation,
    new Date(),
    state.regions,
  );
  const entries = rankings[state.rankingKind];
  const filters = (["NA", "EU", "LATAM", "OCE", "ASIA", "OTHER"] as Region[])
    .map(
      (region) =>
        `<label class="filter-chip"><input type="checkbox" data-region="${region}" ${state.regions.has(region) ? "checked" : ""}><span>${region}</span></label>`,
    )
    .join("");
  const categories = (["pokemon", "cores", "teams"] as RankingKind[])
    .map(
      (kind) =>
        `<button type="button" data-ranking-kind="${kind}" aria-pressed="${state.rankingKind === kind}">${kind === "cores" ? "Cores 2–4" : kind[0]?.toUpperCase() + kind.slice(1)}</button>`,
    )
    .join("");
  const rows = entries
    .map(
      (entry, index) =>
        `<details class="ranking-row"><summary><span class="rank">${String(index + 1).padStart(2, "0")}</span><span class="rank-name">${rankSprites(entry.pokemon)}<small>${entry.teamCount} team${entry.teamCount === 1 ? "" : "s"} · ${entry.eventCount} event${entry.eventCount === 1 ? "" : "s"}${entry.localEvidenceTeams ? ` · ${entry.localEvidenceTeams} Italian local` : ""}</small></span><span class="rank-score">${entry.score.toFixed(1)}<small>score</small></span><span class="confidence ${entry.confidence}">${entry.confidence === "strong" ? "● Strong" : "○ Emerging"}</span></summary><div class="evidence"><p><strong>Evidence</strong> Placement × event tier × recency. Verified Victory Road x-0/x-1 records use 2×/1.75×; Italian VG Cup/Challenge winners are low-weight (0.125×) potential x-2 evidence only. Regulations never mix. Roster-only results do not provide usable moves, abilities or items.</p>${entry.pikalyticsUsage === undefined ? "" : `<p>Pikalytics usage: ${entry.pikalyticsUsage.toFixed(1)}% (tie-break only).</p>`}${evidenceTeams(entry)}</div></details>`,
    )
    .join("");
  return `<section aria-labelledby="meta-title"><div class="screen-heading"><div><p class="board-status">Meta updated · ${escapeHtml(formatDate(snapshot.generatedAt))}</p><h1 id="meta-title">Tournament board</h1></div><span class="reg-stamp">${escapeHtml(snapshot.activeRegulation.replace("champions-regulation-", "REG ").toUpperCase())}</span></div><div class="toolbar"><div class="segmented" aria-label="Ranking type">${categories}</div><fieldset class="filter-row"><legend>Regions</legend>${filters}</fieldset></div>${entries.length ? `<div class="ranking-board">${rows}</div>` : emptyState(snapshot.tournaments.length ? "No results for these filters" : "No approved results", snapshot.tournaments.length ? "Select at least one region with approved results." : "The owner needs to approve completed events and publish a new data snapshot. No results have been invented.")}</section>`;
}

function inputField(
  label: string,
  name: string,
  value: number,
  min = 0,
  max = 255,
): string {
  return `<label><span>${label}</span><input type="number" name="${name}" value="${value}" min="${min}" max="${max}" inputmode="numeric" required></label>`;
}

function itemOptions(): string {
  return `<option value="">None</option>${CHAMPIONS_ITEMS.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`;
}

const pokemonTypes = ["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"];

function calcGoal(): CalcGoal {
  if (calcDraft.get("goal") === "survive-one") return "survive-one";
  return calcDraft.get("goal") === "ko" ? "ko" : "survive-two";
}

function pokemonOptions(): string {
  return `<datalist id="pokemon-options">${pokemonPickerOptions.map((pokemon) => `<option value="${escapeHtml(pokemon.name)}"></option>`).join("")}</datalist>`;
}

function pokemonPicker(side: "attacker" | "defender"): string {
  const name = `${side}Name`;
  const fallback = side === "attacker" ? "Attacker" : "Defender";
  const value = String(calcDraft.get(name) ?? fallback);
  const visual = pokemonVisual(value);
  const stats = visual
    ? `PokeAPI base stats for ${visual.name}: HP ${visual.baseStats.hp} · Atk ${visual.baseStats.attack} · Def ${visual.baseStats.defense} · SpA ${visual.baseStats.specialAttack} · SpD ${visual.baseStats.specialDefense} · Spe ${visual.baseStats.speed}`
    : "Choose a form with bundled exact PokeAPI base stats.";
  return `<label class="pokemon-picker"><span>${side === "attacker" ? "Attacker Pokémon" : "Defender Pokémon"}</span><span class="pokemon-picker-control"><img data-pokemon-sprite="${side}" class="calculator-sprite" ${visual ? `src="${escapeHtml(bundledSpriteUrl(visual.sprite))}"` : ""} alt="" width="48" height="48" ${visual ? "" : "hidden"}><span data-pokemon-fallback="${side}" class="calculator-sprite sprite-fallback" aria-hidden="true" ${visual ? "hidden" : ""}>?</span><input name="${name}" data-pokemon-picker="${side}" list="pokemon-options" value="${escapeHtml(value)}" maxlength="60" autocomplete="off" spellcheck="false"></span><small data-pokemon-status="${side}">${escapeHtml(stats)}</small></label>`;
}

function moveFields(number: 1 | 2): string {
  const prefix = `move${number}`;
  return `<fieldset class="move-step"><legend>Attack ${number}</legend><div class="form-grid"><label><span>Move name (optional)</span><input name="${prefix}Name" maxlength="60"></label><label><span>Move type</span><select name="${prefix}Type"><option value="">Unknown / not set</option>${pokemonTypes.map((type) => `<option>${type}</option>`).join("")}</select></label><label><span>Category</span><select name="${prefix}Category"><option value="physical">Physical</option><option value="special">Special</option></select></label>${inputField("Power", `${prefix}Power`, 100, 1, 999)}${inputField("Attack stage", `${prefix}AttackStage`, 0, -6, 6)}${inputField("Defense stage", `${prefix}DefenseStage`, 0, -6, 6)}<label><span>STAB</span><select name="${prefix}Stab"><option value="1">None</option><option value="1.2">1.2×</option><option value="1.5" selected>1.5×</option><option value="2">2×</option></select></label><label><span>Effectiveness</span><select name="${prefix}Effectiveness"><option value="0">Immune</option><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label><label><span>Weather</span><select name="${prefix}Weather"><option value="1">Neutral</option><option value="1.5">Boosted</option><option value="0.5">Reduced</option></select></label><label class="check-row"><input type="checkbox" name="${prefix}Spread"><span>Spread move</span></label><label class="check-row"><input type="checkbox" name="${prefix}Burned"><span>Attacker burned</span></label><label class="check-row"><input type="checkbox" name="${prefix}HelpingHand"><span>Helping Hand</span></label></div></fieldset>`;
}

function calcView(): string {
  const goal = calcGoal();
  const singleHit = goal === "survive-one";
  return `<section aria-labelledby="calc-title"><div class="screen-heading"><div><p class="board-status">Normal rolls · no critical hits</p><h1 id="calc-title">Damage calculator</h1></div></div><p class="status-line warning">Level 50, neutral natures and full HP. Selecting a legal Pokémon or form loads its bundled PokeAPI base stats; mechanics outside the documented calculator support remain manual.</p><form id="calc-form">${pokemonOptions()}<div class="goal-row"><label><span>Solver goal</span><select name="goal"><option value="survive-one" ${goal === "survive-one" ? "selected" : ""}>Survive one hit (15/16 rolls)</option><option value="survive-two" ${goal === "survive-two" ? "selected" : ""}>Survive both maximum rolls</option><option value="ko" ${goal === "ko" ? "selected" : ""}>Guarantee knockout with both minimum rolls</option></select></label></div>${singleHit ? '<p class="status-line warning">Single-hit mode accepts the sole 6.25% maximum normal-damage roll; critical hits are not simulated.</p>' : ""}<section class="form-section" aria-labelledby="stats-title"><h2 id="stats-title">Combatants</h2><div class="form-grid stats-grid">${inputField("Attacker Attack base", "attackBase", 100, 1)}${inputField("Attacker Sp. Atk base", "specialAttackBase", 100, 1)}${inputField("Fixed Attack points", "attackPoints", 32, 0, 32)}${inputField("Fixed Sp. Atk points", "specialAttackPoints", 32, 0, 32)}${inputField("Defender HP base", "hpBase", 100, 1)}${inputField("Defender Defense base", "defenseBase", 100, 1)}${inputField("Defender Sp. Def base", "specialDefenseBase", 100, 1)}${inputField("Fixed HP points", "hpPoints", 0, 0, 32)}${inputField("Fixed Defense points", "defensePoints", 0, 0, 32)}${inputField("Fixed Sp. Def points", "specialDefensePoints", 0, 0, 32)}${pokemonPicker("attacker")}${pokemonPicker("defender")}<label><span>Attacker ability</span><select name="attackerAbility"><option value="">None / manual</option><option>Technician</option></select></label><label><span>Attacker item</span><select name="attackerItem">${itemOptions()}</select></label><label><span>Defender item</span><select name="defenderItem">${itemOptions()}</select></label><label><span>Terrain (for seeds)</span><select name="terrain"><option value="">None</option><option>Electric</option><option>Grassy</option><option>Misty</option><option>Psychic</option></select></label></div></section><div class="move-grid">${moveFields(1)}${singleHit ? "" : moveFields(2)}</div><button class="primary-action" type="submit">Calculate spreads</button></form><div id="calc-result" class="result-region" aria-live="polite">${calcResult}</div></section>`;
}

function baseStats(partial: Partial<StatTable>): StatTable {
  return {
    hp: 100,
    attack: 100,
    defense: 100,
    specialAttack: 100,
    specialDefense: 100,
    speed: 100,
    ...partial,
  };
}

function numberValue(data: FormData, name: string): number {
  const raw = data.get(name);
  if (typeof raw !== "string" || !raw.trim() || !Number.isFinite(Number(raw)))
    throw new RangeError(`Missing or invalid ${name}`);
  return Number(raw);
}

function moveFromForm(
  data: FormData,
  number: 1 | 2,
): { move: Move; modifiers: DamageModifiers } {
  const prefix = `move${number}`;
  return {
    move: {
      name: String(data.get(`${prefix}Name`) || `Attack ${number}`),
      category: String(data.get(`${prefix}Category`)) as "physical" | "special",
      ...(String(data.get(`${prefix}Type`)) ? { type: String(data.get(`${prefix}Type`)) as Move["type"] } : {}),
      power: numberValue(data, `${prefix}Power`),
      spread: data.has(`${prefix}Spread`),
    },
    modifiers: {
      attackStage: numberValue(data, `${prefix}AttackStage`),
      defenseStage: numberValue(data, `${prefix}DefenseStage`),
      stab: numberValue(data, `${prefix}Stab`),
      effectiveness: numberValue(data, `${prefix}Effectiveness`),
      weather: numberValue(data, `${prefix}Weather`) as 0.5 | 1 | 1.5,
      burned: data.has(`${prefix}Burned`),
      helpingHand: data.has(`${prefix}HelpingHand`),
      ...(String(data.get("terrain")) ? { terrain: String(data.get("terrain")) as DamageModifiers["terrain"] } : {}),
    },
  };
}

function pokemon(
  name: string,
  stats: Partial<StatTable>,
  points: Partial<StatTable>,
  ability?: ChampionsPokemon["ability"],
  item?: ChampionsPokemon["item"],
): ChampionsPokemon {
  return {
    name,
    ability,
    item,
    baseStats: baseStats(stats),
    statPoints: points,
    nature: NEUTRAL_NATURE,
  };
}

function calculateFromForm(form: HTMLFormElement): string {
  const data = new FormData(form);
  const goal = String(data.get("goal")) as CalcGoal;
  if (!["survive-one", "survive-two", "ko"].includes(goal))
    throw new RangeError("Invalid solver goal");
  const singleHit = goal === "survive-one";
  const defensive = goal !== "ko";
  const firstMove = moveFromForm(data, 1);
  const secondMove = singleHit ? undefined : moveFromForm(data, 2);
  const moves = secondMove ? [firstMove, secondMove] : [firstMove];
  const attackerStats = {
    attack: numberValue(data, "attackBase"),
    specialAttack: numberValue(data, "specialAttackBase"),
  };
  const defenderStats = {
    hp: numberValue(data, "hpBase"),
    defense: numberValue(data, "defenseBase"),
    specialDefense: numberValue(data, "specialDefenseBase"),
  };
  const attackerPoints = {
    attack: numberValue(data, "attackPoints"),
    specialAttack: numberValue(data, "specialAttackPoints"),
  };
  const defenderPoints = {
    hp: numberValue(data, "hpPoints"),
    defense: numberValue(data, "defensePoints"),
    specialDefense: numberValue(data, "specialDefensePoints"),
  };
  const attacker = pokemon(
    String(data.get("attackerName") || "Attacker"),
    attackerStats,
    defensive ? attackerPoints : {},
    String(data.get("attackerAbility")) as ChampionsPokemon["ability"],
    (String(data.get("attackerItem")) || undefined) as ChampionsPokemon["item"],
  );
  const defender = pokemon(
    String(data.get("defenderName") || "Defender"),
    defenderStats,
    goal === "ko" ? defenderPoints : {},
    undefined,
    (String(data.get("defenderItem")) || undefined) as ChampionsPokemon["item"],
  );
  const direct = moves.map(({ move, modifiers }) =>
    calculateDamage({ attacker, defender, move, modifiers }),
  );
  let result: SpreadResult;
  if (defensive) {
    const attacks: [IncomingAttack] | [IncomingAttack, IncomingAttack] = secondMove
      ? [
          { attacker, move: firstMove.move, modifiers: firstMove.modifiers },
          { attacker, move: secondMove.move, modifiers: secondMove.modifiers },
        ]
      : [{ attacker, move: firstMove.move, modifiers: firstMove.modifiers }];
    result = solveDefensiveSpread({
      defender: { name: defender.name, baseStats: defender.baseStats, item: defender.item },
      attacks,
    });
  } else {
    if (!secondMove) throw new RangeError("Knockout mode needs two attacks");
    result = solveOffensiveSpread({
      attacker: { name: attacker.name, baseStats: attacker.baseStats, ability: attacker.ability, item: attacker.item },
      attacks: [
        { defender, move: firstMove.move, modifiers: firstMove.modifiers },
        { defender, move: secondMove.move, modifiers: secondMove.modifiers },
      ],
    });
  }
  const firstDamage = direct[0];
  const toleratedSingleRoll = firstDamage?.rolls.length === 16
    ? firstDamage.rolls.at(-2) ?? firstDamage.max
    : firstDamage?.max ?? 0;
  let checkValue: number;
  let checkLabel: string;
  if (singleHit) {
    checkValue = toleratedSingleRoll;
    checkLabel = "15/16 roll";
  } else if (defensive) {
    checkValue = direct.reduce((sum, damage) => sum + damage.max, 0);
    checkLabel = "Maximum total";
  } else {
    checkValue = direct.reduce((sum, damage) => sum + damage.min, 0);
    checkLabel = "Minimum total";
  }
  const summary = `<p>Baseline damage with zero investment on the optimized side (not the spreads below).</p><div class="damage-summary ${singleHit ? "single-hit-summary" : ""}">${direct.map((damage, index) => `<div><strong>${damage.min}–${damage.max}</strong><span>Attack ${index + 1}</span></div>`).join("")}<div><strong>${checkValue}</strong><span>${checkLabel}</span></div></div>${singleHit ? '<p class="status-line warning">15 of 16 normal damage rolls must survive. The single maximum roll is tolerated; critical hits are not simulated.</p>' : ""}`;
  const notes = [...new Set(direct.flatMap(({ notes }) => notes))];
  const itemNotice = notes.length
    ? `<p class="status-line warning">${notes.map(escapeHtml).join(" · ")}</p>`
    : "";
  if (!result.possible)
    return `${summary}${itemNotice}<div class="inline-alert" role="status"><strong>Impossible</strong><span>${escapeHtml(result.reason)}</span></div>`;
  const rows = result.options
    .map(
      (option) =>
        `<tr><td>${escapeHtml(option.nature.name)}</td><td>${Object.entries(
          option.statPoints,
        )
          .map(([stat, points]) => `${escapeHtml(stat)} ${points}`)
          .join(
            " · ",
          )}</td><td>${option.totalInvested}</td><td>${option.remaining}</td><td>${option.margin}</td></tr>`,
    )
    .join("");
  return `${summary}${itemNotice}<div class="result-table"><h2>Non-dominated spreads</h2><div class="table-scroll"><table><thead><tr><th>Nature</th><th>Stat points</th><th>Used</th><th>Left</th><th>Margin</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function teamRows(team: readonly TeamSlot[]): string {
  return team
    .map(
      (slot, index) =>
        `<li><span class="rank">${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(slot.species || "Missing species")}</strong><span>${escapeHtml(slot.item ?? "No item")} · ${escapeHtml(slot.ability ?? "Missing ability")}${slot.teraType ? ` · Tera ${escapeHtml(slot.teraType)}` : ""}</span><small>${slot.moves.map(escapeHtml).join(" · ") || "No moves"}</small></div></li>`,
    )
    .join("");
}

function teamsView(): string {
  const catalogNotice = hasLegalityCatalog
    ? '<p class="status-line success">Regulation legality catalog loaded</p>'
    : '<p class="status-line warning">Legality catalog is missing, incomplete or uses a different regulation. PDF export is disabled.</p>';
  const parsed = state.team.length
    ? `<ol class="team-list">${teamRows(state.team)}</ol><section class="registration" aria-labelledby="registration-title"><h2 id="registration-title">One-time registration fields</h2><p>These values are sent only to the print sheet and are not saved.</p><div class="form-grid"><label><span>Player name</span><input id="player-name" autocomplete="off"></label><label><span>Player ID</span><input id="player-id" inputmode="numeric" autocomplete="off"></label><label><span>Team name</span><input id="team-name" autocomplete="off"></label></div><div class="action-row"><button type="button" data-print="open" ${hasLegalityCatalog ? "" : "disabled"}>Print / save open PDF</button><button type="button" data-print="staff" ${hasLegalityCatalog ? "" : "disabled"}>Print / save staff PDF</button></div></section>`
    : emptyState(
        "Paste a team to begin",
        "Use Poképaste with Ability, SPs or EVs (0–32 Champions points), Nature, and one to four moves. Tera Type is used only if the regulation enables it.",
      );
  return `<section aria-labelledby="teams-title"><div class="screen-heading"><div><p class="board-status">Local draft · never uploaded</p><h1 id="teams-title">Team sheet</h1></div></div>${catalogNotice}<form id="team-form"><label class="textarea-label"><span>Poképaste</span><textarea name="paste" rows="12" spellcheck="false" placeholder="Pokémon @ Item&#10;Ability: …&#10;EVs: 32 HP / 32 SpD / 2 Spe&#10;Calm Nature&#10;- Move">${escapeHtml(state.teamText)}</textarea></label><button class="primary-action" type="submit">Parse team</button></form><div id="team-result" aria-live="polite">${parsed}</div></section>`;
}

function completionMarkup(completion: TeamCompletion, index: number): string {
  const uncovered = [
    ...completion.uncoveredRoles.map((role) => `Role: ${role}`),
    ...completion.uncoveredThreats.map((threat) => `Threat: ${threat}`),
  ];
  return `<details class="completion" ${index === 0 ? "open" : ""}><summary><span>Option ${index + 1}</span><strong>${completion.score.toFixed(2)}</strong><small>Role data ${escapeHtml(completion.roleVersion)}</small></summary><ol class="team-list">${teamRows(completion.slots)}</ol>${completion.reasons.map((entry) => `<div class="reason"><strong>${escapeHtml(entry.pokemon)}</strong><ul>${entry.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></div>`).join("")}${uncovered.length ? `<p class="status-line warning">▲ Still uncovered: ${uncovered.map(escapeHtml).join(" · ")}</p>` : '<p class="status-line success">● All configured roles and threats covered</p>'}</details>`;
}

function assistView(): string {
  const blockers = [
    ...(snapshot.tournaments.length ? [] : ["approved tournament results"]),
    ...(hasLegalityCatalog ? [] : ["legality catalog"]),
    ...(hasRoleCatalog ? [] : ["versioned role/threat catalog"]),
  ];
  const readiness = blockers.length
    ? `<p class="status-line warning">▲ Complete data setup before recommending: ${blockers.map(escapeHtml).join(", ")}.</p>`
    : '<p class="status-line success">● Regulation evidence and constraints loaded</p>';
  const coverageNote = roleData.coverageDefinition
    ? `<p class="status-line">Coverage scope: ${escapeHtml(roleData.coverageDefinition)}</p>`
    : "";
  const results = state.completions.length
    ? state.completions.map(completionMarkup).join("")
    : emptyState(
        "No completion yet",
        "Lock one to five Pokémon with Poképaste. SPs or standard EVs labels are accepted; recommendations preserve every supplied field.",
      );
  return `<section aria-labelledby="assist-title"><div class="screen-heading"><div><p class="board-status">Deterministic · no simulation or LLM</p><h1 id="assist-title">Team assist</h1></div></div>${readiness}${coverageNote}<form id="assist-form"><label class="textarea-label"><span>Locked slots (1–5)</span><textarea name="paste" rows="10" spellcheck="false" placeholder="Paste one to five complete sets">${escapeHtml(state.assistantText)}</textarea></label><button class="primary-action" type="submit" ${blockers.length ? "disabled" : ""}>Rank completions</button></form><div id="assist-result" aria-live="polite">${results}</div></section>`;
}

function render(): void {
  const views: Record<Tab, () => string> = {
    meta: metaView,
    calc: calcView,
    teams: teamsView,
    assist: assistView,
  };
  setMarkup(app, shell(views[state.tab]()));
  for (const field of app.querySelectorAll<
    HTMLInputElement | HTMLSelectElement
  >("#calc-form [name]")) {
    const value = calcDraft.get(field.name);
    if (value === undefined) continue;
    if (field instanceof HTMLInputElement && field.type === "checkbox")
      field.checked = value === true;
    else field.value = String(value);
  }
  bindEvents();
}

async function printHtml(html: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await nativePrint.print({ html });
    return;
  }
  const frame = document.createElement("iframe");
  frame.className = "print-frame";
  frame.title = "Printable team sheet";
  document.body.append(frame);
  const target = frame.contentWindow;
  if (!target) throw new Error("Print preview is unavailable");
  frame.addEventListener(
    "load",
    () => {
      target.focus();
      target.print();
      window.setTimeout(() => frame.remove(), 1000);
    },
    { once: true },
  );
  target.document.open();
  target.document.write(html);
  target.document.close();
}

function applyPokemonPicker(input: HTMLInputElement): void {
  const side = input.dataset.pokemonPicker as "attacker" | "defender" | undefined;
  if (!side) return;
  const visual = pokemonVisual(input.value);
  const form = input.form;
  const image = form?.querySelector<HTMLImageElement>(`[data-pokemon-sprite="${side}"]`);
  const fallback = form?.querySelector<HTMLElement>(`[data-pokemon-fallback="${side}"]`);
  const status = form?.querySelector<HTMLElement>(`[data-pokemon-status="${side}"]`);
  if (!visual) {
    image?.removeAttribute("src");
    if (image) image.hidden = true;
    if (fallback) fallback.hidden = false;
    if (status)
      status.textContent = "Choose a form with bundled exact PokeAPI base stats.";
    return;
  }
  if (image) {
    image.src = bundledSpriteUrl(visual.sprite);
    image.hidden = false;
  }
  if (fallback) fallback.hidden = true;
  if (status)
    status.textContent = `PokeAPI base stats: HP ${visual.baseStats.hp} · Atk ${visual.baseStats.attack} · Def ${visual.baseStats.defense} · SpA ${visual.baseStats.specialAttack} · SpD ${visual.baseStats.specialDefense} · Spe ${visual.baseStats.speed}`;
  const fields = side === "attacker"
    ? [["attackBase", visual.baseStats.attack], ["specialAttackBase", visual.baseStats.specialAttack]] as const
    : [["hpBase", visual.baseStats.hp], ["defenseBase", visual.baseStats.defense], ["specialDefenseBase", visual.baseStats.specialDefense]] as const;
  for (const [name, value] of fields) {
    const field = form?.elements.namedItem(name);
    if (field instanceof HTMLInputElement) field.value = String(value);
    calcDraft.set(name, String(value));
  }
}

function bindEvents(): void {
  for (const id of ["team-form", "assist-form"]) {
    const textarea = app.querySelector<HTMLTextAreaElement>(`#${id} textarea`);
    textarea?.addEventListener("input", () => {
      const isTeam = id === "team-form";
      if (isTeam) state.teamText = textarea.value;
      else {
        state.assistantText = textarea.value;
        state.completions = [];
      }
      saveDraft(
        isTeam ? "delta-stream-team" : "delta-stream-assist",
        textarea.value,
      );
    });
  }
  const calcForm = app.querySelector<HTMLFormElement>("#calc-form");
  calcForm?.addEventListener("input", () => {
    for (const field of app.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("#calc-form [name]")) {
      calcDraft.set(
        field.name,
        field instanceof HTMLInputElement && field.type === "checkbox"
          ? field.checked
          : field.value,
      );
    }
    calcResult = "";
    app.querySelector("#calc-result")?.replaceChildren();
  });
  for (const picker of app.querySelectorAll<HTMLInputElement>(
    "#calc-form [data-pokemon-picker]",
  )) {
    picker.addEventListener("input", () => applyPokemonPicker(picker));
  }
  calcForm?.querySelector<HTMLSelectElement>("[name=goal]")?.addEventListener(
    "change",
    (event) => {
      const goal = event.currentTarget;
      if (!(goal instanceof HTMLSelectElement)) return;
      calcDraft.set("goal", goal.value);
      calcResult = "";
      render();
      app.querySelector<HTMLSelectElement>("#calc-form [name=goal]")?.focus();
    },
  );
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab as Tab;
      state.message = "";
      render();
      app.querySelector<HTMLElement>("#main")?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    });
  }
  for (const button of app.querySelectorAll<HTMLButtonElement>(
    "[data-ranking-kind]",
  )) {
    button.addEventListener("click", () => {
      state.rankingKind = button.dataset.rankingKind as RankingKind;
      render();
      app
        .querySelector<HTMLElement>(
          `[data-ranking-kind="${state.rankingKind}"]`,
        )
        ?.focus();
    });
  }
  for (const input of app.querySelectorAll<HTMLInputElement>("[data-region]")) {
    input.addEventListener("change", () => {
      const region = input.dataset.region as Region;
      if (input.checked) state.regions.add(region);
      else state.regions.delete(region);
      render();
      app.querySelector<HTMLElement>(`[data-region="${region}"]`)?.focus();
    });
  }
  app
    .querySelector<HTMLFormElement>("#calc-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const target = app.querySelector<HTMLDivElement>("#calc-result");
      try {
        calcResult = calculateFromForm(event.currentTarget as HTMLFormElement);
        if (target) setMarkup(target, calcResult);
        state.message = "Calculation complete";
      } catch (error) {
        if (target)
          target.replaceChildren(
            alertNode(
              "Check the inputs",
              String(error instanceof Error ? error.message : error),
            ),
          );
      }
    });
  app
    .querySelector<HTMLFormElement>("#team-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = String(
        new FormData(event.currentTarget as HTMLFormElement).get("paste") ?? "",
      );
      const parsed = parsePokepaste(text);
      state.teamText = text;
      state.team = parsed.slots;
      saveDraft("delta-stream-team", text);
      state.message = parsed.warnings.length
        ? parsed.warnings.join(". ")
        : `${parsed.slots.length} slots parsed`;
      render();
    });
  for (const button of app.querySelectorAll<HTMLButtonElement>(
    "[data-print]",
  )) {
    button.addEventListener("click", async () => {
      try {
        state.team = parsePokepaste(state.teamText).slots;
        const issues = validateTeam(state.team, rules);
        if (issues.length)
          throw new Error(issues.map(({ message }) => message).join("; "));
        await printHtml(
          renderTeamSheetHtml(
            state.team,
            button.dataset.print as "open" | "staff",
            rules,
            {
              playerName:
                app.querySelector<HTMLInputElement>("#player-name")?.value,
              playerId:
                app.querySelector<HTMLInputElement>("#player-id")?.value,
              teamName:
                app.querySelector<HTMLInputElement>("#team-name")?.value,
            },
          ),
        );
      } catch (error) {
        state.message = error instanceof Error ? error.message : String(error);
        const target = app.querySelector<HTMLDivElement>("#team-result");
        if (target) target.prepend(alertNode("Cannot export", state.message));
      }
    });
  }
  app
    .querySelector<HTMLFormElement>("#assist-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = String(
        new FormData(event.currentTarget as HTMLFormElement).get("paste") ?? "",
      );
      state.assistantText = text;
      const locked = parsePokepaste(text).slots;
      const result = recommendTeam({
        regulation: snapshot.activeRegulation,
        lockedSlots: locked,
        rankings: rankMeta(snapshot, snapshot.activeRegulation),
        profiles,
        setEvidence: tournamentSetEvidence(snapshot, snapshot.activeRegulation),
        archetypeCores: tournamentArchetypeCores(snapshot, snapshot.activeRegulation),
        rules,
        requiredRoles: roleData.requiredRoles,
        topThreats: roleData.topThreats,
      });
      state.completions = result.completions;
      state.message =
        result.reason ?? `${result.completions.length} completions ranked`;
      render();
    });
}

render();
if (import.meta.env.PROD && !Capacitor.isNativePlatform()) void startOfflineApp(import.meta.env.BASE_URL);

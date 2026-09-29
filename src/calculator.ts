/*
 * Core formula adapted from NCP VGC Damage Calculator (MIT),
 * copyright Honko, Tapin, Firestorm, Jake White, nerd-of-now, and contributors.
 */

export type BattleStat =
  | "hp"
  | "attack"
  | "defense"
  | "specialAttack"
  | "specialDefense"
  | "speed";
export type DamageStat = Exclude<BattleStat, "hp">;
export type MoveCategory = "physical" | "special" | "status";
export type PokemonType =
  | "Normal" | "Fire" | "Water" | "Electric" | "Grass" | "Ice"
  | "Fighting" | "Poison" | "Ground" | "Flying" | "Psychic" | "Bug"
  | "Rock" | "Ghost" | "Dragon" | "Dark" | "Steel" | "Fairy";
export type BattleStatus =
  | "Healthy" | "Burned" | "Poisoned" | "Badly Poisoned" | "Paralyzed" | "Asleep";
export type FieldWeather = "" | "Sun" | "Rain" | "Sand" | "Snow";

import legalityData from "../data/legality.json" with { type: "json" };
import { isChampionsItem, type ChampionsItem } from "./items.js";

export interface StatTable {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
}

export interface Nature {
  name: string;
  plus?: DamageStat;
  minus?: DamageStat;
}

export interface ChampionsPokemon {
  name: string;
  ability?: string;
  item?: ChampionsItem | "";
  baseStats: StatTable;
  statPoints?: Partial<StatTable>;
  nature: Nature;
}

export interface Move {
  name: string;
  power: number;
  category: MoveCategory;
  type?: PokemonType;
  hits?: number;
  spread?: boolean;
  fixedDamage?: number;
  contact?: boolean;
  sound?: boolean;
  bite?: boolean;
  punch?: boolean;
  pulse?: boolean;
  bullet?: boolean;
  wind?: boolean;
  slicing?: boolean;
  secondary?: boolean;
  recoil?: boolean;
  priority?: boolean;
}

export interface DamageModifiers {
  attackStage?: number;
  defenseStage?: number;
  basePower?: number[];
  attack?: number[];
  defense?: number[];
  final?: number[];
  weather?: 0.5 | 1 | 1.5;
  stab?: number;
  effectiveness?: number;
  burned?: boolean;
  helpingHand?: boolean;
  terrain?: "Electric" | "Grassy" | "Misty" | "Psychic";
  fieldWeather?: FieldWeather;
  attackerStatus?: BattleStatus;
  defenderStatus?: BattleStatus;
  attackerHpPercent?: number;
  defenderHpPercent?: number;
  attackerAbilityActive?: boolean;
  attackerMovedLast?: boolean;
  genderRelation?: "same" | "opposite";
  faintedAllies?: number;
  attackerAllyAbility?: "Steely Spirit";
  defenderAllyAbility?: "Friend Guard";
  neutralizingGas?: boolean;
}

export interface DamageInput {
  attacker: ChampionsPokemon;
  defender: ChampionsPokemon;
  move: Move;
  modifiers?: DamageModifiers;
}

export interface DamageResult {
  rolls: number[];
  min: number;
  max: number;
  defenderHp: number;
  minPercent: number;
  maxPercent: number;
  notes: string[];
}

export interface IncomingAttack {
  attacker: ChampionsPokemon;
  move: Move;
  modifiers?: DamageModifiers;
}

export interface OutgoingAttack {
  defender: ChampionsPokemon;
  move: Move;
  modifiers?: DamageModifiers;
}

export interface SpreadOption {
  nature: Nature;
  statPoints: Partial<StatTable>;
  totalInvested: number;
  remaining: number;
  margin: number;
}

export interface SpreadResult {
  possible: boolean;
  options: SpreadOption[];
  reason?: string;
}

export const MOD = {
  QUARTER: 0x400,
  HALF: 0x800,
  THREE_QUARTERS: 0xc00,
  ONE: 0x1000,
  ONE_POINT_ONE: 0x1199,
  ONE_POINT_TWO: 0x1333,
  ONE_POINT_TWENTY_FIVE: 0x1400,
  ONE_POINT_THREE: 0x14cd,
  ONE_POINT_FOUR: 0x1666,
  FOUR_THIRDS: 0x1555,
  ONE_POINT_FIVE: 0x1800,
  TWO: 0x2000,
} as const;

export const NEUTRAL_NATURE: Nature = { name: "Neutral" };
const STATS: readonly BattleStat[] = [
  "hp",
  "attack",
  "defense",
  "specialAttack",
  "specialDefense",
  "speed",
];
const MAX_POINTS_PER_STAT = 32;
const MAX_TOTAL_POINTS = 66;
const CHAMPIONS_ABILITIES = new Set(
  Object.values(
    (legalityData as { allowedAbilities?: Record<string, readonly string[]> })
      .allowedAbilities ?? {},
  ).flat(),
);

export function isChampionsAbility(ability: string): boolean {
  return CHAMPIONS_ABILITIES.has(ability);
}

interface AbilityEffects {
  move: Move;
  basePower: number[];
  attack: number[];
  defense: number[];
  final: number[];
  immune: boolean;
  stab?: number;
  ignoreAttackStage: boolean;
  ignoreDefenseStage: boolean;
  ignoreBurn: boolean;
  ignoreWeather: boolean;
  blocksBerries: boolean;
  ripensBerries: boolean;
  notes: string[];
}

function abilityEffects(
  attacker: ChampionsPokemon,
  defender: ChampionsPokemon,
  initialMove: Move,
  modifiers: DamageModifiers,
): AbilityEffects {
  const notes: string[] = [];
  const used = new Set<string>();
  const use = (ability: string | undefined, note = ability): void => {
    if (!ability || used.has(ability)) return;
    used.add(ability);
    notes.push(note as string);
  };
  const attackerStatus = modifiers.attackerStatus ??
    (modifiers.burned ? "Burned" : "Healthy");
  const defenderStatus = modifiers.defenderStatus ?? "Healthy";
  const attackerHp = modifiers.attackerHpPercent ?? 100;
  const defenderHp = modifiers.defenderHpPercent ?? 100;
  const attackerAbility = modifiers.neutralizingGas ? undefined : attacker.ability;
  const moldBreaker = attackerAbility === "Mold Breaker";
  const defenderAbility = modifiers.neutralizingGas || moldBreaker
    ? undefined
    : defender.ability;
  const ignoreWeather = attackerAbility === "Cloud Nine" || defenderAbility === "Cloud Nine";
  const weather = ignoreWeather ? "" : modifiers.fieldWeather ?? "";
  const move = { ...initialMove };
  const basePower: number[] = [];
  const attack: number[] = [];
  const defense: number[] = [];
  const final: number[] = [];
  let immune = false;
  let stab: number | undefined;
  let ignoreAttackStage = defenderAbility === "Unaware";
  let ignoreDefenseStage = attackerAbility === "Unaware";
  let ignoreBurn = attackerAbility === "Guts";
  const blocksBerries = attackerAbility === "Unnerve";
  const ripensBerries = defenderAbility === "Ripen";

  if (modifiers.neutralizingGas) notes.push("Neutralizing Gas suppresses ability effects.");
  else if (moldBreaker && defender.ability)
    notes.push(`Mold Breaker ignores ${defender.ability}.`);
  if (ignoreWeather && (modifiers.fieldWeather || modifiers.weather !== undefined))
    use(attackerAbility === "Cloud Nine" ? attackerAbility : defenderAbility, "Cloud Nine suppresses weather effects.");
  if (attackerAbility === "Long Reach" && move.contact) {
    move.contact = false;
    use(attackerAbility, "Long Reach removes contact from this move.");
  }
  if (attackerAbility === "Liquid Voice" && move.sound) {
    move.type = "Water";
    use(attackerAbility, "Liquid Voice changes the sound move to Water.");
  }

  if (attackerAbility === "Pixilate" && move.type === "Normal") {
    move.type = "Fairy";
    basePower.push(MOD.ONE_POINT_TWO);
    use(attackerAbility, "Pixilate changes the move to Fairy and boosts it.");
  } else if (attackerAbility === "Refrigerate" && move.type === "Normal") {
    move.type = "Ice";
    basePower.push(MOD.ONE_POINT_TWO);
    use(attackerAbility, "Refrigerate changes the move to Ice and boosts it.");
  }

  if (defenderAbility && move.type) {
    const blocked =
      (move.type === "Fire" && defenderAbility === "Flash Fire") ||
      (move.type === "Water" && ["Dry Skin", "Water Absorb"].includes(defenderAbility)) ||
      (move.type === "Electric" && ["Lightning Rod", "Motor Drive", "Volt Absorb"].includes(defenderAbility)) ||
      (move.type === "Grass" && defenderAbility === "Sap Sipper") ||
      (move.type === "Ground" && ["Earth Eater", "Levitate"].includes(defenderAbility)) ||
      (move.bullet && defenderAbility === "Bulletproof") ||
      (move.sound && defenderAbility === "Soundproof") ||
      (move.wind && defenderAbility === "Wind Rider") ||
      (move.priority && ["Armor Tail", "Queenly Majesty"].includes(defenderAbility));
    if (blocked) {
      immune = true;
      use(defenderAbility, `${defenderAbility} prevents this attack.`);
    }
  }

  if (attackerAbility === "Adaptability" && (modifiers.stab ?? 1) > 1) {
    stab = Math.max(modifiers.stab ?? 1, 2);
    use(attackerAbility, "Adaptability increases STAB.");
  } else if (["Protean", "Libero"].includes(attackerAbility ?? "") &&
      modifiers.attackerAbilityActive) {
    stab = Math.max(modifiers.stab ?? 1, MOD.ONE_POINT_FIVE / MOD.ONE);
    use(attackerAbility, `${attackerAbility} grants STAB for the active move.`);
  }

  if (attackerAbility === "Rivalry" && modifiers.genderRelation) {
    basePower.push(
      modifiers.genderRelation === "same" ? MOD.ONE_POINT_TWENTY_FIVE : MOD.THREE_QUARTERS,
    );
    use(attackerAbility, `Rivalry applies against an ${modifiers.genderRelation}-gender target.`);
  }
  if (
    (attackerAbility === "Reckless" && move.recoil) ||
    (attackerAbility === "Iron Fist" && move.punch)
  ) {
    basePower.push(MOD.ONE_POINT_TWO);
    use(attackerAbility);
  }
  if (attackerAbility === "Sheer Force" && move.secondary) {
    basePower.push(MOD.ONE_POINT_THREE);
    use(attackerAbility);
  }
  if (attackerAbility === "Sand Force" && weather === "Sand" &&
      ["Rock", "Ground", "Steel"].includes(move.type ?? "")) {
    basePower.push(MOD.ONE_POINT_THREE);
    use(attackerAbility);
  }
  if (attackerAbility === "Analytic" && modifiers.attackerMovedLast) {
    basePower.push(MOD.ONE_POINT_THREE);
    use(attackerAbility);
  }
  if (attackerAbility === "Tough Claws" && move.contact) {
    basePower.push(MOD.ONE_POINT_THREE);
    use(attackerAbility);
  }
  if (attackerAbility === "Punk Rock" && move.sound) {
    basePower.push(MOD.ONE_POINT_THREE);
    use(attackerAbility);
  }
  if (attackerAbility === "Mega Launcher" && move.pulse) {
    basePower.push(MOD.ONE_POINT_FIVE);
    use(attackerAbility);
  }
  if (attackerAbility === "Strong Jaw" && move.bite) {
    basePower.push(MOD.ONE_POINT_FIVE);
    use(attackerAbility);
  }
  if (attackerAbility === "Steely Spirit" && move.type === "Steel") {
    basePower.push(MOD.ONE_POINT_FIVE);
    use(attackerAbility);
  }
  if (attackerAbility === "Electromorphosis" && modifiers.attackerAbilityActive &&
      move.type === "Electric") {
    basePower.push(MOD.TWO);
    use(attackerAbility);
  }
  if (attackerAbility === "Supreme Overlord" && modifiers.faintedAllies) {
    const boosts = [MOD.ONE_POINT_ONE, MOD.ONE_POINT_TWO, MOD.ONE_POINT_THREE, MOD.ONE_POINT_FOUR, MOD.ONE_POINT_FIVE];
    basePower.push(boosts[Math.min(5, modifiers.faintedAllies) - 1] as number);
    use(attackerAbility, `Supreme Overlord boosts damage for ${Math.min(5, modifiers.faintedAllies)} fainted allies.`);
  }
  if (modifiers.attackerAllyAbility === "Steely Spirit" && move.type === "Steel") {
    basePower.push(MOD.ONE_POINT_FIVE);
    notes.push("Ally Steely Spirit boosts the Steel move.");
  }

  if (attackerAbility === "Hustle" && move.category === "physical") {
    attack.push(MOD.ONE_POINT_FIVE);
    use(attackerAbility);
  }
  if (attackerAbility === "Guts" && attackerStatus !== "Healthy" && move.category === "physical") {
    attack.push(MOD.ONE_POINT_FIVE);
    ignoreBurn = true;
    use(attackerAbility);
  }
  if (["Huge Power", "Pure Power"].includes(attackerAbility ?? "") && move.category === "physical") {
    attack.push(MOD.TWO);
    use(attackerAbility);
  }
  if (
    (["Overgrow", "Blaze", "Torrent", "Swarm"].includes(attackerAbility ?? "") &&
      attackerHp <= 100 / 3 &&
      ({ Overgrow: "Grass", Blaze: "Fire", Torrent: "Water", Swarm: "Bug" } as Record<string, PokemonType>)[attackerAbility ?? ""] === move.type) ||
    (attackerAbility === "Solar Power" && weather === "Sun" && move.category === "special") ||
    (attackerAbility === "Flash Fire" && modifiers.attackerAbilityActive && move.type === "Fire") ||
    (["Plus", "Minus"].includes(attackerAbility ?? "") && modifiers.attackerAbilityActive && move.category === "special") ||
    (attackerAbility === "Sharpness" && move.slicing)
  ) {
    attack.push(MOD.ONE_POINT_FIVE);
    use(attackerAbility);
  }
  if (attackerAbility === "Stakeout" && modifiers.attackerAbilityActive) {
    attack.push(MOD.TWO);
    use(attackerAbility);
  }
  if (attackerAbility === "Water Bubble" && move.type === "Water") {
    attack.push(MOD.TWO);
    use(attackerAbility);
  }

  if (defenderAbility === "Fur Coat" && move.category === "physical") {
    defense.push(MOD.TWO);
    use(defenderAbility);
  }
  if (
    (defenderAbility === "Marvel Scale" && defenderStatus !== "Healthy" && move.category === "physical") ||
    (defenderAbility === "Grass Pelt" && modifiers.terrain === "Grassy" && move.category === "physical")
  ) {
    defense.push(MOD.ONE_POINT_FIVE);
    use(defenderAbility);
  }

  if (defenderAbility === "Dry Skin" && move.type === "Fire") {
    basePower.push(MOD.ONE_POINT_TWENTY_FIVE);
    use(defenderAbility);
  }
  if (
    (defenderAbility === "Thick Fat" && ["Fire", "Ice"].includes(move.type ?? "")) ||
    (defenderAbility === "Water Bubble" && move.type === "Fire") ||
    (defenderAbility === "Heatproof" && move.type === "Fire") ||
    (defenderAbility === "Purifying Salt" && move.type === "Ghost")
  ) {
    attack.push(MOD.HALF);
    use(defenderAbility);
  }
  if (["Filter", "Solid Rock"].includes(defenderAbility ?? "") &&
      (modifiers.effectiveness ?? 1) > 1) {
    final.push(MOD.THREE_QUARTERS);
    use(defenderAbility);
  }
  if (defenderAbility === "Multiscale" && defenderHp >= 100) {
    final.push(MOD.HALF);
    use(defenderAbility);
  }
  if (defenderAbility === "Punk Rock" && move.sound) {
    final.push(MOD.HALF);
    use(defenderAbility);
  }
  if (defenderAbility === "Fluffy") {
    if (move.contact) final.push(MOD.HALF);
    if (move.type === "Fire") final.push(MOD.TWO);
    if (move.contact || move.type === "Fire") use(defenderAbility);
  }
  if (modifiers.defenderAllyAbility === "Friend Guard") {
    final.push(MOD.THREE_QUARTERS);
    notes.push("Ally Friend Guard reduces incoming damage.");
  }

  if (ignoreAttackStage) use(defenderAbility, "Unaware ignores the attacker's stat stage.");
  if (ignoreDefenseStage) use(attackerAbility, "Unaware ignores the defender's stat stage.");
  return {
    move,
    basePower,
    attack,
    defense,
    final,
    immune,
    stab,
    ignoreAttackStage,
    ignoreDefenseStage,
    ignoreBurn,
    ignoreWeather,
    blocksBerries,
    ripensBerries,
    notes,
  };
}

function pokeRound(value: number): number {
  return value % 1 > 0.5 ? Math.ceil(value) : Math.floor(value);
}

function pointsFor(pokemon: ChampionsPokemon, stat: BattleStat): number {
  return pokemon.statPoints?.[stat] ?? 0;
}

export function validateStatPoints(points: Partial<StatTable>): string[] {
  const errors: string[] = [];
  let total = 0;
  for (const key of Object.keys(points)) {
    if (!STATS.includes(key as BattleStat))
      errors.push(`Unknown stat point field: ${key}`);
  }
  for (const stat of STATS) {
    const value = points[stat] ?? 0;
    total += value;
    if (!Number.isInteger(value) || value < 0 || value > MAX_POINTS_PER_STAT) {
      errors.push(
        `${stat} must be an integer from 0 to ${MAX_POINTS_PER_STAT}`,
      );
    }
  }
  if (total > MAX_TOTAL_POINTS)
    errors.push(`stat point total cannot exceed ${MAX_TOTAL_POINTS}`);
  return errors;
}

export function championsStats(pokemon: ChampionsPokemon): StatTable {
  const errors = validateStatPoints(pokemon.statPoints ?? {});
  if (errors.length) throw new RangeError(errors.join("; "));
  const result = {} as StatTable;
  for (const stat of STATS) {
    const base = pokemon.baseStats[stat];
    if (!Number.isInteger(base) || base < 1 || base > 255)
      throw new RangeError(`${stat} base stat is invalid`);
    if (stat === "hp") {
      result.hp = base === 1 ? 1 : base + 75 + pointsFor(pokemon, stat);
      continue;
    }
    const nature =
      pokemon.nature.plus === stat
        ? 110
        : pokemon.nature.minus === stat
          ? 90
          : 100;
    result[stat] = Math.floor(
      ((base + 20 + pointsFor(pokemon, stat)) * nature) / 100,
    );
  }
  return result;
}

export function modifiedStat(stat: number, stage = 0): number {
  if (!Number.isInteger(stage) || stage < -6 || stage > 6)
    throw new RangeError("stat stage must be from -6 to 6");
  if (stage > 0) return Math.floor((stat * (2 + stage)) / 2);
  if (stage < 0) return Math.floor((stat * 2) / (2 - stage));
  return stat;
}

export function chainModifiers(modifiers: readonly number[]): number {
  if (
    modifiers.length > 16 ||
    modifiers.some(
      (value) => !Number.isInteger(value) || value < 1 || value > MOD.TWO,
    )
  ) {
    throw new RangeError(
      "Modifiers must be 1–8192 fixed-point integers (at most 16)",
    );
  }
  return modifiers.reduce(
    (result, modifier) => Math.round((result * modifier) / MOD.ONE),
    MOD.ONE,
  );
}

function applyChained(value: number, modifiers: readonly number[]): number {
  return Math.max(1, pokeRound((value * chainModifiers(modifiers)) / MOD.ONE));
}

function multiplierMod(multiplier: number): number {
  return Math.round(multiplier * MOD.ONE);
}

const TYPE_BOOST_ITEMS: Partial<Record<ChampionsItem, PokemonType>> = {
  "Black Glasses": "Dark", "Black Belt": "Fighting", Charcoal: "Fire",
  "Dragon Fang": "Dragon", "Hard Stone": "Rock", Magnet: "Electric",
  "Metal Coat": "Steel", "Miracle Seed": "Grass", "Mystic Water": "Water",
  "Never-Melt Ice": "Ice", "Poison Barb": "Poison", "Sharp Beak": "Flying",
  "Silver Powder": "Bug", "Soft Sand": "Ground", "Spell Tag": "Ghost",
  "Twisted Spoon": "Psychic", "Silk Scarf": "Normal", "Fairy Feather": "Fairy",
};
const RESIST_BERRIES: Partial<Record<ChampionsItem, PokemonType>> = {
  "Chilan Berry": "Normal", "Occa Berry": "Fire", "Passho Berry": "Water",
  "Wacan Berry": "Electric", "Rindo Berry": "Grass", "Yache Berry": "Ice",
  "Chople Berry": "Fighting", "Kebia Berry": "Poison", "Shuca Berry": "Ground",
  "Coba Berry": "Flying", "Payapa Berry": "Psychic", "Tanga Berry": "Bug",
  "Charti Berry": "Rock", "Kasib Berry": "Ghost", "Haban Berry": "Dragon",
  "Colbur Berry": "Dark", "Babiri Berry": "Steel", "Roseli Berry": "Fairy",
};
const SEED_TERRAINS: Partial<Record<ChampionsItem, DamageModifiers["terrain"]>> = {
  "Electric Seed": "Electric", "Grassy Seed": "Grassy",
  "Misty Seed": "Misty", "Psychic Seed": "Psychic",
};

type ItemSide = "Attacker" | "Defender";

function modeledItemEffect(
  side: ItemSide,
  pokemon: ChampionsPokemon,
  item: ChampionsItem,
  move: Move,
  terrain: DamageModifiers["terrain"],
): boolean {
  if (side === "Attacker") {
    return TYPE_BOOST_ITEMS[item] === move.type ||
      item === "Expert Belt" || item === "Life Orb" ||
      item === "Light Ball" && pokemon.name.toLowerCase() === "pikachu" ||
      item === "Muscle Band" && move.category === "physical" ||
      item === "Wise Glasses" && move.category === "special" ||
      item === "Normal Gem" && move.type === "Normal";
  }
  return RESIST_BERRIES[item] === move.type ||
    item === "Air Balloon" && move.type === "Ground" ||
    SEED_TERRAINS[item] === terrain;
}

function itemNote(
  side: ItemSide,
  pokemon: ChampionsPokemon,
  item: ChampionsItem,
  move: Move,
  terrain: DamageModifiers["terrain"],
): string | undefined {
  const typeDependent = TYPE_BOOST_ITEMS[item] || RESIST_BERRIES[item] ||
    item === "Normal Gem" || item === "Air Balloon";
  if (typeDependent && !move.type) return `${side} ${item} needs a move type to apply its effect.`;
  if (item.endsWith("ite")) return `${side} ${item}: enter the transformed form's stats and ability manually.`;
  if (item === "Life Orb") return "Life Orb recoil is not included in this damage roll.";
  if (item === "Normal Gem" && move.type === "Normal")
    return "Normal Gem is consumed after this hit; the two-hit solvers carry that state forward.";
  if (item === "Air Balloon" && move.type === "Ground")
    return "Air Balloon grants Ground immunity until popped; the two-hit solvers carry that state forward.";
  if (RESIST_BERRIES[item] === move.type && move.type !== undefined)
    return `${item} is consumed after this hit; the two-hit solvers carry that state forward.`;
  if (!modeledItemEffect(side, pokemon, item, move, terrain))
    return `${side} ${item}: its stateful or non-damage effect is not modeled in this roll.`;
  return undefined;
}

function itemNotes(
  attacker: ChampionsPokemon,
  defender: ChampionsPokemon,
  move: Move,
  terrain: DamageModifiers["terrain"],
): string[] {
  const notes: string[] = [];
  for (const { side, pokemon } of [
    { side: "Attacker" as const, pokemon: attacker },
    { side: "Defender" as const, pokemon: defender },
  ]) {
    if (!pokemon.item) continue;
    const note = itemNote(side, pokemon, pokemon.item, move, terrain);
    if (note) notes.push(note);
  }
  return [...new Set(notes)];
}

export function calculateDamage(input: DamageInput): DamageResult {
  let { attacker, defender } = input;
  let move = input.move;
  const modifiers = input.modifiers ?? {};
  if (!["physical", "special", "status"].includes(move.category))
    throw new RangeError("Invalid move category");
  if (!Number.isInteger(move.power) || move.power < 0 || move.power > 999)
    throw new RangeError("Move power must be an integer from 0 to 999");
  if (
    move.fixedDamage !== undefined &&
    (!Number.isInteger(move.fixedDamage) ||
      move.fixedDamage < 0 ||
      move.fixedDamage > 65535)
  ) {
    throw new RangeError("Fixed damage must be an integer from 0 to 65535");
  }
  for (const [name, value, max] of [
    ["STAB", modifiers.stab ?? 1, 2.25],
    ["effectiveness", modifiers.effectiveness ?? 1, 4],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > max)
      throw new RangeError(`Invalid ${name}`);
  }
  if (![0.5, 1, 1.5].includes(modifiers.weather ?? 1))
    throw new RangeError("Invalid weather modifier");
  if (move.type && !["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"].includes(move.type))
    throw new RangeError("Invalid move type");
  modifiedStat(1, modifiers.attackStage);
  modifiedStat(1, modifiers.defenseStage);
  for (const values of [
    modifiers.basePower,
    modifiers.attack,
    modifiers.defense,
    modifiers.final,
  ])
    chainModifiers(values ?? []);
  // Abilities are accepted only from the reviewed Champions legality catalog.
  if ((attacker.item && !isChampionsItem(attacker.item)) ||
      (defender.item && !isChampionsItem(defender.item)))
    throw new RangeError("Unknown Champions item");
  if ((attacker.ability && !isChampionsAbility(attacker.ability)) ||
      (defender.ability && !isChampionsAbility(defender.ability)))
    throw new RangeError("Unsupported ability interaction");
  if (modifiers.helpingHand !== undefined && typeof modifiers.helpingHand !== "boolean")
    throw new RangeError("Invalid Helping Hand state");
  if (!["", "Sun", "Rain", "Sand", "Snow"].includes(modifiers.fieldWeather ?? ""))
    throw new RangeError("Invalid field weather");
  for (const status of [modifiers.attackerStatus, modifiers.defenderStatus]) {
    if (status !== undefined && !["Healthy", "Burned", "Poisoned", "Badly Poisoned", "Paralyzed", "Asleep"].includes(status))
      throw new RangeError("Invalid battle status");
  }
  for (const percent of [modifiers.attackerHpPercent, modifiers.defenderHpPercent]) {
    if (percent !== undefined && (!Number.isFinite(percent) || percent < 0 || percent > 100))
      throw new RangeError("HP percent must be from 0 to 100");
  }
  if (modifiers.faintedAllies !== undefined &&
      (!Number.isInteger(modifiers.faintedAllies) || modifiers.faintedAllies < 0 || modifiers.faintedAllies > 5))
    throw new RangeError("Fainted allies must be an integer from 0 to 5");
  if (modifiers.genderRelation !== undefined && !["same", "opposite"].includes(modifiers.genderRelation))
    throw new RangeError("Invalid gender relation");
  if (modifiers.attackerAllyAbility !== undefined && modifiers.attackerAllyAbility !== "Steely Spirit")
    throw new RangeError("Unsupported attacker ally ability");
  if (modifiers.defenderAllyAbility !== undefined && modifiers.defenderAllyAbility !== "Friend Guard")
    throw new RangeError("Unsupported defender ally ability");
  for (const active of [modifiers.attackerAbilityActive, modifiers.attackerMovedLast, modifiers.neutralizingGas]) {
    if (active !== undefined && typeof active !== "boolean")
      throw new RangeError("Invalid ability state");
  }
  const suppressedItemNotes: string[] = [];
  if (!modifiers.neutralizingGas && attacker.ability === "Klutz" && attacker.item) {
    suppressedItemNotes.push("Klutz prevents the attacker's held-item effect.");
    attacker = { ...attacker, item: undefined };
  }
  if (!modifiers.neutralizingGas && defender.ability === "Klutz" && defender.item) {
    suppressedItemNotes.push("Klutz prevents the defender's held-item effect.");
    defender = { ...defender, item: undefined };
  }
  const effects = abilityEffects(attacker, defender, move, modifiers);
  move = effects.move;
  championsStats(attacker);
  const defenderHp = championsStats(defender).hp;
  const effectiveness = effects.immune ||
      defender.item === "Air Balloon" && move.type === "Ground" && move.name !== "Thousand Arrows"
    ? 0 : modifiers.effectiveness ?? 1;
  const hits = move.hits ?? 1;
  if (!Number.isInteger(hits) || hits < 1 || hits > 10)
    throw new RangeError("move hits must be an integer from 1 to 10");
  const notes = [...new Set([
    ...suppressedItemNotes,
    ...itemNotes(attacker, defender, move, modifiers.terrain),
    ...effects.notes,
  ])];
  if (move.category === "status" || effectiveness === 0) {
    return {
      rolls: [0],
      min: 0,
      max: 0,
      defenderHp,
      minPercent: 0,
      maxPercent: 0,
      notes,
    };
  }
  if (move.fixedDamage !== undefined) {
    const damage = Math.max(0, Math.floor(move.fixedDamage)) * hits;
    const percent = (damage * 100) / defenderHp;
    return {
      rolls: [damage],
      min: damage,
      max: damage,
      defenderHp,
      minPercent: percent,
      maxPercent: percent,
      notes,
    };
  }
  if (!Number.isFinite(move.power) || move.power < 1)
    throw new RangeError("move power must be positive");

  const attackerStats = championsStats(attacker);
  const defenderStats = championsStats(defender);
  const attackKey = move.category === "physical" ? "attack" : "specialAttack";
  const defenseKey =
    move.category === "physical" ? "defense" : "specialDefense";
  const bpModifiers = [
    ...(move.type && TYPE_BOOST_ITEMS[attacker.item as ChampionsItem] === move.type ? [MOD.ONE_POINT_TWO] : []),
    ...(attacker.item === "Muscle Band" && move.category === "physical" ? [MOD.ONE_POINT_ONE] : []),
    ...(attacker.item === "Wise Glasses" && move.category === "special" ? [MOD.ONE_POINT_ONE] : []),
    ...(attacker.item === "Normal Gem" && move.type === "Normal" ? [MOD.ONE_POINT_THREE] : []),
    ...effects.basePower,
    ...modifiers.basePower ?? [],
  ];
  const technicianBoost = !modifiers.neutralizingGas && attacker.ability === "Technician" &&
    applyChained(move.power, bpModifiers) <= 60;
  if (technicianBoost) notes.push("Technician boosts this move.");
  const basePower = applyChained(move.power, [
    ...bpModifiers,
    ...(technicianBoost ? [MOD.ONE_POINT_FIVE] : []),
    ...(modifiers.helpingHand ? [MOD.ONE_POINT_FIVE] : []),
  ]);
  const attackBoost = attacker.item === "Light Ball" && attacker.name.toLowerCase() === "pikachu";
  const seedTerrain = defender.item ? SEED_TERRAINS[defender.item] : undefined;
  const seedStat = defender.item === "Electric Seed" || defender.item === "Grassy Seed" ? "defense" : "specialDefense";
  const seedBoost = seedTerrain !== undefined && seedTerrain === modifiers.terrain &&
    defenseKey === seedStat;
  const attackStage = effects.ignoreAttackStage ? 0 : modifiers.attackStage;
  const defenseStage = effects.ignoreDefenseStage
    ? 0
    : Math.min(6, (modifiers.defenseStage ?? 0) + Number(seedBoost));
  const attack = applyChained(
    modifiedStat(attackerStats[attackKey], attackStage),
    [...(attackBoost ? [MOD.TWO] : []), ...effects.attack, ...modifiers.attack ?? []],
  );
  const defense = applyChained(
    modifiedStat(defenderStats[defenseKey], defenseStage),
    [...effects.defense, ...modifiers.defense ?? []],
  );
  let baseDamage = Math.floor(
    Math.floor(Math.floor((22 * basePower * attack) / defense) / 50) + 2,
  );
  if (move.spread)
    baseDamage = pokeRound((baseDamage * MOD.THREE_QUARTERS) / MOD.ONE);
  baseDamage = pokeRound(baseDamage * (effects.ignoreWeather ? 1 : modifiers.weather ?? 1));

  const stab = effects.stab ?? modifiers.stab ?? 1;
  const expertBelt = attacker.item === "Expert Belt" && effectiveness > 1;
  const lifeOrb = attacker.item === "Life Orb";
  const berryType = defender.item && RESIST_BERRIES[defender.item as ChampionsItem];
  const resistBerry = !effects.blocksBerries && move.type !== undefined && berryType === move.type &&
    (effectiveness > 1 || move.type === "Normal");
  if (!resistBerry && berryType === move.type && effects.blocksBerries)
    notes.push("Unnerve prevents the defender's resist Berry from activating.");
  if (resistBerry && effects.ripensBerries)
    notes.push("Ripen doubles the defender's resist Berry reduction.");
  const finalModifiers = [
    ...(expertBelt ? [MOD.ONE_POINT_TWO] : []),
    ...(lifeOrb ? [0x14cc] : []),
    ...effects.final,
    ...modifiers.final ?? [],
  ];
  const resistBerryModifier = effects.ripensBerries ? MOD.QUARTER : MOD.HALF;
  const rolls = Array.from({ length: 16 }, (_, index) => {
    let total = 0;
    for (let hit = 0; hit < hits; hit += 1) {
      let damage = Math.floor((baseDamage * (85 + index)) / 100);
      damage = pokeRound((damage * multiplierMod(stab)) / MOD.ONE);
      damage = Math.floor(damage * effectiveness);
      if ((modifiers.burned || modifiers.attackerStatus === "Burned") &&
          !effects.ignoreBurn && move.category === "physical")
        damage = Math.floor(damage / 2);
      const hitModifiers = hit === 0 && resistBerry
        ? [...finalModifiers, resistBerryModifier]
        : finalModifiers;
      damage = pokeRound((damage * chainModifiers(hitModifiers)) / MOD.ONE);
      total += Math.max(1, damage);
    }
    return total;
  });
  const min = rolls[0] as number;
  const max = rolls.at(-1) as number;
  return {
    rolls,
    min,
    max,
    defenderHp,
    minPercent: (min * 100) / defenderHp,
    maxPercent: (max * 100) / defenderHp,
    notes,
  };
}

function advanceConsumedItems<T extends IncomingAttack | OutgoingAttack>(first: T, next: T): T {
  const firstAttacker = "attacker" in first ? first.attacker : undefined;
  const firstDefender = "defender" in first ? first.defender : undefined;
  const nextAttacker = "attacker" in next ? next.attacker : undefined;
  const nextDefender = "defender" in next ? next.defender : undefined;
  const gemUsed = firstAttacker?.item === "Normal Gem" && first.move.type === "Normal" && first.move.category !== "status";
  const berryType = firstDefender?.item && RESIST_BERRIES[firstDefender.item as ChampionsItem];
  const berryUsed = firstAttacker?.ability !== "Unnerve" && first.move.type !== undefined &&
    berryType === first.move.type &&
    ((first.modifiers?.effectiveness ?? 1) > 1 || first.move.type === "Normal");
  const seedType = firstDefender?.item ? SEED_TERRAINS[firstDefender.item] : undefined;
  const seedUsed = seedType !== undefined && seedType === first.modifiers?.terrain;
  const damagingMove = first.move.category !== "status" &&
    (first.move.fixedDamage !== undefined ? first.move.fixedDamage > 0 : first.move.power > 0) &&
    (first.modifiers?.effectiveness ?? 1) > 0;
  const balloonPopped = firstDefender?.item === "Air Balloon" && damagingMove &&
    (first.move.type !== "Ground" || first.move.name === "Thousand Arrows");
  const updatedAttacker = gemUsed && nextAttacker?.name === firstAttacker?.name && nextAttacker.item === "Normal Gem"
    ? { ...nextAttacker, item: undefined } : nextAttacker;
  const updatedDefender = (berryUsed || seedUsed || balloonPopped) && nextDefender
    ? { ...nextDefender, item: undefined } : nextDefender;
  let defenderReaction = 0;
  const defenderCanReact = firstDefender && damagingMove &&
    first.move.category === "physical" && !first.modifiers?.neutralizingGas &&
    firstAttacker?.ability !== "Mold Breaker";
  if (defenderCanReact && firstDefender.ability === "Stamina")
    defenderReaction = first.move.hits ?? 1;
  else if (defenderCanReact && firstDefender.ability === "Weak Armor")
    defenderReaction = -(first.move.hits ?? 1);
  const updatedModifiers = seedUsed || defenderReaction
    ? {
        ...next.modifiers,
        defenseStage: Math.max(-6, Math.min(6,
          (next.modifiers?.defenseStage ?? 0) + Number(seedUsed) + defenderReaction)),
      }
    : next.modifiers;
  return {
    ...next,
    ...(updatedAttacker ? { attacker: updatedAttacker } : {}),
    ...(updatedDefender ? { defender: updatedDefender } : {}),
    ...(updatedModifiers ? { modifiers: updatedModifiers } : {}),
  } as T;
}

function pointTotal(points: Partial<StatTable>): number {
  return STATS.reduce((sum, stat) => sum + (points[stat] ?? 0), 0);
}

function allocations(
  stats: readonly BattleStat[],
  remaining: number,
): Array<Partial<StatTable>> {
  const result: Array<Partial<StatTable>> = [];
  const visit = (
    index: number,
    left: number,
    points: Partial<StatTable>,
  ): void => {
    if (index === stats.length) {
      result.push(points);
      return;
    }
    const stat = stats[index] as BattleStat;
    for (
      let value = 0;
      value <= Math.min(MAX_POINTS_PER_STAT, left);
      value += 1
    ) {
      visit(index + 1, left - value, { ...points, [stat]: value });
    }
  };
  visit(0, remaining, {});
  return result;
}

function pareto(
  options: SpreadOption[],
  stats: readonly BattleStat[],
  limit: number,
): SpreadOption[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("Result limit must be from 1 to 100");
  const bestBySpread = new Map<string, SpreadOption>();
  for (const option of options) {
    const key = [
      option.nature.plus,
      option.nature.minus,
      ...stats.map((stat) => option.statPoints[stat] ?? 0),
    ].join("/");
    const existing = bestBySpread.get(key);
    if (!existing || option.margin > existing.margin)
      bestBySpread.set(key, option);
  }
  const unique = [...bestBySpread.values()].sort(
    (left, right) =>
      left.totalInvested - right.totalInvested || right.margin - left.margin,
  );
  const frontier: SpreadOption[] = [];
  for (const candidate of unique) {
    const dominated = frontier.some(
      (other) =>
        other.nature.plus === candidate.nature.plus &&
        other.nature.minus === candidate.nature.minus &&
        stats.every(
          (stat) =>
            (other.statPoints[stat] ?? 0) <= (candidate.statPoints[stat] ?? 0),
        ) &&
        stats.some(
          (stat) =>
            (other.statPoints[stat] ?? 0) < (candidate.statPoints[stat] ?? 0),
        ),
    );
    if (!dominated) frontier.push(candidate);
  }
  return frontier.slice(0, limit);
}

function buildPokemon(
  pokemon: Omit<ChampionsPokemon, "nature" | "statPoints">,
  nature: Nature,
  locked: Partial<StatTable>,
  allocated: Partial<StatTable>,
): ChampionsPokemon {
  return { ...pokemon, nature, statPoints: { ...locked, ...allocated } };
}

function defensiveDamageCeiling(result: DamageResult, singleHit: boolean): number {
  // A single-hit check accepts the one 1/16 maximum normal-damage roll.
  return singleHit && result.rolls.length === 16
    ? result.rolls.at(-2) as number
    : result.max;
}

export function solveDefensiveSpread(input: {
  defender: Omit<ChampionsPokemon, "nature" | "statPoints">;
  lockedPoints?: Partial<StatTable>;
  natures?: Nature[];
  attacks: [IncomingAttack] | [IncomingAttack, IncomingAttack];
  limit?: number;
}): SpreadResult {
  const locked = input.lockedPoints ?? {};
  const remaining = MAX_TOTAL_POINTS - pointTotal(locked);
  if (remaining < 0 || validateStatPoints(locked).length)
    return {
      possible: false,
      options: [],
      reason: "Locked stat points are illegal",
    };
  const firstAttack = { ...input.attacks[0], defender: input.defender };
  const attacks = input.attacks.length === 1
    ? [firstAttack]
    : [
        firstAttack,
        advanceConsumedItems(
          firstAttack,
          { ...input.attacks[1], defender: input.defender },
        ),
      ];
  const singleHit = attacks.length === 1;
  for (const attack of attacks)
    calculateDamage({ ...attack, defender: buildPokemon(attack.defender, NEUTRAL_NATURE, locked, {}) });
  const optimizedStats = (["hp", "defense", "specialDefense"] as const).filter(
    (stat) => locked[stat] === undefined,
  );
  const options: SpreadOption[] = [];
  for (const nature of input.natures ?? [NEUTRAL_NATURE]) {
    const physicalDamage = new Map<number, number>();
    const specialDamage = new Map<number, number>();
    const damageFor = (
      stat: "defense" | "specialDefense",
      value: number,
    ): number => {
      const cache = stat === "defense" ? physicalDamage : specialDamage;
      const cached = cache.get(value);
      if (cached !== undefined) return cached;
      const category = stat === "defense" ? "physical" : "special";
      const damage = attacks
        .filter((attack) => attack.move.category === category)
        .reduce(
          (sum, attack) => sum + defensiveDamageCeiling(
            calculateDamage({
              ...attack,
              defender: buildPokemon(attack.defender, nature, locked, { [stat]: value }),
            }),
            singleHit,
          ),
          0,
        );
      cache.set(value, damage);
      return damage;
    };
    for (const allocated of allocations(optimizedStats, remaining)) {
      const defender = buildPokemon(input.defender, nature, locked, allocated);
      const damage =
        damageFor("defense", pointsFor(defender, "defense")) +
        damageFor("specialDefense", pointsFor(defender, "specialDefense"));
      const hp = championsStats(defender).hp;
      if (damage < hp) {
        const statPoints = { ...locked, ...allocated };
        const totalInvested = pointTotal(statPoints);
        options.push({
          nature,
          statPoints,
          totalInvested,
          remaining: MAX_TOTAL_POINTS - totalInvested,
          margin: hp - damage,
        });
      }
    }
  }
  if (!options.length)
    return {
      possible: false,
      options: [],
      reason: singleHit
        ? "No legal spread survives 15 of 16 normal-damage rolls"
        : "No legal spread survives both maximum rolls",
    };
  return {
    possible: true,
    options: pareto(options, optimizedStats, input.limit ?? 8),
  };
}

export function solveOffensiveSpread(input: {
  attacker: Omit<ChampionsPokemon, "nature" | "statPoints">;
  lockedPoints?: Partial<StatTable>;
  natures?: Nature[];
  attacks: [OutgoingAttack, OutgoingAttack];
  limit?: number;
}): SpreadResult {
  const locked = input.lockedPoints ?? {};
  const remaining = MAX_TOTAL_POINTS - pointTotal(locked);
  if (remaining < 0 || validateStatPoints(locked).length)
    return {
      possible: false,
      options: [],
      reason: "Locked stat points are illegal",
    };
  const [first, second] = input.attacks.map((step) => step.defender);
  if (
    !first ||
    !second ||
    first.name !== second.name ||
    STATS.some(
      (stat) =>
        first.baseStats[stat] !== second.baseStats[stat] ||
        pointsFor(first, stat) !== pointsFor(second, stat),
    ) ||
    first.nature.plus !== second.nature.plus ||
    first.nature.minus !== second.nature.minus
  ) {
    throw new RangeError(
      "Sequential attacks must target the same defender; use stages for changes between steps",
    );
  }
  const attacks = [
    input.attacks[0],
    advanceConsumedItems(
      { ...input.attacks[0], attacker: input.attacker },
      { ...input.attacks[1], attacker: input.attacker },
    ),
  ] as const;
  const normalGemUsed = input.attacker.item === "Normal Gem" &&
    attacks[0].move.type === "Normal" && attacks[0].move.category !== "status";
  const baseline = buildPokemon(input.attacker, NEUTRAL_NATURE, locked, {});
  for (const [index, attack] of attacks.entries())
    calculateDamage({ ...attack, attacker: index === 1 && normalGemUsed ? { ...baseline, item: undefined } : baseline });
  const optimizedStats = (["attack", "specialAttack"] as const).filter(
    (stat) => locked[stat] === undefined,
  );
  const options: SpreadOption[] = [];
  for (const nature of input.natures ?? [NEUTRAL_NATURE]) {
    const physicalDamage = new Map<number, number>();
    const specialDamage = new Map<number, number>();
    const damageFor = (
      stat: "attack" | "specialAttack",
      value: number,
    ): number => {
      const cache = stat === "attack" ? physicalDamage : specialDamage;
      const cached = cache.get(value);
      if (cached !== undefined) return cached;
      const category = stat === "attack" ? "physical" : "special";
      const attacker = buildPokemon(input.attacker, nature, locked, {
        [stat]: value,
      });
      const damage = attacks.reduce((sum, attack, index) => {
        if (attack.move.category !== category) return sum;
        const stepAttacker = index === 1 && normalGemUsed
          ? { ...attacker, item: undefined }
          : attacker;
        return sum + calculateDamage({ ...attack, attacker: stepAttacker }).min;
      }, 0);
      cache.set(value, damage);
      return damage;
    };
    for (const allocated of allocations(optimizedStats, remaining)) {
      const attacker = buildPokemon(input.attacker, nature, locked, allocated);
      const damage =
        damageFor("attack", pointsFor(attacker, "attack")) +
        damageFor("specialAttack", pointsFor(attacker, "specialAttack"));
      const hp = championsStats(input.attacks[1].defender).hp;
      if (damage >= hp) {
        const statPoints = { ...locked, ...allocated };
        const totalInvested = pointTotal(statPoints);
        options.push({
          nature,
          statPoints,
          totalInvested,
          remaining: MAX_TOTAL_POINTS - totalInvested,
          margin: damage - hp,
        });
      }
    }
  }
  if (!options.length)
    return {
      possible: false,
      options: [],
      reason: "No legal spread guarantees the knockout",
    };
  return {
    possible: true,
    options: pareto(options, optimizedStats, input.limit ?? 8),
  };
}

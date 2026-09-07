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
  baseStats: StatTable;
  statPoints?: Partial<StatTable>;
  nature: Nature;
}

export interface Move {
  name: string;
  power: number;
  category: MoveCategory;
  hits?: number;
  spread?: boolean;
  fixedDamage?: number;
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
  HALF: 0x800,
  THREE_QUARTERS: 0xc00,
  ONE: 0x1000,
  ONE_POINT_ONE: 0x119a,
  ONE_POINT_TWO: 0x1333,
  ONE_POINT_THREE: 0x14cd,
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

export function calculateDamage(input: DamageInput): DamageResult {
  const { attacker, defender, move } = input;
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
  modifiedStat(1, modifiers.attackStage);
  modifiedStat(1, modifiers.defenseStage);
  for (const values of [
    modifiers.basePower,
    modifiers.attack,
    modifiers.defense,
    modifiers.final,
  ])
    chainModifiers(values ?? []);
  championsStats(attacker);
  const defenderHp = championsStats(defender).hp;
  const hits = move.hits ?? 1;
  if (!Number.isInteger(hits) || hits < 1 || hits > 10)
    throw new RangeError("move hits must be an integer from 1 to 10");
  if (move.category === "status" || modifiers.effectiveness === 0) {
    return {
      rolls: [0],
      min: 0,
      max: 0,
      defenderHp,
      minPercent: 0,
      maxPercent: 0,
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
    };
  }
  if (!Number.isFinite(move.power) || move.power < 1)
    throw new RangeError("move power must be positive");

  const attackerStats = championsStats(attacker);
  const defenderStats = championsStats(defender);
  const attackKey = move.category === "physical" ? "attack" : "specialAttack";
  const defenseKey =
    move.category === "physical" ? "defense" : "specialDefense";
  const basePower = applyChained(move.power, modifiers.basePower ?? []);
  const attack = applyChained(
    modifiedStat(attackerStats[attackKey], modifiers.attackStage),
    modifiers.attack ?? [],
  );
  const defense = applyChained(
    modifiedStat(defenderStats[defenseKey], modifiers.defenseStage),
    modifiers.defense ?? [],
  );
  let baseDamage = Math.floor(
    Math.floor(Math.floor((22 * basePower * attack) / defense) / 50) + 2,
  );
  if (move.spread)
    baseDamage = pokeRound((baseDamage * MOD.THREE_QUARTERS) / MOD.ONE);
  baseDamage = pokeRound(baseDamage * (modifiers.weather ?? 1));

  const stab = modifiers.stab ?? 1;
  const effectiveness = modifiers.effectiveness ?? 1;
  const finalModifier = chainModifiers(modifiers.final ?? []);
  const rolls = Array.from({ length: 16 }, (_, index) => {
    let damage = Math.floor((baseDamage * (85 + index)) / 100);
    damage = pokeRound((damage * multiplierMod(stab)) / MOD.ONE);
    damage = Math.floor(damage * effectiveness);
    if (modifiers.burned && move.category === "physical")
      damage = Math.floor(damage / 2);
    damage = pokeRound((damage * finalModifier) / MOD.ONE);
    return Math.max(1, damage) * hits;
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
  };
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

export function solveDefensiveSpread(input: {
  defender: Omit<ChampionsPokemon, "nature" | "statPoints">;
  lockedPoints?: Partial<StatTable>;
  natures?: Nature[];
  attacks: [IncomingAttack, IncomingAttack];
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
  for (const attack of input.attacks)
    calculateDamage({
      ...attack,
      defender: buildPokemon(input.defender, NEUTRAL_NATURE, locked, {}),
    });
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
      const defender = buildPokemon(input.defender, nature, locked, {
        [stat]: value,
      });
      const damage = input.attacks
        .filter((attack) => attack.move.category === category)
        .reduce(
          (sum, attack) => sum + calculateDamage({ ...attack, defender }).max,
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
      reason: "No legal spread survives both maximum rolls",
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
  for (const attack of input.attacks)
    calculateDamage({
      ...attack,
      attacker: buildPokemon(input.attacker, NEUTRAL_NATURE, locked, {}),
    });
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
      const damage = input.attacks
        .filter((attack) => attack.move.category === category)
        .reduce(
          (sum, attack) => sum + calculateDamage({ ...attack, attacker }).min,
          0,
        );
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

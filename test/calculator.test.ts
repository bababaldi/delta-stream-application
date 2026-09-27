import assert from "node:assert/strict";
import test from "node:test";
import { CHAMPIONS_ITEMS } from "../src/items.js";
import {
  NEUTRAL_NATURE,
  calculateDamage,
  championsStats,
  solveDefensiveSpread,
  solveOffensiveSpread,
  validateStatPoints,
  type ChampionsPokemon,
  type StatTable,
} from "../src/calculator.js";

const BASE_STATS: StatTable = {
  hp: 100,
  attack: 100,
  defense: 100,
  specialAttack: 100,
  specialDefense: 100,
  speed: 100,
};

function pokemon(
  name: string,
  points: Partial<StatTable> = {},
  plus?: "attack" | "defense" | "specialAttack" | "specialDefense" | "speed",
): ChampionsPokemon {
  return {
    name,
    baseStats: BASE_STATS,
    statPoints: points,
    nature: plus ? { name: `+${plus}`, plus } : NEUTRAL_NATURE,
  };
}

test("Champions stat points use the NCP level-50 formula and limits", () => {
  assert.deepEqual(
    championsStats(pokemon("Test", { hp: 32, attack: 32 }, "attack")),
    {
      hp: 207,
      attack: 167,
      defense: 120,
      specialAttack: 120,
      specialDefense: 120,
      speed: 120,
    },
  );
  assert.deepEqual(
    validateStatPoints({ hp: 33, defense: 32, specialDefense: 32 }),
    ["hp must be an integer from 0 to 32", "stat point total cannot exceed 66"],
  );
});

test("golden neutral damage case follows NCP rounding order", () => {
  const result = calculateDamage({
    attacker: pokemon("Attacker", { attack: 32 }, "attack"),
    defender: pokemon("Defender"),
    move: { name: "Test Strike", power: 100, category: "physical" },
    modifiers: { stab: 1.5 },
  });
  assert.equal(result.defenderHp, 175);
  assert.equal(result.min, 79);
  assert.equal(result.max, 94);
  assert.equal(result.rolls.length, 16);

  const fixed = calculateDamage({
    attacker: pokemon("Attacker"),
    defender: pokemon("Defender"),
    move: { name: "Fixed", power: 0, category: "physical", fixedDamage: 50 },
  });
  assert.equal(fixed.min, 50);
  assert.equal(fixed.max, 50);
});

test("NCP Champions item catalog and direct damage interactions", () => {
  assert.equal(CHAMPIONS_ITEMS.length, 166);
  assert.equal(new Set(CHAMPIONS_ITEMS).size, CHAMPIONS_ITEMS.length);
  assert.ok(CHAMPIONS_ITEMS.includes("Baxcalibrite"));
  const attacker = pokemon("Attacker");
  const defender = pokemon("Defender");
  const move = { name: "Test", category: "physical" as const, type: "Normal" as const, power: 60 };
  const normal = calculateDamage({ attacker, defender, move }).max;
  const boosted = calculateDamage({
    attacker: { ...attacker, ability: "Technician", item: "Life Orb" },
    defender, move, modifiers: { helpingHand: true },
  }).max;
  assert.ok(boosted > normal * 1.5);
  assert.ok(calculateDamage({ attacker: { ...attacker, item: "Muscle Band" }, defender, move }).max > normal);
  assert.ok(calculateDamage({ attacker: { ...attacker, item: "Silk Scarf" }, defender, move }).max > normal);
  assert.ok(calculateDamage({ attacker: { ...attacker, item: "Normal Gem" }, defender, move }).max > normal);
  assert.ok(calculateDamage({ attacker: { ...attacker, name: "Pikachu", item: "Light Ball" }, defender, move }).max > normal);
  const superEffective = { ...move, type: "Fighting" as const };
  const noBelt = calculateDamage({ attacker, defender, move: superEffective, modifiers: { effectiveness: 2 } }).max;
  assert.ok(calculateDamage({ attacker: { ...attacker, item: "Expert Belt" }, defender, move: superEffective, modifiers: { effectiveness: 2 } }).max > noBelt);
  const berry = calculateDamage({ attacker, defender: { ...defender, item: "Chople Berry" }, move: superEffective, modifiers: { effectiveness: 2 } }).max;
  assert.ok(berry < noBelt);
  const airBalloon = calculateDamage({ attacker, defender: { ...defender, item: "Air Balloon" }, move: { ...move, type: "Ground" } }).max;
  assert.equal(airBalloon, 0);
  const special = { ...move, category: "special" as const };
  assert.ok(calculateDamage({ attacker, defender: { ...defender, item: "Psychic Seed" }, move: special, modifiers: { terrain: "Psychic" } }).max <
    calculateDamage({ attacker, defender, move: special }).max);
  assert.ok(calculateDamage({ attacker: { ...attacker, item: "Life Orb" }, defender, move }).notes
    .includes("Life Orb recoil is not included in this damage roll."));
  assert.throws(() => calculateDamage({ attacker: { ...attacker, item: "Unknown item" as never }, defender, move }), /Unknown Champions item/);
  assert.throws(() => calculateDamage({ attacker: { ...attacker, ability: "Unknown" as "Technician" }, defender, move }), /Unsupported ability/);
});

test("two-step solvers carry consumed items into the second attack", () => {
  const attacker = pokemon("Attacker");
  const defender = pokemon("Defender");
  const normalMove = { name: "Normal hit", power: 180, category: "physical" as const, type: "Normal" as const };
  assert.equal(solveOffensiveSpread({
    attacker: { name: "Attacker", baseStats: BASE_STATS, item: "Normal Gem" },
    lockedPoints: { attack: 0, specialAttack: 0 },
    attacks: [{ defender, move: normalMove }, { defender, move: normalMove }],
  }).possible, false);
  assert.equal(solveDefensiveSpread({
    defender: { name: "Defender", baseStats: BASE_STATS, item: "Air Balloon" },
    lockedPoints: { hp: 0, defense: 0, specialDefense: 0 },
    attacks: [
      { attacker, move: { name: "Pop balloon", power: 1, category: "physical", type: "Normal" } },
      { attacker, move: { name: "Ground hit", power: 999, category: "physical", type: "Ground" } },
    ],
  }).possible, false);
});

test("defensive solver returns legal Pareto spreads that survive both max rolls", () => {
  const attack = {
    attacker: pokemon("Attacker", { attack: 32 }, "attack"),
    move: { name: "Test Strike", power: 100, category: "physical" as const },
    modifiers: { stab: 1.5 },
  };
  const result = solveDefensiveSpread({
    defender: { name: "Defender", baseStats: BASE_STATS },
    lockedPoints: { hp: 0, speed: 10 },
    attacks: [attack, attack],
  });
  assert.equal(result.possible, true);
  assert.ok(result.options.length > 0 && result.options.length <= 8);
  const option = result.options[0] as NonNullable<
    (typeof result.options)[number]
  >;
  assert.equal(option.statPoints.speed, 10);
  assert.equal(option.statPoints.hp, 0);
  const defender = pokemon("Defender", option.statPoints);
  const damage = calculateDamage({ ...attack, defender }).max * 2;
  assert.ok(damage < championsStats(defender).hp);
  assert.ok(option.totalInvested <= 66);
});

test("offensive solver guarantees the two-step knockout or reports impossible", () => {
  const defender = pokemon("Defender");
  const move = {
    name: "Test Strike",
    power: 100,
    category: "physical" as const,
  };
  const result = solveOffensiveSpread({
    attacker: { name: "Attacker", baseStats: BASE_STATS },
    attacks: [
      { defender, move, modifiers: { stab: 1.5, effectiveness: 1.5 } },
      { defender, move, modifiers: { stab: 1.5, effectiveness: 1.5 } },
    ],
  });
  assert.equal(result.possible, true);
  const option = result.options[0] as NonNullable<
    (typeof result.options)[number]
  >;
  const attacker = pokemon("Attacker", option.statPoints);
  const minDamage =
    calculateDamage({
      attacker,
      defender,
      move,
      modifiers: { stab: 1.5, effectiveness: 1.5 },
    }).min * 2;
  assert.ok(minDamage >= championsStats(defender).hp);

  const impossible = solveDefensiveSpread({
    defender: { name: "Defender", baseStats: BASE_STATS },
    attacks: [
      {
        attacker: pokemon("Attacker", { attack: 32 }, "attack"),
        move: { ...move, power: 999 },
        modifiers: { effectiveness: 4 },
      },
      {
        attacker: pokemon("Attacker", { attack: 32 }, "attack"),
        move: { ...move, power: 999 },
        modifiers: { effectiveness: 4 },
      },
    ],
  });
  assert.deepEqual(impossible, {
    possible: false,
    options: [],
    reason: "No legal spread survives both maximum rolls",
  });
});

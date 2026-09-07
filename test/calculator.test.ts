import assert from "node:assert/strict";
import test from "node:test";
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

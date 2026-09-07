import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDamage,
  solveDefensiveSpread,
  solveOffensiveSpread,
  NEUTRAL_NATURE,
  type ChampionsPokemon,
} from "../src/calculator.js";
import {
  parsePokepaste,
  renderTeamSheetHtml,
  validateTeam,
} from "../src/team.js";
import { recommendTeam, type SetEvidence } from "../src/assistant.js";
import { rulesFor } from "./legality-fixture.js";

const fighter: ChampionsPokemon = {
  name: "Synthetic",
  nature: NEUTRAL_NATURE,
  baseStats: {
    hp: 100,
    attack: 100,
    defense: 100,
    specialAttack: 100,
    specialDefense: 100,
    speed: 100,
  },
};
const move = { name: "Synthetic", power: 100, category: "physical" as const };

test("damage rejects invalid modifiers, fixed damage and mixed targets instead of returning NaN or a false guarantee", () => {
  for (const modifiers of [
    { stab: NaN },
    { effectiveness: -1 },
    { final: [Infinity] },
    { attackStage: 7 },
  ]) {
    assert.throws(
      () =>
        calculateDamage({
          attacker: fighter,
          defender: fighter,
          move,
          modifiers,
        }),
      RangeError,
    );
  }
  assert.throws(
    () =>
      calculateDamage({
        attacker: fighter,
        defender: fighter,
        move: { ...move, fixedDamage: NaN },
      }),
    RangeError,
  );
  assert.throws(
    () =>
      solveOffensiveSpread({
        attacker: fighter,
        attacks: [
          { defender: fighter, move },
          { defender: { ...fighter, name: "Different" }, move },
        ],
      }),
    /same defender/,
  );
  const invalid = {
    attacker: fighter,
    move: { ...move, category: "invalid" as "physical" },
  };
  assert.throws(
    () =>
      solveDefensiveSpread({ defender: fighter, attacks: [invalid, invalid] }),
    /category/,
  );
});

test("malformed or duplicated spread fields cannot silently produce a printable team", () => {
  for (const line of ["SPs: 32 HP / 2 HP", "SPs: banana", "EVs: 252 HP"]) {
    const parsed = parsePokepaste(
      `Synthetic\nAbility: Test\n${line}\n- Protect`,
    );
    assert.ok(parsed.warnings.length);
    const team = parsed.slots;
    assert.ok(
      validateTeam(team, rulesFor(team), true).some(
        (issue) => issue.code === "import-error",
      ),
    );
  }
  assert.throws(
    () => renderTeamSheetHtml([], "open", { regulation: "test" }),
    /catalog/,
  );
});

test("missing species catalogs fail closed; Tera is not required unless enabled by regulation", () => {
  const team = Array.from({ length: 6 }, (_, i) => ({
    species: `Synthetic ${i}`,
    ability: "Test",
    moves: ["Protect"],
  }));
  const rules = rulesFor(team);
  assert.deepEqual(validateTeam(team, rules), []);
  assert.doesNotMatch(renderTeamSheetHtml(team, "open", rules), /Tera Type/);
  const incomplete = { ...rules, allowedAbilities: {} };
  assert.throws(
    () => renderTeamSheetHtml(team, "open", incomplete),
    /catalog missing/,
  );
});

test("assistant tries legal alternative sets, rejects malformed candidates, and never divides by zero", () => {
  const locked = Array.from({ length: 5 }, (_, i) => ({
    species: `Locked ${i}`,
    item: `Item ${i}`,
    ability: "Test",
    moves: ["Protect"],
  }));
  const evidence: SetEvidence[] = [
    {
      regulation: "test",
      pokemon: "Candidate",
      source: "tournament",
      evidenceScore: 100,
      set: { item: "Item 0", ability: "Test", moves: ["Protect"] },
    },
    {
      regulation: "test",
      pokemon: "Candidate",
      source: "tournament",
      evidenceScore: 20,
      set: { item: "Free item", ability: "Test", moves: ["Protect"] },
    },
  ];
  const rules = rulesFor([
    ...locked,
    ...evidence.map((entry) => ({ ...entry.set, species: entry.pokemon })),
  ]);
  const input = {
    regulation: "test",
    lockedSlots: locked,
    rules,
    setEvidence: evidence,
    rankings: {
      pokemon: [
        {
          key: "candidate",
          pokemon: ["candidate"],
          score: 0,
          teamCount: 1,
          eventCount: 1,
          confidence: "emerging" as const,
        },
      ],
      cores: [],
      teams: [],
    },
    profiles: [
      {
        regulation: "test",
        version: "test-only",
        pokemon: "Candidate",
        roles: [],
        coversThreats: [],
      },
    ],
    requiredRoles: [],
    topThreats: [],
  };
  const completion = recommendTeam(input).completions[0];
  assert.ok(completion);
  assert.equal(completion.slots[5]?.item, "Free item");
  assert.ok(Number.isFinite(completion.score));
  assert.deepEqual(validateTeam(completion.slots, rules), []);
  const partial = recommendTeam({
    ...input,
    lockedSlots: [
      { species: "Locked 0", item: "Item 0", moves: [], statPoints: { hp: 0 } },
      ...locked.slice(1),
    ],
    setEvidence: [
      ...evidence,
      {
        regulation: "test",
        pokemon: "Locked 0",
        source: "tournament",
        evidenceScore: 10,
        set: {
          item: "Item 1",
          ability: "Test",
          moves: ["Protect"],
          statPoints: { hp: 32, speed: 2 },
        },
      },
    ],
  }).completions[0];
  assert.ok(partial);
  assert.equal(partial.slots[0]?.ability, "Test");
  assert.equal(partial.slots[0]?.item, "Item 0");
  assert.equal(partial.slots[0]?.statPoints?.hp, 0);
  assert.equal(partial.slots[0]?.statPoints?.speed, 2);
  const bad = evidence.map((entry) => ({
    ...entry,
    set: { ...entry.set, statPoints: { hp: 33 } },
  }));
  assert.equal(
    recommendTeam({ ...input, setEvidence: bad }).completions.length,
    0,
  );
});

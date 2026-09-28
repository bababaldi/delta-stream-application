import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePokepaste,
  renderTeamSheetHtml,
  validateTeam,
  type TeamSlot,
} from "../src/team.js";

import { rulesFor } from "./legality-fixture.js";

function slot(species: string, item?: string): TeamSlot {
  return {
    species,
    item,
    ability: "Test Ability",
    teraType: "Water",
    nature: "Calm",
    statPoints: { hp: 32, specialDefense: 32, speed: 2 },
    moves: ["Protect", `${species} Move`],
  };
}

test("Poképaste parser reads Champions fields without persisting registration data", () => {
  const parsed = parsePokepaste(`Sparky (Pikachu) (M) @ Light Ball
Ability: Static
Tera Type: Electric
SPs: 32 SpA / 32 Spe / 2 HP
Timid Nature
- Thunderbolt
- Protect`);
  assert.deepEqual(parsed, {
    slots: [
      {
        species: "Pikachu",
        nickname: "Sparky",
        gender: "M",
        item: "Light Ball",
        ability: "Static",
        teraType: "Electric",
        nature: "Timid",
        statPoints: { specialAttack: 32, speed: 32, hp: 2 },
        moves: ["Thunderbolt", "Protect"],
      },
    ],
    warnings: [],
  });
});

test("Poképaste accepts standard EVs labels as Champions stat points", () => {
  const parsed = parsePokepaste(`Kangaskhan (F) @ Life Orb
Ability: Scrappy
EVs: 32 HP / 32 Atk / 2 Def
Brave Nature
- Fake Out
- Hammer Arm
- Protect
- Double-Edge`);
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.slots[0]?.statPoints, {
    hp: 32,
    attack: 32,
    defense: 2,
  });
});

test("team validation enforces clauses and supplied regulation catalogs", () => {
  const team = [
    slot("Alpha", "Berry"),
    slot("Alpha", "Berry"),
    slot("Gamma"),
    slot("Delta"),
    slot("Epsilon"),
    slot("Zeta"),
  ];
  const issues = validateTeam(team, {
    regulation: "champions-test",
    allowedPokemon: ["Alpha", "Gamma", "Delta", "Epsilon", "Zeta"],
    allowedMoves: { alpha: ["Protect"] },
    allowedAbilities: { alpha: ["Legal Ability"] },
    allowedTeraTypes: ["Fire"],
  });
  assert.ok(issues.some(({ code }) => code === "species-clause"));
  assert.ok(issues.some(({ code }) => code === "item-clause"));
  assert.ok(issues.some(({ code }) => code === "move-illegal"));
  assert.ok(issues.some(({ code }) => code === "ability-illegal"));
  assert.ok(issues.some(({ code }) => code === "tera-illegal"));
});

test("printable open sheet omits private spread data and rejects illegal export", () => {
  const team = [
    slot("Alpha", "A"),
    slot("Bravo", "B"),
    slot("Charlie", "C"),
    slot("Delta", "D"),
    slot("Echo", "E"),
    slot("Foxtrot", "F"),
  ];
  const rules = rulesFor(team, "champions-test");
  const open = renderTeamSheetHtml(team, "open", rules, {
    playerName: "A <B>",
  });
  assert.match(open, /Open Team Sheet/);
  assert.match(open, /A &lt;B&gt;/);
  assert.doesNotMatch(open, /Stat Points/);
  const staff = renderTeamSheetHtml(team, "staff", rules);
  assert.match(staff, /Stat Points/);
  assert.match(staff, /32 HP \/ 0 Atk \/ 0 Def \/ 0 SpA \/ 32 SpD \/ 2 Spe/);
  assert.throws(
    () => renderTeamSheetHtml(team.slice(0, 5), "open", rules),
    /exactly six/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  recommendTeam,
  tournamentArchetypeCores,
  tournamentSetEvidence,
  type RoleProfile,
  type SetEvidence,
} from "../src/assistant.js";
import legalityData from "../data/legality.json" with { type: "json" };
import roleData from "../data/roles.json" with { type: "json" };
import snapshotData from "../data/snapshot.json" with { type: "json" };
import {
  canonicalPokemonName,
  rankMeta,
  type MetaRankings,
  type MetaSnapshot,
  type RankedEntry,
} from "../src/meta.js";
import {
  parsePokepaste,
  type LegalityRules,
  type TeamSlot,
} from "../src/team.js";
import { rulesFor } from "./legality-fixture.js";

function ranked(key: string, score: number, pokemon = [key]): RankedEntry {
  return {
    key,
    pokemon,
    score,
    teamCount: 3,
    eventCount: 2,
    confidence: "strong",
  };
}

function teamSlot(species: string, item: string): TeamSlot {
  return {
    species,
    item,
    ability: "Ability",
    teraType: "Water",
    moves: ["Protect"],
  };
}

const locked = [
  teamSlot("Lock One", "Item 1"),
  teamSlot("Lock Two", "Item 2"),
  teamSlot("Lock Three", "Item 3"),
  teamSlot("Lock Four", "Item 4"),
  teamSlot("Lock Five", "Item 5"),
];
const rankings: MetaRankings = {
  pokemon: [ranked("beta", 100), ranked("alpha", 80)],
  cores: [ranked("alpha+lock-one", 50, ["alpha", "lock-one"])],
  teams: [],
};
const profiles: RoleProfile[] = [
  ...locked.map(({ species }) => ({
    regulation: "test",
    version: "2026.1",
    pokemon: species,
    roles: [],
    coversThreats: [],
  })),
  {
    regulation: "test",
    version: "2026.1",
    pokemon: "Alpha",
    roles: ["speed control"],
    coversThreats: ["Threat X"],
  },
  {
    regulation: "test",
    version: "2026.1",
    pokemon: "Beta",
    roles: [],
    coversThreats: [],
  },
];
const evidence: SetEvidence[] = [
  {
    regulation: "test",
    pokemon: "Alpha",
    set: { ...teamSlot("ignored", "Item A"), moves: ["Protect"] },
    source: "pikalytics",
    evidenceScore: 999,
  },
  {
    regulation: "test",
    pokemon: "Alpha",
    set: {
      item: "Item A",
      ability: "A",
      teraType: "Water",
      moves: ["Trick Room"],
    },
    source: "tournament",
    evidenceScore: 1,
  },
  {
    regulation: "test",
    pokemon: "Beta",
    set: { item: "Item B", ability: "B", teraType: "Fire", moves: ["Protect"] },
    source: "tournament",
    evidenceScore: 100,
  },
];

test("assistant deterministically ranks legal completions and prefers tournament sets", () => {
  const input = {
    regulation: "test",
    lockedSlots: locked,
    rankings,
    profiles,
    setEvidence: evidence,
    archetypeCores: [{
      regulation: "test",
      archetype: "trick-room",
      pokemon: ["Alpha", "Lock One"],
      teamCount: 2,
      eventCount: 1,
      evidenceScore: 100,
    }],
    rules: rulesFor([
      ...locked,
      ...evidence.map((entry) => ({ ...entry.set, species: entry.pokemon })),
    ]),
    requiredRoles: ["speed control"],
    topThreats: ["Threat X"],
    limit: 2,
  } as const;
  const first = recommendTeam(input);
  const second = recommendTeam(input);
  assert.deepEqual(first, second);
  assert.equal(first.completions.length, 2);
  assert.equal(first.completions[0]?.slots[5]?.species, "Alpha");
  assert.equal("setSource" in (first.completions[0]?.slots[5] ?? {}), true);
  assert.equal(
    (first.completions[0]?.slots[5] as { setSource: string }).setSource,
    "tournament",
  );
  assert.equal(first.completions[0]?.roleVersion, "2026.1");
  assert.ok(first.completions[0]?.reasons[0]?.reasons.some((reason) =>
    reason.includes("Observed Trick Room core"),
  ));
  assert.ok(
    first.completions[0]?.reasons[0]?.reasons.some((reason) =>
      reason.includes("missing role"),
    ),
  );
});

test("assistant derives only direct Trick Room, balance, and Tailwind archetype cores", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  const sourceUrl = "https://rk9.gg/tournament/archetypes";
  const snapshot: MetaSnapshot = {
    generatedAt: now.toISOString(), activeRegulation: "test", pikalyticsUsage: {},
    tournaments: [{
      event: { id: "archetypes", name: "Archetypes", date: "2026-09-01", regulation: "test",
        tier: "regional", region: "EU", source: "rk9", sourceUrl },
      teams: [
        { eventId: "archetypes", player: "TR", placement: 1, sourceUrl, roster: [
          { pokemon: "Farigiraf", moves: ["Trick Room"] }, { pokemon: "Sylveon", moves: ["Protect"] },
          { pokemon: "A" }, { pokemon: "B" }, { pokemon: "C" }, { pokemon: "D" },
        ] },
        { eventId: "archetypes", player: "Balance", placement: 2, sourceUrl, roster: [
          { pokemon: "Incineroar", moves: ["Parting Shot"] }, { pokemon: "Rillaboom", moves: ["Fake Out"] },
          { pokemon: "E", moves: ["Protect"] }, { pokemon: "F", moves: ["Protect"] },
          { pokemon: "G", moves: ["Protect"] }, { pokemon: "H", moves: ["Protect"] },
        ] },
        { eventId: "archetypes", player: "Fast", placement: 4, sourceUrl, roster: [
          { pokemon: "Salamence", moves: ["Tailwind"] }, { pokemon: "Gholdengo", moves: ["Protect"] },
          { pokemon: "I" }, { pokemon: "J" }, { pokemon: "K" }, { pokemon: "L" },
        ] },
        { eventId: "archetypes", player: "Roster only", placement: 8, sourceUrl, roster: [
          { pokemon: "Incineroar" }, { pokemon: "Rillaboom" }, { pokemon: "M" },
          { pokemon: "N" }, { pokemon: "O" }, { pokemon: "P" },
        ] },
      ],
    }],
  };
  const cores = tournamentArchetypeCores(snapshot, "test", now);
  const has = (archetype: string, pair: string) => cores.some((core) =>
    core.archetype === archetype && core.pokemon.map(canonicalPokemonName).sort().join("+") === pair,
  );
  assert.ok(has("trick-room", "farigiraf+sylveon"));
  assert.ok(has("balance", "incineroar+rillaboom"));
  assert.equal(cores.find((core) => core.archetype === "balance")?.teamCount, 1);
  assert.ok(has("hyper-offense", "gholdengo+salamence"));
});

test("assistant set evidence gets the same Victory Road record and recency bonus as rankings", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const snapshot = { generatedAt: now.toISOString(), activeRegulation: "test", pikalyticsUsage: {}, tournaments: [
    { event: { id: "recent", name: "Recent", date: "2026-09-20", regulation: "test",
        tier: "online" as const, region: "EU" as const, source: "victoryroad" as const,
        sourceUrl: "https://victoryroad.pro/vr-sep26-2/", recordRounds: 10 },
      teams: [{ eventId: "recent", player: "A", placement: 1 as const,
        record: { wins: 10, losses: 0 }, sourceUrl: "https://victoryroad.pro/vr-sep26-2/",
        roster: Array.from({ length: 6 }, (_, index) => ({ pokemon: `P${index}`, nature: "Timid" })) }] },
  ] };
  assert.equal(tournamentSetEvidence(snapshot, "test", now)[0]?.evidenceScore, 96);
  assert.equal(tournamentSetEvidence(snapshot, "test", now)[0]?.set.nature, "Timid");
  assert.equal(tournamentSetEvidence(snapshot, "other", now).length, 0);
});

test("assistant completes standard EV Poképaste from reviewed M-C evidence", () => {
  const snapshot = snapshotData as MetaSnapshot;
  const rules = legalityData as LegalityRules;
  const now = new Date(snapshot.generatedAt);
  const locked = parsePokepaste(`Kangaskhan (F) @ Life Orb
Ability: Scrappy
Level: 50
EVs: 32 HP / 32 Atk / 2 Def
Brave Nature
- Fake Out
- Hammer Arm
- Protect
- Double-Edge

Farigiraf (M) @ Colbur Berry
Ability: Armor Tail
Level: 50
EVs: 32 HP / 10 Def / 24 SpD
Relaxed Nature
- Helping Hand
- Psychic
- Trick Room
- Thunderbolt`);
  assert.deepEqual(locked.warnings, []);
  const result = recommendTeam({
    regulation: snapshot.activeRegulation,
    lockedSlots: locked.slots,
    rankings: rankMeta(snapshot, snapshot.activeRegulation, now),
    profiles: roleData.profiles as RoleProfile[],
    setEvidence: tournamentSetEvidence(snapshot, snapshot.activeRegulation, now),
    rules,
    requiredRoles: roleData.requiredRoles,
    topThreats: roleData.topThreats,
  });
  assert.ok(result.completions.length, result.reason);
  const first = result.completions[0];
  assert.ok(first);
  assert.deepEqual(
    first.slots.slice(0, 2).map((slot) => slot.species),
    ["Kangaskhan", "Farigiraf"],
  );
  assert.equal(first.slots.length, 6);
  assert.ok(
    first.reasons.some((entry) =>
      entry.reasons.some((reason) => reason.startsWith("Placed-team co-occurrence:")),
    ),
  );
});

test("assistant explains invalid or impossible requests", () => {
  assert.deepEqual(
    recommendTeam({
      regulation: "test",
      lockedSlots: [],
      rankings,
      profiles,
      setEvidence: evidence,
      rules: { regulation: "test" },
      requiredRoles: [],
      topThreats: [],
    }),
    {
      completions: [],
      reason: "Lock one to five Pokémon before requesting a completion",
    },
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  recommendTeam,
  tournamentSetEvidence,
  type RoleProfile,
  type SetEvidence,
} from "../src/assistant.js";
import type { MetaRankings, RankedEntry } from "../src/meta.js";
import { validateTeam, type TeamSlot } from "../src/team.js";
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
      moves: ["Protect"],
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
  assert.ok(
    first.completions[0]?.reasons[0]?.reasons.some((reason) =>
      reason.includes("missing role"),
    ),
  );
});

test("assistant set evidence gets the same Victory Road record and recency bonus as rankings", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const snapshot = { generatedAt: now.toISOString(), activeRegulation: "test", pikalyticsUsage: {}, tournaments: [
    { event: { id: "recent", name: "Recent", date: "2026-09-20", regulation: "test",
        tier: "online" as const, region: "EU" as const, source: "victoryroad" as const,
        sourceUrl: "https://victoryroad.pro/vr-sep26-2/", recordRounds: 10 },
      teams: [{ eventId: "recent", player: "A", placement: 1 as const,
        record: { wins: 10, losses: 0 }, sourceUrl: "https://victoryroad.pro/vr-sep26-2/",
        roster: Array.from({ length: 6 }, (_, index) => ({ pokemon: `P${index}` })) }] },
  ] };
  assert.equal(tournamentSetEvidence(snapshot, "test", now)[0]?.evidenceScore, 96);
  assert.equal(tournamentSetEvidence(snapshot, "other", now).length, 0);
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

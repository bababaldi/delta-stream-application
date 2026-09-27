import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalPokemonName,
  placementBucket,
  rankMeta,
  recencyWeight,
  teamScore,
  validateTournamentData,
  type MetaSnapshot,
  type PlacedTeam,
  type TournamentData,
  type TournamentEvent,
} from "../src/meta.js";

const NOW = new Date("2026-09-06T12:00:00Z");

function event(
  id: string,
  date = "2026-09-01",
  regulation = "champions-mb",
): TournamentEvent {
  return {
    id,
    name: id,
    date,
    regulation,
    tier: "regional",
    region: "EU",
    source: "rk9",
    sourceUrl: `https://rk9.gg/tournament/${id}`,
  };
}

function team(
  eventId: string,
  player: string,
  roster: string[],
  placement: PlacedTeam["placement"],
): PlacedTeam {
  return {
    eventId,
    player,
    placement,
    roster: roster.map((pokemon) => ({ pokemon })),
    sourceUrl: `https://rk9.gg/teamlist/${eventId}/${player}`,
  };
}

test("placement and recency boundaries are explicit", () => {
  assert.equal(placementBucket(1), 1);
  assert.equal(placementBucket(3), 4);
  assert.equal(placementBucket(64), 64);
  assert.equal(placementBucket(65), undefined);
  assert.equal(canonicalPokemonName("Indeedee ♀"), "indeedee-female");
  assert.equal(recencyWeight("2026-08-07", NOW), 1);
  assert.equal(recencyWeight("2026-08-06", NOW), 0.75);
  assert.equal(recencyWeight("2026-06-08", NOW), 0.5);
  assert.equal(recencyWeight("2026-06-07", NOW), 0.25);
  assert.equal(recencyWeight("2026-09-07", NOW), 0);
});

test("a recent regional can outrank an old Worlds result", () => {
  assert.equal(teamScore(1, { tier: "regional", date: "2026-09-01" }, NOW), 64);
  assert.equal(teamScore(1, { tier: "worlds", date: "2026-05-01" }, NOW), 32);
});

test("complete 10-0 / 9-1 records are boosted and decay with event age", () => {
  const event = { tier: "online" as const, date: "2026-09-20", source: "victoryroad" as const, recordRounds: 10 };
  const now = new Date("2026-09-27T12:00:00Z");
  assert.equal(teamScore(1, event, now, { wins: 10, losses: 0 }), 96);
  assert.equal(teamScore(1, event, now, { wins: 9, losses: 1 }), 84);
  assert.equal(teamScore(1, event, now, { wins: 8, losses: 2 }), 48);
  assert.equal(teamScore(1, event, now, { wins: 9, losses: 0 }), 48);
  assert.equal(teamScore(1, { ...event, source: "rk9" }, now, { wins: 10, losses: 0 }), 48);
  const roster = ["A", "B", "C", "D", "E", "F"];
  const ranked = rankMeta({ generatedAt: now.toISOString(), activeRegulation: "champions-regulation-mc",
    tournaments: [{ event: { ...event, id: "vr", name: "VR", region: "EU", source: "victoryroad",
      sourceUrl: "https://victoryroad.pro/vr-sep26-2/", regulation: "champions-regulation-mc" },
      teams: [{ ...team("vr", "Alice", roster, 1), record: { wins: 10, losses: 0 } }] }],
    pikalyticsUsage: {} }, "champions-regulation-mc", now);
  assert.equal(ranked.teams[0]?.confidence, "strong");
  assert.equal(teamScore(1, { ...event, date: "2026-07-20" }, now, { wins: 10, losses: 0 }), 48);
  const tournament = { event: { ...event, ...{ id: "vr", name: "VR", region: "EU" as const,
    source: "victoryroad" as const, sourceUrl: "https://victoryroad.pro/vr-sep26-2/",
    regulation: "champions-regulation-mc" } }, teams: [
    { ...team("vr", "Alice", ["A", "B", "C", "D", "E", "F"], 1), record: { wins: 9, losses: 0 } },
  ] };
  assert.ok(validateTournamentData(tournament, now).some((error) => error.includes("record")));
});

test("Italian local winners are low-weight emerging x-2 evidence", () => {
  const roster = ["A", "B", "C", "D", "E", "F"];
  const local = (id: string): TournamentData => ({
    event: {
      ...event(id), tier: "local", source: "italianlocals",
      sourceUrl: `https://shairaba.github.io/vgc-locals-italia/data/tournaments.json#${id}`,
    },
    teams: [team(id, id, roster, 1)],
  });
  const snapshot: MetaSnapshot = {
    generatedAt: NOW.toISOString(), activeRegulation: "champions-mb",
    tournaments: [local("local-one"), local("local-two")], pikalyticsUsage: {},
  };
  assert.equal(teamScore(1, snapshot.tournaments[0]!.event, NOW), 8);
  const ranking = rankMeta(snapshot, "champions-mb", NOW).teams[0];
  assert.equal(ranking?.score, 16);
  assert.equal(ranking?.localEvidenceTeams, 2);
  assert.equal(ranking?.confidence, "emerging");
});

test("rankings isolate regulations and mark repeated cross-event cores strong", () => {
  const six = [
    "Garchomp",
    "Kingambit",
    "Whimsicott",
    "Incineroar",
    "Sylveon",
    "Milotic",
  ];
  const first: TournamentData = {
    event: event("eu-one"),
    teams: [team("eu-one", "Alice", six, 1), team("eu-one", "Bob", six, 2)],
  };
  const secondRoster = [
    "Garchomp",
    "Kingambit",
    "Pelipper",
    "Archaludon",
    "Sneasler",
    "Sinistcha",
  ];
  const second: TournamentData = {
    event: event("eu-two"),
    teams: [team("eu-two", "Carol", secondRoster, 4)],
  };
  const ignored: TournamentData = {
    event: { ...event("other", "2026-09-01", "other-reg"), tier: "worlds" },
    teams: [
      team(
        "other",
        "Dana",
        ["Pikachu", "Raichu", "Eevee", "Mew", "Ditto", "Mewtwo"],
        1,
      ),
    ],
  };
  const snapshot: MetaSnapshot = {
    generatedAt: NOW.toISOString(),
    activeRegulation: "champions-mb",
    tournaments: [first, second, ignored],
    pikalyticsUsage: { Garchomp: 20, Kingambit: 30 },
  };

  const ranking = rankMeta(snapshot, "champions-mb", NOW);
  assert.equal(ranking.pokemon[0]?.pokemon[0], "kingambit");
  const core = ranking.cores.find(({ key }) => key === "garchomp+kingambit");
  assert.equal(core?.teamCount, 3);
  assert.equal(core?.eventCount, 2);
  assert.equal(core?.confidence, "strong");
  assert.equal(ranking.teams[0]?.teamCount, 2);
  assert.equal(
    ranking.pokemon.some(({ key }) => key === "pikachu"),
    false,
  );
});

test("invalid tournament records are quarantinable", () => {
  const tournament: TournamentData = {
    event: event("broken", "2026-09-07"),
    teams: [
      team("wrong-id", "Alice", ["A", "B", "C", "D", "E"], 1),
      team("broken", "Alice", ["A", "A", "C", "D", "E", "F"], 2),
    ],
  };
  const errors = validateTournamentData(tournament, NOW);
  assert.ok(errors.includes("event.date cannot be in the future"));
  assert.ok(errors.some((error) => error.includes("must contain exactly six")));
  assert.ok(errors.some((error) => error.includes("duplicate Pokemon")));
  assert.ok(
    errors.some((error) => error.includes("duplicates another record")),
  );
});

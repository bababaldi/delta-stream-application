import assert from "node:assert/strict";
import test from "node:test";
import { releaseDataErrors, type RoleCatalog } from "../src/release.js";
import type { MetaSnapshot } from "../src/meta.js";
import { rulesFor } from "./legality-fixture.js";

const slots = Array.from({ length: 6 }, (_, i) => ({
  species: `Test ${i}`,
  ability: "Test",
  moves: ["Protect"],
}));
const rules = rulesFor(slots);
const snapshot: MetaSnapshot = {
  generatedAt: "2026-06-02T00:00:00Z",
  activeRegulation: "test",
  pikalyticsUsage: {},
  tournaments: [
    {
      event: {
        id: "test-event",
        name: "Test event",
        date: "2026-06-01",
        regulation: "test",
        tier: "regional",
        region: "EU",
        source: "rk9",
        sourceUrl: "https://rk9.gg/tournament/test",
      },
      teams: [
        {
          eventId: "test-event",
          player: "Test player",
          placement: 1,
          sourceUrl: "https://rk9.gg/teamlist/test",
          roster: slots.map(({ species, ...set }) => ({
            ...set,
            pokemon: species,
          })),
        },
      ],
    },
  ],
};
const roles: RoleCatalog = {
  regulation: "test",
  version: "test-only",
  requiredRoles: ["test role"],
  topThreats: ["test threat"],
  profiles: slots.map((slot) => ({
    regulation: "test",
    version: "test-only",
    pokemon: slot.species,
    roles: ["test role"],
    coversThreats: ["test threat"],
  })),
};
const now = new Date("2026-06-03T00:00:00Z");

test("roster-only tournament sources validate species without requiring hidden sets", () => {
  const rosterOnly = structuredClone(snapshot);
  const tournament = rosterOnly.tournaments[0]!;
  tournament.event = {
    ...tournament.event,
    tier: "local",
    source: "italianlocals",
    sourceUrl: "https://shairaba.github.io/vgc-locals-italia/data/tournaments.json#test-event",
  };
  tournament.teams[0]!.roster = slots.map(({ species }) => ({ pokemon: species }));
  assert.deepEqual(releaseDataErrors(rosterOnly, rules, roles, now), []);
});

test("data preflight rejects missing, cross-regulation, duplicate and empty tournament data", () => {
  assert.deepEqual(releaseDataErrors(snapshot, rules, roles, now), []);
  assert.ok(
    releaseDataErrors(snapshot, { regulation: "test" }, roles, now).length,
  );
  assert.ok(
    releaseDataErrors(
      snapshot,
      { ...rules, regulation: "other" },
      roles,
      now,
    ).some((e) => e.includes("different regulations")),
  );
  assert.ok(
    releaseDataErrors(
      {
        ...snapshot,
        tournaments: [...snapshot.tournaments, ...snapshot.tournaments],
      },
      rules,
      roles,
      now,
    ).some((e) => e.includes("Duplicate event")),
  );
  const empty = structuredClone(snapshot);
  empty.tournaments[0]!.teams = [];
  assert.ok(
    releaseDataErrors(empty, rules, roles, now).some((e) =>
      e.includes("placed team"),
    ),
  );
  assert.ok(
    releaseDataErrors(snapshot, rules, { ...roles, profiles: [] }, now).some(
      (e) => e.includes("incomplete"),
    ),
  );
  const invalidDate = structuredClone(snapshot);
  invalidDate.tournaments[0]!.event.date = "2026-02-30";
  assert.ok(
    releaseDataErrors(invalidDate, rules, roles, now).some((e) =>
      e.includes("ISO date"),
    ),
  );
});

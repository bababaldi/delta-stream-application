import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

type Tournament = {
  event: { source: string; id: string };
  teams: unknown[];
};

test("owner-approved top-24 Pokédata evidence is promoted alongside its preserved review draft", async () => {
  const [draftText, manifestText, productionText] = await Promise.all([
    readFile(new URL("../data/review/reviewed-results-mc-top24-draft.json", import.meta.url), "utf8"),
    readFile(new URL("../data/review/reviewed-results-mc-top24-manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../data/reviewed-results.json", import.meta.url), "utf8"),
  ]);
  const draft = JSON.parse(draftText) as Tournament[];
  const manifest = JSON.parse(manifestText) as {
    reviewStatus: string;
    target: { placementDepth: number; totalTeamRecords: number };
    draft: { sha256: string };
    sources: Array<{ eventId: string; importedTeams: number }>;
  };
  const production = JSON.parse(productionText) as Tournament[];
  assert.equal(manifest.reviewStatus, "owner-approved");
  assert.equal(manifest.target.placementDepth, 24);
  assert.equal(manifest.target.totalTeamRecords, 100);
  assert.equal(
    manifest.draft.sha256,
    createHash("sha256").update(draftText).digest("hex"),
  );
  assert.equal(draft.reduce((total, event) => total + event.teams.length, 0), 100);
  assert.equal(production.reduce((total, event) => total + event.teams.length, 0), 185);
  assert.deepEqual(
    production
      .filter(({ event }) => event.source === "pokedata")
      .map(({ event, teams }) => [event.id, teams.length]),
    [
      ["baltimore-2027", 24],
      ["brisbane-2027", 24],
      ["frankfurt-2027", 24],
    ],
  );
  assert.deepEqual(
    draft
      .filter(({ event }) => event.source === "pokedata")
      .map(({ event, teams }) => [event.id, teams.length]),
    [
      ["baltimore-2027", 24],
      ["brisbane-2027", 24],
      ["frankfurt-2027", 24],
    ],
  );
  assert.deepEqual(
    manifest.sources.map(({ eventId, importedTeams }) => [eventId, importedTeams]),
    [
      ["baltimore-2027", 24],
      ["brisbane-2027", 24],
      ["frankfurt-2027", 24],
    ],
  );
});

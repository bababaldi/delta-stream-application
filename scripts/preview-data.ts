import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { MetaSnapshot } from "../src/meta.js";

try {
  const bytes = await readFile(new URL("../data/snapshot.json", import.meta.url));
  const snapshot = JSON.parse(bytes.toString()) as MetaSnapshot;
  const preflight = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("validate-data.ts", import.meta.url))], { encoding: "utf8" });
  if (preflight.error) throw preflight.error;
  const report = {
    regulation: snapshot.activeRegulation,
    generatedAt: snapshot.generatedAt,
    snapshotSha256: createHash("sha256").update(bytes).digest("hex"),
    eventCount: snapshot.tournaments.length,
    teamCount: snapshot.tournaments.reduce((sum, event) => sum + event.teams.length, 0),
    events: snapshot.tournaments.map(({ event }) => event),
    dataPreflightPassed: preflight.status === 0,
    preflightOutput: (preflight.stdout + preflight.stderr).trim(),
    publicationApproved: false,
    note: "Review only. Calculator accuracy, mobile accessibility and offline tests are separate release requirements. No push or deployment was performed.",
  };
  const directory = new URL("../data/review/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL("publication-preview.json", directory), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  console.log("Review saved to data/review/publication-preview.json. Production data was not modified.");
} catch (error) {
  console.error("Cannot prepare data preview:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

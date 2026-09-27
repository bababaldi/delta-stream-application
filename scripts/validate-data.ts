import { readFile } from "node:fs/promises";
import { releaseDataErrors, type RoleCatalog } from "../src/release.js";
import type { LegalityRules } from "../src/team.js";
import type { MetaSnapshot } from "../src/meta.js";

try {
  const load = async (name: string) =>
    JSON.parse(
      await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"),
    );
  const [snapshot, rules, roles, config, quarantine] = await Promise.all(
    ["snapshot", "legality", "roles", "config", "quarantine"].map(load),
  );
  const errors = releaseDataErrors(
    snapshot as MetaSnapshot,
    rules as LegalityRules,
    roles as RoleCatalog,
  );
  if (config.activeRegulation !== snapshot.activeRegulation)
    errors.push("Snapshot does not match active config regulation");
  if (!Array.isArray(quarantine) || quarantine.length)
    errors.push("Unresolved quarantined events");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Data preflight passed. Mobile accessibility, offline/update behavior and independent calculator checks are still required before publication.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

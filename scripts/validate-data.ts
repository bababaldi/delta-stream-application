import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  catalogApprovalErrors,
  releaseDataErrors,
  type RoleCatalog,
} from "../src/release.js";
import type { LegalityRules } from "../src/team.js";
import type { MetaSnapshot } from "../src/meta.js";

type VersionedCatalog = { catalogVersion?: unknown };

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

try {
  const load = (name: string) =>
    readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8");
  const [snapshotText, rulesText, rolesText, configText, quarantineText, approvalsText] =
    await Promise.all([
      load("snapshot"),
      load("legality"),
      load("roles"),
      load("config"),
      load("quarantine"),
      load("approved-sources"),
    ]);
  const snapshot = parseJson<MetaSnapshot>(snapshotText, "snapshot");
  const rules = parseJson<LegalityRules & VersionedCatalog>(rulesText, "legality");
  const roles = parseJson<RoleCatalog>(rolesText, "roles");
  const config = parseJson<{ activeRegulation?: unknown }>(configText, "config");
  const quarantine = parseJson<unknown>(quarantineText, "quarantine");
  const approvals = parseJson<unknown>(approvalsText, "approved sources");
  const errors = [
    ...releaseDataErrors(snapshot, rules, roles),
    ...catalogApprovalErrors(approvals, {
      regulation: snapshot.activeRegulation,
      scope: "legality-catalog",
      version: rules.catalogVersion,
      sha256: sha256(rulesText),
    }),
    ...catalogApprovalErrors(approvals, {
      regulation: snapshot.activeRegulation,
      scope: "role-threat-catalog",
      version: roles.version,
      sha256: sha256(rolesText),
    }),
  ];
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

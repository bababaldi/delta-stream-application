import {
  canonicalPokemonName,
  validateTournamentData,
  type MetaSnapshot,
} from "./meta.js";
import {
  legalityCatalogErrors,
  validateTeam,
  type LegalityRules,
} from "./team.js";
import type { RoleProfile } from "./assistant.js";

export interface RoleCatalog {
  regulation: string;
  version: string;
  requiredRoles: string[];
  topThreats: string[];
  profiles: RoleProfile[];
}

export type CatalogApprovalScope = "legality-catalog" | "role-threat-catalog";

export interface CatalogApproval {
  regulation: string;
  scope: CatalogApprovalScope;
  approvedBy: string;
  approvedAt: string;
  catalogVersion: string;
  catalogSha256: string;
}

function isCatalogApproval(value: unknown): value is CatalogApproval {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CatalogApproval>;
  return (
    typeof record.regulation === "string" &&
    (record.scope === "legality-catalog" || record.scope === "role-threat-catalog") &&
    typeof record.approvedBy === "string" &&
    typeof record.approvedAt === "string" &&
    typeof record.catalogVersion === "string" &&
    typeof record.catalogSha256 === "string"
  );
}

export function catalogApprovalErrors(
  records: unknown,
  input: {
    regulation: string;
    scope: CatalogApprovalScope;
    version: unknown;
    sha256: string;
  },
): string[] {
  if (typeof input.version !== "string" || !input.version.trim())
    return [`${input.scope} version is missing`];
  const approvals = (Array.isArray(records) ? records : []).filter(
    (record): record is CatalogApproval =>
      isCatalogApproval(record) &&
      record.regulation === input.regulation &&
      record.scope === input.scope &&
      record.approvedBy === "owner",
  );
  if (!approvals.length) return [`${input.scope} has no owner approval`];
  if (!approvals.some(
    (approval) =>
      approval.catalogVersion === input.version && approval.catalogSha256 === input.sha256,
  )) return [`${input.scope} does not match its approved catalog hash`];
  return [];
}

const ROSTER_ONLY_SOURCES = new Set(["victoryroad", "italianlocals"]);
const ROSTER_ONLY_ISSUES = new Set([
  "team-size", "species-required", "species-clause", "pokemon-illegal", "restricted-limit",
]);

/** Data preflight only. Passing does not certify calculator accuracy or Android accessibility. */
export function releaseDataErrors(
  snapshot: MetaSnapshot,
  rules: LegalityRules,
  roles: RoleCatalog,
  now = new Date(),
): string[] {
  const errors = legalityCatalogErrors(rules);
  if (
    snapshot.activeRegulation !== rules.regulation ||
    roles.regulation !== rules.regulation
  )
    errors.push("Data catalogs use different regulations");
  const generated = Date.parse(snapshot.generatedAt);
  if (
    !Number.isFinite(generated) ||
    generated <= 0 ||
    generated > now.getTime()
  )
    errors.push("Snapshot timestamp is invalid or future-dated");
  if (!snapshot.tournaments.length)
    errors.push("No approved tournament results");
  const eventIds = new Set<string>();
  const rosterNames = new Set<string>();
  for (const tournament of snapshot.tournaments) {
    const event = tournament.event;
    if (eventIds.has(event.id)) errors.push(`Duplicate event: ${event.id}`);
    eventIds.add(event.id);
    if (event.regulation !== snapshot.activeRegulation)
      errors.push(`Cross-regulation event: ${event.id}`);
    errors.push(...validateTournamentData(tournament, now));
    for (const team of tournament.teams) {
      const slots = team.roster.map(({ pokemon, ...set }) => ({
        ...set,
        species: pokemon,
        moves: set.moves ?? [],
      }));
      const issues = validateTeam(slots, rules).filter(
        (issue) => !ROSTER_ONLY_SOURCES.has(event.source) || ROSTER_ONLY_ISSUES.has(issue.code),
      );
      errors.push(...issues.map((issue) => `${event.id}: ${issue.message}`));
      for (const slot of slots)
        rosterNames.add(canonicalPokemonName(slot.species));
    }
  }
  if (
    !roles.version.trim() ||
    !roles.profiles.length ||
    !roles.requiredRoles.length ||
    !roles.topThreats.length
  )
    errors.push("Role/threat catalog is unclassified or incomplete");
  const profileNames = new Set<string>();
  for (const profile of roles.profiles) {
    const name = canonicalPokemonName(profile.pokemon);
    if (profileNames.has(name)) errors.push(`Duplicate role profile: ${name}`);
    profileNames.add(name);
    if (
      profile.version !== roles.version ||
      profile.regulation !== rules.regulation
    )
      errors.push(`Role profile version/regulation mismatch: ${name}`);
  }
  for (const name of rosterNames)
    if (!profileNames.has(name)) errors.push(`Missing role profile: ${name}`);
  return [...new Set(errors)];
}

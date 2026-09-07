import {
  canonicalPokemonName,
  teamScore,
  type MetaRankings,
  type MetaSnapshot,
} from "./meta.js";
import {
  validateTeam,
  legalityCatalogErrors,
  type LegalityRules,
  type TeamSlot,
} from "./team.js";

export interface RoleProfile {
  regulation: string;
  version: string;
  pokemon: string;
  roles: readonly string[];
  coversThreats: readonly string[];
}

export interface SetEvidence {
  regulation: string;
  pokemon: string;
  set: Omit<TeamSlot, "species">;
  source: "tournament" | "pikalytics";
  evidenceScore: number;
}

export function tournamentSetEvidence(
  snapshot: MetaSnapshot,
  regulation: string,
  now = new Date(),
): SetEvidence[] {
  return snapshot.tournaments
    .filter((tournament) => tournament.event.regulation === regulation)
    .flatMap((tournament) =>
      tournament.teams.flatMap((team) =>
        team.roster.map((member) => ({
          regulation,
          pokemon: member.pokemon,
          set: {
            ability: member.ability,
            item: member.item,
            teraType: member.teraType,
            moves: member.moves ?? [],
          },
          source: "tournament" as const,
          evidenceScore: teamScore(team.placement, tournament.event, now),
        })),
      ),
    );
}

export interface RecommendedSlot extends TeamSlot {
  setSource: SetEvidence["source"];
  evidenceScore: number;
}

export interface RecommendationReason {
  pokemon: string;
  reasons: string[];
}

export interface TeamCompletion {
  slots: Array<TeamSlot | RecommendedSlot>;
  score: number;
  roleVersion: string;
  reasons: RecommendationReason[];
  uncoveredRoles: string[];
  uncoveredThreats: string[];
}

export interface CompletionResult {
  completions: TeamCompletion[];
  reason?: string;
}

interface CandidateScore {
  total: number;
  reasons: string[];
}

interface SearchState {
  slots: Array<TeamSlot | RecommendedSlot>;
  score: number;
  reasons: RecommendationReason[];
}

function profileFor(
  profiles: readonly RoleProfile[],
  regulation: string,
  pokemon: string,
): RoleProfile | undefined {
  const key = canonicalPokemonName(pokemon);
  return profiles.find(
    (profile) =>
      profile.regulation === regulation &&
      canonicalPokemonName(profile.pokemon) === key,
  );
}

function coveredValues(
  slots: readonly TeamSlot[],
  profiles: readonly RoleProfile[],
  regulation: string,
  field: "roles" | "coversThreats",
): Set<string> {
  return new Set(
    slots
      .flatMap(
        (slot) => profileFor(profiles, regulation, slot.species)?.[field] ?? [],
      )
      .map((value) => value.toLowerCase()),
  );
}

function chooseSets(
  evidence: readonly SetEvidence[],
  regulation: string,
  pokemon: string,
): SetEvidence[] {
  const key = canonicalPokemonName(pokemon);
  return evidence
    .filter(
      (entry) =>
        entry.regulation === regulation &&
        canonicalPokemonName(entry.pokemon) === key,
    )
    .sort(
      (left, right) =>
        Number(right.source === "tournament") -
          Number(left.source === "tournament") ||
        right.evidenceScore - left.evidenceScore ||
        JSON.stringify(left.set).localeCompare(JSON.stringify(right.set)),
    );
}

function candidateAllowed(
  slots: readonly TeamSlot[],
  set: SetEvidence,
  rules: LegalityRules,
): boolean {
  if (!Number.isFinite(set.evidenceScore) || set.evidenceScore < 0)
    return false;
  return (
    validateTeam([...slots, { ...set.set, species: set.pokemon }], rules, true)
      .length === 0
  );
}

function scoreCandidate(
  pokemon: string,
  slots: readonly TeamSlot[],
  rankings: MetaRankings,
  profiles: readonly RoleProfile[],
  regulation: string,
  requiredRoles: readonly string[],
  topThreats: readonly string[],
): CandidateScore {
  const key = canonicalPokemonName(pokemon);
  const entry = rankings.pokemon.find((ranked) => ranked.key === key);
  const bestPokemonScore = Math.max(
    1,
    ...rankings.pokemon.map((ranked) => ranked.score),
  );
  const success = ((entry?.score ?? 0) / bestPokemonScore) * 60;
  const roster = new Set(
    slots.map((slot) => canonicalPokemonName(slot.species)),
  );
  const relatedCore = rankings.cores
    .filter(
      (core) =>
        core.pokemon.includes(key) &&
        core.pokemon.every((member) => member === key || roster.has(member)),
    )
    .sort((left, right) => right.score - left.score)[0];
  const bestCoreScore = Math.max(
    1,
    ...rankings.cores.map((core) => core.score),
  );
  const coOccurrence = ((relatedCore?.score ?? 0) / bestCoreScore) * 25;
  const profile = profileFor(profiles, regulation, pokemon);
  const coveredRoles = coveredValues(slots, profiles, regulation, "roles");
  const coveredThreats = coveredValues(
    slots,
    profiles,
    regulation,
    "coversThreats",
  );
  const roleGain = (profile?.roles ?? []).filter(
    (role) =>
      requiredRoles.some(
        (required) => required.toLowerCase() === role.toLowerCase(),
      ) && !coveredRoles.has(role.toLowerCase()),
  ).length;
  const threatGain = (profile?.coversThreats ?? []).filter(
    (threat) =>
      topThreats.some(
        (target) => target.toLowerCase() === threat.toLowerCase(),
      ) && !coveredThreats.has(threat.toLowerCase()),
  ).length;
  const reasons = [`Recent tournament success: ${success.toFixed(1)}/60`];
  if (relatedCore)
    reasons.push(
      `Placed-team co-occurrence: ${coOccurrence.toFixed(1)}/25 (${relatedCore.confidence})`,
    );
  if (roleGain)
    reasons.push(`Adds ${roleGain} missing role${roleGain === 1 ? "" : "s"}`);
  if (threatGain)
    reasons.push(
      `Adds coverage for ${threatGain} top threat${threatGain === 1 ? "" : "s"}`,
    );
  return {
    total: success + coOccurrence + roleGain * 8 + threatGain * 7,
    reasons,
  };
}

function stateKey(state: SearchState): string {
  return state.slots
    .map((slot) =>
      JSON.stringify([
        canonicalPokemonName(slot.species),
        slot.item,
        slot.ability,
        slot.teraType,
        slot.nature,
        slot.statPoints,
        slot.moves,
      ]),
    )
    .sort()
    .join("/");
}

export function recommendTeam(input: {
  regulation: string;
  lockedSlots: readonly TeamSlot[];
  rankings: MetaRankings;
  profiles: readonly RoleProfile[];
  setEvidence: readonly SetEvidence[];
  rules: LegalityRules;
  requiredRoles: readonly string[];
  topThreats: readonly string[];
  limit?: number;
}): CompletionResult {
  if (input.lockedSlots.length < 1 || input.lockedSlots.length > 5) {
    return {
      completions: [],
      reason: "Lock one to five Pokémon before requesting a completion",
    };
  }
  if (input.rules.regulation !== input.regulation)
    return {
      completions: [],
      reason: "Legality rules use a different regulation",
    };
  const catalogErrors = legalityCatalogErrors(input.rules);
  if (catalogErrors.length)
    return { completions: [], reason: catalogErrors.join("; ") };
  const resolvedLocks: TeamSlot[] = [];
  for (const locked of input.lockedSlots) {
    // Supplied values are hard locks. Missing fields may be filled from legal evidence.
    const supplied = Object.fromEntries(
      Object.entries(locked).filter(([, value]) => value !== undefined),
    );
    const choices: TeamSlot[] = [
      locked,
      ...chooseSets(input.setEvidence, input.regulation, locked.species).map(
        (entry) => ({
          ...entry.set,
          ...supplied,
          species: locked.species,
          moves: [
            ...locked.moves,
            ...entry.set.moves.filter(
              (move) =>
                !locked.moves.some(
                  (given) => given.toLowerCase() === move.toLowerCase(),
                ),
            ),
          ].slice(0, Math.max(4, locked.moves.length)),
          statPoints: locked.statPoints
            ? { ...entry.set.statPoints, ...locked.statPoints }
            : entry.set.statPoints,
        }),
      ),
    ];
    const legal = choices.find(
      (slot) =>
        validateTeam([...resolvedLocks, slot], input.rules, true).length === 0,
    );
    if (!legal)
      return {
        completions: [],
        reason: `Cannot complete locked slot ${locked.species} without violating its locks or the regulation`,
      };
    resolvedLocks.push(legal);
  }
  const versions = new Set(
    input.profiles
      .filter((profile) => profile.regulation === input.regulation)
      .map((profile) => profile.version),
  );
  if (versions.size !== 1 || ![...versions][0]?.trim())
    return {
      completions: [],
      reason: "Role data must have exactly one version for the regulation",
    };
  const roleVersion = [...versions][0] as string;
  if (!Number.isInteger(input.limit ?? 3) || (input.limit ?? 3) < 1)
    return {
      completions: [],
      reason: "Result limit must be a positive integer",
    };
  const limit = Math.min(input.limit ?? 3, 5);
  let states: SearchState[] = [{ slots: resolvedLocks, score: 0, reasons: [] }];

  while ((states[0]?.slots.length ?? 6) < 6) {
    const expanded: SearchState[] = [];
    for (const state of states) {
      for (const ranked of input.rankings.pokemon) {
        const set = chooseSets(
          input.setEvidence,
          input.regulation,
          ranked.pokemon[0] ?? "",
        ).find((entry) => candidateAllowed(state.slots, entry, input.rules));
        if (!set) continue;
        const candidate = scoreCandidate(
          set.pokemon,
          state.slots,
          input.rankings,
          input.profiles,
          input.regulation,
          input.requiredRoles,
          input.topThreats,
        );
        expanded.push({
          slots: [
            ...state.slots,
            {
              ...set.set,
              species: set.pokemon,
              setSource: set.source,
              evidenceScore: set.evidenceScore,
            },
          ],
          score: state.score + candidate.total,
          reasons: [
            ...state.reasons,
            { pokemon: set.pokemon, reasons: candidate.reasons },
          ],
        });
      }
    }
    const deduplicated = new Map<string, SearchState>();
    for (const state of expanded.sort(
      (left, right) =>
        right.score - left.score ||
        stateKey(left).localeCompare(stateKey(right)),
    )) {
      if (!deduplicated.has(stateKey(state)))
        deduplicated.set(stateKey(state), state);
    }
    // ponytail: bounded beam search, not proof of global optimality; widen or use exhaustive search if needed.
    states = [...deduplicated.values()].slice(0, 32);
    if (!states.length)
      return {
        completions: [],
        reason:
          "No completion found in the bounded search; try different locks or add legal evidence-backed sets",
      };
  }

  return {
    completions: states.slice(0, limit).map((state) => {
      const roles = coveredValues(
        state.slots,
        input.profiles,
        input.regulation,
        "roles",
      );
      const threats = coveredValues(
        state.slots,
        input.profiles,
        input.regulation,
        "coversThreats",
      );
      return {
        ...state,
        score: Number(state.score.toFixed(2)),
        roleVersion,
        uncoveredRoles: input.requiredRoles.filter(
          (role) => !roles.has(role.toLowerCase()),
        ),
        uncoveredThreats: input.topThreats.filter(
          (threat) => !threats.has(threat.toLowerCase()),
        ),
      };
    }),
  };
}

export type EventTier = "worlds" | "international" | "regional" | "online" | "local";
export type Region = "NA" | "EU" | "LATAM" | "OCE" | "ASIA" | "OTHER";
export type Placement = 1 | 2 | 4 | 8 | 16 | 32 | 64;
export type TournamentSource = "pikalytics" | "rk9" | "victoryroad" | "pokedata" | "italianlocals";

export interface TournamentEvent {
  id: string;
  name: string;
  date: string;
  regulation: string;
  tier: EventTier;
  region: Region;
  source: TournamentSource;
  sourceUrl: string;
  recordRounds?: number;
}

export interface TeamMember {
  pokemon: string;
  ability?: string;
  item?: string;
  nature?: string;
  teraType?: string;
  moves?: string[];
}

export interface PlacedTeam {
  eventId: string;
  player: string;
  placement: Placement;
  /** Exact published placing when the source lists it; scoring uses the normalized bucket above. */
  publishedPlacement?: number;
  record?: { wins: number; losses: number };
  roster: TeamMember[];
  sourceUrl: string;
}

export interface TournamentData {
  event: TournamentEvent;
  teams: PlacedTeam[];
  usage?: Record<string, number>;
}

export interface MetaSnapshot {
  generatedAt: string;
  activeRegulation: string;
  tournaments: TournamentData[];
  pikalyticsUsage: Record<string, number>;
}

export interface RankedEntry {
  key: string;
  pokemon: string[];
  /** Calibrated display score. Teams and cores use the 1–10 current-meta scale. */
  score: number;
  /** Raw placement × tier × recency evidence retained for ranking and recommendations. */
  evidenceScore?: number;
  teamCount: number;
  eventCount: number;
  confidence: "strong" | "emerging";
  pikalyticsUsage?: number;
  localEvidenceTeams?: number;
}

export interface MetaRankings {
  pokemon: RankedEntry[];
  cores: RankedEntry[];
  teams: RankedEntry[];
}

const PLACEMENT_POINTS: Record<Placement, number> = {
  1: 64,
  2: 48,
  4: 32,
  8: 20,
  16: 12,
  32: 6,
  64: 3,
};

const TIER_MULTIPLIERS: Record<EventTier, number> = {
  worlds: 2,
  international: 1.5,
  regional: 1,
  online: 0.75,
  local: 0.125,
};

export function placementBucket(position: number): Placement | undefined {
  if (!Number.isInteger(position) || position < 1 || position > 64)
    return undefined;
  if (position === 1) return 1;
  if (position === 2) return 2;
  if (position <= 4) return 4;
  if (position <= 8) return 8;
  if (position <= 16) return 16;
  if (position <= 32) return 32;
  return 64;
}

export function recencyWeight(eventDate: string, now = new Date()): number {
  const event = Date.parse(`${eventDate}T00:00:00Z`);
  if (!Number.isFinite(event)) return 0;
  const days = Math.floor((now.getTime() - event) / 86_400_000);
  if (days < 0) return 0;
  if (days <= 30) return 1;
  if (days <= 60) return 0.75;
  if (days <= 90) return 0.5;
  return 0.25;
}

function recordMultiplier(
  event: Pick<TournamentEvent, "recordRounds"> & Partial<Pick<TournamentEvent, "source">>,
  record?: PlacedTeam["record"],
): number {
  if (event.source !== "victoryroad" || !event.recordRounds || !record ||
      record.wins + record.losses !== event.recordRounds ||
      record.wins < event.recordRounds - 1) return 1;
  if (record.losses === 0) return 2;
  if (record.losses === 1) return 1.75;
  return 1;
}

export function teamScore(
  placement: Placement,
  event: Pick<TournamentEvent, "tier" | "date" | "recordRounds"> &
    Partial<Pick<TournamentEvent, "source">>,
  now = new Date(),
  record?: PlacedTeam["record"],
): number {
  return PLACEMENT_POINTS[placement] * TIER_MULTIPLIERS[event.tier] *
    recencyWeight(event.date, now) * recordMultiplier(event, record);
}

const canonicalNameCache = new Map<string, string>();

// Reviewed form names accepted by Poképaste/Showdown but catalogued differently.
const FORM_NAME_ALIASES: Readonly<Record<string, string>> = {
  "floette-eternal": "floette-eternal-flower",
  "maushold-four": "maushold",
  "maushold-family-of-four": "maushold",
};

export function canonicalPokemonName(name: string): string {
  const cached = canonicalNameCache.get(name);
  if (cached !== undefined) return cached;
  let normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/♀/g, " female")
    .replace(/♂/g, " male")
    .trim()
    .toLowerCase();
  const regional = normalized.match(
    /^(hisuian|alolan|galarian|paldean)\s+(.+)$/,
  );
  if (regional) {
    const suffix = {
      hisuian: "hisui",
      alolan: "alola",
      galarian: "galar",
      paldean: "paldea",
    }[regional[1] as "hisuian" | "alolan" | "galarian" | "paldean"];
    normalized = `${regional[2]}-${suffix}`;
  }
  normalized = normalized
    .replace(/\s*\[([^\]]+)\]/g, "-$1")
    .replace(/\b(forme|form|rider)\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-{2,}/g, "-");
  normalized = FORM_NAME_ALIASES[normalized] ?? normalized;
  canonicalNameCache.set(name, normalized);
  return normalized;
}

function combinations<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  const visit = (start: number, selected: T[]): void => {
    if (selected.length === size) {
      result.push(selected);
      return;
    }
    for (
      let index = start;
      index <= items.length - (size - selected.length);
      index += 1
    ) {
      visit(index + 1, [...selected, items[index] as T]);
    }
  };
  visit(0, []);
  return result;
}

interface Aggregate {
  names: string[];
  score: number;
  teams: number;
  events: Set<string>;
  establishedEvents: Set<string>;
  localTeams: number;
  establishedTeams: number;
  exceptionalRecord: boolean;
}

function addAggregate(
  aggregates: Map<string, Aggregate>,
  names: string[],
  score: number,
  eventId: string,
  exceptionalRecord = false,
  localEvidence = false,
): void {
  const canonical = names.map(canonicalPokemonName).sort();
  const key = canonical.join("+");
  const existing = aggregates.get(key);
  if (existing) {
    existing.score += score;
    existing.teams += 1;
    existing.events.add(eventId);
    if (localEvidence) existing.localTeams += 1;
    else {
      existing.establishedTeams += 1;
      existing.establishedEvents.add(eventId);
    }
    existing.exceptionalRecord ||= exceptionalRecord;
    return;
  }
  aggregates.set(key, {
    names: canonical,
    score,
    teams: 1,
    events: new Set([eventId]),
    establishedEvents: localEvidence ? new Set() : new Set([eventId]),
    localTeams: Number(localEvidence),
    establishedTeams: Number(!localEvidence),
    exceptionalRecord,
  });
}

function normalizedEvidence(
  evidence: number,
  floor: number,
  ceiling: number,
  index: number,
  count: number,
): number {
  if (ceiling <= floor || floor <= 0)
    return count <= 1 ? 1 : 1 - index / (count - 1);
  const relative = Math.log(evidence / floor) / Math.log(ceiling / floor);
  // Preserve ordering and meaningful evidence gaps without making adjacent top ranks jump.
  return Math.pow(Math.max(0, Math.min(1, relative)), 0.25);
}

function calibrateTeamAndCoreScores(entries: RankedEntry[]): RankedEntry[] {
  if (!entries.length) return entries;
  const topCount = Math.min(50, entries.length);
  const topFloor = entries[topCount - 1]?.evidenceScore ?? entries[topCount - 1]?.score ?? 0;
  const topCeiling = entries[0]?.evidenceScore ?? entries[0]?.score ?? topFloor;
  const lowerFloor = entries.at(-1)?.evidenceScore ?? entries.at(-1)?.score ?? topFloor;
  return entries.map((entry, index) => {
    const isTop = index < topCount;
    const relative = isTop
      ? normalizedEvidence(entry.evidenceScore ?? entry.score, topFloor, topCeiling, index, topCount)
      : normalizedEvidence(
          entry.evidenceScore ?? entry.score,
          lowerFloor,
          topFloor,
          index - topCount,
          entries.length - topCount,
        );
    const score = isTop ? 6.1 + 3.7 * relative : 1 + 5.1 * relative;
    return { ...entry, score: Number(score.toFixed(2)) };
  });
}

function finishRanking(
  aggregates: Map<string, Aggregate>,
  usage: Readonly<Record<string, number>> = {},
  kind: "pokemon" | "core" | "team",
): RankedEntry[] {
  const entries = [...aggregates.entries()]
    .map(([key, value]) => {
      const eventCount = value.events.size;
      const strong = value.exceptionalRecord ||
        (kind === "core"
          ? value.establishedTeams >= 3 && value.establishedEvents.size >= 2
          : value.establishedTeams >= 2);
      return {
        key,
        pokemon: value.names,
        score: value.score,
        evidenceScore: value.score,
        teamCount: value.teams,
        eventCount,
        localEvidenceTeams: value.localTeams,
        confidence: strong ? "strong" : "emerging",
        ...(kind === "pokemon"
          ? { pikalyticsUsage: usage[value.names[0] as string] }
          : {}),
      } satisfies RankedEntry;
    })
    .sort(
      (left, right) =>
        (right.evidenceScore ?? right.score) - (left.evidenceScore ?? left.score) ||
        (right.pikalyticsUsage ?? -1) - (left.pikalyticsUsage ?? -1) ||
        left.key.localeCompare(right.key),
    );
  return kind === "pokemon" ? entries : calibrateTeamAndCoreScores(entries);
}

export function rankMeta(
  snapshot: MetaSnapshot,
  regulation: string,
  now = new Date(),
  regions?: ReadonlySet<Region>,
): MetaRankings {
  const pokemon = new Map<string, Aggregate>();
  const cores = new Map<string, Aggregate>();
  const teams = new Map<string, Aggregate>();

  for (const tournament of snapshot.tournaments) {
    if (
      tournament.event.regulation !== regulation ||
      (regions && !regions.has(tournament.event.region))
    )
      continue;
    for (const team of tournament.teams) {
      const names = team.roster.map(({ pokemon: name }) => name);
      const score = teamScore(team.placement, tournament.event, now, team.record);
      const exceptional = recordMultiplier(tournament.event, team.record) > 1;
      const localEvidence = tournament.event.tier === "local";
      for (const name of names)
        addAggregate(pokemon, [name], score, team.eventId, exceptional, localEvidence);
      for (let size = 2; size <= 4; size += 1) {
        for (const core of combinations(names, size))
          addAggregate(cores, core, score, team.eventId, exceptional, localEvidence);
      }
      addAggregate(teams, names, score, team.eventId, exceptional, localEvidence);
    }
  }

  const usage = Object.fromEntries(
    Object.entries(snapshot.pikalyticsUsage).map(([name, value]) => [
      canonicalPokemonName(name),
      value,
    ]),
  );
  return {
    pokemon: finishRanking(pokemon, usage, "pokemon"),
    cores: finishRanking(cores, usage, "core"),
    teams: finishRanking(teams, usage, "team"),
  };
}

export function validateTournamentData(
  data: TournamentData,
  now = new Date(),
): string[] {
  const errors: string[] = [];
  const eventTime = Date.parse(`${data.event.date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(data.event.date) ||
    !Number.isFinite(eventTime) ||
    new Date(eventTime).toISOString().slice(0, 10) !== data.event.date
  ) {
    errors.push("event.date must be an ISO date");
  } else if (eventTime > now.getTime()) {
    errors.push("event.date cannot be in the future");
  }
  if (!data.event.regulation.trim())
    errors.push("event.regulation is required");
  if (!data.event.sourceUrl.startsWith("https://"))
    errors.push("event.sourceUrl must use HTTPS");

  if (!data.teams.length)
    errors.push("event must contain at least one placed team");
  if (data.event.recordRounds !== undefined &&
      (!Number.isInteger(data.event.recordRounds) || data.event.recordRounds < 1 || data.event.recordRounds > 20))
    errors.push("event.recordRounds must be from 1 to 20");
  if (!(data.event.tier in TIER_MULTIPLIERS))
    errors.push("event.tier is unsupported");
  const players = new Set<string>();
  for (const [index, team] of data.teams.entries()) {
    const prefix = `teams[${index}]`;
    if (team.eventId !== data.event.id)
      errors.push(`${prefix}.eventId does not match event.id`);
    if (!PLACEMENT_POINTS[team.placement])
      errors.push(`${prefix}.placement is unsupported`);
    if (team.publishedPlacement !== undefined &&
        (!Number.isInteger(team.publishedPlacement) || team.publishedPlacement < 1 ||
         team.publishedPlacement > 64 || placementBucket(team.publishedPlacement) !== team.placement))
      errors.push(`${prefix}.publishedPlacement does not match placement`);
    if (team.record && (!data.event.recordRounds ||
        !Number.isInteger(team.record.wins) || !Number.isInteger(team.record.losses) ||
        team.record.wins < 0 || team.record.losses < 0 ||
        team.record.wins + team.record.losses !== data.event.recordRounds))
      errors.push(`${prefix}.record does not match event.recordRounds`);
    if (!team.sourceUrl.startsWith("https://"))
      errors.push(`${prefix}.sourceUrl must use HTTPS`);
    if (team.roster.length !== 6)
      errors.push(`${prefix}.roster must contain exactly six Pokemon`);
    const names = team.roster.map(({ pokemon }) =>
      canonicalPokemonName(pokemon),
    );
    if (names.some((name) => !name))
      errors.push(`${prefix}.roster contains an empty Pokemon name`);
    if (new Set(names).size !== names.length)
      errors.push(`${prefix}.roster contains duplicate Pokemon`);
    const player = team.player.trim().toLowerCase();
    if (!player) errors.push(`${prefix}.player is required`);
    if (players.has(player))
      errors.push(`${prefix}.player duplicates another record`);
    players.add(player);
  }
  return errors;
}

export type EventTier = "worlds" | "international" | "regional";
export type Region = "NA" | "EU" | "LATAM" | "OCE" | "ASIA" | "OTHER";
export type Placement = 1 | 2 | 4 | 8 | 16 | 32 | 64;
export type TournamentSource = "pikalytics" | "rk9";

export interface TournamentEvent {
  id: string;
  name: string;
  date: string;
  regulation: string;
  tier: EventTier;
  region: Region;
  source: TournamentSource;
  sourceUrl: string;
}

export interface TeamMember {
  pokemon: string;
  ability?: string;
  item?: string;
  teraType?: string;
  moves?: string[];
}

export interface PlacedTeam {
  eventId: string;
  player: string;
  placement: Placement;
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
  score: number;
  teamCount: number;
  eventCount: number;
  confidence: "strong" | "emerging";
  pikalyticsUsage?: number;
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

export function teamScore(
  placement: Placement,
  event: Pick<TournamentEvent, "tier" | "date">,
  now = new Date(),
): number {
  return (
    PLACEMENT_POINTS[placement] *
    TIER_MULTIPLIERS[event.tier] *
    recencyWeight(event.date, now)
  );
}

export function canonicalPokemonName(name: string): string {
  let normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
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
}

function addAggregate(
  aggregates: Map<string, Aggregate>,
  names: string[],
  score: number,
  eventId: string,
): void {
  const canonical = names.map(canonicalPokemonName).sort();
  const key = canonical.join("+");
  const existing = aggregates.get(key);
  if (existing) {
    existing.score += score;
    existing.teams += 1;
    existing.events.add(eventId);
    return;
  }
  aggregates.set(key, {
    names: canonical,
    score,
    teams: 1,
    events: new Set([eventId]),
  });
}

function finishRanking(
  aggregates: Map<string, Aggregate>,
  usage: Readonly<Record<string, number>> = {},
  kind: "pokemon" | "core" | "team",
): RankedEntry[] {
  return [...aggregates.entries()]
    .map(([key, value]) => {
      const eventCount = value.events.size;
      const strong =
        kind === "core"
          ? value.teams >= 3 && eventCount >= 2
          : value.teams >= 2;
      return {
        key,
        pokemon: value.names,
        score: value.score,
        teamCount: value.teams,
        eventCount,
        confidence: strong ? "strong" : "emerging",
        ...(kind === "pokemon"
          ? { pikalyticsUsage: usage[value.names[0] as string] }
          : {}),
      } satisfies RankedEntry;
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.pikalyticsUsage ?? -1) - (left.pikalyticsUsage ?? -1) ||
        left.key.localeCompare(right.key),
    );
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
      const score = teamScore(team.placement, tournament.event, now);
      for (const name of names)
        addAggregate(pokemon, [name], score, team.eventId);
      for (let size = 2; size <= 4; size += 1) {
        for (const core of combinations(names, size))
          addAggregate(cores, core, score, team.eventId);
      }
      addAggregate(teams, names, score, team.eventId);
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
  if (!(data.event.tier in TIER_MULTIPLIERS))
    errors.push("event.tier is unsupported");
  const players = new Set<string>();
  for (const [index, team] of data.teams.entries()) {
    const prefix = `teams[${index}]`;
    if (team.eventId !== data.event.id)
      errors.push(`${prefix}.eventId does not match event.id`);
    if (!PLACEMENT_POINTS[team.placement])
      errors.push(`${prefix}.placement is unsupported`);
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

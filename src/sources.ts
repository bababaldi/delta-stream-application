import {
  canonicalPokemonName,
  placementBucket,
  type MetaSnapshot,
  type PlacedTeam,
  type Region,
  type TeamMember,
  type TournamentData,
  type TournamentEvent,
} from "./meta.js";

export interface TournamentCandidate {
  id: string;
  name: string;
  date: string | null;
  source: "pikalytics" | "rk9";
  sourceUrl: string;
  players?: number;
  suggestedTier?: TournamentEvent["tier"];
  suggestedRegion?: Region;
  approved: false;
  notes: string[];
}

const COUNTRY_REGIONS: Readonly<Record<string, Region>> = {
  US: "NA",
  CA: "NA",
  MX: "LATAM",
  BR: "LATAM",
  CL: "LATAM",
  AR: "LATAM",
  PE: "LATAM",
  GB: "EU",
  IE: "EU",
  FR: "EU",
  DE: "EU",
  IT: "EU",
  ES: "EU",
  PT: "EU",
  PL: "EU",
  NL: "EU",
  BE: "EU",
  SE: "EU",
  NO: "EU",
  FI: "EU",
  DK: "EU",
  CZ: "EU",
  AT: "EU",
  CH: "EU",
  AU: "OCE",
  NZ: "OCE",
  JP: "ASIA",
  KR: "ASIA",
  SG: "ASIA",
};

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function plainText(html: string): string {
  return decodeHtml(
    html.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function splitMarkdownRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of line.trim().replace(/^\||\|$/g, "")) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function markdownLink(cell: string): string | undefined {
  return cell.match(/\((https:\/\/[^)]+)\)/)?.[1];
}

function urlId(url: string): string | undefined {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop();
  } catch {
    return undefined;
  }
}

function isoDate(value: string): string | null {
  if (!value || value === "N/A") return null;
  const range = value
    .replace(/[–—]/g, "-")
    .match(/^([A-Za-z]+)\s+(\d{1,2})(?:-\d{1,2})?,\s*(\d{4})$/);
  const normalized = range
    ? `${range[1]} ${range[2]}, ${range[3]} 00:00:00 UTC`
    : value;
  const time = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? `${normalized}T00:00:00Z`
      : normalized,
  );
  return Number.isFinite(time)
    ? new Date(time).toISOString().slice(0, 10)
    : null;
}

function suggestedTier(name: string): TournamentEvent["tier"] | undefined {
  if (/pok[eé]mon world championships?/i.test(name)) return "worlds";
  if (
    /pok[eé]mon international championships?|\b(?:EUIC|NAIC|LAIC|OCIC)\b/i.test(
      name,
    )
  )
    return "international";
  if (/pok[eé]mon (?:VGC )?regional championships?/i.test(name))
    return "regional";
  return undefined;
}

export function parsePikalyticsIndex(markdown: string): TournamentCandidate[] {
  const candidates: TournamentCandidate[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|") || /---|Tournament \| Date/.test(line)) continue;
    const cells = splitMarkdownRow(line);
    if (cells.length !== 8) continue;
    const url = markdownLink(cells[6] as string);
    const name = cells[0]?.trim();
    if (!url || !name) continue;
    const id = urlId(url);
    if (!id) continue;
    const date = isoDate(cells[1] as string);
    const players = Number.parseInt(cells[3] as string, 10);
    candidates.push({
      id,
      name,
      date,
      source: "pikalytics",
      sourceUrl: url,
      ...(Number.isFinite(players) ? { players } : {}),
      ...(suggestedTier(name) ? { suggestedTier: suggestedTier(name) } : {}),
      approved: false,
      notes: [
        ...(date ? [] : ["Date missing"]),
        ...(suggestedTier(name) ? [] : ["Official event tier not detected"]),
        "Regulation and region require approval",
      ],
    });
  }
  return candidates;
}

function countryToRegion(country: string): Region {
  return COUNTRY_REGIONS[country.toUpperCase()] ?? "OTHER";
}

export function parseRk9Events(html: string): TournamentCandidate[] {
  const candidates: TournamentCandidate[] = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const content = row[1] as string;
    const link = [
      ...content.matchAll(
        /<a[^>]+href="(\/tournament\/([^"]+))"[^>]*>([\s\S]*?)<\/a>/gi,
      ),
    ].find((match) =>
      /^(?:VG|VGC)$|\bVGC\b/i.test(plainText(match[3] as string)),
    );
    if (!link) continue;
    const cells = [...content.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => plainText(match[1] as string),
    );
    const date = isoDate(
      cells[0]?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? cells[0] ?? "",
    );
    const linkLabel = plainText(link[3] as string);
    const name = /^(?:VG|VGC)$/i.test(linkLabel)
      ? (cells[2] ?? linkLabel)
      : linkLabel;
    let country =
      cells.find((cell) => /,\s*[A-Z]{2}$/.test(cell))?.slice(-2) ?? "";
    for (let index = cells.length - 1; index >= 0; index -= 1) {
      if (/^[A-Z]{2}$/.test(cells[index] as string)) {
        country = cells[index] as string;
        break;
      }
    }
    const url = `https://rk9.gg${link[1]}`;
    candidates.push({
      id: link[2] as string,
      name,
      date,
      source: "rk9",
      sourceUrl: url,
      ...(suggestedTier(name) ? { suggestedTier: suggestedTier(name) } : {}),
      suggestedRegion: countryToRegion(country),
      approved: false,
      notes: [
        ...(date ? [] : ["Date missing"]),
        ...(suggestedTier(name) ? [] : ["Official event tier not detected"]),
        "Regulation and completion status require approval",
      ],
    });
  }
  return candidates;
}

export function parsePikalyticsTournament(
  markdown: string,
  event: TournamentEvent,
): TournamentData {
  const usage: Record<string, number> = {};
  const teams: PlacedTeam[] = [];
  let section = "";

  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) section = line.slice(3).trim();
    if (!line.startsWith("|") || /---/.test(line)) continue;
    const cells = splitMarkdownRow(line);
    if (
      section === "Pokemon Usage And Win Rates" &&
      cells.length === 7 &&
      /^\d+$/.test(cells[0] as string)
    ) {
      const value = Number.parseFloat((cells[2] as string).replace("%", ""));
      if (Number.isFinite(value))
        usage[canonicalPokemonName(plainText(cells[1] as string))] = value;
    }
    if (
      section === "Published Teams" &&
      cells.length === 5 &&
      /^\d+$/.test(cells[0] as string)
    ) {
      const position = Number.parseInt(cells[0] as string, 10);
      const placement = placementBucket(position);
      const roster = (cells[3] as string)
        .split(",")
        .map((pokemon) => ({ pokemon: pokemon.trim() }));
      const sourceUrl = markdownLink(cells[4] as string) ?? event.sourceUrl;
      if (placement) {
        teams.push({
          eventId: event.id,
          player: cells[1] as string,
          placement,
          roster,
          sourceUrl,
        });
      }
    }
  }
  return { event, teams, usage };
}

interface Rk9RosterEntry {
  player: string;
  position: number;
  teamUrl: string;
}

export function parseRk9Roster(html: string): Rk9RosterEntry[] {
  const entries: Rk9RosterEntry[] = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const content = row[1] as string;
    if (!/>\s*Masters\s*</i.test(content)) continue;
    const teamPath = content.match(/href="(\/teamlist\/public\/[^"]+)"/i)?.[1];
    const positionMatch = content.match(
      /<td[^>]*class="[^"]*text-center[^"]*"[^>]*>\s*(\d+)\s*<\/th>/i,
    );
    if (!teamPath || !positionMatch) continue;
    const position = Number.parseInt(positionMatch[1] as string, 10);
    if (position > 64) continue;
    const cells = [
      ...content.matchAll(/<td[^>]*>([\s\S]*?)(?:<\/td>|<\/th>)/gi),
    ].map((match) => plainText(match[1] as string));
    const player =
      `${cells[1] ?? ""} ${cells[2] ?? ""}`.trim() ||
      teamPath.split("/").pop() ||
      "Unknown";
    entries.push({ player, position, teamUrl: `https://rk9.gg${teamPath}` });
  }
  return entries;
}

function field(block: string, label: string): string | undefined {
  const match = block.match(new RegExp(`<b>${label}:<\\/b>\\s*([^<]+)`, "i"));
  return match ? plainText(match[1] as string) : undefined;
}

export function parseRk9TeamList(html: string): TeamMember[] {
  const english = html.match(
    /<div[^>]+translation lang-EN[^>]*>([\s\S]*?)<div[^>]+translation lang-(?:FR|IT|DE|ES|JP|KO|SC|TC)/i,
  )?.[1];
  if (!english) return [];
  const roster: TeamMember[] = [];
  for (const match of english.matchAll(
    /<div class="pokemon[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  )) {
    const block = match[1] as string;
    const nameChunk = block.match(/<img[^>]*>\s*([\s\S]*?)<b>EN<\/b>/i)?.[1];
    const pokemon = nameChunk ? plainText(nameChunk) : "";
    const moves = [
      ...block.matchAll(/<span class="badge">([\s\S]*?)<\/span>/gi),
    ].map((move) => plainText(move[1] as string));
    if (pokemon) {
      roster.push({
        pokemon,
        ...(field(block, "Ability")
          ? { ability: field(block, "Ability") }
          : {}),
        ...(field(block, "Held Item")
          ? { item: field(block, "Held Item") }
          : {}),
        ...(field(block, "Tera Type")
          ? { teraType: field(block, "Tera Type") }
          : {}),
        ...(moves.length ? { moves } : {}),
      });
    }
  }
  return roster;
}

export interface EligiblePokemon {
  formId: string;
  nationalDex: number;
  name: string;
}

/** Parse only the official page's JSON literal; never execute downloaded scripts. */
export function parseChampionsEligibility(html: string): EligiblePokemon[] {
  const literal = html.match(/\bconst\s+pokemons\s*=\s*(\[[\s\S]*?\])\s*;/)?.[1];
  if (!literal) throw new Error("Official eligibility JSON is missing");
  let rows: unknown;
  try {
    rows = JSON.parse(literal);
  } catch (cause) {
    throw new Error("Official eligibility is not valid JSON", { cause });
  }
  if (!Array.isArray(rows) || !rows.length) throw new Error("Empty eligibility roster");
  const seen = new Set<string>();
  return rows.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== 3 ||
        typeof row[0] !== "string" || !/^\d{4}-\d{3}$/.test(row[0]) ||
        row[1] !== 1 || typeof row[2] !== "string" || !row[2].trim()) {
      throw new Error("Unrecognized official eligibility row; review upstream format");
    }
    if (seen.has(row[0])) throw new Error(`Duplicate official form: ${row[0]}`);
    seen.add(row[0]);
    return { formId: row[0], nationalDex: Number(row[0].slice(0, 4)), name: row[2] };
  });
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": "Delta-Stream-VGC/0.1 (manual team data update)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function mapLimit<T, U>(
  items: readonly T[],
  limit: number,
  action: (item: T) => Promise<U>,
): Promise<U[]> {
  const result = new Array<U>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await action(items[index] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return result;
}

export async function ingestTournament(
  event: TournamentEvent,
): Promise<TournamentData> {
  if (event.source === "pikalytics") {
    return parsePikalyticsTournament(await fetchText(event.sourceUrl), event);
  }
  const tournamentId = urlId(event.sourceUrl);
  if (!tournamentId) throw new Error(`${event.id}: missing RK9 tournament id`);
  const entries = parseRk9Roster(
    await fetchText(`https://rk9.gg/roster/${tournamentId}`),
  );
  const teams = await mapLimit(
    entries,
    4,
    async (entry): Promise<PlacedTeam> => {
      const roster = parseRk9TeamList(await fetchText(entry.teamUrl));
      const placement = placementBucket(entry.position);
      if (!placement)
        throw new Error(`${event.id}: unsupported placement ${entry.position}`);
      return {
        eventId: event.id,
        player: entry.player,
        placement,
        roster,
        sourceUrl: entry.teamUrl,
      };
    },
  );
  return { event, teams };
}

export function parsePikalyticsUsage(markdown: string): Record<string, number> {
  const usage: Record<string, number> = {};
  let inUsage = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) inUsage = line.includes("Pokemon by Usage");
    if (!inUsage || !line.startsWith("|") || /---/.test(line)) continue;
    const cells = splitMarkdownRow(line);
    if (cells.length !== 7 || !/^\d+$/.test(cells[0] as string)) continue;
    const value = Number.parseFloat((cells[2] as string).replace("%", ""));
    if (Number.isFinite(value))
      usage[canonicalPokemonName(plainText(cells[1] as string))] = value;
  }
  return usage;
}

export function emptySnapshot(activeRegulation: string): MetaSnapshot {
  return {
    generatedAt: new Date(0).toISOString(),
    activeRegulation,
    tournaments: [],
    pikalyticsUsage: {},
  };
}

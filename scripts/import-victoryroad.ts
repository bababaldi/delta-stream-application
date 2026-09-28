// Owner-approved import of public M-C Victory Road result rows and Open Team Lists.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  canonicalPokemonName,
  placementBucket,
  validateTournamentData,
  type TournamentData,
} from "../src/meta.js";
import { fetchText } from "../src/sources.js";

interface EventConfig {
  id: string;
  name: string;
  date: string;
  sourceUrl: string;
  recordRounds: number;
  expectedOpenLists: number;
}

interface OpenListMember {
  name?: string;
  species?: string;
  item?: string;
  ability?: string;
  nature?: string;
  moves?: unknown;
  megaEvolution?: { megaSpecies?: string };
}

interface OpenListData {
  teams?: OpenListMember[];
}

interface ResultRow {
  placement: number;
  player: string;
  record: { wins: number; losses: number };
  sourceUrl: string;
  pasteId: string;
  publishedRoster: string[];
}

type ImportedEvent = {
  data: TournamentData;
  resultSha256: string;
  teamDataSha256: string;
  completeRecords: number;
};

const EVENTS: readonly EventConfig[] = [
  {
    id: "vr-sep26", name: "VR September Challenge #1", date: "2026-09-13",
    sourceUrl: "https://victoryroad.pro/vr-sep26/", recordRounds: 11,
    expectedOpenLists: 55,
  },
  {
    id: "vr-sep26-2", name: "VR September Challenge #2", date: "2026-09-20",
    sourceUrl: "https://victoryroad.pro/vr-sep26-2/", recordRounds: 10,
    expectedOpenLists: 36,
  },
];
const API_BASE = "https://vrpaste-backend.vercel.app/api/paste";
const reviewedPath = new URL("../data/reviewed-results.json", import.meta.url);
const manifestPath = new URL("../data/review/victoryroad-mc-open-team-lists-manifest.json", import.meta.url);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'");
}

function plainText(markup: string): string {
  return decodeHtml(markup.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function rosterKey(name: string): string {
  return canonicalPokemonName(name.replace(/[’']/g, ""));
}

function resultRows(html: string, config: EventConfig): ResultRow[] {
  const rows: ResultRow[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(
    /href=["'](https?:\/\/(?:www\.)?vrpastes\.com\/([A-Za-z0-9]+))["']/gi,
  )) {
    const sourceUrl = match[1];
    const pasteId = match[2];
    if (!sourceUrl || !pasteId || seen.has(pasteId)) continue;
    seen.add(pasteId);
    const start = html.lastIndexOf("<tr", match.index);
    const end = html.indexOf("</tr>", match.index);
    if (start < 0 || end < 0) throw new Error(`Missing result row for ${pasteId}`);
    const cells = [...html.slice(start, end + 5).matchAll(
      /<td\b[^>]*>([\s\S]*?)<\/td>/gi,
    )].map((cell) => cell[1] ?? "");
    const placement = Number.parseInt(plainText(cells[0] ?? ""), 10);
    const record = plainText(cells[1] ?? "").match(/^(\d+)-(\d+)$/);
    const player = plainText(cells[3] ?? "").replace(/\s*\([^)]*\)\s*$/, "");
    const publishedRoster = [...(cells[5] ?? "").matchAll(
      /<img\b[^>]*\btitle=["']([^"']+)["'][^>]*>/gi,
    )].map((image) => decodeHtml(image[1] ?? "").trim()).filter(Boolean);
    if (!Number.isInteger(placement) || placement < 1 || placement > 64 ||
        !record || !player || publishedRoster.length !== 6)
      throw new Error(`Incomplete public result row for ${pasteId}`);
    if (new Set(publishedRoster.map(rosterKey)).size !== 6)
      throw new Error(`Duplicate Pokémon in public result row for ${pasteId}`);
    rows.push({
      placement,
      player,
      record: { wins: Number(record[1]), losses: Number(record[2]) },
      sourceUrl,
      pasteId,
      publishedRoster,
    });
  }
  if (rows.length !== config.expectedOpenLists)
    throw new Error(`${config.name} expected ${config.expectedOpenLists} public Open Team Lists, found ${rows.length}`);
  return rows.sort((left, right) => left.placement - right.placement);
}

function memberFromOpenList(member: OpenListMember, row: ResultRow) {
  const rawSpecies = member.megaEvolution?.megaSpecies ?? member.species ?? member.name;
  const pokemon = row.publishedRoster.find(
    (published) => rosterKey(published) === rosterKey(rawSpecies ?? ""),
  );
  if (!pokemon || !member.item || !member.ability || !member.nature ||
      !Array.isArray(member.moves) || member.moves.length !== 4 ||
      member.moves.some((move) => typeof move !== "string" || !move.trim()))
    throw new Error(`Incomplete Open Team List for ${row.player} (Top ${row.placement})`);
  return {
    pokemon,
    item: member.item,
    ability: member.ability,
    nature: member.nature,
    moves: member.moves as string[],
  };
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
      const index = cursor++;
      result[index] = await action(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

async function importEvent(config: EventConfig): Promise<ImportedEvent> {
  const resultText = await fetchText(config.sourceUrl);
  const rows = resultRows(resultText, config);
  const teams = await mapLimit(rows, 4, async (row) => {
    const text = await fetchText(`${API_BASE}/${row.pasteId}?lang=english`);
    let openList: OpenListData;
    try { openList = JSON.parse(text) as OpenListData; }
    catch (cause) { throw new Error(`Invalid Open Team List for ${row.pasteId}`, { cause }); }
    if (!Array.isArray(openList.teams) || openList.teams.length !== 6)
      throw new Error(`Open Team List has no complete roster for ${row.pasteId}`);
    const placement = placementBucket(row.placement);
    if (!placement) throw new Error(`Unsupported placement ${row.placement}`);
    const completeRecord = row.record.wins + row.record.losses === config.recordRounds;
    return {
      eventId: config.id,
      player: row.player,
      placement,
      publishedPlacement: row.placement,
      sourceUrl: row.sourceUrl,
      ...(completeRecord ? { record: row.record } : {}),
      roster: openList.teams.map((member) => memberFromOpenList(member, row)),
    };
  });
  const data: TournamentData = {
    event: {
      id: config.id,
      name: config.name,
      date: config.date,
      regulation: "champions-regulation-mc",
      tier: "online",
      region: "OTHER",
      source: "victoryroad",
      sourceUrl: config.sourceUrl,
      recordRounds: config.recordRounds,
    },
    teams,
  };
  const errors = validateTournamentData(data);
  if (errors.length) throw new Error(errors.join("; "));
  return {
    data,
    resultSha256: sha256(resultText),
    teamDataSha256: sha256(JSON.stringify(teams)),
    completeRecords: teams.filter((team) => team.record).length,
  };
}

let reviewed: TournamentData[];
try { reviewed = JSON.parse(await readFile(reviewedPath, "utf8")) as TournamentData[]; }
catch (cause) { throw new Error("Could not read reviewed results", { cause }); }
if (!Array.isArray(reviewed)) throw new Error("Reviewed results must be an array");

const imported = await Promise.all(EVENTS.map(importEvent));
const replacements = new Map(imported.map(({ data }) => [data.event.id, data]));
for (const data of replacements.values()) {
  const existing = reviewed.find(({ event }) => event.id === data.event.id);
  if (existing && existing.event.sourceUrl !== data.event.sourceUrl)
    throw new Error(`${data.event.id} source changed; review it before replacing data`);
}
const merged = [
  ...reviewed.map((tournament) => replacements.get(tournament.event.id) ?? tournament),
  ...[...replacements.values()].filter(
    (data) => !reviewed.some(({ event }) => event.id === data.event.id),
  ),
];
await writeFile(reviewedPath, `${JSON.stringify(merged, null, 2)}\n`);
const manifest = {
  reviewStatus: "owner-approved",
  regulation: "champions-regulation-mc",
  sources: imported.map((event) => ({
    eventId: event.data.event.id,
    sourceUrl: event.data.event.sourceUrl,
    resultSha256: event.resultSha256,
    importedOpenTeamLists: event.data.teams.length,
    completeRecords: event.completeRecords,
    teamDataSha256: event.teamDataSha256,
  })),
  note: "Every imported roster is linked directly from the public Victory Road result table. Nature, item, ability and four moves come from the linked public Open Team List; stat points are not published and remain unset.",
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Imported ${imported.reduce((total, event) => total + event.data.teams.length, 0)} owner-approved Victory Road Open Team Lists.`);

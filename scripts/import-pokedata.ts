// Reviewed completed-event import. Do not add an event here while play is in progress.
import { readFile, writeFile } from "node:fs/promises";
import { fetchText } from "../src/sources.js";
import { placementBucket, validateTournamentData, type TournamentData } from "../src/meta.js";

interface EventConfig {
  id: string;
  name: string;
  date: string;
  region: "NA" | "EU" | "OCE";
  sourceUrl: string;
  minimumRows: number;
  recordRounds: number;
}

interface PokeDataMember {
  name?: string;
  ability?: string;
  item?: string;
  badges?: string[];
}

interface PokeDataRow {
  name?: string;
  placing?: number;
  record?: { wins?: number; losses?: number };
  decklist?: PokeDataMember[];
}

const EVENTS: readonly EventConfig[] = [
  {
    id: "baltimore-2027", name: "2027 Baltimore Regional Masters", date: "2026-09-20", region: "NA",
    sourceUrl: "https://www.pokedata.ovh/standingsVGC/0000192/masters/0000192_Masters.json",
    minimumRows: 1000, recordRounds: 17,
  },
  {
    id: "brisbane-2027", name: "2027 Brisbane Regional Masters", date: "2026-09-27", region: "OCE",
    sourceUrl: "https://www.pokedata.ovh/standingsVGC/0000193/masters/0000193_Masters.json",
    minimumRows: 300, recordRounds: 15,
  },
  {
    id: "frankfurt-2027", name: "2027 Frankfurt Regional Masters", date: "2026-09-27", region: "EU",
    sourceUrl: "https://www.pokedata.ovh/standingsVGC/0000194/masters/0000194_Masters.json",
    minimumRows: 1000, recordRounds: 17,
  },
];
const reviewedPath = new URL("../data/reviewed-results.json", import.meta.url);

function completeRecord(
  row: PokeDataRow,
  rounds: number,
): { wins: number; losses: number } | undefined {
  const { wins, losses } = row.record ?? {};
  if (typeof wins !== "number" || typeof losses !== "number" ||
      !Number.isInteger(wins) || !Number.isInteger(losses) ||
      wins < 0 || losses < 0 || wins + losses !== rounds) return undefined;
  return { wins, losses };
}

async function importEvent(config: EventConfig): Promise<TournamentData> {
  let rows: PokeDataRow[];
  try { rows = JSON.parse(await fetchText(config.sourceUrl)) as PokeDataRow[]; }
  catch (cause) { throw new Error(`Could not read ${config.name} Pokédata JSON`, { cause }); }
  if (!Array.isArray(rows) || rows.length < config.minimumRows)
    throw new Error(`${config.name} standings missing or incomplete`);
  const teams = rows
    .filter((row) => Number.isInteger(row.placing) && (row.placing as number) >= 1 && (row.placing as number) <= 8)
    .map((row) => {
      if (!row.name || !Array.isArray(row.decklist) || row.decklist.length !== 6 ||
          row.decklist.some((member) => !member.name || !member.ability || !member.item || !Array.isArray(member.badges) || member.badges.length !== 4))
        throw new Error(`Incomplete ${config.name} team at placement ${row.placing}`);
      const placement = placementBucket(row.placing as number);
      if (!placement) throw new Error(`Invalid ${config.name} placement`);
      const record = completeRecord(row, config.recordRounds);
      return {
        eventId: config.id, player: row.name, placement, sourceUrl: config.sourceUrl,
        ...(record ? { record } : {}),
        roster: row.decklist.map((member) => ({
          pokemon: member.name as string, ability: member.ability as string,
          item: member.item as string, moves: member.badges as string[],
        })),
      };
    });
  if (teams.length !== 8) throw new Error(`${config.name} top 8 is incomplete`);
  const data: TournamentData = {
    event: {
      id: config.id, name: config.name, date: config.date, region: config.region,
      sourceUrl: config.sourceUrl, recordRounds: config.recordRounds,
      tier: "regional", regulation: "champions-regulation-mc", source: "pokedata",
    },
    teams,
  };
  const errors = validateTournamentData(data);
  if (errors.length) throw new Error(errors.join("; "));
  return data;
}

let reviewed: TournamentData[];
try { reviewed = JSON.parse(await readFile(reviewedPath, "utf8")) as TournamentData[]; }
catch (cause) { throw new Error("Could not read reviewed results", { cause }); }
if (!Array.isArray(reviewed)) throw new Error("Reviewed results must be an array");
for (const tournament of await Promise.all(EVENTS.map(importEvent))) {
  const index = reviewed.findIndex(({ event }) => event.id === tournament.event.id);
  if (index >= 0 && reviewed[index]?.event.sourceUrl !== tournament.event.sourceUrl)
    throw new Error(`${tournament.event.id} source changed; review it before replacing data`);
  if (index < 0) reviewed.push(tournament);
  else reviewed[index] = tournament;
}
await writeFile(reviewedPath, `${JSON.stringify(reviewed, null, 2)}\n`);
console.log(`Imported ${EVENTS.length} completed Pokédata Regional top eights.`);

// Owner-reviewed local evidence. The source has winner rosters only, never full sets or Swiss records.
import { readFile, writeFile } from "node:fs/promises";
import { fetchText } from "../src/sources.js";
import { validateTournamentData, type TournamentData } from "../src/meta.js";

const SOURCE_URL = "https://shairaba.github.io/vgc-locals-italia/data/tournaments.json";
const MINIMUM_TOURNAMENTS = 20;
const reviewedPath = new URL("../data/reviewed-results.json", import.meta.url);

interface LocalSpecies { species_name?: string; }
interface LocalTournament {
  id?: string;
  name?: string;
  date?: string;
  tournament_type?: string;
  number_of_players?: number;
  top_cut_size?: number;
  winner?: { player_name?: string; placement?: string; team?: LocalSpecies[] };
}

function asTournament(source: LocalTournament, today: string): TournamentData {
  const winner = source.winner;
  if (!source.id || !source.name || !source.date || source.date >= today ||
      !["VG Cup", "VG Challenge"].includes(source.tournament_type ?? "") ||
      typeof source.number_of_players !== "number" ||
      !Number.isInteger(source.number_of_players) || source.number_of_players < 2 ||
      typeof source.top_cut_size !== "number" ||
      !Number.isInteger(source.top_cut_size) || source.top_cut_size < 2 ||
      !winner?.player_name || winner.placement !== "1st" ||
      !Array.isArray(winner.team) || winner.team.length !== 6 ||
      winner.team.some(({ species_name }) => !species_name)) {
    throw new Error(`Incomplete or unreviewed Italian local: ${source.id ?? "unknown"}`);
  }
  const id = `italian-local-${source.id}`;
  const sourceUrl = `${SOURCE_URL}#${source.id}`;
  const data: TournamentData = {
    event: {
      id, name: `${source.tournament_type}: ${source.name}`, date: source.date,
      regulation: "champions-regulation-mc", tier: "local", region: "EU",
      source: "italianlocals", sourceUrl,
    },
    teams: [{
      eventId: id, player: winner.player_name, placement: 1, sourceUrl,
      roster: winner.team.map(({ species_name }) => ({ pokemon: species_name as string })),
    }],
  };
  const errors = validateTournamentData(data);
  if (errors.length) throw new Error(errors.join("; "));
  return data;
}

let source: LocalTournament[];
try { source = JSON.parse(await fetchText(SOURCE_URL)) as LocalTournament[]; }
catch (cause) { throw new Error("Could not read VGC Locals Italia JSON", { cause }); }
if (!Array.isArray(source) || source.length < MINIMUM_TOURNAMENTS)
  throw new Error("VGC Locals Italia data is missing or incomplete");
const today = new Date().toISOString().slice(0, 10);
const locals = source.map((event) => asTournament(event, today));
if (new Set(locals.map(({ event }) => event.id)).size !== locals.length)
  throw new Error("VGC Locals Italia contains duplicate event IDs");

let reviewed: TournamentData[];
try { reviewed = JSON.parse(await readFile(reviewedPath, "utf8")) as TournamentData[]; }
catch (cause) { throw new Error("Could not read reviewed results", { cause }); }
if (!Array.isArray(reviewed)) throw new Error("Reviewed results must be an array");
const preserved = reviewed.filter(({ event }) => event.source !== "italianlocals");
if (new Set([...preserved, ...locals].map(({ event }) => event.id)).size !== preserved.length + locals.length)
  throw new Error("Italian local event ID conflicts with reviewed data");
await writeFile(reviewedPath, `${JSON.stringify([...preserved, ...locals], null, 2)}\n`);
console.log(`Imported ${locals.length} reviewed Italian VG Cup/Challenge winners as local evidence.`);

// Reviewed completed-event import. Do not add an event here while play is in progress.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import legalityData from "../data/legality.json" with { type: "json" };
import { canonicalPokemonName, placementBucket, validateTournamentData, type TournamentData } from "../src/meta.js";
import { fetchText } from "../src/sources.js";
import { validateTeam, type LegalityRules, type TeamSlot } from "../src/team.js";

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

const reviewDraftPath = new URL("../data/review/reviewed-results-mc-top24-draft.json", import.meta.url);
const reviewManifestPath = new URL("../data/review/reviewed-results-mc-top24-manifest.json", import.meta.url);
const reviewTop24 = process.argv.includes("--review-top24");
const promoteTop24 = process.argv.includes("--promote-top24");
if (reviewTop24 && promoteTop24)
  throw new Error("Choose either --review-top24 or --promote-top24");
const maximumPlacement = reviewTop24 || promoteTop24 ? 24 : 8;
const approvedRules = legalityData as LegalityRules;

const PROPOSED_FORM_ALIASES: Readonly<Record<string, { approvedBase: string; officialBaseFormId: string }>> = {
  "maushold-family-of-three": { approvedBase: "maushold", officialBaseFormId: "0925-001" },
  "sinistcha-masterpiece": { approvedBase: "sinistcha", officialBaseFormId: "1013-000" },
  "sinistcha-unremarkable": { approvedBase: "sinistcha", officialBaseFormId: "1013-000" },
};

type ImportedEvent = {
  data: TournamentData;
  sourceSha256: string;
  completeRecords: number;
  omittedRecords: number;
};

type AliasReview = {
  canonicalAlias: string;
  proposedBase: string;
  officialBaseFormId: string;
  sourceLabels: string[];
  occurrences: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

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

function reviewRules(): LegalityRules {
  const allowedPokemon = [...(approvedRules.allowedPokemon ?? [])];
  const allowedMoves = { ...approvedRules.allowedMoves };
  const allowedAbilities = { ...approvedRules.allowedAbilities };
  const speciesClauseKeys = { ...approvedRules.speciesClauseKeys };
  for (const [alias, proposal] of Object.entries(PROPOSED_FORM_ALIASES)) {
    const moves = allowedMoves[proposal.approvedBase];
    const abilities = allowedAbilities[proposal.approvedBase];
    if (!moves || !abilities)
      throw new Error(`Approved base catalog is incomplete for candidate alias ${alias}`);
    allowedPokemon.push(alias);
    allowedMoves[alias] = moves;
    allowedAbilities[alias] = abilities;
    speciesClauseKeys[alias] = speciesClauseKeys[proposal.approvedBase] ?? proposal.approvedBase;
  }
  return { ...approvedRules, allowedPokemon, allowedMoves, allowedAbilities, speciesClauseKeys };
}

function candidateAliasReview(tournaments: readonly TournamentData[]): AliasReview[] {
  const approvedPokemon = new Set(
    (approvedRules.allowedPokemon ?? []).map(canonicalPokemonName),
  );
  const observed = new Map<string, { labels: Set<string>; occurrences: number }>();
  for (const tournament of tournaments) {
    for (const team of tournament.teams) {
      for (const member of team.roster) {
        const alias = canonicalPokemonName(member.pokemon);
        if (approvedPokemon.has(alias)) continue;
        const proposal = PROPOSED_FORM_ALIASES[alias];
        if (!proposal)
          throw new Error(`Unreviewed candidate Pokémon alias: ${member.pokemon}`);
        const value = observed.get(alias) ?? { labels: new Set<string>(), occurrences: 0 };
        value.labels.add(member.pokemon);
        value.occurrences += 1;
        observed.set(alias, value);
      }
    }
  }
  return [...observed]
    .map(([canonicalAlias, value]) => ({
      canonicalAlias,
      proposedBase: PROPOSED_FORM_ALIASES[canonicalAlias]?.approvedBase ?? "",
      officialBaseFormId: PROPOSED_FORM_ALIASES[canonicalAlias]?.officialBaseFormId ?? "",
      sourceLabels: [...value.labels].sort((left, right) => left.localeCompare(right)),
      occurrences: value.occurrences,
    }))
    .sort((left, right) => left.canonicalAlias.localeCompare(right.canonicalAlias));
}

function validateReviewDraft(tournaments: readonly TournamentData[]): AliasReview[] {
  const aliases = candidateAliasReview(tournaments);
  const rules = reviewRules();
  const errors = tournaments.flatMap((tournament) =>
    tournament.teams.flatMap((team) => {
      const slots: TeamSlot[] = team.roster.map((member) => ({
        species: member.pokemon,
        ability: member.ability,
        item: member.item,
        moves: member.moves ?? [],
      }));
      return validateTeam(slots, rules, false, true).map(
        (issue) => `${tournament.event.id} Top ${team.placement}: ${issue.message}`,
      );
    }),
  );
  if (errors.length) throw new Error(errors.join("; "));
  return aliases;
}

async function importEvent(
  config: EventConfig,
  maximumPlacement: number,
): Promise<ImportedEvent> {
  let text: string;
  try { text = await fetchText(config.sourceUrl); }
  catch (cause) { throw new Error(`Could not read ${config.name} Pokédata JSON`, { cause }); }
  let rows: PokeDataRow[];
  try { rows = JSON.parse(text) as PokeDataRow[]; }
  catch (cause) { throw new Error(`Could not parse ${config.name} Pokédata JSON`, { cause }); }
  if (!Array.isArray(rows) || rows.length < config.minimumRows)
    throw new Error(`${config.name} standings missing or incomplete`);
  const selected = rows.filter(
    (row) => Number.isInteger(row.placing) && (row.placing as number) >= 1 &&
      (row.placing as number) <= maximumPlacement,
  );
  const teams = selected.map((row) => {
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
  if (teams.length !== maximumPlacement)
    throw new Error(`${config.name} top ${maximumPlacement} is incomplete`);
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
  return {
    data,
    sourceSha256: sha256(text),
    completeRecords: teams.filter((team) => team.record).length,
    omittedRecords: selected.filter((row) => row.record && !completeRecord(row, config.recordRounds)).length,
  };
}

let reviewed: TournamentData[];
try { reviewed = JSON.parse(await readFile(reviewedPath, "utf8")) as TournamentData[]; }
catch (cause) { throw new Error("Could not read reviewed results", { cause }); }
if (!Array.isArray(reviewed)) throw new Error("Reviewed results must be an array");

const imported = await Promise.all(
  EVENTS.map((event) => importEvent(event, maximumPlacement)),
);
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

if (!reviewTop24) {
  await writeFile(reviewedPath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`Imported ${EVENTS.length} completed Pokédata Regional top ${maximumPlacement}.`);
} else {
  const aliases = validateReviewDraft(imported.map(({ data }) => data));
  const draftText = `${JSON.stringify(merged, null, 2)}\n`;
  await writeFile(reviewDraftPath, draftText);
  const teamRecords = merged.reduce((total, tournament) => total + tournament.teams.length, 0);
  const manifest = {
    reviewStatus: "pending-owner-review",
    regulation: "champions-regulation-mc",
    target: {
      placementDepth: maximumPlacement,
      totalTeamRecords: teamRecords,
      sourceBackedPokeDataTeamRecords: imported.reduce(
        (total, event) => total + event.data.teams.length,
        0,
      ),
    },
    draft: {
      path: "data/review/reviewed-results-mc-top24-draft.json",
      sha256: sha256(draftText),
    },
    sources: imported.map((event) => ({
      eventId: event.data.event.id,
      sourceUrl: event.data.event.sourceUrl,
      sourceSha256: event.sourceSha256,
      importedTeams: event.data.teams.length,
      completeRecords: event.completeRecords,
      omittedAmbiguousRecords: event.omittedRecords,
    })),
    requiredCatalogReview: {
      proposedFormAliases: aliases,
      note: "These aliases are not added to data/legality.json by this draft. Owner approval is required before promotion.",
    },
    scorePolicy: "Every placed roster and its 2–4 Pokémon cores use the same placement × tier × recency score. New placements add current evidence; old evidence decays at 31, 61 and 91 days.",
  };
  await writeFile(reviewManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote a pending-owner-review top-${maximumPlacement} draft with ${teamRecords} team records; production reviewed results are unchanged.`);
}

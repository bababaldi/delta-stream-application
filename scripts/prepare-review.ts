import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fetchText, ingestTournament, parseChampionsEligibility } from "../src/sources.js";
import { validateTournamentData, type TournamentEvent } from "../src/meta.js";

// Review-only: this script never modifies approved manifests or runtime catalogs.
const rosterUrl = "https://web-view.app.pokemonchampions.jp/battle/pages/events/rs178066986988lmoqpm/en/pokemon.html";
const event: TournamentEvent = {
  id: "WCS02wAQpCIaqFmXxER4", name: "2026 Pokémon World Championships — Masters",
  date: "2026-08-28", regulation: "champions-regulation-mb", tier: "worlds", region: "NA",
  source: "rk9", sourceUrl: "https://rk9.gg/tournament/WCS02wAQpCIaqFmXxER4",
};

async function main(): Promise<void> {
  const output = new URL("../data/review/", import.meta.url);
  await mkdir(output, { recursive: true });
  const generatedAt = new Date().toISOString();
  const html = await fetchText(rosterUrl);
  const pokemon = parseChampionsEligibility(html);
  await writeFile(new URL("eligibility-mb.json", output), JSON.stringify({
    status: "pending-owner-approval", generatedAt, regulation: event.regulation,
    rankedStartsAt: "2026-06-17T02:00:00Z", rankedEndsAtExclusive: "2026-09-09T02:00:00Z",
    sourceUrl: rosterUrl, sourceSha256: createHash("sha256").update(html).digest("hex"),
    regulationSource: "https://news.pokemon-home.com/en/page/776.html", pokemon,
    limitations: ["Not a complete legality catalog: move learnsets, abilities and items still need verification", "Official form names must be mapped explicitly to Poképaste/calculator aliases", "Ranked dates do not establish any tournament's regulation"],
  }, null, 2) + "\n");
  console.log(`Prepared ${pokemon.length} official form entries for review.`);
  const tournament = await ingestTournament(event);
  const errors = validateTournamentData(tournament);
  const missingDetails = tournament.teams.flatMap((team) => team.roster.filter((slot) => !slot.ability || !slot.moves?.length).map((slot) => `${team.player}: ${slot.pokemon}`));
  await writeFile(new URL("worlds-2026.json", output), JSON.stringify({
    status: "pending-owner-approval", generatedAt, tournament, errors, missingDetails,
    corroboratingSources: [
      "https://www.pokemon.com/us/play-pokemon/worlds/2026/event-results",
      "https://worlds.pokemon.com/en-us/coverage-rewards/live-updates/",
      "https://www.pokemon.com/us/features/pokemon-champions-regulation-m-b-double-battles-overview",
    ],
    limitations: ["Masters Top 64 only; public sheets are not proof of move/ability legality", "Player names and results require comparison with official final standings before approval"],
  }, null, 2) + "\n");
  console.log(`Prepared ${tournament.teams.length} placed teams; ${errors.length} structural issues; ${missingDetails.length} incomplete sets. Nothing approved.`);
  if (errors.length || missingDetails.length) process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

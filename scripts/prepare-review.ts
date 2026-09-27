import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fetchText, parseChampionsEligibility } from "../src/sources.js";

// Review-only. Changing a regulation requires verifying its official sources again.
const regulation = "champions-regulation-mc";
const rosterUrl = "https://web-view.app.pokemonchampions.jp/battle/pages/events/rs178713870219xeaaio/en/pokemon.html";

async function main(): Promise<void> {
  let config: { activeRegulation: string };
  try {
    config = JSON.parse(await readFile(new URL("../data/config.json", import.meta.url), "utf8"));
  } catch {
    throw new Error("Cannot read data/config.json");
  }
  if (config.activeRegulation !== regulation)
    throw new Error("This review source is M-C only; verify new official sources before changing regulation.");
  const output = new URL("../data/review/", import.meta.url);
  await mkdir(output, { recursive: true });
  const html = await fetchText(rosterUrl);
  const pokemon = parseChampionsEligibility(html);
  await writeFile(new URL("eligibility-mc.json", output), JSON.stringify({
    status: "pending-owner-approval", generatedAt: new Date().toISOString(), regulation,
    rankedStartsAt: "2026-09-09T02:00:00Z", rankedEndsAtExclusive: "2026-12-02T02:00:00Z",
    sourceUrl: rosterUrl, sourceSha256: createHash("sha256").update(html).digest("hex"),
    regulationSource: "https://news.pokemon-home.com/en/page/816.html", pokemon,
    limitations: [
      "Not a complete legality catalog: move learnsets, abilities and items still need verification",
      "Official form names must be mapped explicitly to Poképaste/calculator aliases",
      "Ranked dates do not establish any tournament's regulation or final standings",
      "Existing M-B review artifacts are historical and are not regenerated or promoted",
    ],
  }, null, 2) + "\n");
  console.log(`Prepared ${pokemon.length} official M-C form entries in data/review/eligibility-mc.json. Nothing approved; production catalogs unchanged.`);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

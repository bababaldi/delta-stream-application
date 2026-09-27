import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { CHAMPIONS_ITEMS } from "../src/items.js";
import { canonicalPokemonName, type MetaSnapshot } from "../src/meta.js";
import { fetchText } from "../src/sources.js";

const DATA_DIR = new URL("../data/", import.meta.url);
const SEREBII_INDEX = "https://www.serebii.net/pokedex-champions/";
const REQUEST_DELAY_MS = 350;

type EligibilityEntry = { name: string };
type EligibilityReview = {
  regulation: string;
  sourceUrl: string;
  sourceSha256: string;
  pokemon: EligibilityEntry[];
};

type SerebiiEntry = { slug: string; name: string };
type SerebiiSetData = { moves: string[]; abilities: string[] };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
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

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

/** Maps regional, gender, seasonal, and Mega display labels to the source species page. */
function baseSpeciesKey(name: string): string {
  let value = name
    .replace(/\s*\[[^\]]+\]/g, "")
    .replace(/\s*\([^)]*\)/g, "")
    .trim();
  const isMega = /(?:^|[-\s])mega(?:[-\s]|$)/i.test(value);
  value = value
    .replace(/^mega[-\s]+/i, "")
    .replace(/[-\s]+mega(?:[-\s]+[xyz])?$/i, "")
    .replace(/^(?:alolan|galarian|hisuian|paldean)\s+/i, "")
    .replace(/[-\s]+(?:alola|galar|hisui|paldea)$/i, "")
    .replace(/[♀♂]/g, "")
    .replace(/\s+[mf]$/i, "");
  if (isMega) value = value.replace(/[-\s]+[xyz]$/i, "");
  return canonicalPokemonName(value);
}

function parseIndex(html: string): SerebiiEntry[] {
  const entries = new Map<string, SerebiiEntry>();
  for (const match of html.matchAll(
    /<option value="\/pokedex-champions\/([^/]+)\/">([^<]+)<\/option>/g,
  )) {
    const slug = match[1];
    const name = decodeHtml((match[2] ?? "").replace(/^\d+\s+/, "").trim());
    if (slug && name) entries.set(slug, { slug, name });
  }
  return [...entries.values()];
}

function parseSetData(html: string): SerebiiSetData {
  const abilityMarkup = html.match(/<b>Abilities<\/b>:\s*([\s\S]*?)<\/td>/i)?.[1] ?? "";
  const abilities = uniqueSorted(
    [...abilityMarkup.matchAll(/<b>([^<]+)<\/b>/g)].map((match) =>
      decodeHtml((match[1] ?? "").replace(/<[^>]+>/g, "")),
    ),
  );
  const moves = uniqueSorted(
    [...html.matchAll(/href="\/attackdex-champions\/[^/"]+\.shtml">([^<]+)<\/a>/g)].map(
      (match) => decodeHtml((match[1] ?? "").replace(/<[^>]+>/g, "")),
    ),
  );
  return { moves, abilities };
}

async function delayedFetch(url: string): Promise<string> {
  const result = await fetchText(url);
  await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
  return result;
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

function observedSets(snapshot: MetaSnapshot): Map<string, SerebiiSetData> {
  const result = new Map<string, SerebiiSetData>();
  for (const tournament of snapshot.tournaments) {
    for (const team of tournament.teams) {
      for (const member of team.roster) {
        const key = baseSpeciesKey(member.pokemon);
        const current = result.get(key) ?? { moves: [], abilities: [] };
        result.set(key, {
          moves: uniqueSorted([...current.moves, ...(member.moves ?? [])]),
          abilities: uniqueSorted([
            ...current.abilities,
            ...(member.ability ? [member.ability] : []),
          ]),
        });
      }
    }
  }
  return result;
}

async function main(): Promise<void> {
  const [reviewText, snapshotText, indexHtml] = await Promise.all([
    readFile(new URL("review/eligibility-mc.json", DATA_DIR), "utf8"),
    readFile(new URL("snapshot.json", DATA_DIR), "utf8"),
    delayedFetch(SEREBII_INDEX),
  ]);
  const review = parseJson<EligibilityReview>(reviewText, "eligibility review");
  const snapshot = parseJson<MetaSnapshot>(snapshotText, "snapshot");
  if (review.regulation !== snapshot.activeRegulation)
    throw new Error("Eligibility review and snapshot use different regulations");
  if (!Array.isArray(review.pokemon) || !review.pokemon.length)
    throw new Error("Official eligibility review contains no Pokémon");

  const index = parseIndex(indexHtml);
  const indexByBaseKey = new Map(index.map((entry) => [baseSpeciesKey(entry.name), entry]));
  const sourceForEligibility = new Map<string, SerebiiEntry>();
  const missingSource: string[] = [];
  for (const entry of review.pokemon) {
    const source = indexByBaseKey.get(baseSpeciesKey(entry.name));
    if (source) sourceForEligibility.set(baseSpeciesKey(entry.name), source);
    else missingSource.push(entry.name);
  }
  if (missingSource.length)
    throw new Error(`Serebii has no Champions page for: ${missingSource.join(", ")}`);

  const requiredSources = [...new Map(
    [...sourceForEligibility.values()].map((entry) => [entry.slug, entry]),
  ).values()];
  console.log(`Fetching move and ability data for ${requiredSources.length} Champions species pages...`);
  const fetched = await mapLimit(requiredSources, 2, async (entry) => ({
    key: baseSpeciesKey(entry.name),
    source: entry,
    data: parseSetData(
      await delayedFetch(`https://www.serebii.net/pokedex-champions/${entry.slug}/`),
    ),
  }));
  const dataByBaseKey = new Map(fetched.map((entry) => [entry.key, entry.data]));
  const incomplete = fetched.filter(
    (entry) => !entry.data.moves.length || !entry.data.abilities.length,
  );
  if (incomplete.length)
    throw new Error(
      `Serebii returned incomplete data for: ${incomplete.map((entry) => entry.source.name).join(", ")}`,
    );

  const observed = observedSets(snapshot);
  const allowedPokemon = uniqueSorted([
    ...review.pokemon.map((entry) => entry.name),
    ...snapshot.tournaments.flatMap((tournament) =>
      tournament.teams.flatMap((team) => team.roster.map((member) => member.pokemon)),
    ),
  ]);
  const allowedMoves: Record<string, string[]> = {};
  const allowedAbilities: Record<string, string[]> = {};
  const speciesClauseKeys: Record<string, string> = {};
  for (const name of allowedPokemon) {
    const key = canonicalPokemonName(name);
    const baseKey = baseSpeciesKey(name);
    const sourceData = dataByBaseKey.get(baseKey);
    if (!sourceData) throw new Error(`No source data mapped for ${name}`);
    const observedData = observed.get(baseKey);
    allowedMoves[key] = uniqueSorted([
      ...sourceData.moves,
      ...(observedData?.moves ?? []),
    ]);
    allowedAbilities[key] = uniqueSorted([
      ...sourceData.abilities,
      ...(observedData?.abilities ?? []),
    ]);
    speciesClauseKeys[key] = baseKey;
  }

  const catalog = {
    regulation: review.regulation,
    catalogVersion: "serebii-champions-2026-09-27",
    reviewStatus: "secondary-reference-pending-owner-review",
    sources: {
      eligibility: {
        url: review.sourceUrl,
        sha256: review.sourceSha256,
        entries: review.pokemon.length,
      },
      movesAndAbilities: {
        url: SEREBII_INDEX,
        indexSha256: sha256(indexHtml),
        pages: requiredSources.length,
        fetchedAt: new Date().toISOString(),
        note: "Serebii's Champions Pokédex is a secondary reference; source values are conservatively augmented only by reviewed tournament sets.",
      },
      items: {
        url: "https://github.com/nerd-of-now/NCP-VGC-Damage-Calculator/blob/1369b359b85f0a6343df006acde92cc4a7d07805/script_res/item_data.js",
        count: CHAMPIONS_ITEMS.length,
      },
    },
    allowedPokemon,
    allowedItems: [...CHAMPIONS_ITEMS],
    allowedTeraTypes: [],
    restrictedPokemon: [],
    maxRestricted: 0,
    allowedMoves,
    allowedAbilities,
    speciesClauseKeys,
  };
  await writeFile(
    new URL("review/legality-mc-serebii-draft.json", DATA_DIR),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
  console.log(
    `Wrote review draft with ${allowedPokemon.length} legal display names, ${requiredSources.length} source pages, and ${CHAMPIONS_ITEMS.length} items.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

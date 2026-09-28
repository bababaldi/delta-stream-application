// Review-only: Pikalytics M-C pages must publish exact EV spread/nature data before it can enter Assist.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { rankMeta, type MetaSnapshot } from "../src/meta.js";

const DATA_DIR = new URL("../data/", import.meta.url);
const FORMAT = "gen9championsvgc2026regmc";
const BASE_URL = `https://www.pikalytics.com/ai/pokedex/${FORMAT}`;
const PIKALYTICS_SLUGS: Readonly<Record<string, string>> = { "indeedee-male": "Indeedee" };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function mapLimit<T, U>(items: readonly T[], action: (item: T) => Promise<U>): Promise<U[]> {
  const result = new Array<U>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await action(items[index] as T);
    }
    return undefined;
  }));
  return result;
}

const snapshotText = await readFile(new URL("snapshot.json", DATA_DIR), "utf8");
let snapshot: MetaSnapshot;
try { snapshot = JSON.parse(snapshotText) as MetaSnapshot; }
catch (cause) { throw new Error("snapshot.json is not valid JSON", { cause }); }
const ranked = rankMeta(snapshot, snapshot.activeRegulation, new Date(snapshot.generatedAt))
  .pokemon.slice(0, 21)
  .map((entry) => entry.pokemon[0] ?? "");
const entries = await mapLimit(ranked, async (pokemon) => {
  const slug = PIKALYTICS_SLUGS[pokemon] ?? pokemon;
  const url = `${BASE_URL}/${encodeURIComponent(slug)}`;
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok || !/Pokemon Champions VGC 2026 Reg M-C/.test(text))
    throw new Error(`Unverified Pikalytics M-C page for ${pokemon}: HTTP ${response.status}`);
  if (!/No EV spread or nature data available\./i.test(text))
    throw new Error(`${pokemon} now publishes spread/nature data; review it before importing`);
  return { pokemon, url, sha256: sha256(text), noSpreadNatureData: true };
});
const audit = {
  reviewStatus: "verified-no-spread-data",
  regulation: snapshot.activeRegulation,
  pikalyticsFormat: FORMAT,
  sourceSnapshotSha256: sha256(snapshotText),
  checkedAt: new Date().toISOString(),
  entries,
  conclusion: "All 21 current M-C pages explicitly state that no EV spread or nature data is available. No Pikalytics spread recommendation is imported.",
};
await writeFile(
  new URL("review/pikalytics-mc-spread-audit.json", DATA_DIR),
  `${JSON.stringify(audit, null, 2)}\n`,
);
console.log(`Verified ${entries.length} current M-C Pikalytics pages: no spread/nature data published.`);

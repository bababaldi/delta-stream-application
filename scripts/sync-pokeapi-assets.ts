import { mkdir, readFile, writeFile } from "node:fs/promises";
import { canonicalPokemonName } from "../src/meta.js";

type BaseStats = {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
};

type PokeApiPokemon = {
  name: string;
  sprites: { front_default: string | null };
  stats: Array<{ base_stat: number; stat: { name: string } }>;
};

type PokeApiItem = {
  name: string;
  sprites: { default: string | null };
};

type ItemEntry = { name: string; pokeApiName: string; sprite?: string };
type ReviewedItemSprite = { url: string; sprite: string };
type ReviewedItemSpriteManifest = {
  sources: { pokeApiSprites: string };
  items: Record<string, ReviewedItemSprite>;
};

type PokeApiCatalog = {
  source: {
    api: string;
    sprites: string;
    reviewedItemSprites: Record<string, string>;
    fetchedAt: string;
  };
  pokemon: Record<
    string,
    { name: string; pokeApiName: string; sprite: string; baseStats: BaseStats }
  >;
  items: Record<string, ItemEntry>;
};

const DATA_DIR = new URL("../data/", import.meta.url);
const PUBLIC_DIR = new URL("../public/", import.meta.url);
const ASSET_DIR = new URL("pokeapi/", PUBLIC_DIR);
const API = "https://pokeapi.co/api/v2/";

function isReviewedItemSprite(
  key: string,
  source: Partial<ReviewedItemSprite>,
): source is ReviewedItemSprite {
  const item = Object(source) as Partial<ReviewedItemSprite>;
  return [
    /^[a-z0-9-]+$/.test(key),
    typeof item.url === "string",
    item.url?.startsWith("https://"),
    typeof item.sprite === "string",
    item.sprite?.startsWith("champions/items/"),
    !item.sprite?.includes(".."),
  ].every(Boolean);
}

function parseReviewedItemSprites(text: string): ReviewedItemSpriteManifest {
  let parsed: Partial<ReviewedItemSpriteManifest>;
  try {
    parsed = JSON.parse(text) as Partial<ReviewedItemSpriteManifest>;
  } catch {
    throw new Error("Reviewed Champions item sprites are invalid JSON");
  }
  if (!parsed.sources || typeof parsed.sources.pokeApiSprites !== "string" ||
      !parsed.sources.pokeApiSprites.startsWith("https://"))
    throw new Error("Reviewed item sprite source is missing");
  if (!parsed.items || typeof parsed.items !== "object")
    throw new Error("Reviewed Champions item sprites are missing");
  for (const [key, source] of Object.entries(parsed.items))
    if (!isReviewedItemSprite(key, source))
      throw new Error(`Invalid reviewed Champions item sprite: ${key}`);
  return parsed as ReviewedItemSpriteManifest;
}

const FORM_ALIASES: Readonly<Record<string, string>> = {
  aegislash: "aegislash-shield",
  "arcanine-hisuian": "arcanine-hisui",
  "avalugg-hisuian": "avalugg-hisui",
  basculegion: "basculegion-male",
  "decidueye-hisuian": "decidueye-hisui",
  "farfetch-d": "farfetchd",
  "floette-eternal-flower": "floette-eternal",
  "goodra-hisuian": "goodra-hisui",
  "gourgeist-jumbo-variety": "gourgeist-super",
  "gourgeist-large-variety": "gourgeist-large",
  "gourgeist-medium-variety": "gourgeist-average",
  "gourgeist-small-variety": "gourgeist-small",
  indeedee: "indeedee-male",
  "indeedee-f": "indeedee-female",
  maushold: "maushold-family-of-four",
  "meowstic-f-mega": "meowstic-female-mega",
  mimikyu: "mimikyu-disguised",
  morpeko: "morpeko-full-belly",
  "ninetales-alolan": "ninetales-alola",
  palafin: "palafin-zero",
  "persian-alolan": "persian-alola",
  pyroar: "pyroar-male",
  "raichu-alolan": "raichu-alola",
  "rotom-fan-rotom": "rotom-fan",
  "rotom-frost-rotom": "rotom-frost",
  "rotom-heat-rotom": "rotom-heat",
  "rotom-mow-rotom": "rotom-mow",
  "rotom-rotom": "rotom",
  "rotom-wash-rotom": "rotom-wash",
  "samurott-hisuian": "samurott-hisui",
  "sirfetch-d": "sirfetchd",
  "slowbro-galarian": "slowbro-galar",
  "slowking-galarian": "slowking-galar",
  squawkabilly: "squawkabilly-green-plumage",
  "stunfisk-galarian": "stunfisk-galar",
  "tauros-paldean-aqua-breed": "tauros-paldea-aqua-breed",
  "tauros-paldean-blaze-breed": "tauros-paldea-blaze-breed",
  "tauros-paldean-combat-breed": "tauros-paldea-combat-breed",
  "typhlosion-hisuian": "typhlosion-hisui",
  "zoroark-hisuian": "zoroark-hisui",
};

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`PokeAPI ${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function download(url: string, path: URL): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sprite ${url}: HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.startsWith("image/"))
    throw new Error(`Sprite ${url}: expected an image`);
  await writeFile(path, new Uint8Array(await response.arrayBuffer()));
}

async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let worker = 0; worker < Math.min(limit, values.length); worker += 1) {
    workers.push((async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await task(values[index] as T);
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

function statsFrom(data: PokeApiPokemon): BaseStats {
  const byName = new Map(data.stats.map((stat) => [stat.stat.name, stat.base_stat]));
  const value = (name: string): number => {
    const stat = byName.get(name);
    if (typeof stat !== "number" || !Number.isInteger(stat) || stat < 1)
      throw new Error(`${data.name} has no ${name} stat`);
    return stat;
  };
  return {
    hp: value("hp"),
    attack: value("attack"),
    defense: value("defense"),
    specialAttack: value("special-attack"),
    specialDefense: value("special-defense"),
    speed: value("speed"),
  };
}

function itemKey(name: string): string {
  return name.trim().toLowerCase();
}

try {
  const [legalityText, snapshotText, reviewedSpritesText, pokemonIndex, itemIndex] = await Promise.all([
    readFile(new URL("legality.json", DATA_DIR), "utf8"),
    readFile(new URL("snapshot.json", DATA_DIR), "utf8"),
    readFile(new URL("review/champions-item-sprites.json", DATA_DIR), "utf8"),
    fetchJson<{ results: Array<{ name: string }> }>("pokemon?limit=2000"),
    fetchJson<{ results: Array<{ name: string }> }>("item?limit=3000"),
  ]);
  const legality = JSON.parse(legalityText) as { allowedPokemon: string[] };
  const reviewedSpriteManifest = parseReviewedItemSprites(reviewedSpritesText);
  const reviewedItemSprites = reviewedSpriteManifest.items;
  const snapshot = JSON.parse(snapshotText) as {
    tournaments: Array<{ teams: Array<{ roster: Array<{ item?: string }> }> }>;
  };
  const pokemonNames = new Set(pokemonIndex.results.map((entry) => entry.name));
  const itemNames = new Set(itemIndex.results.map((entry) => entry.name));
  const displayByKey = new Map<string, string>();
  for (const name of legality.allowedPokemon) {
    const key = canonicalPokemonName(name);
    if (!displayByKey.has(key)) displayByKey.set(key, name);
  }
  const endpointByKey = new Map<string, string>();
  const unavailablePokemon: string[] = [];
  for (const [key, displayName] of displayByKey) {
    const endpoint = pokemonNames.has(key) ? key : FORM_ALIASES[key];
    if (!endpoint || !pokemonNames.has(endpoint)) {
      unavailablePokemon.push(displayName);
      continue;
    }
    endpointByKey.set(key, endpoint);
  }
  const observedItems = [
    ...new Set(
      snapshot.tournaments.flatMap((tournament) =>
        tournament.teams.flatMap((team) =>
          team.roster.map((member) => member.item).filter((item): item is string => Boolean(item)),
        ),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  await Promise.all([
    mkdir(new URL("pokemon/", ASSET_DIR), { recursive: true }),
    mkdir(new URL("items/", ASSET_DIR), { recursive: true }),
    mkdir(new URL("champions/items/", PUBLIC_DIR), { recursive: true }),
  ]);
  const pokemonEntries = await mapLimit([...endpointByKey], 6, async ([key, endpoint]) => {
    const data = await fetchJson<PokeApiPokemon>(`pokemon/${endpoint}`);
    if (!data.sprites.front_default) throw new Error(`No PokeAPI Pokémon sprite for ${endpoint}`);
    const sprite = `pokeapi/pokemon/${endpoint}.png`;
    await download(data.sprites.front_default, new URL(`pokemon/${endpoint}.png`, ASSET_DIR));
    return [key, {
      name: displayByKey.get(key) as string,
      pokeApiName: data.name,
      sprite,
      baseStats: statsFrom(data),
    }] as const;
  });
  const itemEntries = await mapLimit(observedItems, 6, async (name) => {
    const key = itemKey(name);
    const pokeApiName = key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const reviewedSprite = reviewedItemSprites[pokeApiName];
    if (!itemNames.has(pokeApiName)) {
      const entry: ItemEntry = { name, pokeApiName };
      if (reviewedSprite) {
        await download(reviewedSprite.url, new URL(reviewedSprite.sprite, PUBLIC_DIR));
        entry.sprite = reviewedSprite.sprite;
      }
      return [key, entry] as const;
    }
    const data = await fetchJson<PokeApiItem>(`item/${pokeApiName}`);
    const entry: ItemEntry = { name, pokeApiName: data.name };
    if (data.sprites.default) {
      entry.sprite = `pokeapi/items/${pokeApiName}.png`;
      await download(data.sprites.default, new URL(`items/${pokeApiName}.png`, ASSET_DIR));
    } else if (reviewedSprite) {
      entry.sprite = reviewedSprite.sprite;
      await download(reviewedSprite.url, new URL(reviewedSprite.sprite, PUBLIC_DIR));
    }
    return [key, entry] as const;
  });
  const catalog: PokeApiCatalog = {
    source: {
      api: API,
      sprites: reviewedSpriteManifest.sources.pokeApiSprites,
      reviewedItemSprites: Object.fromEntries(
        Object.entries(reviewedItemSprites).map(([name, { url }]) => [name, url]),
      ),
      fetchedAt: new Date().toISOString(),
    },
    pokemon: Object.fromEntries(pokemonEntries),
    items: Object.fromEntries(itemEntries),
  };
  await writeFile(
    new URL("pokeapi.json", DATA_DIR),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
  const missingItemSprites = itemEntries.filter(([, entry]) => !entry.sprite).map(([, entry]) => entry.name);
  console.log(
    `Synced ${pokemonEntries.length} Pokémon sprites and ${itemEntries.length - missingItemSprites.length}/${itemEntries.length} observed item sprites.`,
  );
  if (unavailablePokemon.length)
    console.log(`No exact PokeAPI base stats for: ${unavailablePokemon.sort().join(", ")}`);
  if (missingItemSprites.length)
    console.log(`PokeAPI has no item image for: ${missingItemSprites.sort().join(", ")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

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

type PokeApiCatalog = {
  source: {
    api: string;
    sprites: string;
    fetchedAt: string;
  };
  pokemon: Record<
    string,
    { name: string; pokeApiName: string; sprite: string; baseStats: BaseStats }
  >;
  items: Record<string, { name: string; pokeApiName: string; sprite?: string }>;
};

const DATA_DIR = new URL("../data/", import.meta.url);
const ASSET_DIR = new URL("../public/pokeapi/", import.meta.url);
const API = "https://pokeapi.co/api/v2/";
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
  const [legalityText, snapshotText, pokemonIndex, itemIndex] = await Promise.all([
    readFile(new URL("legality.json", DATA_DIR), "utf8"),
    readFile(new URL("snapshot.json", DATA_DIR), "utf8"),
    fetchJson<{ results: Array<{ name: string }> }>("pokemon?limit=2000"),
    fetchJson<{ results: Array<{ name: string }> }>("item?limit=3000"),
  ]);
  const legality = JSON.parse(legalityText) as { allowedPokemon: string[] };
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
  ].sort();
  await Promise.all([
    mkdir(new URL("pokemon/", ASSET_DIR), { recursive: true }),
    mkdir(new URL("items/", ASSET_DIR), { recursive: true }),
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
    const pokeApiName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!itemNames.has(pokeApiName))
      return [itemKey(name), { name, pokeApiName }] as const;
    const data = await fetchJson<PokeApiItem>(`item/${pokeApiName}`);
    const sprite = data.sprites.default
      ? `pokeapi/items/${pokeApiName}.png`
      : undefined;
    if (data.sprites.default)
      await download(data.sprites.default, new URL(`items/${pokeApiName}.png`, ASSET_DIR));
    return [itemKey(name), { name, pokeApiName: data.name, ...(sprite ? { sprite } : {}) }] as const;
  });
  const catalog: PokeApiCatalog = {
    source: {
      api: API,
      sprites: "https://github.com/PokeAPI/sprites",
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

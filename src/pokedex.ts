import pokeApiData from "../data/pokeapi.json" with { type: "json" };
import type { StatTable } from "./calculator.js";
import { canonicalPokemonName } from "./meta.js";

export interface PokemonVisual {
  name: string;
  pokeApiName: string;
  sprite: string;
  baseStats: StatTable;
}

export interface ItemVisual {
  name: string;
  pokeApiName: string;
  sprite?: string;
}

type PokeApiCatalog = {
  pokemon: Record<string, PokemonVisual>;
  items: Record<string, ItemVisual>;
};

const catalog = pokeApiData as PokeApiCatalog;

export const pokemonPickerOptions = Object.values(catalog.pokemon).sort(
  (left, right) => left.name.localeCompare(right.name),
);

export function pokemonVisual(name: string): PokemonVisual | undefined {
  return catalog.pokemon[canonicalPokemonName(name)];
}

export function itemVisual(name: string | undefined): ItemVisual | undefined {
  return name ? catalog.items[name.trim().toLowerCase()] : undefined;
}

export function bundledSpriteUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

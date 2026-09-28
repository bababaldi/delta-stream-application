import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import legalityData from "../data/legality.json" with { type: "json" };
import snapshotData from "../data/snapshot.json" with { type: "json" };
import { canonicalPokemonName } from "../src/meta.js";
import {
  itemVisual,
  pokemonPickerOptions,
  pokemonVisual,
} from "../src/pokedex.js";

test("bundled PokeAPI data covers every exact calculator form and observed item", () => {
  const unavailableExactForms = [
    "Sinistcha [Masterpiece Form]",
    "Sinistcha [Unremarkable Form]",
    "Vivillon Fancy",
    "Vivillon High Plains",
  ];
  const unavailableKeys = new Set(unavailableExactForms.map(canonicalPokemonName));
  const calculatorForms = legalityData.allowedPokemon.filter(
    (name) => !unavailableKeys.has(canonicalPokemonName(name)),
  );
  assert.equal(
    pokemonPickerOptions.length,
    new Set(calculatorForms.map(canonicalPokemonName)).size,
  );
  for (const name of calculatorForms) {
    const visual = pokemonVisual(name);
    assert.ok(visual, `Missing PokeAPI data for ${name}`);
    assert.ok(existsSync(`public/${visual.sprite}`), `Missing sprite file for ${name}`);
    assert.equal(Object.values(visual.baseStats).length, 6);
  }
  for (const name of unavailableExactForms)
    assert.equal(pokemonVisual(name), undefined, `No exact PokeAPI stats for ${name}`);
  const observedItems = new Set(
    snapshotData.tournaments.flatMap((tournament) =>
      tournament.teams.flatMap((team) =>
        team.roster
          .map((member) => ("item" in member ? member.item : undefined))
          .filter((item): item is string => Boolean(item)),
      ),
    ),
  );
  for (const item of observedItems)
    assert.ok(itemVisual(item), `Missing PokeAPI item record for ${item}`);
  assert.match(pokemonVisual("Floette Mega")?.sprite ?? "", /floette-mega\.png$/);
  assert.match(itemVisual("Miracle Seed")?.sprite ?? "", /miracle-seed\.png$/);
});

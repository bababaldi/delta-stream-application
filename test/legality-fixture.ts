import { canonicalPokemonName } from "../src/meta.js";
import type { LegalityRules, TeamSlot } from "../src/team.js";

// Synthetic test-only rules, never a production legality catalog.
export function rulesFor(
  slots: readonly TeamSlot[],
  regulation = "test",
): LegalityRules {
  const keys = [
    ...new Set(slots.map((slot) => canonicalPokemonName(slot.species))),
  ];
  return {
    regulation,
    allowedPokemon: keys,
    allowedItems: slots.flatMap((slot) => (slot.item ? [slot.item] : [])),
    allowedTeraTypes: [
      ...new Set(
        slots.flatMap((slot) => (slot.teraType ? [slot.teraType] : [])),
      ),
    ],
    restrictedPokemon: [],
    maxRestricted: 0,
    speciesClauseKeys: Object.fromEntries(keys.map((key) => [key, key])),
    allowedAbilities: Object.fromEntries(
      keys.map((key) => [
        key,
        slots
          .filter((slot) => canonicalPokemonName(slot.species) === key)
          .flatMap((slot) => (slot.ability ? [slot.ability] : [])),
      ]),
    ),
    allowedMoves: Object.fromEntries(
      keys.map((key) => [
        key,
        slots
          .filter((slot) => canonicalPokemonName(slot.species) === key)
          .flatMap((slot) => slot.moves),
      ]),
    ),
  };
}

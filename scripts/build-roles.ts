import { readFile, writeFile } from "node:fs/promises";
import {
  canonicalPokemonName,
  rankMeta,
  type MetaSnapshot,
  type TeamMember,
} from "../src/meta.js";
import { fetchText } from "../src/sources.js";
import { OBSERVED_DISPLAY_ALIASES } from "./observed-display-aliases.js";

const DATA_DIR = new URL("../data/", import.meta.url);
const SEREBII_ATTACKDEX = "https://www.serebii.net/attackdex-champions/";
const REQUEST_DELAY_MS = 250;
const VERSION = "observed-capabilities-2026-09-28";

const TYPES = [
  "bug", "dark", "dragon", "electric", "fairy", "fighting", "fire", "flying",
  "ghost", "grass", "ground", "ice", "normal", "poison", "psychict", "rock",
  "steel", "water",
] as const;

type MoveType = { type: string; category: "physical" | "special" | "other" };
type Profile = {
  regulation: string;
  version: string;
  pokemon: string;
  roles: string[];
  coversThreats: string[];
  evidenceStatus: "observed-set" | "roster-only";
  roleSignals: string[];
  coverageSignals: string[];
};
type ApprovedRoleCatalog = {
  regulation: string;
  version: string;
  reviewStatus: string;
  requiredRoles: string[];
  topThreats: string[];
  coverageDefinition: string;
  sources: Record<string, unknown>;
  profiles: Profile[];
};

type Threat = { name: string; weakTo: readonly string[] };

// These are the five highest-ranked species in the reviewed snapshot at catalog creation.
// A changed ranking fails the build so a new matchup review cannot happen silently.
const THREATS: readonly Threat[] = [
  { name: "Rillaboom", weakTo: ["bug", "fire", "flying", "ice", "poison"] },
  { name: "Sneasler", weakTo: ["flying", "ground", "psychic"] },
  { name: "Incineroar", weakTo: ["fighting", "ground", "rock", "water"] },
  { name: "Kingambit", weakTo: ["fighting", "fire", "ground"] },
  { name: "Gholdengo", weakTo: ["dark", "fire", "ghost", "ground"] },
];

const SPEED_CONTROL = new Set(["tailwind", "trick room", "icy wind", "electroweb", "rock tomb"]);
const FIELD_CONTROL_ABILITIES = new Set([
  "drought", "drizzle", "sand stream", "snow warning", "grassy surge", "psychic surge",
  "electric surge", "misty surge",
]);
const REDIRECTION = new Set(["follow me", "rage powder"]);
const SCREEN_SUPPORT = new Set(["reflect", "light screen", "aurora veil"]);
const PIVOT = new Set(["parting shot", "u-turn", "flip turn"]);
const DISRUPTION = new Set([
  "fake out", "encore", "taunt", "sleep powder", "hypnosis", "yawn", "toxic",
  "thunder wave", "will-o-wisp", "perish song", "imprison", "snarl", "infestation",
]);
const SETUP = new Set([
  "nasty plot", "swords dance", "calm mind", "bulk up", "quiver dance", "clangorous soul",
  "coil",
]);
const SPREAD_PROTECTION = new Set(["wide guard", "quick guard"]);
const PRIORITY = new Set(["fake out", "grassy glide", "sucker punch", "aqua jet", "shadow sneak"]);

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
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
    .replace(/&#39;|&apos;/g, "'");
}

function moveKey(move: string): string {
  return move.trim().toLowerCase();
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

async function delayedFetch(url: string): Promise<string> {
  const text = await fetchText(url);
  await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
  return text;
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

function parseTypePage(html: string, type: string): Array<[string, MoveType]> {
  const result: Array<[string, MoveType]> = [];
  for (const match of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const row = match[1] ?? "";
    const name = row.match(/href="\/attackdex-champions\/[^/"]+\.shtml">([^<]+)<\/a>/)?.[1];
    const category = row.match(/\/type\/(physical|special|other)\.png/i)?.[1];
    if (!name || !category) continue;
    result.push([
      moveKey(decodeHtml(name)),
      { type, category: category.toLowerCase() as MoveType["category"] },
    ]);
  }
  return result;
}

function hasSignal(moves: ReadonlySet<string>, signals: ReadonlySet<string>): string[] {
  return [...moves].filter((move) => signals.has(move)).sort();
}

function profileFromObserved(
  regulation: string,
  pokemon: string,
  members: readonly TeamMember[],
  moveTypes: ReadonlyMap<string, MoveType>,
): Profile {
  const abilities = new Set(
    members.flatMap((member) => (member.ability ? [moveKey(member.ability)] : [])),
  );
  const moves = new Set(members.flatMap((member) => member.moves?.map(moveKey) ?? []));
  const damageMoves = [...moves].filter((move) => {
    const category = moveTypes.get(move)?.category;
    return category === "physical" || category === "special";
  });
  const roles: string[] = [];
  const signals: string[] = [];
  const add = (role: string, values: readonly string[]): void => {
    if (!values.length) return;
    roles.push(role);
    signals.push(`${role}: ${values.join(", ")}`);
  };
  add("offense", damageMoves);
  add("speed control", hasSignal(moves, SPEED_CONTROL));
  add("field control", [...abilities].filter((ability) => FIELD_CONTROL_ABILITIES.has(ability)));
  add("redirection", hasSignal(moves, REDIRECTION));
  add("screen support", hasSignal(moves, SCREEN_SUPPORT));
  add("pivot", hasSignal(moves, PIVOT));
  add("disruption", hasSignal(moves, DISRUPTION));
  add("setup", hasSignal(moves, SETUP));
  add("spread protection", hasSignal(moves, SPREAD_PROTECTION));
  add("priority", hasSignal(moves, PRIORITY));

  const coversThreats: string[] = [];
  const coverageSignals: string[] = [];
  for (const threat of THREATS) {
    const directMoves = damageMoves.filter((move) =>
      threat.weakTo.includes(moveTypes.get(move)?.type ?? ""),
    );
    if (!directMoves.length) continue;
    coversThreats.push(threat.name);
    coverageSignals.push(`${threat.name}: ${directMoves.join(", ")}`);
  }
  return {
    regulation,
    version: VERSION,
    pokemon,
    roles: uniqueSorted(roles),
    coversThreats: uniqueSorted(coversThreats),
    evidenceStatus: "observed-set",
    roleSignals: uniqueSorted(signals),
    coverageSignals: uniqueSorted(coverageSignals),
  };
}

function rosterOnlyProfile(regulation: string, pokemon: string): Profile {
  return {
    regulation,
    version: VERSION,
    pokemon,
    roles: [],
    coversThreats: [],
    evidenceStatus: "roster-only",
    roleSignals: [],
    coverageSignals: [],
  };
}

async function main(): Promise<void> {
  const snapshot = parseJson<MetaSnapshot>(
    await readFile(new URL("snapshot.json", DATA_DIR), "utf8"),
    "snapshot",
  );
  const ranked = rankMeta(snapshot, snapshot.activeRegulation, new Date("2026-09-28T00:00:00Z"))
    .pokemon.slice(0, THREATS.length)
    .map((entry) => entry.key);
  const expectedThreats = THREATS.map((threat) => canonicalPokemonName(threat.name));
  if (ranked.join("|") !== expectedThreats.join("|"))
    throw new Error(
      `Top threats changed (${ranked.join(", ")}); review THREATS before rebuilding roles.`,
    );
  if (process.argv.includes("--from-approved-catalog")) {
    const approved = parseJson<ApprovedRoleCatalog>(
      await readFile(new URL("roles.json", DATA_DIR), "utf8"),
      "approved role catalog",
    );
    const profileByKey = new Map(approved.profiles.map((profile) => [
      canonicalPokemonName(profile.pokemon), profile,
    ]));
    const labels = new Set(snapshot.tournaments.flatMap((tournament) =>
      tournament.teams.flatMap((team) => team.roster.map((member) => member.pokemon)),
    ));
    const unprofiled = [...new Map(
      [...labels]
        .filter((name) => !profileByKey.has(canonicalPokemonName(name)))
        .map((name) => [canonicalPokemonName(name), name]),
    ).values()];
    const profiles = [
      ...approved.profiles.map((profile) => ({ ...profile, version: VERSION })),
      ...unprofiled.map((pokemon) => {
        const base = OBSERVED_DISPLAY_ALIASES[pokemon];
        const profile = base ? profileByKey.get(canonicalPokemonName(base)) : undefined;
        return profile
          ? { ...profile, pokemon, version: VERSION }
          : rosterOnlyProfile(snapshot.activeRegulation, pokemon);
      }),
    ].sort((left, right) => left.pokemon.localeCompare(right.pokemon));
    const catalog = {
      ...approved,
      version: VERSION,
      reviewStatus: "owner-approved-2026-09-28",
      topThreats: THREATS.map((threat) => threat.name),
      sources: {
        ...approved.sources,
        observedDisplayAliases: {
          source: "owner-approved reviewed PokeData and Victory Road Open Team Lists",
          aliases: OBSERVED_DISPLAY_ALIASES,
          unclassifiedProfiles: unprofiled,
          note: "Mapped aliases inherit their prior base profile; other newly observed species remain roster-only because Serebii move categories were unavailable during this review refresh.",
        },
        threatSelection: "top five reviewed-snapshot rankings at 2026-09-28",
      },
      profiles,
    };
    await writeFile(
      new URL("review/roles-mc-observed-signals-draft.json", DATA_DIR),
      `${JSON.stringify(catalog, null, 2)}\n`,
    );
    console.log(`Wrote source-preserving role review draft with ${unprofiled.length} newly observed profiles.`);
    return;
  }

  console.log(`Fetching Champions move categories from ${TYPES.length} Serebii type pages...`);
  const parsedTypes = await mapLimit(TYPES, 2, async (type) =>
    parseTypePage(
      await delayedFetch(`${SEREBII_ATTACKDEX}${type}.shtml`),
      type === "psychict" ? "psychic" : type,
    ),
  );
  const moveTypes = new Map(parsedTypes.flat());
  if (!moveTypes.size) throw new Error("Serebii move-category parse returned no moves");

  const labels = new Map<string, string>();
  const observed = new Map<string, TeamMember[]>();
  for (const tournament of snapshot.tournaments) {
    for (const team of tournament.teams) {
      for (const member of team.roster) {
        const key = canonicalPokemonName(member.pokemon);
        labels.set(key, labels.get(key) ?? member.pokemon);
        if (!member.ability || !member.moves?.length) continue;
        observed.set(key, [...(observed.get(key) ?? []), member]);
      }
    }
  }
  const profiles = [...labels]
    .map(([key, pokemon]) => {
      const members = observed.get(key);
      return members
        ? profileFromObserved(snapshot.activeRegulation, pokemon, members, moveTypes)
        : rosterOnlyProfile(snapshot.activeRegulation, pokemon);
    })
    .sort((left, right) => left.pokemon.localeCompare(right.pokemon));
  const untypedMoves = uniqueSorted(
    [...observed.values()]
      .flatMap((members) => members.flatMap((member) => member.moves ?? []))
      .filter((move) => !moveTypes.has(moveKey(move))),
  );
  if (untypedMoves.length)
    throw new Error(`Missing Champions move categories: ${untypedMoves.join(", ")}`);

  const catalog = {
    regulation: snapshot.activeRegulation,
    version: VERSION,
    reviewStatus: "pending-owner-review",
    requiredRoles: ["offense", "speed control", "disruption"],
    topThreats: THREATS.map((threat) => threat.name),
    coverageDefinition:
      "Threat coverage means an observed tournament set has a physical or special move that is super-effective against the threat's base typing; it is not a matchup or damage guarantee.",
    sources: {
      setEvidence: "reviewed PokeData tournament sets in data/snapshot.json",
      moveCategories: `${SEREBII_ATTACKDEX}{type}.shtml`,
      threatSelection: "top five reviewed-snapshot rankings at 2026-09-28",
    },
    profiles,
  };
  await writeFile(
    new URL("review/roles-mc-observed-signals-draft.json", DATA_DIR),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
  const observedProfiles = profiles.filter(
    (profile) => profile.evidenceStatus === "observed-set",
  ).length;
  console.log(
    `Wrote review draft with ${profiles.length} profiles (${observedProfiles} observed-set, ${profiles.length - observedProfiles} roster-only).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

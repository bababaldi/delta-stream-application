import { readFile, writeFile, rename } from "node:fs/promises";
import {
  type MetaSnapshot,
  type TournamentData,
  type TournamentEvent,
  validateTournamentData,
} from "../src/meta.js";
import {
  fetchText,
  ingestTournament,
  parsePikalyticsUsage,
} from "../src/sources.js";

const DATA_DIR = new URL("../data/", import.meta.url);

interface DataConfig {
  activeRegulation: string;
  pikalyticsFormat: string;
}

interface QuarantinedEvent {
  event: TournamentEvent;
  errors: string[];
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function assertConfig(value: DataConfig): void {
  if (!value.activeRegulation?.trim() || !value.pikalyticsFormat?.trim()) {
    throw new Error(
      "data/config.json requires activeRegulation and pikalyticsFormat",
    );
  }
}

function manifestErrors(
  event: TournamentEvent,
  activeRegulation: string,
): string[] {
  const errors: string[] = [];
  if (!event.id?.trim() || !event.name?.trim())
    errors.push("id and name are required");
  if (!(["worlds", "international", "regional"] as const).includes(event.tier))
    errors.push("tier is invalid");
  if (
    !(["NA", "EU", "LATAM", "OCE", "ASIA", "OTHER"] as const).includes(
      event.region,
    )
  )
    errors.push("region is invalid");
  if (event.regulation !== activeRegulation)
    errors.push("regulation is not active");
  let url: URL | undefined;
  try {
    url = new URL(event.sourceUrl);
  } catch {
    errors.push("sourceUrl is invalid");
  }
  const validSource =
    (event.source === "pikalytics" &&
      url?.hostname === "www.pikalytics.com" &&
      url.pathname.startsWith("/ai/tournaments/")) ||
    (event.source === "rk9" &&
      url?.hostname === "rk9.gg" &&
      url.pathname.startsWith("/tournament/"));
  if (!validSource)
    errors.push("source and sourceUrl do not match an allowed public source");
  return errors;
}

async function loadTournament(
  event: TournamentEvent,
  activeRegulation: string,
): Promise<{ data?: TournamentData; quarantine?: QuarantinedEvent }> {
  const errors = manifestErrors(event, activeRegulation);
  if (errors.length) return { quarantine: { event, errors } };
  try {
    const data = await ingestTournament(event);
    errors.push(...validateTournamentData(data));
    return errors.length ? { quarantine: { event, errors } } : { data };
  } catch (error) {
    return {
      quarantine: {
        event,
        errors: [error instanceof Error ? error.message : String(error)],
      },
    };
  }
}

async function main(): Promise<void> {
  const [configText, approvedText] = await Promise.all([
    readFile(new URL("config.json", DATA_DIR), "utf8"),
    readFile(new URL("approved-tournaments.json", DATA_DIR), "utf8"),
  ]);
  const config = parseJson<DataConfig>(configText, "data/config.json");
  const approved = parseJson<TournamentEvent[]>(
    approvedText,
    "data/approved-tournaments.json",
  );
  assertConfig(config);
  if (!Array.isArray(approved) || approved.length === 0) {
    throw new Error(
      "No approved tournaments. Run npm run data:discover and approve at least one completed event.",
    );
  }

  if (new Set(approved.map((event) => event.id)).size !== approved.length) {
    throw new Error(
      "Duplicate approved event IDs would inflate ranking scores",
    );
  }
  const accepted: TournamentData[] = [];
  const quarantined: QuarantinedEvent[] = [];
  for (const event of approved) {
    const result = await loadTournament(event, config.activeRegulation);
    if (result.data) accepted.push(result.data);
    if (result.quarantine) quarantined.push(result.quarantine);
  }

  let pikalyticsUsage: Record<string, number> = {};
  try {
    const page = await fetchText(
      `https://www.pikalytics.com/ai/pokedex/${config.pikalyticsFormat}`,
    );
    pikalyticsUsage = parsePikalyticsUsage(page);
  } catch (error) {
    console.warn(
      `Pikalytics usage unavailable: ${error instanceof Error ? error.message : error}`,
    );
  }

  const snapshot: MetaSnapshot = {
    generatedAt: new Date().toISOString(),
    activeRegulation: config.activeRegulation,
    tournaments: accepted,
    pikalyticsUsage,
  };
  await writeFile(
    new URL("quarantine.json", DATA_DIR),
    `${JSON.stringify(quarantined, null, 2)}\n`,
  );
  console.log(
    `Accepted ${accepted.length} tournament(s); quarantined ${quarantined.length}.`,
  );
  if (quarantined.length) {
    console.error("Fix data/quarantine.json findings before building an APK.");
    process.exitCode = 1;
    return; // Keep the last valid snapshot when an update is quarantined.
  }
  const temporary = new URL(`snapshot.${process.pid}.tmp`, DATA_DIR);
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(temporary, new URL("snapshot.json", DATA_DIR));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

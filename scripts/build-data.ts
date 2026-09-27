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
  pikalyticsFormat: string | null;
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

export function assertConfig(value: DataConfig): void {
  if (!value || typeof value.activeRegulation !== "string" || !value.activeRegulation.trim() ||
      (value.pikalyticsFormat !== null && (typeof value.pikalyticsFormat !== "string" || !/^[a-z0-9-]+$/i.test(value.pikalyticsFormat)))) {
    throw new Error(
      "data/config.json requires activeRegulation and a pikalyticsFormat slug, or null to disable unverified usage data",
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
  if (!(["worlds", "international", "regional", "online", "local"] as const).includes(event.tier))
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
  const [configText, approvedText, reviewedText] = await Promise.all([
    readFile(new URL("config.json", DATA_DIR), "utf8"),
    readFile(new URL("approved-tournaments.json", DATA_DIR), "utf8"),
    readFile(new URL("reviewed-results.json", DATA_DIR), "utf8"),
  ]);
  const config = parseJson<DataConfig>(configText, "data/config.json");
  const approved = parseJson<TournamentEvent[]>(
    approvedText,
    "data/approved-tournaments.json",
  );
  assertConfig(config);
  const reviewed = parseJson<TournamentData[]>(reviewedText, "data/reviewed-results.json");
  if (!Array.isArray(approved) || !Array.isArray(reviewed) ||
      approved.length + reviewed.length === 0)
    throw new Error("No approved or reviewed completed tournaments");

  if (new Set([...approved.map((event) => event.id), ...reviewed.map(({ event }) => event.id)]).size !== approved.length + reviewed.length) {
    throw new Error(
      "Duplicate approved event IDs would inflate ranking scores",
    );
  }
  const accepted: TournamentData[] = [];
  const quarantined: QuarantinedEvent[] = [];
  for (const data of reviewed) {
    let url: URL | undefined;
    try { url = new URL(data.event.sourceUrl); } catch { /* reported below */ }
    const verifiedSource =
      (data.event.source === "victoryroad" && data.event.tier === "online" &&
        url?.hostname === "victoryroad.pro" && /^\/vr-sep26(?:-2)?\/$/.test(url.pathname)) ||
      (data.event.source === "pokedata" && data.event.tier === "regional" &&
        url?.hostname === "www.pokedata.ovh" && [
          "/standingsVGC/0000192/masters/0000192_Masters.json",
          "/standingsVGC/0000193/masters/0000193_Masters.json",
          "/standingsVGC/0000194/masters/0000194_Masters.json",
        ].includes(url.pathname)) ||
      (data.event.source === "italianlocals" && data.event.tier === "local" &&
        url?.hostname === "shairaba.github.io" &&
        url.pathname === "/vgc-locals-italia/data/tournaments.json");
    const errors = [
      ...validateTournamentData(data),
      ...(verifiedSource && data.event.regulation === config.activeRegulation
        ? [] : ["reviewed event source, tier or regulation is invalid"]),
    ];
    if (errors.length) quarantined.push({ event: data.event, errors });
    else accepted.push(data);
  }
  for (const event of approved) {
    const result = await loadTournament(event, config.activeRegulation);
    if (result.data) accepted.push(result.data);
    if (result.quarantine) quarantined.push(result.quarantine);
  }

  let pikalyticsUsage: Record<string, number> = {};
  if (config.pikalyticsFormat !== null) {
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
  } else {
    console.log("Pikalytics usage disabled: no unverified or previous-regulation usage will be included.");
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
    console.error("Fix data/quarantine.json findings before publishing a snapshot.");
    process.exitCode = 1;
    return; // Keep the last valid snapshot when an update is quarantined.
  }
  const temporary = new URL(`snapshot.${process.pid}.tmp`, DATA_DIR);
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(temporary, new URL("snapshot.json", DATA_DIR));
}

if (import.meta.main) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

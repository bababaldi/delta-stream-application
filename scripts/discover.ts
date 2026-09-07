import { readFile, writeFile } from "node:fs/promises";
import {
  fetchText,
  parsePikalyticsIndex,
  parseRk9Events,
  type TournamentCandidate,
} from "../src/sources.js";

const CANDIDATES_PATH = new URL("../data/candidates.json", import.meta.url);
const APPROVED_PATH = new URL(
  "../data/approved-tournaments.json",
  import.meta.url,
);

function unique(
  candidates: readonly TournamentCandidate[],
): TournamentCandidate[] {
  return [
    ...new Map(
      candidates.map((candidate) => [candidate.sourceUrl, candidate]),
    ).values(),
  ].sort(
    (left, right) =>
      (right.date ?? "").localeCompare(left.date ?? "") ||
      left.name.localeCompare(right.name),
  );
}

async function discoverPikalytics(): Promise<TournamentCandidate[]> {
  const first = await fetchText("https://www.pikalytics.com/ai/tournaments");
  const pageCount = Number.parseInt(
    first.match(/\*\*Page\*\*:\s*1 of (\d+)/i)?.[1] ?? "1",
    10,
  );
  const pages = [first];
  for (let page = 2; page <= Math.min(pageCount, 20); page += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    pages.push(
      await fetchText(`https://www.pikalytics.com/ai/tournaments?page=${page}`),
    );
  }
  return pages.flatMap(parsePikalyticsIndex);
}

async function main(): Promise<void> {
  const [pikalytics, rk9Html, approvedJson] = await Promise.all([
    discoverPikalytics(),
    fetchText("https://rk9.gg/events/pokemon"),
    readFile(APPROVED_PATH, "utf8"),
  ]);
  let approved: Array<{ sourceUrl?: string }>;
  try {
    approved = JSON.parse(approvedJson) as Array<{ sourceUrl?: string }>;
  } catch {
    throw new Error("data/approved-tournaments.json is not valid JSON");
  }
  const approvedUrls = new Set(approved.map(({ sourceUrl }) => sourceUrl));
  const candidates = unique([...pikalytics, ...parseRk9Events(rk9Html)]).filter(
    ({ sourceUrl }) => !approvedUrls.has(sourceUrl),
  );
  await writeFile(CANDIDATES_PATH, `${JSON.stringify(candidates, null, 2)}\n`);
  const counts = candidates.reduce<Record<string, number>>(
    (result, { source }) => {
      result[source] = (result[source] ?? 0) + 1;
      return result;
    },
    {},
  );
  console.log(
    `Wrote ${candidates.length} candidates (${counts.pikalytics ?? 0} Pikalytics, ${counts.rk9 ?? 0} RK9).`,
  );
  console.log(
    "Review data/candidates.json and copy approved entries into data/approved-tournaments.json with date, regulation, tier and region.",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

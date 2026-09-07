import assert from "node:assert/strict";
import test from "node:test";
import type { TournamentEvent } from "../src/meta.js";
import {
  parsePikalyticsIndex,
  parsePikalyticsTournament,
  parseRk9Events,
  parseRk9Roster,
  parseRk9TeamList,
  splitMarkdownRow,
} from "../src/sources.js";

const EVENT: TournamentEvent = {
  id: "cup",
  name: "Champions Cup",
  date: "2026-09-01",
  regulation: "champions-mb",
  tier: "regional",
  region: "NA",
  source: "pikalytics",
  sourceUrl: "https://www.pikalytics.com/ai/tournaments/limitless/cup",
};

test("Markdown rows preserve escaped pipes", () => {
  assert.deepEqual(splitMarkdownRow("| Cup \\| Finals | Sep 1, 2026 |"), [
    "Cup | Finals",
    "Sep 1, 2026",
  ]);
});

test("Pikalytics tournament index creates review candidates", () => {
  const markdown = `| Tournament | Date | Source | Players | Winner | Winning Team | Agent Page | Web Page |
|---|---|---|---|---|---|---|---|
| Cup \\| 2026 Pokémon VGC Regional Championships | Sep 1, 2026 | Limitless | 128 | Alice | A, B, C, D, E, F | [Markdown](https://www.pikalytics.com/ai/tournaments/limitless/cup) | [View](https://example.test) |`;
  const [candidate] = parsePikalyticsIndex(markdown);
  assert.equal(
    candidate?.name,
    "Cup | 2026 Pokémon VGC Regional Championships",
  );
  assert.equal(candidate?.date, "2026-09-01");
  assert.equal(candidate?.suggestedTier, "regional");
  assert.equal(candidate?.approved, false);
});

test("Pikalytics published teams and numeric usage are parsed", () => {
  const markdown = `## Pokemon Usage And Win Rates
| Rank | Pokemon | Usage | Win Rate | Record | Web Page | AI Data |
|---|---|---|---|---|---|---|
| 1 | **Garchomp** | 20.5% | N/A | N/A | [View](https://example.test) | [AI](https://example.test) |
## Published Teams
| Rank | Player | Record | Pokemon | Source |
|---|---|---|---|---|
| 1 | Alice | 7-1 | Garchomp, Kingambit, Whimsicott, Incineroar, Sylveon, Milotic | [Source](https://example.test/alice) |
| 65 | Late | 4-4 | A, B, C, D, E, F | [Source](https://example.test/late) |`;
  const data = parsePikalyticsTournament(markdown, EVENT);
  assert.equal(data.teams.length, 1);
  assert.equal(data.teams[0]?.placement, 1);
  assert.equal(data.teams[0]?.roster.length, 6);
  assert.equal(data.usage?.garchomp, 20.5);
});

test("RK9 event, roster, and English team list parsers use public HTML", () => {
  const events = parseRk9Events(`<table><tr>
<td>September 1-2, 2026</td><td><a href="/tournament/XX001-tcg">TCG</a></td><td><a href="/tournament/XX002-vgc">2026 Test Pokémon VGC Regional Championships</a></td><td>Paris</td><td>FR</td>
</tr></table>`);
  assert.equal(events[0]?.id, "XX002-vgc");
  assert.equal(events[0]?.date, "2026-09-01");
  assert.equal(events[0]?.suggestedRegion, "EU");

  const roster = parseRk9Roster(`<table><tr>
<td>1....2</td><td>Alice</td><td>Smith</td><td>US</td><td>Masters</td><td>Alice</td>
<td class="text-center"><a href="/teamlist/public/XX002-vgc/alice">View</a></td><td class="text-center">3</th>
</tr><tr><td>2</td><td>Kid</td><td>Player</td><td>US</td><td>Senior</td><td>K</td><td class="text-center"><a href="/teamlist/public/XX002-vgc/kid">View</a></td><td class="text-center">1</th></tr></table>`);
  assert.deepEqual(roster, [
    {
      player: "Alice Smith",
      position: 3,
      teamUrl: "https://rk9.gg/teamlist/public/XX002-vgc/alice",
    },
  ]);

  const pokemon = (name: string) =>
    `<div class="pokemon bg-light-green-50"><img src="sprite.png"> ${name} &nbsp; <b>EN</b><br><b>Tera Type:</b> Water<br><b>Ability:</b> Test &nbsp;&nbsp; <b>Held Item:</b> Berry<br><span class="badge">Protect</span></div>`;
  const html = `<div class="translation lang-EN" id="lang-EN">${["A", "B", "C", "D", "E", "F"].map(pokemon).join("")}</div><div class="translation lang-FR">`;
  const team = parseRk9TeamList(html);
  assert.equal(team.length, 6);
  assert.deepEqual(team[0], {
    pokemon: "A",
    ability: "Test",
    item: "Berry",
    teraType: "Water",
    moves: ["Protect"],
  });
});

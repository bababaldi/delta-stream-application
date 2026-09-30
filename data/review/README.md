# Owner review provenance and frozen artifacts

Most files here are not imported by the app and do not modify rankings. The explicitly marked M-C catalog and team-evidence artifacts are the frozen records behind the owner-approved production copies. `npm run data:review` regenerates **M-C eligibility only**; archived M-B/Worlds files are preserved. Regeneration writes pending review artifacts, never production approvals.

## Current target: Regulation M-C

`eligibility-mc.json`: **262 official roster entries**, retrieved September 20, 2026, with original names, National Pokédex numbers, form IDs and source SHA-256.

**Owner approved this source only on September 20, 2026.** The durable decision and exact source/roster hashes are recorded in `data/approved-sources.json`, which the batch does not overwrite. A regenerated review is not a new approval: compare its hashes with that record; changed content needs review again.

- Official rules: <https://news.pokemon-home.com/en/page/816.html>
- Official eligible list: <https://web-view.app.pokemonchampions.jp/battle/pages/events/rs178713870219xeaaio/en/pokemon.html>
- Ranked period: September 9, 2026 02:00 UTC through December 2, 2026 02:00 UTC (exclusive).
- This is an eligibility **source**, not a complete competitive catalog or a verified list of every distinct battle form.

The comparison with the archived M-B extraction has 28 added rows and one removed row (net +27). Maushold changed from source ID `0925-000` to `0925-001`; Squawkabilly appears under two IDs with the same display name. Do **not** infer form bans, aliases or species-clause behavior from these display IDs. Those mappings need separate verification. New names include Salamence, Golisopod, Rillaboom, Indeedee and Baxcalibur; the complete rows are in the JSON.

### Approved M-C catalogs (frozen review artifacts)

`legality-mc-serebii-draft.json` is the exact reviewed artifact copied to `data/legality.json` after owner approval on September 28, 2026. It retains the prior owner-approved Serebii-backed base catalog (231 base-species pages for move/ability lists), adds only 15 owner-approved display aliases from reviewed PokeData/Victory Road teams, and keeps the pinned NCP calculator item catalog (166 items). During this refresh Serebii was unreachable, so aliases inherit only their explicitly mapped prior approved base form; no remote rule data was substituted or inferred. Hashes, mappings, no-Tera policy and zero-restricted assumption are in `data/approved-sources.json`. Regenerating it creates a new artifact that requires another approval.

`roles-mc-observed-signals-draft.json` is the exact reviewed artifact copied to `data/roles.json` after the same approval. Its 49 set-backed profiles retain direct source-backed move/ability signals; its 59 roster-only profiles deliberately make no role or matchup claim. Mapped aliases inherit only their prior base profile, while newly observed species without a prior profile remain roster-only until Serebii move categories can be refreshed. “Threat coverage” is only a direct observed physical/special super-effective move against a top threat's base typing, not a matchup or damage guarantee.

### Event and usage blockers

`npm run data:discover -- --rk9-only` retrieved 41 unapproved RK9 candidates. Eight start dates fall within the ranked M-C period, but a date match is not proof of the game's regulation or completion. No RK9 candidate was promoted through this path; the separately reviewed PokeData and Victory Road imports are documented above.

Current M-C Pikalytics AI pages are publicly accessible, but `pikalytics-mc-spread-audit.json` verified that all 21 checked pages explicitly report no EV spread or nature data. No spread recommendation is imported and `data/config.json` keeps `pikalyticsFormat` as `null`, so unverified M-C or historical M-B data cannot silently enter the snapshot. If Pikalytics publishes exact spreads later, the audit fails closed and requires review before import.

`publication-preview.json` records a snapshot SHA-256 and preflight state at the time it was generated. It is an inspection report, not consent; regenerate it after any data or catalog change before publishing.

`champions-item-sprites.json` records exact local-artwork sources for 16 observed Champions held items that PokeAPI does not distribute. It affects imagery only, never legality, mechanics, rankings, or the reviewed catalog hashes.

## Approved M-C Top-24 team expansion

`reviewed-results-mc-top24-draft.json` is the preserved 100-team review artifact for the owner-approved expansion of Baltimore, Brisbane and Frankfurt from Top 8 to Top 24. Its exact draft SHA-256 and three fetched source hashes are recorded in `reviewed-results-mc-top24-manifest.json`; the 72 PokeData records are promoted into `data/reviewed-results.json`.

All 72 Pokédata rosters have six Pokémon, an ability, an item and four moves. Only two source records per Regional exactly match the documented Swiss-round count; 22 ambiguous records per event remain without a record bonus. The approved aliases are `Maushold [Family of Three]`, `Sinistcha [Masterpiece Form]`, and `Sinistcha [Unremarkable Form]`, mapped only to their approved base entries.

Recency scoring applies independently to each roster and each 2–4 Pokémon core; only new placed finishes add fresh evidence.

## Approved Victory Road Open Team Lists

`victoryroad-mc-open-team-lists-manifest.json` records the owner-approved import of all 55 public lists from VR September Challenge #1 and all 36 from #2. Each roster is linked from the public result table and is validated for six Pokémon, item, ability, nature and four moves. Exact published positions are kept separately from the scoring bucket (for example, Marco Silva is recorded as Placement #5 while retaining the Top-8 score bucket). Only records that exactly total the event’s 11 or 10 rounds receive an x-0/x-1 bonus; no published list supplies stat points, IVs or Tera data.

## Historical Regulation M-B eligibility

`eligibility-mb.json`: 235 official species/form entries, with original names, National Pokédex numbers, form IDs, retrieval time and source SHA-256.

- Official regulation: <https://news.pokemon-home.com/en/page/776.html>
- Official roster: <https://web-view.app.pokemonchampions.jp/battle/pages/events/rs178066986988lmoqpm/en/pokemon.html>
- Ranked period: June 17, 2026 02:00 UTC through September 9, 2026 02:00 UTC (exclusive).
- M-C starts afterward: <https://www.pokemon.com/us/news/get-ready-for-regulation-set-m-c-in-pokemon-champions>

Approval would cover this species/form list only, NOT complete move/ability/item legality. Source aliases still need explicit mappings (for example official Floette versus RK9 Floette [Eternal Flower]). No Scarlet/Violet learnsets may be substituted without Champions verification.

## 2026 Worlds — Masters Top 64

`worlds-2026.json`: 64 placed teams from public RK9 lists; six Pokémon per team and no missing ability/move fields in the initial retrieval. This checks structure, not complete battle legality.

- RK9: <https://rk9.gg/tournament/WCS02wAQpCIaqFmXxER4>
- Final results: <https://www.pokemon.com/us/play-pokemon/worlds/2026/event-results>
- Tournament coverage: <https://worlds.pokemon.com/en-us/coverage-rewards/live-updates/>
- Champions M-B context: <https://www.pokemon.com/us/features/pokemon-champions-regulation-m-b-double-battles-overview>

Dates: August 28–30, 2026, San Francisco. Proposed category: Worlds, NA, M-B, Masters only. Winner Takuma Yamazaki and runner-up Hiroshi Onishi agree with the official results. The official results extraction spells the eighth player's surname differently from RK9 (Pecitelli/Piscitelli): resolve this source discrepancy rather than silently rewriting it. Finishing positions are stored as scoring buckets (1, 2, Top 4, Top 8, etc.), not fabricated exact ranks.

One event alone cannot establish a strong cross-event core. This historical M-B proposal is excluded from the M-C ranking.

## Approval boundary

The owner requested personal approval. The exact M-C legality and observed-signal role/threat catalog artifacts listed above have separate approvals in `data/approved-sources.json`; a regenerated artifact is not approved automatically. Only after separate explicit confirmation may an event be copied to `data/approved-tournaments.json`, data artifacts be promoted, or GitHub Pages be published. `data:validate` must pass for the exact production data before publication.

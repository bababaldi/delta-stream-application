# Delta Stream VGC

Private, offline-first Android toolkit for the Delta Stream Pokémon Champions team.

## Current status

Work in progress, **not a release-ready competitive calculator or APK**. The four-tab UI, manual formula/solver, team-sheet renderer, tournament pipeline and deterministic assistant are available for development. Empty production catalogs deliberately disable exports/recommendations rather than invent data.

```bash
npm ci
npx playwright install chromium   # one-time browser test setup
npm run dev
npm test
npm run test:ui
npm run typecheck
npm run build
```

Browser checks cover draft recovery, unavailable storage, private registration fields, keyboard focus, offline requests and light/dark reflow at 200% text. They do not replace Android/TalkBack testing.

## Data update workflow

Requirements: Node.js 22+ (Node 24 tested) and network access while updating. The installed app itself remains offline.

```bash
npm install
npm run data:discover
```

`data:discover` reads public Pikalytics AI tournament pages and RK9 Pokémon event pages. It writes untrusted suggestions to `data/candidates.json`; it does **not** approve or rank them.

Review candidates against official Pokémon Champions rules. Copy only completed, relevant events into `data/approved-tournaments.json` using this shape:

```json
[
  {
    "id": "stable-event-id",
    "name": "Official event name",
    "date": "2026-09-01",
    "regulation": "champions-regulation-mb",
    "tier": "regional",
    "region": "EU",
    "source": "rk9",
    "sourceUrl": "https://rk9.gg/tournament/TOURNAMENT_ID"
  }
]
```

Allowed tiers: `worlds`, `international`, `regional`. Allowed regions: `NA`, `EU`, `LATAM`, `OCE`, `ASIA`, `OTHER`. Keep the regulation equal to `activeRegulation` in `data/config.json`.

Then build the validated snapshot:

```bash
npm run data:build
npm test
npm run typecheck
```

- A fully accepted update atomically replaces `data/snapshot.json`; a quarantined update preserves the last valid snapshot. Duplicate event IDs are rejected.
- Invalid or conflicting events are written to `data/quarantine.json`.
- Any quarantined approved event makes `data:build` fail. `npm run data:validate` additionally rejects incomplete/mismatched legality and role catalogs, invalid timestamps, duplicate events and missing team details.
- Populate `data/legality.json` with reviewed Pokémon/items/moves/abilities and species-clause mappings; populate `data/roles.json` with regulation-specific versioned profiles and threat definitions. An empty `allowedTeraTypes` list disables that mechanic. Do not import Scarlet/Violet assumptions as Champions rules.
- Scrapers use only public HTTPS pages with a small concurrency limit. Do not bypass authentication, rate limits, or technical controls.

## Ranking formula

For each placed team:

`placement points × event tier × recency`

- Placement: winner `64`, runner-up `48`, Top 4 `32`, Top 8 `20`, Top 16 `12`, Top 32 `6`, Top 64 `3`.
- Tier: Worlds `2`, International `1.5`, Regional `1`.
- Recency: 0–30 days `1`, 31–60 `.75`, 61–90 `.5`, older `.25`.

Recency is calculated from the device date. Regulations never mix. Pikalytics usage is displayed separately and only breaks tournament-score ties.

## Calculator core

`src/calculator.ts` implements Pokémon Champions stat points (0–32 per stat, 66 total), 16 damage rolls, sequential two-attack checks, and Pareto-minimal defensive/offensive spread search. Each attack step has independent field modifiers; defensive checks use both maximum rolls and offensive checks use both minimum rolls. Unsupported move-, ability-, and item-specific effects must be resolved by the future data adapter rather than guessed.

The formula is adapted from NCP under MIT; see `THIRD_PARTY_NOTICES.md`. The UI currently exposes neutral natures and static manual inputs; it is not yet an automatic Pokémon/move/ability/item calculator. HP-triggered effects, recoil, recovery and independent golden validation remain release blockers. Baseline damage is explicitly distinguished from each optimized spread.

## Team tools

`src/team.ts` parses Poképaste, validates team and regulation clauses against supplied legality catalogs, and renders printable English open/staff sheets. Staff sheets require nature and stat points; incomplete catalogs and malformed imported fields block export. Tera Type is required/rendered only when enabled by the regulation. Registration fields are not stored; team and assistant text drafts are saved locally with visible storage-error recovery.

`src/assistant.ts` completes one to five locked slots from regulation-specific tournament rankings, co-occurrence, versioned roles, top-threat coverage, and evidence-backed sets. Legal tournament sets take priority over Pikalytics fallback sets; item conflicts trigger alternative-set selection. Missing locked-slot fields can be filled without changing supplied values. Output includes scoring reasons and uncovered roles/threats. Search is bounded (32 states), not exhaustive and not proof that a team is impossible; no LLM or battle simulation is used.

## Android and release gates

App ID: `team.deltastream.vgc`; minimum Android 10 (API 29). Use **JDK 21 and Android SDK 36**, for example through Android Studio. This environment currently has Java 8 and no SDK; native compilation, printing, system Back/insets and TalkBack are unverified.

```bash
npm run android:sync       # development assets; does NOT certify a release
npm run android:open
npm run release:check      # fails until reviewed production data is complete
```

Before distributing: finish the calculator adapters and independent golden cases; verify APK printing and accessibility on actual Android hardware; build a signed release in Android Studio. Keep the app ID and signing key stable for upgrades. Signing keys and `android/local.properties` are ignored by Git. Never commit them.

Runtime requests no network permission and backup is disabled. Printing uses the Android print service, with JavaScript, network and file access disabled in its dedicated WebView. Bundle the corresponding GPL source alongside the APK; the web build includes LICENSE and MIT notices.

The Capacitor CLI is pinned to 8.4.3 to avoid the vulnerable iOS-only xcode/uuid dependency introduced in 8.5.x; core/android remain on 8.5.1. Recheck `npm audit` and Android sync before changing that pin.

## License

GPL-3.0-only. Third-party notices and corresponding source must accompany distributed APKs.

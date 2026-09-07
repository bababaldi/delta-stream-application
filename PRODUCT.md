# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TypeScript and semantic HTML/CSS, packaged for Android with Capacitor. Android 10+ is the first release target; the shared web code may later support PWA and iOS.

## Users

A private Pokémon VGC team uses the app on Android while scouting the current Pokémon Champions metagame, calculating damage, preparing tournament lists, and completing teams.

## Product Purpose

Delta Stream VGC turns recent, regulation-specific tournament evidence into transparent mobile decisions: which Pokémon, cores, teams, sets, and spreads are currently strongest. Success means the team can trace every recommendation to fresh evidence and complete tournament preparation without leaving the app.

## Positioning

Unlike a usage chart or generic team generator, the product combines placement-, event-tier-, and recency-weighted tournament evidence with exact damage constraints and explains every recommendation.

## Operating Context

The owner runs repository scripts manually to discover candidate Pikalytics/RK9 events, approves them, validates the resulting data, and builds a newly signed APK. Members use the installed app offline. Discord team data enters only through local Poképaste copy/paste and never changes official rankings.

## Capabilities and Constraints

- Pokémon Champions only; every regulation is isolated.
- Separate rankings for Pokémon, frequent 2–4 Pokémon cores, and exact six-Pokémon rosters.
- Tournament score: placement points `64/48/32/20/12/6/3` for winner through Top 64, multiplied by `2/1.5/1` for Worlds/International/Regional and recency weights `1/.75/.5/.25` for 0–30/31–60/61–90/90+ days.
- A strong core requires at least three placed teams across at least two events; lower support is emerging.
- Global ranking has no geographic multiplier; the default view filters North America and Europe.
- Pikalytics usage is context and a tie-breaker, not tournament success.
- Invalid, conflicting, incomplete, future-dated, or cross-regulation records are quarantined rather than inferred.
- Calculator supports two generic attack steps, guaranteed maximum normal rolls without critical hits, explicit field state, Pareto-minimal spreads, and impossible-result reporting.
- Team creator parses Poképaste, blocks illegal exports, and creates English open and staff PDFs. Personal registration fields are not persisted.
- Team assistant accepts one to five field-level locked slots and ranks completion using recent success, co-occurrence, versioned roles, and top-threat coverage. Tournament sets take priority over Pikalytics fallback. No LLM or battle simulation.
- Runtime is offline with no account, backend, telemetry, or backup. In-place APK upgrades depend on a stable app ID and signing key.
- App name: Delta Stream VGC. Android application ID: `team.deltastream.vgc`.
- GPL-3.0 application; retain MIT attribution for adapted calculator code.

## Brand Commitments

Use the Delta Stream team logo supplied by the user. Derive an accessible palette from it and use system fonts. The interface is English-only and follows Impeccable guidance without obscuring competitive data.

## Evidence on Hand

- Pikalytics AI endpoints expose format and tournament Markdown.
- RK9 public event, standings, roster, and team-list pages are available but have no official API contract.
- `nerd-of-now/NCP-VGC-Damage-Calculator` is MIT licensed.
- `simusr2/PokemonTeamListCreator` has no declared license, so its behavior must be reimplemented clean-room.
- The user supplied `delta-stream.png` (JPEG bytes), now preserved as `public/delta-stream.jpg`; the Android icon is a crop of that source. No performance or accuracy claims may be fabricated.
- Confirmed visual direction: departure-board layout, mixed-light use with system light/dark theme, restrained decoration. Production legality and role catalogs are still unapproved/empty.

## Product Principles

1. Tournament results outrank popularity.
2. Every score and recommendation exposes its source, freshness, and confidence.
3. Regulation boundaries and legality are hard constraints.
4. Offline, local-first operation beats fake accounts and fragile runtime services.
5. Incorrect competitive data blocks release rather than degrading silently.

## Accessibility & Inclusion

WCAG 2.2 AA is a release gate. Every flow must support TalkBack, 200% text/zoom, visible focus, reduced motion, non-color status cues, at least 48×48 dp touch targets with adequate spacing, and a real Android device check.

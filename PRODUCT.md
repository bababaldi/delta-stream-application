# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TypeScript/Vite and semantic HTML/CSS, published as a mobile-first offline PWA on GitHub Pages (GitHub Free, public repository). Data collection and preparation run as local batch scripts. Android/Capacitor code is retained only as legacy reference, not a release dependency.

## Users

The Delta Stream Pokémon VGC team and public site visitors use mobile browsers or the installed PWA while scouting the current Pokémon Champions metagame, calculating damage, preparing tournament lists, and completing teams.

## Product Purpose

Delta Stream VGC turns recent, regulation-specific tournament evidence into transparent mobile decisions: which Pokémon, cores, teams, sets, and spreads are currently strongest. Success means the team can trace every recommendation to fresh evidence and complete tournament preparation without leaving the app.

## Positioning

Unlike a usage chart or generic team generator, the product combines placement-, event-tier-, and recency-weighted tournament evidence with exact damage constraints and explains every recommendation.

## Operating Context

The owner runs repository scripts manually to discover candidate Pikalytics/RK9 events, personally approves events/catalogs, and reviews the batch preview. Only an explicit subsequent owner confirmation authorizes publication of the reviewed snapshot via GitHub Actions to GitHub Pages. No push-triggered deploy or hosted scraper. Visitors can use the downloaded PWA offline; new versions wait for an explicit reload so open forms are not discarded. Discord team data enters only through local Poképaste copy/paste and never changes official rankings.

## Capabilities and Constraints

- Pokémon Champions only; every regulation is isolated. Current requested target: M-C, with official eligibility and individually verified tournament regulations. M-B evidence must not be relabeled.
- Separate rankings for Pokémon, frequent 2–4 Pokémon cores, and exact six-Pokémon rosters.
- Tournament score: placement points `64/48/32/20/12/6/3` for winner through Top 64, multiplied by `2/1.5/1` for Worlds/International/Regional and recency weights `1/.75/.5/.25` for 0–30/31–60/61–90/90+ days.
- A strong core requires at least three placed teams across at least two events; lower support is emerging.
- Global ranking has no geographic multiplier; the default view filters North America and Europe.
- Pikalytics usage is context and a tie-breaker, not tournament success.
- Invalid, conflicting, incomplete, future-dated, or cross-regulation records are quarantined rather than inferred.
- Calculator supports two generic attack steps, guaranteed maximum normal rolls without critical hits, explicit field state, Pareto-minimal spreads, and impossible-result reporting.
- Team creator parses Poképaste, blocks illegal exports, and creates English open and staff PDFs. Personal registration fields are not persisted.
- Team assistant accepts one to five field-level locked slots and ranks completion using recent success, co-occurrence, versioned roles, and top-threat coverage. Tournament sets take priority over Pikalytics fallback. No LLM or battle simulation.
- Four sections ship together: Meta, Calc, Teams, Assist. Competitive gaps remain release blockers, not grounds to silently reduce scope.
- No account, hosted backend, app telemetry or cloud backup. Offline use needs a successful first download; browsers can evict storage. Team drafts stay in the browser, on the GitHub Pages origin shared with the owner's other project sites.
- App name: Delta Stream VGC. Repository: `bababaldi/delta-stream-application`; project site: `https://bababaldi.github.io/delta-stream-application/`.
- GPL-3.0 application; retain MIT attribution for adapted calculator code.

## Brand Commitments

Use the Delta Stream team logo supplied by the user. Derive an accessible palette from it and use system fonts. The interface is English-only and follows Impeccable guidance without obscuring competitive data.

## Evidence on Hand

- Pikalytics AI endpoints expose format and tournament Markdown.
- RK9 public event, standings, roster, and team-list pages are available but have no official API contract.
- `nerd-of-now/NCP-VGC-Damage-Calculator` is MIT licensed.
- `simusr2/PokemonTeamListCreator` has no declared license, so its behavior must be reimplemented clean-room.
- The user supplied `delta-stream.png` (JPEG bytes), now preserved as `public/delta-stream.jpg`; PWA icons are resized copies of that source. No performance or accuracy claims may be fabricated.
- Confirmed visual direction: departure-board layout, mixed-light use with system light/dark theme, restrained decoration. Production legality and role catalogs are still unapproved/empty.

## Product Principles

1. Tournament results outrank popularity.
2. Every score and recommendation exposes its source, freshness, and confidence.
3. Regulation boundaries and legality are hard constraints.
4. Offline, local-first operation beats fake accounts and fragile runtime services.
5. Incorrect competitive data blocks release rather than degrading silently.

## Accessibility & Inclusion

WCAG 2.2 AA is a release gate. Every flow must support TalkBack, 200% text/zoom, visible focus, reduced motion, non-color status cues, at least 48×48 CSS-pixel touch targets with adequate spacing, and real-phone browser checks (Android Chrome and iOS Safari).

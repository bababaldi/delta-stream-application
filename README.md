# Delta Stream VGC

Mobile-first, offline-capable web toolkit for the Delta Stream Pokémon Champions team, targeting GitHub Pages on GitHub Free. Data collection runs manually on the owner's computer; visitors need no account or backend.

## Current status

Work in progress, **not a release-ready competitive calculator or public site**. The requested current format is Champions M-C; production legality/role data still needs separate owner approval. The snapshot contains six roster-only teams from the two completed September M-C VR Challenges, reviewed Pokédata top eights from Baltimore, Brisbane and Frankfurt, and 22 Italian VG Cup/VG Challenge winner rosters (52 teams across 27 events). Italian locals are low-weight, owner-accepted evidence rather than official Regional results. Pokédata and Italian locals are manually imported only after review; the owner has accepted Brisbane, Frankfurt and the Italian local source for this snapshot. Incomplete production legality/role catalogs still disable exports/recommendations rather than invent data.

```bash
npm ci
npx playwright install chromium   # one-time browser test setup
npm run dev
npm test
npm run test:ui
npm run typecheck
npm run build:pages
npm run test:pwa
npm run preview:pages
```

Preview: `http://127.0.0.1:4173/delta-stream-application/`. Browser checks cover draft recovery, unavailable storage, private registration fields, keyboard focus, offline reload, explicit updates, failed-update rollback, cache isolation and light/dark reflow at 200% text. Real-phone Safari/TalkBack checks remain separate.

## GitHub Pages publication — owner approval required

**Pages on GitHub Free is public, not password-protected.** A password checked in browser JavaScript/HTML is bypassable and must not be used as access control. A password stored only on this computer cannot authenticate visitors to GitHub's static hosting; do not commit or bundle it. For genuine private access use a host with server-side authentication (or a controlled proxy/custom domain and access gateway); public repository source remains readable regardless of site protection. [GitHub Pages publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

Target: <https://bababaldi.github.io/delta-stream-application/>. The repository is `bababaldi/delta-stream-application`. Before making it public, review the **entire Git history**, tracked review datasets and Actions logs for credentials, personal information and redistribution rights. A bounded local scan found no recognizable private-key/GitHub/OpenAI/AWS token patterns in the current history; this is not a guarantee that all sensitive content has been found.

Owner steps on GitHub:

1. Repository **Settings → General → Danger Zone → Change repository visibility → Public**, then confirm.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**. No template is needed.
3. After completing and approving the data and calculator work, review `npm run data:preview` and the local preview. Only then authorize the commit/push and publication.
4. **Actions → Publish reviewed GitHub Pages → Run workflow** on `main`; check the approval box and paste `snapshotSha256` from the preview report.

The workflow is **manual only**: a push never deploys. It checks the exact snapshot hash, validates committed data, runs tests, builds the site and uploads only `dist/`. It does not collect new tournament data. A failing check leaves the previous deployment untouched. `npm run release:check` remains blocked while production catalogs/results are incomplete; passing data preflight alone does not certify competitive correctness.

### Offline use and privacy

After the initial online load reports **Offline copy ready**, the four tools use the cached app and bundled snapshot. Install using the browser's **Install app** / **Add to Home Screen** menu. Browser storage can be cleared or evicted; keep copies of important teams. Private browsing may not retain drafts or offline files.

An available update waits for **Reload to update**; it never silently replaces an open form. Reloading clears unsaved calculator/registration fields, but saved team/assistant drafts are retained. A failed download does not replace the previous cache. No account, analytics or visitor-data upload is added. GitHub serves the files and may retain standard hosting logs. Browser storage is origin-scoped: other sites hosted under the same `bababaldi.github.io` origin share that security boundary.

The PWA icons are resized copies of the owner-supplied `public/delta-stream.jpg`; no new artwork or asset license is implied.

## Data update workflow

Requirements: Node.js 24 and network access while collecting data. The PWA uses its last downloaded snapshot offline.

```bash
npm ci
npm run data:review                  # official M-C eligibility, review only
npm run data:discover -- --rk9-only  # available public source while Pikalytics returns 403
```

`data:discover` normally reads public Pikalytics AI tournament pages and RK9 Pokémon event pages. `--rk9-only` explicitly skips Pikalytics and replaces the candidate file with current RK9 suggestions. It writes untrusted suggestions to `data/candidates.json`; it does **not** approve or rank them. The two reviewed VR events plus completed Baltimore, Brisbane and Frankfurt top eights are pinned in `data/reviewed-results.json`; the same file also stores reviewed Italian VG Cup/VG Challenge winners. New live events are never ingested automatically. Run `npm run data:import-pokedata` or `npm run data:import-italian-locals` only to refresh their already-reviewed sources. Usage context is currently disabled with `pikalyticsFormat: null` until an accessible M-C feed is verified; M-B is never a fallback.

Review candidates against official Pokémon Champions rules. Copy only completed, relevant events into `data/approved-tournaments.json` using this shape:

```json
[
  {
    "id": "stable-event-id",
    "name": "Official event name",
    "date": "2026-09-12",
    "regulation": "champions-regulation-mc",
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
npm run data:preview       # review report + snapshot hash; no push or approval
npm run build:pages
npm run preview:pages
```

- A fully accepted update atomically replaces `data/snapshot.json`; a quarantined update preserves the last valid snapshot. Duplicate event IDs are rejected.
- Invalid or conflicting events are written to `data/quarantine.json`.
- Any quarantined approved or reviewed event makes `data:build` fail. `npm run data:validate` additionally rejects incomplete/mismatched legality and role catalogs, invalid timestamps, duplicate events and missing team details.
- Populate `data/legality.json` with reviewed Pokémon/items/moves/abilities and species-clause mappings; populate `data/roles.json` with regulation-specific versioned profiles and threat definitions. An empty `allowedTeraTypes` list disables that mechanic. Do not import Scarlet/Violet assumptions as Champions rules.
- Scrapers use only public HTTPS pages with a small concurrency limit. Do not bypass authentication, rate limits, or technical controls.

## Ranking formula

For each placed team:

`placement points × event tier × recency`

- Placement: winner `64`, runner-up `48`, Top 4 `32`, Top 8 `20`, Top 16 `12`, Top 32 `6`, Top 64 `3`.
- Tier: Worlds `2`, International `1.5`, Regional `1`, VR Online `.75`.
- Recency: 0–30 days `1`, 31–60 `.75`, 61–90 `.5`, older `.25`.

- For Victory Road online events only, a documented complete record that exactly totals `recordRounds` gives x-0 a `2` multiplier and x-1 a `1.75` multiplier; all other records get `1`. These bonuses use the **same recency weight**. Partial or inferred records never receive a bonus.
- Italian VG Cup/VG Challenge winners are roster-only local evidence at `0.125×` placement value (a conservative potential x-2 Regional/VR signal). They never receive a record bonus or make an entry `Strong` by themselves.

Recency is calculated from the device date. Regulations never mix. Pikalytics usage is displayed separately and only breaks tournament-score ties. Sources for the current snapshot: [Pokédata Baltimore](https://www.pokedata.ovh/standingsVGC/0000192/masters/0000192_Masters.json), [Brisbane](https://www.pokedata.ovh/standingsVGC/0000193/masters/0000193_Masters.json), [Frankfurt](https://www.pokedata.ovh/standingsVGC/0000194/masters/0000194_Masters.json), [VR Sep #1](https://victoryroad.pro/vr-sep26/), [VR Sep #2](https://victoryroad.pro/vr-sep26-2/) and [VGC Locals Italia](https://shairaba.github.io/vgc-locals-italia/data/tournaments.json). `data/reviewed-results.json` is a manually reviewed, versioned source; run `npm run data:build` to rebuild the snapshot. `scripts/import-pokedata.ts` imports the three pinned completed-event top eights; `scripts/import-italian-locals.ts` imports only published local winners, not full top-cut sets. Pokédata's final Frankfurt record is 17-0 for Eric Rios and 14-3 for Sebastian Liu Li; the prior in-progress 16-0/14-2 figures are not retained. VR roster sprites are not full sets. Missing set fields keep team recommendations disabled until legality/role catalogs and actual sets are reviewed.

## Calculator core

`src/calculator.ts` implements Pokémon Champions stat points (0–32 per stat, 66 total), 16 damage rolls, sequential two-attack checks, and Pareto-minimal defensive/offensive spread search. Each attack step has independent field modifiers; defensive checks use both maximum rolls and offensive checks use both minimum rolls. Unsupported move-, ability-, and item-specific effects must be resolved by the future data adapter rather than guessed.

The formula is adapted from NCP under MIT; see `THIRD_PARTY_NOTICES.md`. The UI lists all 166 NCP Champions items. Direct handlers cover type boosters, Normal Gem, Muscle Band, Wise Glasses, Expert Belt, Life Orb, Light Ball (Pikachu), resist berries, Air Balloon and active terrain seeds; `Technician` remains an ability, not an item. Mega form stats/abilities and stateful effects such as recovery, recoil, accuracy, speed and switching remain manual and are called out beside each result. Actual move catalogs, type/ability immunities, changing BP, screens, crits, HP-triggered effects and independent in-game golden validation remain release blockers. Baseline damage is explicitly distinguished from each optimized spread.

## Team tools

`src/team.ts` parses Poképaste, validates team and regulation clauses against supplied legality catalogs, and renders printable English open/staff sheets. Staff sheets require nature and stat points; incomplete catalogs and malformed imported fields block export. Tera Type is required/rendered only when enabled by the regulation. Registration fields are not stored; team and assistant text drafts are saved locally with visible storage-error recovery.

`src/assistant.ts` completes one to five locked slots from regulation-specific tournament rankings, co-occurrence, versioned roles, top-threat coverage, and evidence-backed sets. Legal tournament sets take priority over Pikalytics fallback sets; item conflicts trigger alternative-set selection. Missing locked-slot fields can be filled without changing supplied values. Output includes scoring reasons and uncovered roles/threats. Search is bounded (32 states), not exhaustive and not proof that a team is impossible; no LLM or battle simulation is used.

## Legacy Android build — not part of the web release

App ID: `team.deltastream.vgc`; minimum Android 10 (API 29). **Terminal-only workflow: no VS Code extensions or Java language server required.** Standalone JDK 21 and Android SDK 36 are installed under `~/.local/share/delta-stream/toolchain/`; system Java is unchanged. `scripts/build-android.sh` also accepts explicit `JAVA_HOME` and `ANDROID_HOME`.

```bash
npm run android:debug     # build a development APK
npm run android:verify    # app lint + APK + compilation of instrumentation tests
npm run android:test      # RUN instrumentation tests; needs a connected Android device
npm run release:check     # still fails until reviewed production data is complete
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`. This is debug-signed, NOT a distributable release. Instrumentation test compilation is not evidence that those tests ran. Real printing, system Back/insets and TalkBack remain unverified.

WSL builds use one Gradle worker, a 768 MB heap, no parallel builds, no persistent daemon and no file watching. `.pi-lens.json` excludes Android sources from editor/LSP scans; Gradle compiles and lints them instead. Workspace settings disable Java auto-build/import, `gradle.autoDetect`, and `java.gradle.buildServer.enabled`; disable the Java/Gradle extensions for this workspace in VS Code too if they were already running. Do not activate Java extensions when the editor suggests them. The editor's `--add-opens` failure is consistent with its Java 8 fallback; the standalone JDK 21 accepts that option.

**Do not launch any Android emulator inside this WSL instance.** Both software emulation and a KVM-enabled attempt (1 GB guest RAM, two cores) coincided with WSL disconnections. KVM access was successfully verified via `sg kvm` after the owner added the user to the group, so more permission changes are not a fix. WSL has about 3.7 GiB RAM; the emulator has overhead beyond guest RAM, but memory exhaustion is only a hypothesis: previous-boot logs were lost and no OOM cause was established. Keep CLI compilation in WSL and use a physical Android phone, or investigate a Windows-native emulator separately. Neither native runtime tests nor a crash fix have been certified.

The newly installed Google SDK CLI enables metrics by default; the first compatibility-wrapper invocation displayed that notice. Subsequent direct invocations use `android --no-metrics`. This is build tooling, not app telemetry. Do not use the legacy `sdkmanager` wrapper for further installs.

Before distributing: finish the calculator adapters and independent golden cases; verify APK printing and accessibility on actual Android hardware; create and sign a release using the command-line build tools and an owner-controlled signing key. Keep the app ID and signing key stable for upgrades. Signing keys and `android/local.properties` are ignored by Git. Never commit them.

Runtime requests no network permission and backup is disabled. Printing uses the Android print service, with JavaScript, network and file access disabled in its dedicated WebView. Bundle the corresponding GPL source alongside the APK; the web build includes LICENSE and MIT notices.

The Capacitor CLI is pinned to 8.4.3 to avoid the vulnerable iOS-only xcode/uuid dependency introduced in 8.5.x; core/android remain on 8.5.1. Recheck `npm audit` and Android sync before changing that pin.

## License

GPL-3.0-only. The site bundles LICENSE and third-party notices; keep the corresponding source available with every published version. This code license does not grant rights to Pokémon trademarks or third-party competitive datasets.

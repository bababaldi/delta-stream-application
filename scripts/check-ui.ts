import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const browser = await chromium.launch();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error("Test server has no URL");
try {
    await mkdir(".impeccable/review", { recursive: true });
    const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const outsideRequests: string[] = [];
    page.on("request", (request) => {
        if (new URL(request.url()).origin !== new URL(url).origin)
            outsideRequests.push(request.url());
    });
    await page.goto(url);
    const tab = async (label: string) =>
        page
            .getByRole("navigation")
            .getByRole("button", { name: label, exact: true })
            .click();
    await tab("Teams");
    const paste = "Synthetic\nAbility: Test\nSPs: broken\n- Protect";
    const assistPaste = `Kangaskhan (F) @ Life Orb
Ability: Scrappy
Level: 50
EVs: 32 HP / 32 Atk / 2 Def
Brave Nature
- Fake Out
- Hammer Arm
- Protect
- Double-Edge

Farigiraf (M) @ Colbur Berry
Ability: Armor Tail
Level: 50
EVs: 32 HP / 10 Def / 24 SpD
Relaxed Nature
- Helping Hand
- Psychic
- Trick Room
- Thunderbolt`;
    await page
        .getByRole("textbox", { name: "Poképaste", exact: true })
        .fill(paste);
    await tab("Meta");
    await tab("Teams");
    assert.equal(
        await page
            .getByRole("textbox", { name: "Poképaste", exact: true })
            .inputValue(),
        paste,
    );
    await page.reload();
    await tab("Teams");
    assert.equal(
        await page
            .getByRole("textbox", { name: "Poképaste", exact: true })
            .inputValue(),
        paste,
    );
    await page.getByRole("button", { name: "Parse team", exact: true }).click();
    assert.match(
        await page.locator("#feedback").innerText(),
        /malformed stat points/,
    );
    const printButton = page.getByRole("button", {
        name: "Print / save open PDF",
        exact: true,
    });
    assert.ok(!(await printButton.isDisabled()));
    await printButton.click();
    assert.match(await page.locator("#team-result").innerText(), /Cannot export/);
    await page.locator("#player-name").fill("PRIVATE REGISTRATION");
    const stored = await page.evaluate(() =>
        Object.values(localStorage).join(" "),
    );
    assert.ok(!stored.includes("PRIVATE REGISTRATION"));
    await tab("Calc");
    const defenderPicker = page.locator('[name="defenderName"]');
    const firstMove = page.locator('[name="move1Name"]');
    assert.ok(await defenderPicker.isDisabled());
    assert.ok(await firstMove.isDisabled());
    await page.locator('[name="attackerName"]').fill("Floette Mega");
    assert.equal(await defenderPicker.isDisabled(), false);
    assert.equal(await firstMove.isDisabled(), false);
    assert.ok(await firstMove.locator('option[value="Light of Ruin"]').count());
    assert.equal(await firstMove.locator('option[value="Surf"]').count(), 0);
    await defenderPicker.fill("Incineroar");
    assert.equal(await page.locator('[name="attackBase"]').inputValue(), "85");
    assert.equal(await page.locator('[name="specialAttackBase"]').inputValue(), "155");
    assert.match(
        await page.locator('[data-pokemon-sprite="attacker"]').getAttribute("src") ?? "",
        /floette-mega\.png$/,
    );
    await firstMove.selectOption("Light of Ruin");
    await page.locator('[name="move2Name"]').selectOption("Light of Ruin");
    await page.locator('[name="move1Power"]').fill("80");
    await page.getByRole("button", { name: "Calculate spreads" }).click();
    const calcResult = await page.locator("#calc-result").innerText();
    assert.match(calcResult, /Attacker spread — guaranteed 2HKO/);
    assert.match(calcResult, /Defender spread — survives two maximum rolls/);
    await page.locator('[name="attackerSpread"]').uncheck();
    await page.locator('[name="defenderGoal"]').selectOption("one");
    assert.equal(await page.locator(".move-step").count(), 1);
    assert.match(await page.locator("#calc-form").innerText(), /6\.25%/);
    await page.getByRole("button", { name: "Calculate spreads" }).click();
    assert.match(await page.locator("#calc-result").textContent() ?? "", /Defender spread — survives one hit/);
    await tab("Assist");
    await page.locator("#assist-form textarea").fill(assistPaste);
    await page.getByRole("button", { name: "Rank completions" }).click();
    assert.ok(await page.locator("#assist-result .completion").count());
    assert.match(await page.locator("#assist-result").innerText(), /Kangaskhan[\s\S]*Farigiraf/);
    assert.match(await page.locator("#assist-result").innerText(), /Placed-team co-occurrence/);
    await tab("Calc");
    assert.equal(await page.locator('[name="move1Power"]').inputValue(), "80");
    assert.match(
        await page.locator("#calc-result").innerText(),
        /Defender spread — survives one hit/,
    );
    await page.locator('[name="attackerSpread"]').check();
    await page.locator('[name="defenderGoal"]').selectOption("two");
    assert.equal(await page.locator(".move-step").count(), 2);
    await page.getByRole("button", { name: "Calculate spreads" }).click();
    assert.match(
        await page.locator("#calc-result").innerText(),
        /Attacker spread — guaranteed 2HKO[\s\S]*Defender spread — survives two maximum rolls/,
    );
    await tab("Meta");
    const firstRanking = page.locator(".ranking-row").first();
    assert.ok(await firstRanking.locator(".rank-sprites img").count());
    assert.equal(await firstRanking.locator("[data-ranking-evidence] *").count(), 0);
    await firstRanking.locator("summary").first().click();
    const setPreview = firstRanking.locator("[data-set-preview]").first();
    await setPreview.waitFor();
    assert.ok(await setPreview.count());
    assert.match(await setPreview.getAttribute("aria-label") ?? "", /Moves:|Roster-only/);
    await setPreview.focus();
    await page.waitForTimeout(150);
    assert.equal(
        await setPreview.locator(".set-popover").evaluate((element) =>
            getComputedStyle(element).visibility,
        ),
        "visible",
    );
    await page.getByRole("button", { name: "Cores 2–4", exact: true }).click();
    assert.equal(await page.locator(".ranking-row").count(), 50);
    await page.getByRole("button", { name: "Show next 50", exact: true }).click();
    assert.equal(await page.locator(".ranking-row").count(), 100);
    await page.getByRole("button", { name: "Pokemon", exact: true }).click();
    await page.locator('[data-region="NA"]').uncheck();
    assert.equal(
        await page.evaluate(() =>
            document.activeElement?.getAttribute("data-region"),
        ),
        "NA",
    );

    for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({
            colorScheme: theme,
            reducedMotion: "reduce",
        });
        for (const [width, scale] of [
            [390, 1],
            [390, 2],
            [1440, 1],
        ]) {
            await page.setViewportSize({ width: width!, height: 900 });
            await page.evaluate((value) => {
                document.documentElement.style.fontSize = `${value * 100}%`;
            }, scale!);
            for (const label of ["Meta", "Calc", "Teams", "Assist"]) {
                await tab(label);
                const overflow = await page.evaluate(
                    () => document.documentElement.scrollWidth > innerWidth + 1,
                );
                assert.equal(
                    overflow,
                    false,
                    `${label} horizontal overflow at ${width}px, ${scale}x, ${theme}`,
                );
            }
            await tab("Meta");
            await page.evaluate(() => {
                (document.activeElement as HTMLElement)?.blur();
                window.scrollTo({ top: 0, behavior: "instant" });
            });
            await page.screenshot({
                path: `.impeccable/review/${width === 1440 ? "desktop" : "mobile"}-${theme}-${scale}x.png`,
                fullPage: true,
            });
            const firstRanking = page.locator(".ranking-row").first();
            await firstRanking.locator("summary").first().click();
            const evidenceRows = firstRanking.locator(".evidence > .evidence-team-list > li");
            await evidenceRows.nth(5).waitFor();
            assert.equal(await evidenceRows.count(), 6);
            assert.match(
                await firstRanking.locator(".evidence-more summary").textContent() ?? "",
                /^Show \d+ more supporting teams$/,
            );
            await page.screenshot({
                path: `.impeccable/review/${width === 1440 ? "desktop" : "mobile"}-detail-${theme}-${scale}x.png`,
                fullPage: true,
            });
            await tab("Calc");
            await page.screenshot({
                path: `.impeccable/review/${width === 1440 ? "desktop" : "mobile"}-calc-${theme}-${scale}x.png`,
                fullPage: true,
            });
        }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(outsideRequests, []);

    const denied = await browser.newPage();
    await denied.addInitScript(() => {
        Storage.prototype.getItem = () => {
            throw new DOMException("denied", "SecurityError");
        };
        Storage.prototype.setItem = () => {
            throw new DOMException("full", "QuotaExceededError");
        };
    });
    await denied.goto(url);
    assert.ok(
        await denied
            .getByRole("heading", { name: "Tournament board" })
            .isVisible(),
    );
    assert.match(
        await denied.locator("#storage-feedback").innerText(),
        /storage is unavailable/,
    );
    await denied
        .getByRole("navigation")
        .getByRole("button", { name: "Teams", exact: true })
        .click();
    await denied
        .getByRole("textbox", { name: "Poképaste", exact: true })
        .fill("Still editable");
    assert.match(
        await denied.locator("#storage-feedback").innerText(),
        /could not be saved/,
    );
    console.log(
        "UI checks passed: draft recovery, storage failure, calculator state, private fields, focus, offline requests, light/dark reflow at 200%.",
    );
} finally {
    await browser.close();
    await server.close();
}

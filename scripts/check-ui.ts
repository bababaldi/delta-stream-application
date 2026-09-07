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
    assert.ok(
        await page
            .getByRole("button", { name: "Print / save open PDF", exact: true })
            .isDisabled(),
    );
    await page.locator("#player-name").fill("PRIVATE REGISTRATION");
    const stored = await page.evaluate(() =>
        Object.values(localStorage).join(" "),
    );
    assert.ok(!stored.includes("PRIVATE REGISTRATION"));
    await tab("Calc");
    await page.locator('[name="move1Power"]').fill("80");
    await page.getByRole("button", { name: "Calculate spreads" }).click();
    assert.match(
        await page.locator("#calc-result").innerText(),
        /Non-dominated spreads|Impossible/,
    );
    await tab("Assist");
    await tab("Calc");
    assert.equal(await page.locator('[name="move1Power"]').inputValue(), "80");
    assert.match(
        await page.locator("#calc-result").innerText(),
        /Non-dominated spreads|Impossible/,
    );
    await tab("Meta");
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

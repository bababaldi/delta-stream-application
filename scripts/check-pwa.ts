import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readdir, readFile, mkdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { chromium } from "playwright";

const base = "/delta-stream-application/";
const directory = resolve("dist");
const files = new Map<string, Buffer>();
for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
  if (entry.isFile()) files.set(base + relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"), await readFile(join(entry.parentPath, entry.name)));
}
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg" };
const server = createServer((request, response) => {
  const path = new URL(request.url!, "http://localhost").pathname;
  const key = path === base ? base + "index.html" : path;
  const body = files.get(key);
  response.writeHead(body ? 200 : 404, { "Content-Type": types[extname(key)] ?? "text/plain", "Cache-Control": "no-store" });
  response.end(body ?? "Not found");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Missing test address");
const url = `http://127.0.0.1:${address.port}${base}`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.getByText("Offline copy ready. Data freshness is shown in Meta.", { exact: true }).waitFor();
  assert.ok(await page.locator(".app-bar img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0));
  assert.equal(await page.locator('link[rel="manifest"]').evaluate((link: HTMLLinkElement) => link.href), url + "manifest.webmanifest");
  const manifest = await page.evaluate(async () => (await fetch("./manifest.webmanifest")).json());
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.deepEqual(manifest.icons.map((icon: { sizes: string }) => icon.sizes), ["192x192", "512x512"]);
  await page.evaluate(async () => { await caches.open("unrelated-site-cache"); });
  const tab = (name: string) => page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
  const draft = "PRIVATE LOCAL DRAFT\nAbility: Test\n- Protect";
  await tab("Teams");
  await page.getByRole("textbox", { name: "Poképaste", exact: true }).fill(draft);
  await context.setOffline(true);
  await page.reload();
  for (const name of ["Meta", "Calc", "Teams", "Assist"]) await tab(name);
  await tab("Teams");
  assert.equal(await page.getByRole("textbox", { name: "Poképaste", exact: true }).inputValue(), draft);
  await context.setOffline(false);

  const originalWorker = files.get(base + "sw.js")!.toString();
  const originalIndex = files.get(base + "index.html")!.toString();
  assert.match(originalWorker, /const cacheName = prefix \+ "[a-f0-9]+";/);
  const workerVersion = (version: string) => originalWorker.replace(/const cacheName = prefix \+ "[a-f0-9]+";/, `const cacheName = prefix + "${version}";`);
  // A failed precache must leave the previous release fully usable offline.
  files.set(base + "sw.js", Buffer.from(workerVersion("broken").replace("const assets = [", 'const assets = ["missing-release.js",')));
  await page.evaluate(async () => {
    const registration = (await navigator.serviceWorker.getRegistration())!;
    const failed = new Promise<void>((resolve) => registration.addEventListener("updatefound", () => {
      const worker = registration.installing!;
      worker.addEventListener("statechange", () => { if (worker.state === "redundant") resolve(); });
    }, { once: true }));
    await registration.update();
    await failed;
  });
  await context.setOffline(true);
  await page.reload();
  await tab("Teams");
  assert.equal(await page.getByRole("textbox", { name: "Poképaste", exact: true }).inputValue(), draft);
  assert.ok(!(await page.evaluate(() => caches.keys())).some((key) => key.endsWith(":broken")));
  await context.setOffline(false);

  const peer = await context.newPage();
  await peer.goto(url);
  await peer.getByRole("navigation").getByRole("button", { name: "Calc", exact: true }).click();
  await peer.locator('[name="move1Power"]').fill("130");
  files.set(base + "index.html", Buffer.from(originalIndex.replace("</head>", '<meta name="test-release" content="two"></head>')));
  files.set(base + "sw.js", Buffer.from(workerVersion("two")));
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  const update = page.getByRole("button", { name: "Reload to update", exact: true });
  await update.waitFor();
  assert.equal(await page.locator('meta[name="test-release"]').count(), 0, "Never reload an open form automatically");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await mkdir(".impeccable/review", { recursive: true });
      await page.screenshot({ path: `.impeccable/review/pwa-update-${width}-${theme}.png`, fullPage: true });
    }
  }
  await update.click();
  await page.waitForFunction(() => document.querySelector<HTMLMetaElement>('meta[name="test-release"]')?.content === "two");
  await tab("Teams");
  assert.equal(await page.getByRole("textbox", { name: "Poképaste", exact: true }).inputValue(), draft);
  const keys = await page.evaluate(() => caches.keys());
  assert.ok(keys.includes("unrelated-site-cache"));
  assert.equal(keys.filter((key) => key.startsWith("delta-stream:")).length, 1);
  assert.equal(await peer.locator('meta[name="test-release"]').count(), 0, "Another tab must keep its unsaved form");
  assert.equal(await peer.locator('[name="move1Power"]').inputValue(), "130");
  await peer.getByRole("button", { name: "Reload to update", exact: true }).click();
  await peer.waitForFunction(() => document.querySelector<HTMLMetaElement>('meta[name="test-release"]')?.content === "two");
  await peer.close();
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator('meta[name="test-release"]').getAttribute("content"), "two");
  assert.deepEqual(errors, []);
  console.log("PWA checks passed: project subpath, icon/manifest, offline reload, four tabs, private drafts, failed-update rollback, explicit update, cache isolation and mobile/desktop 200% reflow.");
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

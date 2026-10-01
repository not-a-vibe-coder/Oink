import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
const base = process.env.DEMO_BASE_URL ?? "http://127.0.0.1:3105";
const output = new URL("../docs/submission/artifacts/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const name = viewport.width === 390 ? "mobile" : "desktop";
    const context = await browser.newContext({
      viewport,
      ...(name === "desktop" ? { recordVideo: { dir: output, size: viewport } } : {}),
    });
    const page = await context.newPage();
    const errors = [],
      forbidden = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    page.on("request", (request) => {
      if (/\/api\/v1\/|\/_serverFn/.test(request.url())) forbidden.push(request.url());
    });
    await page.goto(`${base}/demo`, { waitUntil: "networkidle" });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some((button) =>
        Object.keys(button).some((key) => key.startsWith("__reactProps")),
      ),
    );
    await page.getByRole("note").waitFor();
    assert.match(await page.getByRole("note").innerText(), /Simulated walkthrough/);
    for (const text of [
      "Simulate payment receipt",
      "Allocate received income",
      "Check fresh demo quotes",
      "Review demo simulation",
      "Simulate approval",
      "Simulate finalized receipt",
    ]) {
      console.log(name, text);
      await page.getByRole("button", { name: text, exact: true }).click();
      await page.waitForTimeout(500);
    }
    await page
      .getByRole("heading", { name: "Payment and investment receipt" })
      .scrollIntoViewIfNeeded();
    assert.match(await page.locator("main").innerText(), /180 USDC completed · 120 USDC reserved/);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `${name} horizontal overflow`,
    );
    await page.screenshot({ path: `${output}demo-${name}.png`, fullPage: true });
    await page.getByRole("button", { name: "Restart walkthrough" }).click();
    await page.getByRole("button", { name: "Simulate payment receipt" }).waitFor();
    if (name === "mobile") {
      await page.clock.install();
      for (const text of [
        "Simulate payment receipt",
        "Allocate received income",
        "Check fresh demo quotes",
        "Review demo simulation",
      ])
        await page.getByRole("button", { name: text, exact: true }).click();
      await page.clock.fastForward(31000);
      await page.getByRole("button", { name: "Simulate approval", exact: true }).click();
      assert.match(await page.getByRole("alert").innerText(), /Quote expired/);
      assert.equal(
        await page.getByRole("button", { name: "Simulate finalized receipt" }).count(),
        0,
      );
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(forbidden, []);
    const video = page.video();
    await context.close();
    if (video) {
      const rawPath = await video.path();
      await video.saveAs(`${output}demo-desktop.webm`);
      await unlink(rawPath);
    }
    results.push({
      viewport,
      scenario:
        "payment → allocation → passing/deferred quotes → simulated approval → receipt → reset",
      horizontalOverflow: false,
      pageErrors: errors,
      financialRequests: forbidden,
    });
  }
  await writeFile(
    `${output}browser-results.json`,
    JSON.stringify(
      { kind: "simulated browser rehearsal", checkedAt: new Date().toISOString(), base, results },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: results.length, artifacts: output }));
} finally {
  await browser.close();
}

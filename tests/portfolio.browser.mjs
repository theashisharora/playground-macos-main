import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Use an existing Playwright installation without changing application dependencies.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PORTFOLIO_TEST_URL || "http://127.0.0.1:4173/";
const classic = "https://ashisharora.vercel.app/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const check = async (label, run) => {
  await run();
  console.log(`PASS ${label}`);
};
try {
  for (const [width, height] of [
    [390, 844],
    [430, 932],
    [767, 1024],
    [768, 1024],
    [844, 390],
    [1280, 720],
    [1440, 900]
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    let redirects = 0;
    let loginSeen = false;
    await page.exposeFunction("reportLogin", () => {
      loginSeen = true;
    });
    await page.route(`${classic}**`, async (route) => {
      redirects++;
      await route.fulfill({
        body: "<title>Classic test destination</title>Classic",
        contentType: "text/html"
      });
    });
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector(".login")) window.reportLogin();
      }).observe(document, { childList: true, subtree: true });
    });
    await check(`${width}x${height}: direct and refresh`, async () => {
      await page.goto(base);
      if (width < 768) {
        await page.waitForURL(classic);
        assert.equal(loginSeen, false);
        assert.equal(redirects, 1);
        await page.reload();
        assert.equal(redirects, 2);
        assert.equal(page.url(), classic);
        await page.goto(base);
        await page.waitForURL(classic);
        assert.equal(redirects, 3);
      } else {
        await page.locator(".login").waitFor();
        await page.reload();
        await page.locator(".login").waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        assert.equal(redirects, 0);
      }
    });
    await context.close();
  }

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await mobile.newPage();
  await check("desktop override survives refresh and visits without query", async () => {
    await phone.goto(`${base}?desktop=1`);
    await phone.locator(".login").waitFor();
    await phone.reload();
    await phone.locator(".login").waitFor();
    await phone.goto(base);
    await phone.locator(".login").waitFor();
  });
  await mobile.close();

  if (process.env.PORTFOLIO_CHECK_PUBLIC === "1") {
    const liveContext = await browser.newContext({
      viewport: { width: 390, height: 844 }
    });
    const live = await liveContext.newPage();
    await check(
      "real classic destination loads successfully without a redirect loop",
      async () => {
        await live.goto(base);
        await live.waitForURL(classic);
        await live.waitForLoadState("domcontentloaded");
        assert.match(await live.title(), /Ashish.*Portfolio/i);
        await live.reload();
        await live.waitForLoadState("domcontentloaded");
        assert.equal(live.url(), classic);
      }
    );
    await liveContext.close();
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator(".login").click({ position: { x: 20, y: 20 } });
  await page.locator("#window-bear").waitFor();
  const launchpad = page.locator("#launchpad");
  const openLaunchpad = async () => {
    await page.locator("#dock-launchpad").click();
    await launchpad.waitFor({ state: "visible" });
  };
  const foreground = async (id) => {
    await launchpad.waitFor({ state: "hidden" });
    const win = page.locator(`#window-${id}`);
    await win.waitFor({ state: "visible" });
    await page.waitForTimeout(350);
    assert.equal(await win.count(), 1);
    if (process.env.PORTFOLIO_DEBUG === "1") {
      console.log(
        id,
        await win.evaluate((el) => ({
          rect: el.getBoundingClientRect().toJSON(),
          style: el.getAttribute("style"),
          parent: el.parentElement.getBoundingClientRect().toJSON()
        }))
      );
      await page.screenshot({ path: `.cache/debug-${id}.png` });
    }
    assert.equal(
      await win.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const x =
          Math.max(0, rect.left) +
          Math.min(rect.width, window.innerWidth - Math.max(0, rect.left)) / 2;
        const y =
          Math.max(0, rect.top) +
          Math.min(rect.height, window.innerHeight - Math.max(0, rect.top)) / 2;
        return el.contains(document.elementFromPoint(x, y));
      }),
      true,
      `${id} must be visible at the foreground window's center`
    );
    assert.equal(
      await page.evaluate((id) => {
        const target = document.getElementById(`window-${id}`);
        const z = Number(target.style.zIndex);
        return [...document.querySelectorAll('[id^="window-"]')].every(
          (win) => Number(win.style.zIndex) <= z
        );
      }, id),
      true
    );
    await win.locator(".window-bar").evaluate((el) => {
      el.dataset.preservedWindow = "yes";
    });
  };
  for (const id of [
    "messages",
    "music",
    "bear",
    "safari",
    "terminal",
    "typora",
    "vscode",
    "facetime"
  ]) {
    const entry = launchpad.locator(`button:has(img[src*="/${id}."])`);
    await check(
      `${id}: launch, focus existing, restore minimized; no duplicates`,
      async () => {
        await openLaunchpad();
        await entry.click();
        await foreground(id);
        await openLaunchpad();
        await entry.click();
        assert.equal(
          await page
            .locator(`#window-${id} .window-bar`)
            .getAttribute("data-preserved-window"),
          "yes"
        );
        await foreground(id);
        await page.locator(`#window-${id} .window-btn`).nth(1).click();
        await page.locator(`#window-${id}`).waitFor({ state: "hidden" });
        await openLaunchpad();
        await entry.click();
        await foreground(id);
      }
    );
  }
  await check("Dock selection while Launchpad is open", async () => {
    await openLaunchpad();
    await page.locator("#dock-messages").click();
    await foreground("messages");
  });
  await mkdir(".cache", { recursive: true });
  await page.screenshot({ path: ".cache/messages-foreground-qa.png" });
  // Stub shortcut destinations to avoid exercising third-party apps during QA.
  await context.route("**/*", async (route) => {
    if (route.request().isNavigationRequest() && route.request().url() !== base) {
      await route.fulfill({ body: "Shortcut opened", contentType: "text/html" });
    } else await route.continue();
  });
  const shortcuts = await launchpad.locator("a").count();
  for (let i = 0; i < shortcuts; i++) {
    await check(
      `external shortcut ${i + 1} dismisses Launchpad and opens a new tab`,
      async () => {
        await openLaunchpad();
        const popup = page.waitForEvent("popup");
        await launchpad.locator("a").nth(i).click();
        await launchpad.waitFor({ state: "hidden" });
        await (await popup).close();
      }
    );
  }
  await mkdir(".cache", { recursive: true });
  await page.screenshot({ path: ".cache/desktop-qa.png" });
  assert.deepEqual(errors, []);
  await context.close();
} finally {
  await browser.close();
}

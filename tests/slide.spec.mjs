import { expect, test } from "@playwright/test";
import {
  currentView,
  expectView,
  FAR,
  openView,
  scrollTop,
  touchscreen,
} from "./helpers/touch.mjs";

const Y = 600;
const swipeToNext = (ts) => ts.swipe([330, Y], [330 - FAR, Y]);
const swipeToPrevious = (ts) => ts.swipe([80, Y], [80 + FAR, Y]);

/** Runs animations at `rate` speed, so a test can look at the middle of a slide. */
const slowDown = async (page, rate) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: rate });
};

/** The running slide: { old, new } as [from, to] translate keyframes, or null. */
const slide = (page) =>
  page.evaluate(() => {
    const found = {};
    const container = document
      .querySelector("home-assistant")
      .shadowRoot.querySelector("home-assistant-main")
      .shadowRoot.querySelector("partial-panel-resolver ha-panel-lovelace")
      .shadowRoot.querySelector("hui-root")
      .shadowRoot.querySelector("#view");
    // document.getAnimations() leaves out shadow trees
    for (const a of container.getAnimations({ subtree: true })) {
      const which = a.effect?.pseudoElement?.match(/^::view-transition-(old|new)\(root\)$/)?.[1];
      if (which) found[which] = a.effect.getKeyframes().map((k) => k.translate);
    }
    return found.old ? found : null;
  });

/** Counts clicks that reach the view's content. */
const countViewClicks = (page) =>
  page.evaluate(() => {
    window.__viewClicks = 0;
    const count = (e) => {
      if (e.composedPath().some((el) => el.tagName === "HUI-VIEW")) window.__viewClicks++;
    };
    window.addEventListener("click", count, true);
  });

test.describe("slide between views", () => {
  test("the old view slides out and the new one in, both ways", async ({ page }) => {
    await openView(page, "/test-default/one");
    await slowDown(page, 0.1);
    const ts = await touchscreen(page);
    await swipeToNext(ts);
    await expect
      .poll(() => slide(page))
      .toEqual({
        old: ["0px", "-100%"],
        new: ["100%", "0%"],
      });
    await swipeToPrevious(ts);
    await expect
      .poll(() => slide(page))
      .toEqual({
        old: ["0px", "100%"],
        new: ["-100%", "0%"],
      });
    await expect.poll(() => slide(page)).toBe(null);
    await expectView(page, "one");
  });

  test("the old view slides out from where it was scrolled", async ({ page }) => {
    await openView(page, "/test-default/long");
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(() => scrollTop(page)).toBe(300);
    await slowDown(page, 0.1);
    await swipeToPrevious(await touchscreen(page));
    await expect.poll(async () => (await slide(page))?.old[0]).toBe("0px -300px");
  });

  test("the header stays usable and the page doesn't scroll sideways", async ({ page }) => {
    await openView(page, "/test-default/one");
    await slowDown(page, 0.1);
    await swipeToNext(await touchscreen(page));
    await expect.poll(() => slide(page)).not.toBe(null);
    const state = await page.evaluate(() => {
      const root = document
        .querySelector("home-assistant")
        .shadowRoot.querySelector("home-assistant-main")
        .shadowRoot.querySelector("partial-panel-resolver ha-panel-lovelace")
        .shadowRoot.querySelector("hui-root").shadowRoot;
      const header = root.querySelector(".header");
      const { x, y, width, height } = header.getBoundingClientRect();
      return {
        x,
        y,
        hit: header.contains(root.elementFromPoint(x + width / 2, y + height / 2)),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(state).toEqual({ x: 0, y: 0, hit: true, overflow: 0 });
  });

  test("taps wait for the slide, a new swipe doesn't", async ({ page }) => {
    await openView(page, "/test-default/one");
    await countViewClicks(page);
    await slowDown(page, 0.05); // slides last over 5 s
    const ts = await touchscreen(page);
    await swipeToNext(ts);
    await expect.poll(() => slide(page)).not.toBe(null);
    await ts.down([100, 90]);
    await ts.up();
    expect(await slide(page)).not.toBe(null);
    expect(await page.evaluate(() => window.__viewClicks)).toBe(0);

    await ts.down([330, Y]);
    await ts.drag([330, Y], [330 - FAR, Y]);
    expect(await slide(page)).toBe(null);
    await ts.up();
    await expectView(page, "three");

    await slowDown(page, 100);
    await expect.poll(() => slide(page)).toBe(null);
    await ts.down([100, 90]);
    await ts.up();
    await expect.poll(() => page.evaluate(() => window.__viewClicks)).toBe(1);
    expect(currentView(page)).toBe("three");
  });

  test("reduced motion switches without a slide", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openView(page, "/test-default/one");
    await page.evaluate(() => {
      window.__slides = 0;
      const original = Element.prototype.startViewTransition;
      Element.prototype.startViewTransition = function (...args) {
        window.__slides++;
        return original.apply(this, args);
      };
    });
    await swipeToNext(await touchscreen(page));
    await expectView(page, "two");
    expect(await page.evaluate(() => window.__slides)).toBe(0);
  });
});

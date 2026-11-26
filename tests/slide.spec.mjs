import { expect, test } from "@playwright/test";
import {
  currentView,
  expectView,
  FAR,
  openView,
  SHORT,
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

const container = (page) => page.locator("hui-root #view");

/** The running slide: { old, new } as [from, to] translate keyframes, or null. */
const slide = (page) =>
  container(page).evaluate((el) => {
    const views = [...el.querySelectorAll(":scope > hui-view")];
    if (views.length < 2) return null;
    const [old, next] = views.map((v) =>
      v
        .getAnimations()[0]
        ?.effect.getKeyframes()
        .map((k) => k.translate),
    );
    return { old, new: next };
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
    await expect.poll(async () => (await slide(page))?.old?.[0]).toBe("0px -300px");
  });

  test("the old view keeps its size and is left clean", async ({ page }) => {
    await openView(page, "/test-default/long");
    const view = await container(page).locator("hui-view").elementHandle();
    await view.evaluate((v) => v.style.setProperty("--from-theme", "1"));
    const size = () => view.evaluate((v) => [v.offsetWidth, v.offsetHeight, v.offsetTop]);
    const before = await size();
    await slowDown(page, 0.1);
    await swipeToPrevious(await touchscreen(page));
    await expect.poll(() => slide(page)).not.toBe(null);
    expect(await size()).toEqual(before);
    await expect.poll(() => slide(page)).toBe(null);
    expect(await view.evaluate((v) => [v.style.cssText, v.inert])).toEqual([
      "--from-theme: 1;",
      false,
    ]);
    expect(await container(page).evaluate((el) => el.style.overflowX)).toBe("");
  });

  test("the header stays usable and the page doesn't scroll sideways", async ({ page }) => {
    await openView(page, "/test-default/one");
    await slowDown(page, 0.1);
    await swipeToNext(await touchscreen(page));
    await expect.poll(() => slide(page)).not.toBe(null);
    const state = await container(page).evaluate((el) => {
      const root = el.getRootNode();
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

  test("going back during the slide keeps the old view", async ({ page }) => {
    await openView(page, "/test-default/one");
    await container(page).evaluate((el) => (window.__old = el.querySelector("hui-view")));
    await slowDown(page, 0.1);
    await swipeToNext(await touchscreen(page));
    await expect.poll(() => slide(page)).not.toBe(null);
    await page.evaluate(() => {
      history.pushState(null, "", "/test-default/one");
      window.dispatchEvent(new CustomEvent("location-changed"));
    });
    await expect
      .poll(() => container(page).evaluate((el) => el.lastChild === window.__old))
      .toBe(true);
    await slowDown(page, 100);
    const state = () =>
      container(page).evaluate((el) => ({
        views: [...el.querySelectorAll(":scope > hui-view")].length,
        old: el.lastChild === window.__old,
        inert: window.__old.inert,
        position: window.__old.style.position,
        animations: window.__old.getAnimations().length,
      }));
    await expect
      .poll(state)
      .toEqual({ views: 1, old: true, inert: false, position: "", animations: 0 });
  });

  test("two swipes before the view swap slide once and leave every view clean", async ({
    page,
  }) => {
    await openView(page, "/test-default/one");
    // Home Assistant shows each new view only after a delay
    await container(page).evaluate((el) => {
      const root = el.getRootNode().host;
      const select = root._selectView;
      window.__delayed = 0;
      root._selectView = function (...args) {
        window.__delayed++;
        setTimeout(() => select.apply(this, args), 300);
      };
      window.__root = root;
      window.__slides = 0; // view animations started
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.tagName === "HUI-VIEW") window.__slides++;
        return animate.apply(this, args);
      };
    });
    const ts = await touchscreen(page);
    // Quick swipes, so the second ends before the first view swap
    for (let i = 0; i < 2; i++) await ts.swipe([330, Y], [330 - FAR, Y], { step: 40 });
    await expectView(page, "three");
    await expect.poll(() => page.evaluate(() => window.__delayed)).toBe(2);
    // Only the third view is left in the page
    await expect
      .poll(() =>
        container(page).evaluate((el) =>
          [...el.querySelectorAll(":scope > hui-view")].map((v) =>
            Object.keys(window.__root._viewCache).find((k) => window.__root._viewCache[k] === v),
          ),
        ),
      )
      .toEqual(["2"]);
    await page.waitForTimeout(600); // past every cleanup timer
    const views = () =>
      page.evaluate(() =>
        Object.values(window.__root._viewCache).map((v) => ({
          style: v.style.cssText,
          inert: v.inert,
          animations: v.getAnimations().length,
        })),
      );
    expect(await views()).toEqual(Array(3).fill({ style: "", inert: false, animations: 0 }));
    // One slide from the first view to the second: two views animated
    expect(await page.evaluate(() => window.__slides)).toBe(2);
  });

  test("a view removed during the drag is left clean", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openView(page, "/test-default/two");
    await container(page).evaluate((el) => (window.__old = el.querySelector("hui-view")));
    const showView = (path) =>
      page.evaluate((path) => {
        history.pushState(null, "", `/test-default/${path}`);
        window.dispatchEvent(new CustomEvent("location-changed"));
      }, path);
    const ts = await touchscreen(page);
    for (const far of [true, false]) {
      await ts.down([330, Y]);
      await ts.drag([330, Y], [330 - (far ? FAR : SHORT), Y]);
      await showView("one"); // removes the dragged view
      await expect
        .poll(() => container(page).evaluate((el) => el.contains(window.__old)))
        .toBe(false);
      await ts.up();
      await page.waitForTimeout(600); // past every cleanup timer
      expect(await page.evaluate(() => [window.__old.style.cssText, window.__old.inert])).toEqual([
        "",
        false,
      ]);
      expect(await container(page).evaluate((el) => el.style.overflowX)).toBe("");
      await showView("two");
      await expect
        .poll(() => container(page).evaluate((el) => el.lastChild === window.__old))
        .toBe(true);
    }
    expect(errors).toEqual([]);
  });

  test("reduced motion switches without a slide", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openView(page, "/test-default/one");
    await container(page).evaluate((el) => {
      window.__maxViews = 0;
      new MutationObserver(() => {
        const n = el.querySelectorAll(":scope > hui-view").length;
        window.__maxViews = Math.max(window.__maxViews, n);
      }).observe(el, { childList: true });
    });
    await swipeToNext(await touchscreen(page));
    await expectView(page, "two");
    await expect.poll(() => page.evaluate(() => window.__maxViews)).toBe(1);
    expect(await container(page).evaluate((el) => el.style.overflowX)).toBe("");
  });
});

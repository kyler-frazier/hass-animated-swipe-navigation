// Touch gestures via the Chrome DevTools Protocol. Playwright's touchscreen API
// only taps, and swipes need real touchstart/touchmove/touchend sequences.
import { expect } from "@playwright/test";

export const THRESHOLD = 412 * 0.15; // default swipe_amount on the Pixel 7 viewport
const FRAME = 16;

/** Opens a dashboard view and waits for the plugin and the view to be ready. */
export async function openView(page, path) {
  await page.goto(path);
  await page.waitForFunction(() => window.__animatedSwipeNavigation);
  await page.waitForFunction(() => {
    const panel = document
      .querySelector("home-assistant")
      ?.shadowRoot?.querySelector("home-assistant-main")
      ?.shadowRoot?.querySelector("partial-panel-resolver ha-panel-lovelace");
    return panel?.shadowRoot?.querySelector("hui-root")?.shadowRoot?.querySelector("hui-view");
  });
  await page.waitForTimeout(500); // let the first render settle
}

export async function touchscreen(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
  return {
    down: (...points) => send("touchStart", points),
    move: (...points) => send("touchMove", points),
    up: (...remaining) => send("touchEnd", remaining),
    /** Moves one finger from (x0, y0) to (x1, y1) in px-sized steps. */
    async drag([x0, y0], [x1, y1], { step = 8 } = {}) {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let i = 1; i <= n; i++) {
        await send("touchMove", [[x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]]);
        await page.waitForTimeout(FRAME);
      }
    },
    /** A full single-finger swipe: down, drag, up. */
    async swipe(from, to, opts) {
      await send("touchStart", [from]);
      await this.drag(from, to, opts);
      await send("touchEnd", []);
    },
  };
}

/** Swipe distances that do / don't reach the navigation threshold. */
export const FAR = THRESHOLD * 1.6;
export const SHORT = THRESHOLD * 0.5;

/** Current view path (last URL segment). */
export const currentView = (page) => new URL(page.url()).pathname.split("/").pop();

export async function expectView(page, path) {
  await expect.poll(() => currentView(page)).toBe(path);
}

/** "hidden" | "shown" | "absent" (never created) */
export const bubbleState = (page) =>
  page.evaluate(() => {
    const box = document.querySelector(".asn-bubble");
    if (!box) return "absent";
    return box.style.display === "none" ? "hidden" : "shown";
  });

export const bubbleIcon = (page) =>
  page.evaluate(() => document.querySelector(".asn-icon")?.getAttribute("icon"));

/** Waits until any bubble has finished animating out. */
export async function expectBubbleGone(page) {
  await expect.poll(() => bubbleState(page)).not.toBe("shown");
}

/** Scroll position of the dashboard, wherever Home Assistant scrolls it. */
export const scrollTop = (page) =>
  page.evaluate(() => Math.max(window.scrollY, document.scrollingElement?.scrollTop ?? 0));

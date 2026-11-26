import { expect, test } from "@playwright/test";
import {
  bubbleIcon,
  bubbleState,
  expectBubbleGone,
  expectView,
  FAR,
  openView,
  scrollTop,
  SHORT,
  touchscreen,
} from "./helpers/touch.mjs";

const Y = 600;

/** Records every outline the bubble draws, in window.__outlines. */
const recordOutlines = (page) =>
  page.evaluate(() => {
    window.__outlines = [];
    const set = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (name === "d" && this.closest(".asn-bubble")) window.__outlines.push(value);
      return set.call(this, name, value);
    };
  });

/** Waits for n animation frames. */
const frames = (page, n) =>
  page.evaluate(
    (n) =>
      new Promise((done) =>
        (function tick(k) {
          k ? requestAnimationFrame(() => tick(k - 1)) : done();
        })(n),
      ),
    n,
  );

test.describe("bubble and gestures", () => {
  test("bubble shows the destination icon while dragging, then goes away", async ({ page }) => {
    await openView(page, "/test-default/one");
    const ts = await touchscreen(page);
    await ts.down([330, Y]);
    await ts.drag([330, Y], [330 - FAR, Y]);
    expect(await bubbleState(page)).toBe("shown");
    expect(await bubbleIcon(page)).toBe("mdi:numeric-2-circle");
    await ts.up();
    await expectView(page, "two");
    await expectBubbleGone(page);
  });

  test("reversing direction mid-drag retargets the bubble", async ({ page }) => {
    await openView(page, "/test-default/two");
    const ts = await touchscreen(page);
    await ts.down([200, Y]);
    await ts.drag([200, Y], [240, Y]); // toward the previous view
    expect(await bubbleIcon(page)).toBe("mdi:numeric-1-circle");
    await ts.drag([240, Y], [200 - FAR, Y]); // back past the start, toward the next
    expect(await bubbleIcon(page)).toBe("mdi:numeric-3-circle");
    await ts.up();
    await expectView(page, "three");
    await expectBubbleGone(page);
  });

  test("slow drags in tiny steps still swipe", async ({ page }) => {
    await openView(page, "/test-default/one");
    const ts = await touchscreen(page);
    await ts.swipe([330, Y], [330 - FAR, Y + 2], { step: 2 });
    await expectView(page, "two");
  });

  test("a second finger ends the gesture cleanly", async ({ page }) => {
    await openView(page, "/test-default/one");
    const ts = await touchscreen(page);
    await ts.down([330, Y]);
    await ts.drag([330, Y], [300, Y]); // not far enough yet
    await ts.down([300, Y], [100, 400]);
    await ts.move([300, Y], [100, 500]);
    await ts.up([300, Y]);
    await ts.up();
    await expectBubbleGone(page);
    await expectView(page, "one");
  });

  test("vertical scrolling is locked during a sideways drag only", async ({ page }) => {
    await openView(page, "/test-default/long");
    const ts = await touchscreen(page);
    await ts.down([300, 700]);
    await ts.drag([300, 700], [260, 700]);
    await ts.drag([260, 700], [260, 300]);
    expect(await scrollTop(page)).toBe(0);
    await ts.up();
    await expectBubbleGone(page);

    await ts.swipe([200, 800], [200, 300]);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(100);
  });
  test("the bubble is drawn without blur filters", async ({ page }) => {
    await openView(page, "/test-default/one");
    const ts = await touchscreen(page);
    await ts.down([330, Y]);
    await ts.drag([330, Y], [330 - FAR, Y]);
    const filters = await page.evaluate(() => {
      const box = document.querySelector(".asn-bubble");
      return [box, ...box.querySelectorAll("*")]
        .filter((el) => el.localName === "filter" || getComputedStyle(el).filter !== "none")
        .map((el) => el.localName);
    });
    expect(filters).toEqual([]);
    await ts.up();
  });
  test("holding still doesn't redraw the bubble's outline", async ({ page }) => {
    await openView(page, "/test-default/one");
    await recordOutlines(page);
    const ts = await touchscreen(page);
    await ts.down([330, Y]);
    await ts.drag([330, Y], [330 - SHORT, Y]);
    await frames(page, 20); // the water catches up
    const before = await page.evaluate(() => window.__outlines.length);
    await frames(page, 20);
    expect(await page.evaluate(() => window.__outlines.length)).toBe(before);
    await ts.up();
  });

  test("the mound drains away at the wall without a spike", async ({ page }) => {
    await openView(page, "/test-default/one");
    await recordOutlines(page);
    const ts = await touchscreen(page);
    await ts.down([330, Y]);
    await ts.drag([330, Y], [330 - FAR, Y]);
    await frames(page, 40); // past the pinch-off
    await ts.up();
    // How far whatever is left at the wall reaches out, frame by frame, once the ball is
    // off on its own (in the wall's frame: the screen edge is x = 0)
    const reach = (await page.evaluate(() => window.__outlines))
      .map((d) => d.split("M").filter(Boolean))
      .filter((loops) => loops.length > 1)
      .map((loops) => {
        const ends = loops
          .map((l) =>
            Math.max(
              ...l
                .match(/-?[\d.]+/g)
                .filter((_, k) => k % 2 === 0)
                .map(Number),
            ),
          )
          .sort((a, b) => a - b);
        return ends.at(-2); // the ball reaches furthest
      });
    const last = reach.findLastIndex((x) => x > -7); // flat wall: x = -8
    expect(last).toBeGreaterThan(0);
    expect(reach[last]).toBeLessThan(1);
  });
});

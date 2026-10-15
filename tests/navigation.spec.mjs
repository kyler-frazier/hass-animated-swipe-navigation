import { expect, test } from "@playwright/test";
import { bubbleState, expectView, FAR, openView, SHORT, touchscreen } from "./helpers/touch.mjs";

const Y = 600;
const swipeToNext = (ts) => ts.swipe([330, Y], [330 - FAR, Y]);
const swipeToPrevious = (ts) => ts.swipe([80, Y], [80 + FAR, Y]);

test.describe("navigation", () => {
  test("swiping left goes to the next view, right to the previous", async ({ page }) => {
    await openView(page, "/test-default/one");
    const ts = await touchscreen(page);
    await swipeToNext(ts);
    await expectView(page, "two");
    await swipeToNext(ts);
    await expectView(page, "three");
    await swipeToPrevious(ts);
    await expectView(page, "two");
  });

  test("a swipe that falls short stays on the view", async ({ page }) => {
    await openView(page, "/test-default/two");
    const ts = await touchscreen(page);
    await ts.swipe([330, Y], [330 - SHORT, Y]);
    await page.waitForTimeout(600);
    await expectView(page, "two");
  });

  test("wraps around by default and skips subviews", async ({ page }) => {
    await openView(page, "/test-default/one");
    const ts = await touchscreen(page);
    await swipeToPrevious(ts);
    await expectView(page, "long"); // the subview after it is skipped
    await swipeToNext(ts);
    await expectView(page, "one");
  });

  test("wrap: false stops at the first and last views", async ({ page }) => {
    await openView(page, "/test-no-wrap/one");
    const ts = await touchscreen(page);
    await swipeToPrevious(ts);
    await page.waitForTimeout(600);
    await expectView(page, "one");
    expect(await bubbleState(page)).not.toBe("shown");
  });

  test("skip_tabs and skip_subviews: false", async ({ page }) => {
    await openView(page, "/test-skip/one");
    const ts = await touchscreen(page);
    await swipeToNext(ts);
    await expectView(page, "three"); // index 1 ("two") is skipped
    await swipeToPrevious(ts);
    await swipeToPrevious(ts);
    await expectView(page, "sub"); // wrapped around onto the subview
  });

  for (const dashboard of ["test-disabled", "test-no-config"]) {
    test(`does nothing on ${dashboard}`, async ({ page }) => {
      await openView(page, `/${dashboard}/one`);
      const ts = await touchscreen(page);
      await swipeToNext(ts);
      await page.waitForTimeout(600);
      await expectView(page, "one");
      expect(await bubbleState(page)).toBe("absent");
    });
  }

  test("quick successive swipes each count from the new view", async ({ page }) => {
    await openView(page, "/test-default/one");
    const ts = await touchscreen(page);
    await swipeToNext(ts);
    await page.waitForTimeout(60);
    await swipeToNext(ts);
    await expectView(page, "three");
    await swipeToPrevious(ts);
    await expectView(page, "two");
  });

  test("swipes starting on a slider are ignored", async ({ page }) => {
    await openView(page, "/test-default/one");
    const slider = await page.locator("ha-slider").first().boundingBox();
    const ts = await touchscreen(page);
    const y = slider.y + slider.height / 2;
    await ts.swipe([slider.x + slider.width - 10, y], [slider.x + slider.width - 10 - FAR, y]);
    await page.waitForTimeout(600);
    await expectView(page, "one");
  });
});

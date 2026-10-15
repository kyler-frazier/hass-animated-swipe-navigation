import { expect, test } from "@playwright/test";
import {
  bubbleIcon,
  bubbleState,
  expectBubbleGone,
  expectView,
  FAR,
  openView,
  scrollTop,
  touchscreen,
} from "./helpers/touch.mjs";

const Y = 600;

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
});

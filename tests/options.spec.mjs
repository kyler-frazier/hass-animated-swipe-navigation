import { expect, test } from "@playwright/test";
import { FAR, openView, THRESHOLD, touchscreen } from "./helpers/touch.mjs";

const Y = 600;

const look = (page) =>
  page.evaluate(() => {
    const box = document.querySelector(".asn-bubble");
    const ball = box.children[2];
    const icon = document.querySelector(".asn-icon");
    const view = document
      .querySelector("home-assistant")
      .shadowRoot.querySelector("home-assistant-main")
      .shadowRoot.querySelector("partial-panel-resolver ha-panel-lovelace")
      .shadowRoot.querySelector("hui-root")
      .shadowRoot.querySelector("#view hui-view");
    return {
      opacity: getComputedStyle(box).opacity,
      shadow: box.style.filter,
      bubble: getComputedStyle(ball).backgroundColor,
      icon: getComputedStyle(icon).color,
      viewOpacity: getComputedStyle(view).opacity,
    };
  });

test("every color and opacity option is applied", async ({ page }) => {
  await openView(page, "/test-custom/one");
  const ts = await touchscreen(page);
  await ts.down([330, Y]);
  await ts.drag([330, Y], [330 - THRESHOLD * 0.5, Y]);
  await page.waitForTimeout(300); // let color transitions finish
  const idle = await look(page);
  expect(idle.opacity).toBe("0.5");
  expect(idle.shadow).toContain("rgb(130, 140, 150)");
  expect(idle.bubble).toBe("rgb(10, 20, 30)");
  expect(idle.icon).toBe("rgb(70, 80, 90)");
  expect(Number(idle.viewOpacity)).toBeCloseTo(0.75, 1); // half pull, view_fade 0.5

  await ts.drag([330 - THRESHOLD * 0.5, Y], [330 - FAR, Y]);
  await page.waitForTimeout(300);
  const armed = await look(page);
  expect(armed.bubble).toBe("rgb(40, 50, 60)");
  expect(armed.icon).toBe("rgb(100, 110, 120)");
  await ts.up();
});

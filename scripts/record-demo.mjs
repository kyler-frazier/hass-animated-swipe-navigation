// Records the README demo as PNG frames, deterministically: the page clock is
// frozen and stepped one frame at a time, so the animation is smooth regardless
// of how fast the machine is.
//
//   npm run hass:up
//   node scripts/record-demo.mjs [outDir]          # needs test-results/.auth.json (run `npm test` once)
//   ffmpeg -framerate 30 -i out/%03d.png -vf "fps=30,scale=320:-1:flags=lanczos" docs/demo.gif
import { chromium, devices } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

const base = process.env.HASS_URL || "http://localhost:8123";
const out = process.argv[2] || "demo-frames";
const FRAME_MS = 1000 / 30;

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["Pixel 7"],
  deviceScaleFactor: 1,
  colorScheme: "dark",
  // Home Assistant reloads the page when its service worker first takes control
  serviceWorkers: "block",
  storageState: JSON.parse(await readFile("test-results/.auth.json", "utf8")),
});
const page = await context.newPage();
await page.goto(`${base}/demo-home/home`);
await page.waitForFunction(() => window.__animatedSwipeNavigation);
await page.waitForTimeout(3000);

// Freeze time and step every Web Animation by hand
await page.evaluate(() => {
  window.__now = performance.now();
  performance.now = () => window.__now;
  const starts = new WeakMap();
  window.__step = (ms) => {
    window.__now += ms;
    for (const a of document.getAnimations()) {
      if (!starts.has(a)) starts.set(a, window.__now - ms);
      a.pause();
      a.currentTime = window.__now - starts.get(a);
    }
  };
  // Finger indicator
  const dot = document.createElement("div");
  dot.style.cssText = `position:fixed;z-index:20;width:44px;height:44px;margin:-22px;border-radius:50%;
    background:rgba(255,255,255,.35);border:2px solid rgba(255,255,255,.6);pointer-events:none;display:none`;
  document.body.append(dot);
  window.__finger = (x, y) => {
    dot.style.display = x == null ? "none" : "";
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
  };
});

const cdp = await context.newCDPSession(page);
let n = 0;
const frame = async (touch) => {
  if (touch) {
    await cdp.send("Input.dispatchTouchEvent", touch);
    const p = touch.touchPoints[0];
    await page.evaluate(([x, y]) => window.__finger(x, y), p ? [p.x, p.y] : [null, null]);
  }
  await page.evaluate((ms) => window.__step(ms), FRAME_MS);
  await page.waitForTimeout(40); // let rAF callbacks draw the new time
  await page.screenshot({ path: `${out}/${String(n++).padStart(3, "0")}.png` });
};
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const swipe = async (x0, x1, y, frames) => {
  await frame({ type: "touchStart", touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= frames; i++) {
    const x = x0 + (x1 - x0) * ease(i / frames);
    await frame({
      type: "touchMove",
      touchPoints: [{ x, y: y - 6 * Math.sin((i / frames) * Math.PI) }],
    });
  }
  for (let i = 0; i < 6; i++) await frame(); // hold
  await frame({ type: "touchEnd", touchPoints: [] });
};

for (let i = 0; i < 12; i++) await frame();
await swipe(340, 200, 640, 22); // to Lights
for (let i = 0; i < 24; i++) await frame();
await swipe(340, 200, 520, 22); // to Climate
for (let i = 0; i < 24; i++) await frame();
await swipe(90, 230, 600, 22); // back to Lights
for (let i = 0; i < 20; i++) await frame();

await browser.close();
console.log(`${n} frames in ${out}/`);

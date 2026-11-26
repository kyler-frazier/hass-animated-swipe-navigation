/**
 * Animated Swipe Navigation for Home Assistant (MIT)
 * https://github.com/kyler-frazier/hass-animated-swipe-navigation
 */

const VERSION = "0.0.0-dev"; // replaced by the release workflow

(() => {
  if (window.__animatedSwipeNavigation) return; // e.g. added as a resource twice
  window.__animatedSwipeNavigation = VERSION;

  console.info(
    `%c ANIMATED-SWIPE-NAVIGATION %c ${VERSION} `,
    "color: #fff; background: #03a9f4; font-weight: 700;",
    "color: #03a9f4; background: #fff; font-weight: 700;",
  );

  const CONFIG_KEY = "animated_swipe_nav";
  const DEFAULTS = {
    enable: true,
    wrap: true,
    swipe_amount: 15, // % of screen width
    skip_hidden: true,
    skip_subviews: true,
    skip_tabs: [],
    liquid: true,
    haptics: true,
    opacity: 0.75,
    bubble_color: "#272a2f",
    bubble_active_color: "#383b42",
    icon_color: "#b4b7bf",
    icon_active_color: "rgba(255, 255, 255, .85)",
    view_fade: 0.2, // opacity the view loses at full pull
  };

  const SLIDE_MS = 300; // slide from the old view to the new one
  const SWAP_TIMEOUT_MS = 500; // longest wait for Home Assistant to show the new view
  const MAX_SHIFT = 28; // px
  const Y_FOLLOW = 0.25; // share of the finger's vertical movement the bubble follows
  const R = 28; // ball radius
  const GAP = 14; // ball's distance from the wall once out
  const BOX_W = 200,
    BOX_H = 340,
    WALL = 40; // bubble's box; wall sits WALL px inside it
  const MOUND_H = [120, 45]; // wall mound half-height: at rest -> once the ball is out
  const MOUND_W = [30, 8]; // mound protrusion: peak -> at the threshold (thin neck)
  const SNAP_MS = 130; // neck pinch-off duration
  const STRETCH = 1.2; // ball's width at full tension, x its height shrinks by
  const BOUNCE_MS = 440;
  const BOUNCE = [135, 210]; // ball wobble after the snap: decay time, period (ms)
  const MELT = 12; // shapes closer than this melt together (px)
  const GRID = 3; // outline is traced on a grid this fine (px)
  const FLICK_MS = 50; // swipes that snap sooner never show water
  const WATER_LAG_MS = 50; // time constant
  const CATCHUP_MS = 50; // lag shrinks to 0 over this
  const DECIDE_PX = 10; // movement before a touch counts as horizontal or vertical

  // Controls that need horizontal drags themselves
  const SKIP = [
    "ha-slider",
    "ha-control-slider",
    "input[type=range]",
    "#slider",
    ".range-slider",
    "ha-tabs",
    "ha-tab-group",
    "sl-tab-group",
    "mwc-tab-bar",
    "paper-tabs",
    "ha-sidebar",
    ".swiper",
    "#swiper",
    "hui-map-card",
    "ha-map",
    ".badges-scroll",
  ].join(",");

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  let g = null; // current gesture
  let ui = null;
  let slide = null; // running slide between views
  let stopSwap = null; // stops waiting for the last navigation's view swap
  let anim = 0; // rAF id of the release animation
  let popId = 0; // lets a new bubble invalidate a stale fade-out
  // Bubble state, kept separate from the gesture so animations can finish after release
  let bub = null;

  const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

  const findPanel = (path) =>
    path.find((el) => el.tagName === "HA-PANEL-LOVELACE") ||
    document
      .querySelector("home-assistant")
      ?.shadowRoot?.querySelector("home-assistant-main")
      ?.shadowRoot?.querySelector("partial-panel-resolver ha-panel-lovelace");

  const viewEl = (panel) =>
    panel?.shadowRoot
      ?.querySelector("hui-root")
      ?.shadowRoot?.querySelector("#view > hui-view:last-child");

  const options = (panel) => {
    const raw = panel?.lovelace?.config?.[CONFIG_KEY];
    if (!raw || typeof raw !== "object") return null;
    const opt = { ...DEFAULTS, ...raw };
    return opt.enable === false ? null : opt;
  };

  const isRtl = () =>
    getComputedStyle(document.querySelector("home-assistant") || document.body).direction === "rtl";

  // Null when there's nowhere to go
  const targetView = (panel, opt, backwards) => {
    const views = panel.lovelace?.config?.views;
    const cur = (panel.route?.path || "").replace("/", "");
    if (!views) return null;
    let i = views.findIndex((v, n) => String(n) === cur || v.path === cur);
    if (i < 0) return null;
    const uid = document.querySelector("home-assistant")?.hass?.user?.id;
    const start = i;
    for (;;) {
      i += backwards ? -1 : 1;
      if (i < 0 || i >= views.length) {
        if (!opt.wrap) return null;
        i = (i + views.length) % views.length;
      }
      if (i === start) return null;
      const v = views[i];
      if (opt.skip_tabs.includes(i)) continue;
      if (opt.skip_subviews && v.subview) continue;
      const hidden =
        v.visible === false || (Array.isArray(v.visible) && !v.visible.some((u) => u.user === uid));
      if (opt.skip_hidden && hidden) continue;
      return { ...v, path: v.path || String(i) };
    }
  };

  const makeUi = () => {
    const box = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    box.classList.add("asn-bubble");
    box.setAttribute("aria-hidden", "true");
    box.style.cssText = `position:fixed;z-index:9;top:0;left:0;width:${BOX_W}px;height:${BOX_H}px;
      pointer-events:none;display:none`;
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.style.transition = "fill .15s";
    box.append(shape);
    const icon = document.createElement("ha-icon");
    icon.className = "asn-icon";
    icon.style.cssText = `position:fixed;z-index:10;top:0;left:0;pointer-events:none;display:none;
      --mdc-icon-size:26px;transition:color .15s`;
    document.body.append(box, icon);
    return { box, shape, icon };
  };

  // Signed distance from (x, y) to an ellipse around the origin: negative inside.
  // Close approximation, exact for circles.
  const ellipse = (x, y, rx, ry) => {
    if (rx <= 0 || ry <= 0) return Infinity;
    const k0 = Math.hypot(x / rx, y / ry);
    const k1 = Math.hypot(x / (rx * rx), y / (ry * ry));
    return k1 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry);
  };

  // Like Math.min, but two shapes within MELT of each other join with a smooth neck
  const melt = (a, b) => {
    const h = Math.max(MELT - Math.abs(a - b), 0) / MELT;
    return Math.min(a, b) - (h * h * MELT) / 4;
  };

  // Outline of the area where f(x, y) < 0, within x0..x1, y0..y1, as SVG path data.
  // Marching squares: each grid cell the outline crosses gets a segment from where it
  // enters to where it leaves; chained up, the segments make closed loops.
  const outline = (f, x0, x1, y0, y1) => {
    const nx = Math.ceil((x1 - x0) / GRID) + 1;
    const ny = Math.ceil((y1 - y0) / GRID) + 1;
    const v = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
        v[j * nx + i] = edge ? 1 : f(x0 + i * GRID, y0 + j * GRID); // closes every loop
      }
    // Grid edges by id: 2 * point + 0 for the one going +x, + 1 for the one going +y
    const point = (id) => {
      const a = id >> 1;
      const b = a + (id & 1 ? nx : 1);
      const k = v[a] / (v[a] - v[b]);
      const i = a % nx;
      const j = (a - i) / nx;
      const x = x0 + (i + (id & 1 ? 0 : k)) * GRID;
      const y = y0 + (j + (id & 1 ? k : 0)) * GRID;
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    };
    const next = new Map(); // edge where the outline enters a cell -> edge where it leaves
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const c = [j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i];
        // The cell's sides, going around it: from corner, to corner, edge id
        const sides = [
          [c[0], c[1], 2 * c[0]],
          [c[1], c[2], 2 * c[1] + 1],
          [c[2], c[3], 2 * c[3]],
          [c[3], c[0], 2 * c[0] + 1],
        ];
        const cross = sides.filter(([a, b]) => v[a] < 0 !== v[b] < 0);
        if (!cross.length) continue;
        // Pair neighboring crossings, the outline going in at one and out at the other.
        // A saddle cell has two pairings: pairs that start going out join its two inside
        // corners, which is right when the cell's center is inside.
        const join = c.reduce((sum, k) => sum + v[k], 0) < 0;
        const out = ([a]) => v[a] < 0; // the outline leaves the inside here
        const shift = cross.length === 4 && join !== out(cross[0]) ? 1 : 0;
        const ring = [...cross.slice(shift), ...cross.slice(0, shift)];
        for (let k = 0; k < ring.length; k += 2) {
          const [a, b] = out(ring[k]) ? [ring[k + 1], ring[k]] : [ring[k], ring[k + 1]];
          next.set(a[2], b[2]);
        }
      }
    let d = "";
    for (const start of next.keys()) {
      if (!next.has(start)) continue; // already part of a loop
      d += `M${point(start)}`;
      for (let id = next.get(start); ;) {
        const after = next.get(id);
        next.delete(id);
        if (id === start) break;
        d += `L${point(id)}`;
        id = after;
      }
      d += "Z";
    }
    return d;
  };

  // The water starts from rest and catches up with the ball, so it never pops in fully
  // formed. Null while it's held back.
  const waterP = (p) => {
    if (!bub || bub.noWall || !bub.opt.liquid) return null;
    const now = performance.now();
    if (now - bub.shownAt < FLICK_MS) return null;
    if (bub.wp == null) {
      bub.wp = 0;
      bub.wpT = now;
    }
    const lag = WATER_LAG_MS * (1 - (now - bub.shownAt - FLICK_MS) / CATCHUP_MS);
    const dt = now - bub.wpT;
    bub.wp = lag <= 0 ? p : bub.wp + (p - bub.wp) * (1 - Math.exp(-dt / lag));
    bub.wpT = now;
    return bub.wp;
  };

  // Draw the bubble at pull progress p (0..1). s = +1 left wall, -1 right wall.
  // snap (0..1): how far the neck has pinched off after crossing the threshold.
  const render = (p, s, by, snap = 0) => {
    const { box, shape, icon } = ui;
    const boxLeft = s > 0 ? -WALL : window.innerWidth - BOX_W + WALL;
    const wallX = s > 0 ? WALL : BOX_W - WALL;
    box.style.translate = `${boxLeft}px ${by - BOX_H / 2}px`;
    const cx = -R + (2 * R + GAP) * p;
    // The neck stays attached until the threshold, so the snap is what sets off the bounce
    const [aMax, aEnd] = MOUND_W;
    const w = waterP(p);
    const wv = w ?? 0;
    const attached = wv < 0.6 ? aMax * (wv / 0.6) : aMax + (aEnd - aMax) * ((wv - 0.6) / 0.4);
    const a = w == null ? 0 : attached * (1 - snap);
    const b = MOUND_H[0] - (MOUND_H[0] - MOUND_H[1]) * clamp01(wv / 0.6);
    // The neck holds the ball back, so it stretches near the threshold; once the neck
    // snaps, the ball wobbles back to round
    const since = bub?.armedAt == null ? null : performance.now() - bub.armedAt;
    const sx =
      since == null
        ? 1 + (STRETCH - 1) * clamp01((p - 0.55) / 0.45) ** 2
        : since < BOUNCE_MS
          ? 1 +
            (STRETCH - 1) *
              Math.exp(-since / BOUNCE[0]) *
              Math.cos((2 * Math.PI * since) / BOUNCE[1])
          : 1;
    const sy = 1 / sx;
    // In the wall's frame: x points away from the wall. The wall itself starts 8px behind
    // the screen edge, so the mound flares into it like a bell curve.
    const rx = R * sx;
    const ry = R * sy;
    const field = (x, y) => melt(melt(x + 8, ellipse(x, y, a, b)), ellipse(x - cx, y, rx, ry));
    const reach = Math.max(a, cx + rx) + MELT;
    const tall = Math.max(b, ry) + MELT;
    shape.setAttribute("d", outline(field, -3 * GRID, reach, -tall, tall));
    shape.setAttribute("transform", `translate(${wallX} ${BOX_H / 2}) scale(${s} 1)`);
    // Positions use the `translate` property so the fade's animations don't clash
    const iconScale = 0.5 + 0.5 * clamp01((p - 0.3) / 0.6);
    icon.style.opacity = String(clamp01((p - 0.35) / 0.4) * (bub?.opt.opacity ?? 1));
    icon.style.translate = `${boxLeft + wallX + s * cx - 13}px ${by - 13}px`;
    icon.style.transform = `scale(${iconScale * (1 + (sx - 1) / 2)}, ${iconScale * (1 + (sy - 1) / 2)})`;
  };

  const applyOptions = (opt) => {
    ui.box.style.opacity = String(opt.opacity);
  };

  const setArmed = (armed) => {
    const c = armed ? bub.opt.bubble_active_color : bub.opt.bubble_color;
    ui.shape.style.fill = c;
    ui.icon.style.color = armed ? bub.opt.icon_active_color : bub.opt.icon_color;
  };

  const stopAnimations = () =>
    [ui.box, ui.icon].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));

  const hide = () => {
    ui.box.style.display = "none";
    ui.icon.style.display = "none";
    ui.box.style.opacity = ui.icon.style.opacity = "";
  };

  // Keep drawing while the water catches up, even if the finger holds still
  const wallTick = (me) => {
    if (bub !== me || me.armedAt != null || !g) return;
    if (me.drawn) render(me.p, me.s, me.by, 0);
    requestAnimationFrame(() => wallTick(me));
  };

  // Neck pinch-off progress since the threshold was crossed (eased)
  const snapNow = () => {
    if (bub?.armedAt == null) return 0;
    const k = clamp01((performance.now() - bub.armedAt) / SNAP_MS);
    return 1 - (1 - k) * (1 - k);
  };

  // Keep the pinch-off and wobble animating while the finger holds still and after release
  const snapTick = (me) => {
    if (bub !== me || me.armedAt == null) return; // newer bubble, or re-attached
    render(me.p, me.s, me.by, snapNow());
    if (performance.now() - me.armedAt < BOUNCE_MS) requestAnimationFrame(() => snapTick(me));
    else render(me.p, me.s, me.by, 1); // round again
  };

  // HA caches views, so an old view comes back later. Leaves HA's own inline styles alone.
  const clearStyles = (view) => {
    for (const p of "transition transform opacity position top left width height".split(" "))
      view.style[p] = "";
  };

  // Slides the old view out and the new one in, below the header, which stays put.
  // Home Assistant only ever removes the container's last child, so the old view can
  // stay in front of the new one in the DOM until it's gone from the screen.
  const slideViews = (container, s, old, view, place, scrolled) => {
    Object.assign(old.style, { position: "absolute", ...place });
    view.before(old);
    container.style.overflow = "clip";
    old.inert = view.inert = true; // taps wait for the slide
    const me = (slide = {
      finish: () => {
        if (slide !== me) return;
        slide = null;
        anims.forEach((a) => a.cancel());
        if (container.lastChild !== old) old.remove(); // else Home Assistant is showing it again
        clearStyles(old);
        old.inert = view.inert = false;
        container.style.overflow = "";
      },
    });
    // Navigating scrolls the page; the old view stays where it was on screen
    const y = `${window.scrollY - scrolled}px`;
    const run = (el, from, to) =>
      el.animate([{ translate: from }, { translate: to }], {
        duration: SLIDE_MS,
        easing: "cubic-bezier(.3,.4,.2,1)",
        fill: "both",
      });
    const anims = [run(old, `0px ${y}`, `${s * 100}% ${y}`), run(view, `${-s * 100}%`, "0%")];
    anims[1].onfinish = me.finish;
  };

  // The URL changes right away so a quick follow-up swipe starts from the new view
  // container: where the old view was when the drag began; Home Assistant may have removed it since
  const navigate = (panel, target, s, old, container) => {
    stopSwap?.(); // a newer navigation takes over the old view
    if (old && old.parentElement === container && !reducedMotion?.matches) {
      const place = {
        top: `${old.offsetTop}px`,
        left: `${old.offsetLeft}px`,
        width: `${old.offsetWidth}px`,
        height: `${old.offsetHeight}px`,
      };
      const scrolled = window.scrollY;
      // Runs right after the swap, before the old view's disappearance is painted
      const observer = new MutationObserver(() => {
        const view = viewEl(panel);
        if (!view || view === old) return;
        stop();
        if (!g?.mode) return slideViews(container, s, old, view, place, scrolled);
        // The next drag is already under way: hand it the new view, where the drag is
        const { transform, opacity } = old.style;
        clearStyles(old);
        Object.assign(view.style, { transform, opacity });
        g.view = view;
      });
      const stop = () => {
        observer.disconnect();
        clearTimeout(timer);
        if (stopSwap === stop) stopSwap = null;
      };
      stopSwap = stop;
      // No swap if, say, the next swipe already went back
      const timer = setTimeout(() => {
        stop();
        if (g?.mode && g.view === old) return; // being dragged again
        clearStyles(old);
        container.style.overflow = "";
      }, SWAP_TIMEOUT_MS);
      observer.observe(container, { childList: true });
    } else {
      if (old) clearStyles(old);
      if (container) container.style.overflow = "";
    }
    const dash = location.pathname.split("/")[1];
    history.pushState(null, "", `/${dash}/${target.path}${location.search}${location.hash}`);
    window.dispatchEvent(new CustomEvent("location-changed"));
  };

  // cancel: gesture aborted by the system, so no navigation happens
  const release = (cancel = false) => {
    if (!g) return;
    const { panel, view, container, p, s, by, armed, target } = g;
    const going = target && armed && !cancel;
    if (view && !going) {
      view.style.transition = "transform .22s ease-out, opacity .22s ease-out";
      view.style.transform = "";
      view.style.opacity = "";
      setTimeout(() => {
        view.style.transition = "";
        // A pending view swap (stopSwap) or slide unclips the page itself
        if (!g?.mode && !slide && !stopSwap) container.style.overflow = "";
      }, 250);
    }
    g.unlisten?.();
    g = null;
    if (going) navigate(panel, target, s, view, container);
    if (!target || !ui || !bub?.drawn) {
      if (ui) hide();
      return;
    }
    if (going) {
      // End the fade after the jiggle; snapTick keeps draining the neck meanwhile
      const left =
        bub.armedAt != null ? Math.max(0, bub.armedAt + BOUNCE_MS - performance.now()) : 0;
      const o = {
        duration: 240,
        delay: Math.max(0, left - 180),
        easing: "ease-in",
        fill: "forwards",
      };
      const id = ++popId;
      ui.box.animate([{ opacity: 0 }], o); // from whatever opacity it's at
      ui.icon.animate([{ opacity: 0 }], o).onfinish = () => {
        if (id !== popId) return; // a newer bubble took over
        stopAnimations();
        hide();
      };
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const k = clamp01((now - t0) / 260);
      render(p * (1 - k) * (1 - k), s, by);
      anim = k < 1 ? requestAnimationFrame(step) : (hide(), 0);
    };
    anim = requestAnimationFrame(step);
  };

  const setDirection = (fingerRight) => {
    g.fingerRight = fingerRight;
    g.s = fingerRight ? 1 : -1; // bubble comes out of the wall the finger moves away from
    // Finger moving right = previous view (next view in right-to-left languages)
    g.target = targetView(g.panel, g.opt, fingerRight !== g.rtl);
    g.armed = false;
    const animated = g.target && !reducedMotion?.matches;
    if (animated) {
      cancelAnimationFrame(anim);
      ui ||= makeUi();
      popId++; // invalidate any fade still finishing from the previous swipe
      stopAnimations();
      bub = { p: 0, s: g.s, by: g.by, opt: g.opt, armedAt: null, shownAt: performance.now() };
      const me = bub;
      requestAnimationFrame(() => wallTick(me));
      ui.icon.setAttribute(
        "icon",
        g.target.icon || (fingerRight ? "mdi:chevron-left" : "mdi:chevron-right"),
      );
      setArmed(false);
      applyOptions(g.opt);
      ui.box.style.display = ui.icon.style.display = "";
    } else {
      bub = null;
      if (ui) hide(); // nothing that way (first/last view), or reduced motion
    }
  };

  // The same event can reach both the target and window listeners; handle it once
  const seen = new WeakSet();
  const once = (e) => !seen.has(e) && seen.add(e);

  const onStart = (e) => {
    // A second finger mid-drag ends the gesture: navigate if it was already past
    // the threshold, otherwise drain back into the wall.
    if (g) {
      release();
      if (e.touches.length !== 1) return;
      // Only one finger down: we missed the previous lift. Carry on with this touch.
    }
    if (e.touches.length !== 1) return;
    const path = e.composedPath();
    if (!path.some((el) => el.tagName === "HUI-ROOT")) return; // ignore dialogs, sidebar, etc.
    if (path.some((el) => el instanceof Element && el.matches(SKIP))) return;
    const panel = findPanel(path);
    const opt = options(panel);
    if (!opt) return;
    const t = e.touches[0];
    g = {
      panel,
      opt,
      rtl: isRtl(),
      x: t.clientX,
      y: t.clientY,
      mode: null,
    };
    // Touch events stick to the element first touched. If a page switch removes that
    // element mid-drag, its events stop reaching window, so also listen on it directly.
    const el = path[0];
    if (el instanceof EventTarget && el !== window) {
      const ac = new AbortController();
      const o = { passive: false, signal: ac.signal };
      el.addEventListener("touchmove", onMove, o);
      el.addEventListener("touchend", onEnd, o);
      el.addEventListener("touchcancel", onCancel, o);
      g.unlisten = () => ac.abort();
    }
  };

  const onMove = (e) => {
    if (!once(e) || !g || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.mode) {
      if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) {
        // Still deciding. Claim sideways-leaning moves right away: if the browser gets
        // an unhandled move it starts its own pan and the swipe is lost.
        if (Math.abs(dx) > Math.abs(dy) && e.cancelable) e.preventDefault();
        return;
      }
      if (Math.abs(dy) >= Math.abs(dx)) {
        g.unlisten?.();
        g = null;
        return;
      }
      g.mode = "h";
      slide?.finish(); // a new swipe doesn't wait for the last one's slide
      g.view = viewEl(g.panel);
      g.container = g.view?.parentElement;
      // Shifting right would overflow the page (scrollbar + jitter); clip it
      if (g.container) g.container.style.overflowX = "clip";
      setDirection(dx > 0);
    } else if (dx !== 0 && dx > 0 !== g.fingerRight) {
      // Navigation follows the final direction, so the bubble has to as well
      setDirection(dx > 0);
    }
    if (e.cancelable) e.preventDefault(); // no vertical scrolling during a horizontal drag

    const along = Math.max(0, dx * g.s);
    const p = Math.min(along / ((screen.width * g.opt.swipe_amount) / 100), 1);
    g.p = p;

    if (g.view && !reducedMotion?.matches) {
      // At an edge with nowhere to go: tiny rubber-band only
      const shift = g.target ? MAX_SHIFT * p : Math.min(along * 0.05, 8);
      g.view.style.transition = "";
      g.view.style.transform = `translateX(${g.s * shift}px)`;
      g.view.style.opacity = g.target ? String(1 - g.opt.view_fade * p) : "";
    }
    if (!g.target) return;

    // Above the finger so it isn't hidden under it
    const fy = g.y - 2 * R + Y_FOLLOW * (t.clientY - g.y);
    const margin = 5 * R;
    g.by = Math.min(Math.max(fy, margin), window.innerHeight - margin);
    // Small hysteresis so the neck doesn't flicker on/off right at the threshold
    const armed = g.armed ? p >= 0.97 : p >= 1;
    const changed = armed !== !!g.armed;
    g.armed = armed;
    if (changed && armed && g.opt.haptics) navigator.vibrate?.(8);
    if (!bub) return; // reduced motion: navigate without the bubble

    if (changed) {
      setArmed(armed);
      if (armed) {
        bub.armedAt = performance.now();
        // Super fast flick: the ball just shoots out, no water clinging to the wall
        bub.noWall = bub.armedAt - bub.shownAt < FLICK_MS;
        const me = bub;
        requestAnimationFrame(() => snapTick(me));
      }
    }
    if (!armed) {
      bub.armedAt = null;
      bub.noWall = false;
    }
    Object.assign(bub, { p, s: g.s, by: g.by, drawn: true });
    render(p, g.s, g.by, snapNow());
  };

  const onEnd = (e) => once(e) && release();
  const onCancel = (e) => once(e) && release(true);

  window.addEventListener("touchstart", onStart, { passive: true, capture: true });
  window.addEventListener("touchmove", onMove, { passive: false, capture: true });
  window.addEventListener("touchend", onEnd, { passive: true, capture: true });
  window.addEventListener("touchcancel", onCancel, { passive: true, capture: true });
  // Backup for a missed lift: unlike touch events, pointer events get re-targeted when
  // the touched element disappears. Not pointercancel: the browser fires it when it
  // starts its own pan, while the touch is still ours to track.
  window.addEventListener("pointerup", (e) => e.isPrimary && release(), { capture: true });
})();

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
    bubble_color: "#34373e",
    bubble_active_color: "color-mix(in srgb, var(--primary-color, #03a9f4) 78%, #000)",
    icon_color: "#b4b7bf",
    icon_active_color: "rgba(255, 255, 255, .85)",
  };

  const MAX_SHIFT = 28; // px
  const MAX_FADE = 0.2; // opacity lost at full pull
  const Y_FOLLOW = 0.25; // share of the finger's vertical movement the bubble follows
  const R = 28; // ball radius
  const GAP = 14; // ball's distance from the wall once out
  const BOX_W = 200,
    BOX_H = 340,
    WALL = 40; // goo canvas; wall sits WALL px inside it
  const MOUND_H = [120, 45]; // wall mound half-height: at rest -> once the ball is out
  const MOUND_W = [30, 8]; // mound protrusion: peak -> at the threshold (thin neck)
  const SNAP_MS = 130; // neck pinch-off duration
  const STRETCH = [1.2, 0.84]; // ball scale x/y at full tension
  const BOUNCE_MS = 440;
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
    panel?.shadowRoot?.querySelector("hui-root")?.shadowRoot?.querySelector("#view hui-view");

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
    // Gooey filter: blur + alpha threshold makes nearby shapes melt together
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("style", "position:absolute;width:0;height:0");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = `<filter id="asn-goo" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b"/>
      <feColorMatrix in="b" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 22 -10"/></filter>`;
    const box = document.createElement("div");
    box.className = "asn-bubble";
    box.style.cssText = `position:fixed;z-index:9;top:0;left:0;width:${BOX_W}px;height:${BOX_H}px;
      pointer-events:none;filter:url(#asn-goo) drop-shadow(0 2px 5px rgba(0,0,0,.35));display:none`;
    const shape = "position:absolute;left:0;top:0;border-radius:50%;transition:background .15s;";
    const bump = document.createElement("div");
    const ball = document.createElement("div");
    bump.style.cssText = shape;
    ball.style.cssText = shape + `width:${2 * R}px;height:${2 * R}px`;
    // Hidden strip just past the wall: the goo blends the mound's base into it,
    // giving a bell-curve flare instead of a pointy mound
    const strip = document.createElement("div");
    strip.style.cssText = `position:absolute;top:0;width:${WALL - 8}px;height:${BOX_H}px;`;
    box.append(strip, bump, ball);
    const icon = document.createElement("ha-icon");
    icon.className = "asn-icon";
    icon.style.cssText = `position:fixed;z-index:10;top:0;left:0;pointer-events:none;display:none;
      --mdc-icon-size:26px;transition:color .15s`;
    document.body.append(svg, box, icon);
    return { box, strip, bump, ball, icon };
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
    const { box, strip, bump, ball, icon } = ui;
    const boxLeft = s > 0 ? -WALL : window.innerWidth - BOX_W + WALL;
    const wallX = s > 0 ? WALL : BOX_W - WALL;
    box.style.translate = `${boxLeft}px ${by - BOX_H / 2}px`;
    strip.style.left = s > 0 ? "0" : `${BOX_W - WALL + 8}px`;
    const cx = -R + (2 * R + GAP) * p;
    // The neck stays attached until the threshold, so the snap is what sets off the bounce
    const [aMax, aEnd] = MOUND_W;
    const w = waterP(p);
    const wv = w ?? 0;
    const attached = wv < 0.6 ? aMax * (wv / 0.6) : aMax + (aEnd - aMax) * ((wv - 0.6) / 0.4);
    const a = w == null ? 0 : attached * (1 - snap);
    const b = MOUND_H[0] - (MOUND_H[0] - MOUND_H[1]) * clamp01(wv / 0.6);
    bump.style.width = `${2 * a}px`;
    bump.style.height = `${2 * b}px`;
    bump.style.translate = `${wallX - a}px ${BOX_H / 2 - b}px`;
    ball.style.translate = `${wallX + s * cx - R}px ${BOX_H / 2 - R}px`;
    // The neck holds the ball back, so it stretches near the threshold
    const t = snap > 0 || bub?.armedAt != null ? 0 : clamp01((p - 0.55) / 0.45) ** 2;
    const sx = 1 + (STRETCH[0] - 1) * t;
    const sy = 1 + (STRETCH[1] - 1) * t;
    ball.style.scale = `${sx} ${sy}`;
    // Icon lives outside the filter so it stays crisp. Positions use the `translate`
    // property so the bounce's scale animations apply around each element's center.
    const iconScale = 0.5 + 0.5 * clamp01((p - 0.3) / 0.6);
    icon.style.opacity = String(clamp01((p - 0.35) / 0.4));
    icon.style.translate = `${boxLeft + wallX + s * cx - 13}px ${by - 13}px`;
    icon.style.transform = `scale(${iconScale * (1 + (sx - 1) / 2)}, ${iconScale * (1 + (sy - 1) / 2)})`;
  };

  const setArmed = (armed) => {
    const c = armed ? bub.opt.bubble_active_color : bub.opt.bubble_color;
    ui.bump.style.background = c;
    ui.strip.style.background = c;
    ui.ball.style.background = c;
    ui.icon.style.color = armed ? bub.opt.icon_active_color : bub.opt.icon_color;
  };

  // Starts from the stretched shape the pull left, so the snap looks continuous
  const bounce = () => {
    const [x, y] = STRETCH;
    ui.ball.animate(
      [
        { scale: `${x} ${y}` },
        { scale: "0.86 1.14", offset: 0.35 },
        { scale: "1.06 0.95", offset: 0.65 },
        { scale: "1 1" },
      ],
      { duration: 400, easing: "ease-out" },
    );
    ui.icon.animate(
      [
        { scale: `${1 + (x - 1) / 2} ${1 + (y - 1) / 2}` },
        { scale: "0.9 1.1", offset: 0.4 },
        { scale: "1.04 0.97", offset: 0.7 },
        { scale: "1 1" },
      ],
      { duration: BOUNCE_MS, easing: "ease-out" },
    );
  };

  const stopAnimations = () =>
    [ui.ball, ui.box, ui.icon].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));

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

  // Keep the pinch-off animating while the finger holds still and after release
  const snapTick = (me) => {
    if (bub !== me || me.armedAt == null) return; // newer bubble, or re-attached
    const snap = snapNow();
    render(me.p, me.s, me.by, snap);
    if (snap < 1) requestAnimationFrame(() => snapTick(me));
  };

  // Navigate right away so a quick follow-up swipe starts from the new view
  const navigate = (panel, target, s, old) => {
    const dash = location.pathname.split("/")[1];
    history.pushState(null, "", `/${dash}/${target.path}${location.search}${location.hash}`);
    window.dispatchEvent(new CustomEvent("location-changed"));
    // HA caches views, so the old element comes back later: clear its exit styles
    const resetOld = () => {
      if (old) old.style.transition = old.style.transform = old.style.opacity = "";
    };
    if (reducedMotion?.matches) return resetOld();
    let tries = 0;
    const slideIn = () => {
      const v = viewEl(panel);
      if ((!v || v === old) && tries++ < 30) return requestAnimationFrame(slideIn);
      resetOld();
      v?.animate(
        [
          { translate: `${-s * 48}px 0`, opacity: 0 },
          { translate: "0 0", opacity: 1 },
        ],
        { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    };
    requestAnimationFrame(slideIn);
  };

  // cancel: gesture aborted by the system, so no navigation happens
  const release = (cancel = false) => {
    if (!g) return;
    const { panel, view, p, s, by, armed, target } = g;
    const container = view?.parentElement;
    if (container) setTimeout(() => (container.style.overflowX = ""), 450);
    const going = target && armed && !cancel;
    if (view && going && !reducedMotion?.matches) {
      // Keep sliding the old view out while the new one renders
      view.style.transition = "transform .18s ease-in, opacity .18s ease-in";
      view.style.transform = `translateX(${s * (MAX_SHIFT + 40)}px)`;
      view.style.opacity = "0";
    } else if (view) {
      view.style.transition = "transform .22s ease-out, opacity .22s ease-out";
      view.style.transform = "";
      view.style.opacity = "";
      setTimeout(() => (view.style.transition = ""), 250);
    }
    g.unlisten?.();
    g = null;
    if (going) navigate(panel, target, s, view);
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
      ui.box.animate([{ opacity: 1 }, { opacity: 0 }], o);
      ui.icon.animate([{ opacity: 1 }, { opacity: 0 }], o).onfinish = () => {
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
      ui.box.style.opacity = "";
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
      view: viewEl(panel),
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
      // Shifting right would overflow the page (scrollbar + jitter); clip it
      if (g.view?.parentElement) g.view.parentElement.style.overflowX = "clip";
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
      g.view.style.opacity = g.target ? String(1 - MAX_FADE * p) : "";
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
        bounce();
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

  // Phones set up the goo filter's GPU work on its first paint, which made the first swipe
  // after launch stutter. Paint the bubble once, invisibly, while the page is idle.
  const warmUp = () => {
    if (ui || reducedMotion?.matches) return;
    ui = makeUi();
    bub = { opt: DEFAULTS, armedAt: null, shownAt: -Infinity };
    setArmed(false);
    ui.box.style.display = ui.icon.style.display = "";
    render(0.6, -1, window.innerHeight / 2);
    ui.box.style.opacity = ui.icon.style.opacity = "0.01"; // 0 would skip painting
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (g) return; // a swipe already took over the bubble
        bub = null;
        hide();
      }),
    );
  };
  if (window.requestIdleCallback) requestIdleCallback(warmUp, { timeout: 3000 });
  else setTimeout(warmUp, 1000);

  window.addEventListener("touchstart", onStart, { passive: true, capture: true });
  window.addEventListener("touchmove", onMove, { passive: false, capture: true });
  window.addEventListener("touchend", onEnd, { passive: true, capture: true });
  window.addEventListener("touchcancel", onCancel, { passive: true, capture: true });
  // Backup for a missed lift: unlike touch events, pointer events get re-targeted when
  // the touched element disappears. Not pointercancel: the browser fires it when it
  // starts its own pan, while the touch is still ours to track.
  window.addEventListener("pointerup", (e) => e.isPrimary && release(), { capture: true });
})();

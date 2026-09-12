/* Page chrome shared by every demo: header, code panel, controls, HUD.
   None of this is Orihon — the library code lives in each demo's `map.js`,
   which is also what the code panel shows. */

import { codeBlock } from "./hl.js";

const site = () => window.OrihonSite || { origin: "unknown", siteRoot: "../../" };

/* ------------------------------------------------------------------ theme - */

const themeListeners = new Set();

export const isDark = () => document.documentElement.dataset.theme === "dark";

export function setTheme(next) {
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("orihon-theme", next); } catch { /* private mode */ }
  for (const fn of themeListeners) fn(next === "dark");
}

export function onTheme(fn) {
  themeListeners.add(fn);
  return () => themeListeners.delete(fn);
}

/** Neutral raster canvas that follows the site theme. No key, no sign-up. */
export const basemapUrl = (dark = isDark()) =>
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_" +
  (dark ? "Dark" : "Light") +
  "_Gray_Base/MapServer/tile/{z}/{y}/{x}";

export const basemap = (dark = isDark()) => ({
  url: basemapUrl(dark),
  attribution: "Tiles © Esri",
  maxNativeZoom: 16
});

/* ------------------------------------------------------------------ utils - */

export const ready = () =>
  document.readyState === "loading"
    ? new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }))
    : Promise.resolve();

const NUM = new Intl.NumberFormat("en-US");
export const num = (value) => NUM.format(Math.round(value));

export function compact(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

/** Smoothed frames per second, sampled every animation frame. */
export function fpsMeter(onSample) {
  let last = performance.now();
  let smoothed = 60;
  let raf = 0;
  const tick = (now) => {
    const delta = now - last;
    last = now;
    if (delta > 0 && delta < 500) smoothed += (1000 / delta - smoothed) * 0.1;
    onSample(smoothed);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/* ------------------------------------------------------------ control kit - */

export function panel(...children) {
  const box = document.createElement("div");
  box.className = "ctl";
  box.append(...children.filter(Boolean));
  return box;
}

export function field(text, ...children) {
  const label = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = text;
  label.append(caption, ...children);
  return label;
}

export function row(...children) {
  const box = document.createElement("div");
  box.className = "row";
  box.append(...children.filter(Boolean));
  return box;
}

export function segmented(items, initial, onChange) {
  const group = document.createElement("span");
  group.className = "seg";
  const paint = (value) => {
    for (const button of group.children) button.ariaPressed = String(button.dataset.value === String(value));
  };
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.value = String(item.value);
    button.textContent = item.label;
    button.addEventListener("click", () => {
      paint(item.value);
      onChange(item.value);
    });
    group.append(button);
  }
  paint(initial);
  group.select = paint;
  return group;
}

export function choice(items, initial, onChange) {
  const element = document.createElement("select");
  for (const item of items) {
    const option = document.createElement("option");
    option.value = String(item.value);
    option.textContent = item.label;
    element.append(option);
  }
  element.value = String(initial);
  element.addEventListener("change", () => onChange(element.value));
  return element;
}

export function slider({ min, max, step = 1, value, format = String, onInput }) {
  const wrap = document.createElement("div");
  wrap.className = "row";
  const input = document.createElement("input");
  input.type = "range";
  Object.assign(input, { min, max, step, value });
  const readout = document.createElement("span");
  readout.className = "val";
  readout.textContent = format(value);
  input.addEventListener("input", () => {
    readout.textContent = format(Number(input.value));
    onInput(Number(input.value));
  });
  wrap.append(input, readout);
  wrap.set = (next) => {
    input.value = String(next);
    readout.textContent = format(next);
  };
  return wrap;
}

export function action(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-ghost";
  button.style.fontSize = "0.84rem";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function icon(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = paths;
  return svg;
}

const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
const PANEL = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>';

export function themeButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn";
  button.title = "Toggle theme";
  button.setAttribute("aria-label", "Toggle theme");
  const paint = () => {
    button.replaceChildren(icon(isDark() ? SUN : MOON));
  };
  button.addEventListener("click", () => {
    setTheme(isDark() ? "light" : "dark");
    paint();
  });
  paint();
  return button;
}

/* ------------------------------------------------------------- demo shell - */

/**
 * Build the demo page chrome and return handles to it.
 *
 * @param {{
 *   title: string,
 *   badges?: string[],
 *   sources?: {name: string, url: string}[],
 *   hud?: string[],
 *   controls?: HTMLElement,
 *   notes?: string
 * }} config
 */
export async function mountDemo(config) {
  await ready();
  const root = site().siteRoot;

  document.body.classList.add("demo");
  document.title = `${config.title} · Orihon`;

  /* header */
  const head = document.createElement("header");
  head.className = "demo-head";

  const back = document.createElement("a");
  back.className = "back";
  back.href = `${root}index.html`;
  back.append(icon('<path d="M15 18l-6-6 6-6"/>'), Object.assign(document.createElement("span"), { textContent: "Orihon" }));

  const title = document.createElement("h1");
  title.textContent = config.title;

  const meta = document.createElement("div");
  meta.className = "meta";
  for (const badge of config.badges || []) {
    const pill = document.createElement("span");
    pill.className = "pill pill-mono pill-accent";
    pill.textContent = badge;
    meta.append(pill);
  }
  const origin = document.createElement("span");
  origin.className = "pill pill-mono";
  origin.textContent = site().origin;
  origin.title = "Which Orihon build this page loaded";
  meta.append(origin, themeButton());

  head.append(back, title, meta);

  /* stage */
  const body = document.createElement("div");
  body.className = "demo-body";

  const stage = document.createElement("div");
  stage.className = "demo-stage";

  const map = document.createElement("div");
  map.className = "map";
  map.id = "map";
  stage.append(map);

  const side = document.createElement("aside");
  side.className = "demo-side";

  const sideToggle = document.createElement("button");
  sideToggle.type = "button";
  sideToggle.className = "icon-btn side-toggle";
  sideToggle.title = "Toggle the code panel";
  sideToggle.append(icon(PANEL));
  sideToggle.addEventListener("click", () => {
    side.hidden = !side.hidden;
    window.dispatchEvent(new Event("resize"));
  });
  stage.append(sideToggle);

  /* HUD */
  let hud = null;
  if (config.hud?.length) {
    hud = document.createElement("dl");
    hud.className = "hud";
    for (const key of config.hud) {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.dataset.hud = key;
      dd.textContent = "—";
      hud.append(dt, dd);
    }
    stage.append(hud);
  }

  /* panes */
  const tabs = document.createElement("div");
  tabs.className = "tabs";
  tabs.role = "tablist";
  const panes = document.createElement("div");
  panes.className = "panes";

  const definitions = [];
  const sources = config.sources || [];
  if (sources.length) definitions.push({ id: "code", label: sources[0].name, flush: true });
  else if (config.code) definitions.push({ id: "code", label: config.codeLabel || "Code", flush: true });
  if (config.controls) definitions.push({ id: "controls", label: "Controls" });
  if (config.notes) definitions.push({ id: "notes", label: "How it works" });

  const select = (id) => {
    for (const button of tabs.children) button.ariaSelected = String(button.dataset.pane === id);
    for (const pane of panes.children) pane.hidden = pane.dataset.pane !== id;
  };

  for (const definition of definitions) {
    const button = document.createElement("button");
    button.className = "tab";
    button.role = "tab";
    button.dataset.pane = definition.id;
    button.textContent = definition.label;
    button.addEventListener("click", () => select(definition.id));
    tabs.append(button);

    const pane = document.createElement("section");
    pane.className = definition.flush ? "pane flush" : "pane";
    pane.dataset.pane = definition.id;
    panes.append(pane);
  }

  if (config.code) panes.querySelector('[data-pane="code"]').append(config.code);
  if (config.controls) panes.querySelector('[data-pane="controls"]').append(config.controls);
  if (config.notes) panes.querySelector('[data-pane="notes"]').innerHTML = config.notes;

  side.append(tabs, panes);
  body.append(stage, side);
  document.body.append(head, body);
  if (definitions.length) select(definitions[0].id);

  /* Code pane: the real files, fetched as text so the panel cannot drift. */
  if (sources.length) {
    const switcher = document.createElement("span");
    switcher.className = "seg";
    const block = codeBlock("loading…", { label: sources[0].name, actions: sources.length > 1 ? switcher : null });
    panes.querySelector('[data-pane="code"]').append(block);

    const loaded = await Promise.all(
      sources.map((entry) =>
        fetch(entry.url, { cache: "no-cache" })
          .then((response) => (response.ok ? response.text() : `// could not load ${entry.name}`))
          .catch(() => `// could not load ${entry.name}`)
      )
    );

    const show = (index) => {
      block.setSource(loaded[index], sources[index].name);
      tabs.firstChild.textContent = sources[index].name;
      for (const button of switcher.children) button.ariaPressed = String(Number(button.dataset.index) === index);
    };

    sources.forEach((entry, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.index = String(index);
      button.textContent = entry.name;
      button.addEventListener("click", () => show(index));
      switcher.append(button);
    });
    show(0);
  }

  return {
    map,
    stage,
    head,
    side,
    setBadge(index, text) {
      const pill = meta.children[index];
      if (pill) pill.textContent = text;
    },
    hud(key, value) {
      const cell = hud?.querySelector(`[data-hud="${key}"]`);
      if (cell) cell.textContent = value;
    }
  };
}

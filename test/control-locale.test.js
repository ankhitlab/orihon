import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createMap } from "../dist/full-entry.js";
import { fullscreenControl, measureControl } from "../dist/controls.js";
import { locales } from "../dist/ui/locale.js";

/**
 * Every string the shipped UI puts in front of a user has to follow `map.locale`.
 * The measure button used to be the exception: it was hardcoded English and set
 * once in `onAdd`, so it neither followed the map's locale nor `setLocale()`.
 */

function container() {
  const dom = new JSDOM("<!doctype html><div id='map'></div>", { pretendToBeVisual: true, url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  const el = document.getElementById("map");
  Object.defineProperty(el, "clientWidth", { get: () => 800 });
  Object.defineProperty(el, "clientHeight", { get: () => 600 });
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
  return el;
}

const LANGUAGES = ["en", "ru", "ar", "tr", "zh", "de", "fr", "da", "hi"];

test("the measure button is translated in every shipped language", () => {
  const seen = new Set();
  for (const language of LANGUAGES) {
    const map = createMap(container(), { center: { lat: 0, lng: 0 }, zoom: 2, locale: language });
    const control = measureControl().addTo(map);
    const title = control.button.title;
    assert.ok(title, `${language} produced no measure label`);
    assert.equal(control.button.getAttribute("aria-label"), title);
    if (language !== "en") assert.notEqual(title, "Measure distance", `${language} fell back to English`);
    seen.add(title);
    map.destroy();
  }
  assert.equal(seen.size, LANGUAGES.length, "every language needs its own string");
});

test("setLocale relabels the measure button, not just the ones added after it", () => {
  const map = createMap(container(), { center: { lat: 0, lng: 0 }, zoom: 2, locale: "en" });
  const control = measureControl().addTo(map);
  assert.equal(control.button.title, "Measure distance");

  map.setLocale("de");
  assert.equal(control.button.title, "Entfernung messen");

  map.setLocale("ru");
  assert.equal(control.button.title, "Измерить расстояние");
  map.destroy();
});

test("an explicit title still wins over the locale", () => {
  const map = createMap(container(), { center: { lat: 0, lng: 0 }, zoom: 2, locale: "ru" });
  const control = measureControl({ title: "Линейка" }).addTo(map);
  assert.equal(control.button.title, "Линейка");
  map.setLocale("de");
  assert.equal(control.button.title, "Линейка", "an app-supplied title is not a translation slot");
  map.destroy();
});

test("fullscreen keeps following the locale too", () => {
  const map = createMap(container(), { center: { lat: 0, lng: 0 }, zoom: 2, locale: "fr" });
  const control = fullscreenControl().addTo(map);
  assert.equal(control.button.title, "Plein écran");
  map.setLocale("da");
  assert.equal(control.button.title, "Fuld skærm");
  map.destroy();
});

test("core locale packs carry every key for every language", () => {
  const keys = Object.keys(locales.en).filter((key) => key !== "rtl");
  for (const language of LANGUAGES) {
    const pack = locales[language];
    for (const key of keys) {
      assert.equal(typeof pack[key], "string", `${language}.${key} is missing`);
      assert.ok(pack[key].length > 0, `${language}.${key} is empty`);
    }
  }
  assert.equal(locales.ar.rtl, true, "Arabic has to report RTL");
});

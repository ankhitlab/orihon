/*
 * Orihon demo site bootstrap.
 *
 * This is a classic script on purpose. An import map has to be installed before
 * the first module is resolved, and installing it here means every demo file on
 * this site can be written with the same specifiers an application would use:
 *
 *     import { createMap } from "orihon/easy";
 *
 * ...instead of build-output paths. What you read in the code panel is exactly
 * what runs, and it pastes into a real project unchanged.
 *
 * The map points at the repository's own `dist/` when the site is served from a
 * checkout, and falls back to the published package on jsDelivr otherwise, so a
 * plain upload of this folder works with no build step.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var VERSION = "2.0.1";
  var CDN = "https://cdn.jsdelivr.net/npm/orihon@" + VERSION + "/dist/";

  // assets/boot.js -> examples/live/ -> <repo>/dist/
  var siteRoot = new URL("../", script.src).href;
  var localDist = new URL("../../dist/", siteRoot).href;

  /* Package specifier -> file inside dist/.
     Published 2.0.1 ships the modular tree but not every aggregate entry, so a
     couple of specifiers resolve to a different file on the CDN. Same code. */
  var LOCAL = {
    "orihon": "standard.js",
    "orihon/core": "core.js",
    "orihon/standard": "standard.js",
    "orihon/easy": "easy-entry.js",
    "orihon/advanced": "advanced-entry.js",
    "orihon/object-manager": "object-manager-entry.js",
    "orihon/source": "feature-source.js",
    "orihon/draw": "draw/index.js",
    "orihon/controls": "controls.js",
    "orihon/geo": "geo-entry.js",
    "orihon/popup-content": "popup-content.js",
    "orihon/ai": "ai-entry.js",
    "orihon/react": "react/index.js",

    /* React is a peer dependency, so the site has to supply it the way an
       application would. Absolute values are used as-is, not joined to `base`. */
    "react": "https://esm.sh/react@18.3.1",
    "react-dom": "https://esm.sh/react-dom@18.3.1",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client"
  };

  var CDN_OVERRIDES = {
    "orihon/advanced": "index.js",
    "orihon/object-manager": "services/object-manager-factory.js"
  };

  /* ---------------------------------------------------------------- theme - */

  var stored = null;
  try { stored = localStorage.getItem("orihon-theme"); } catch (error) { stored = null; }
  var prefersDark = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = stored || (prefersDark ? "dark" : "light");

  /* ----------------------------------------------------------------- boot - */

  /* Inserted ahead of site.css: the site's layout rules have to win over the
     engine stylesheet (`.oh-map` sets its own position and min-height). */
  function styleSheet(href) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    var site = document.querySelector('link[rel="stylesheet"][href*="site.css"]');
    if (site) site.parentNode.insertBefore(link, site);
    else document.head.appendChild(link);
  }

  /** One tiny module decides it: present and shaped like our build, or CDN. */
  function probe(base) {
    return fetch(base + "geo-entry.js", { cache: "no-cache" })
      .then(function (response) { return response.ok ? response.text() : ""; })
      .then(function (body) { return body.indexOf("export") >= 0 ? base : null; })
      .catch(function () { return null; });
  }

  function installImportMap(base, useCdnOverrides) {
    var imports = {};
    Object.keys(LOCAL).forEach(function (specifier) {
      var file = (useCdnOverrides && CDN_OVERRIDES[specifier]) || LOCAL[specifier];
      imports[specifier] = /^https?:\/\//.test(file) ? file : base + file;
    });
    var element = document.createElement("script");
    element.type = "importmap";
    element.textContent = JSON.stringify({ imports: imports }, null, 2);
    document.head.appendChild(element);
  }

  function fail(message) {
    document.documentElement.classList.add("boot-failed");
    var box = document.createElement("div");
    box.className = "boot-error";
    box.innerHTML = "<strong>Could not load Orihon.</strong><span>" + message + "</span>";
    (document.querySelector(".demo-stage") || document.body).appendChild(box);
  }

  probe(localDist)
    .then(function (found) {
      var base = found || CDN;
      var local = Boolean(found);

      window.OrihonSite = {
        version: VERSION,
        base: base,
        local: local,
        siteRoot: siteRoot,
        /** Where the running code came from, for the badge in the header. */
        origin: local ? "local dist/" : "npm " + VERSION
      };

      styleSheet(base + "orihon.css");
      if ((script.dataset.css || "").split(/\s+/).indexOf("draw") >= 0) {
        styleSheet(base + "draw.css");
      }
      installImportMap(base, !local);

      var entry = script.dataset.entry;
      if (!entry) return;
      var module = document.createElement("script");
      module.type = "module";
      module.src = new URL(entry, script.baseURI).href;
      module.addEventListener("error", function () { fail("Failed to execute " + entry); });
      document.head.appendChild(module);
    })
    .catch(function (error) { fail(String(error && error.message ? error.message : error)); });
})();

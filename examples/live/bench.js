/*
 * Benchmark section: one table per kind of check, each cell carrying both
 * dataset sizes. Data comes from bench-data.js, which is generated from
 * examples/bench-compare — see the site README for how to regenerate it.
 */

import { BENCH } from "./bench-data.js";

/**
 * "66.6 ms" + "1633 ms" → "66.6 / 1633 ms"; unlike units stay spelled out, and a
 * value that measured the same at both sizes collapses to itself.
 */
export function pair(small, large) {
  const unit = (value) => (String(value).match(/[a-zA-Z%]+$/) || [""])[0];
  const bare = (value) => String(value).replace(/\s*[a-zA-Z%]+$/, "").trim();
  if (small === large) return String(small);
  if (!unit(small) || unit(small) !== unit(large)) return `${small} / ${large}`;
  /* Percent sits tight against the number; word units keep their space. */
  const joint = unit(small) === "%" ? "" : " ";
  return `${bare(small)} / ${bare(large)}${joint}${unit(small)}`;
}

export function mountBench() {
  const tabs = document.querySelector('[data-slot="bench-switch"]');
  const table = document.querySelector('[data-slot="bench-table"]');
  const note = document.querySelector('[data-slot="bench-note"]');
  if (!tabs || !table || !note) return;

  const render = (index) => {
    const scenario = BENCH.scenarios[index];
    const head = scenario.columns.map(([label]) => `<th>${label}</th>`).join("");

    table.innerHTML =
      `<thead><tr><th>Engine</th>${head}</tr></thead><tbody>` +
      scenario.rows
        .map((row) => {
          const cells = scenario.columns
            .map(([, key]) => {
              const value = row[key];
              if (!value) return "<td>—</td>";
              const bad = (row.bad || []).includes(key);
              return `<td${bad ? ' class="bad"' : ""}>${pair(value[0], value[1])}</td>`;
            })
            .join("");
          return (
            `<tr${row.self ? ' class="self"' : ""}>` +
            `<td>${row.name}<small>${row.note}</small></td>${cells}</tr>`
          );
        })
        .join("") +
      "</tbody>";

    note.innerHTML =
      `<strong>${scenario.verdict}</strong><br>` +
      `${scenario.note} Every cell reads <b>50 000 / 1 000 000</b> ${scenario.unit}; ` +
      "a single value measured the same at both sizes, and a dash means that engine was " +
      "not run at that size. " +
      (scenario.caveat ? `${scenario.caveat} ` : "") +
      `${BENCH.runs}. ${BENCH.env}. ` +
      "The MapLibre row is always the fastest shape the harness can ask MapLibre for — for points " +
      "and live updates that is a hand-written raw-WebGL layer rather than a GeoJSON source. GPU, " +
      "browser and dataset shape all move these numbers, which is exactly why the harness ships " +
      "with the library.";

    for (const button of tabs.children) {
      button.ariaPressed = String(Number(button.dataset.index) === index);
    }
  };

  BENCH.scenarios.forEach((scenario, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = String(index);
    button.textContent = scenario.label;
    button.title = scenario.note;
    button.addEventListener("click", () => render(index));
    tabs.append(button);
  });

  render(0);
}

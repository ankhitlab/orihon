/*
 * Generated from examples/bench-compare — see "Regenerating the benchmark table"
 * in the site README. Every value is a [at 50 000, at 1 000 000] pair.
 * Do not hand-tune the numbers; re-run the harness instead.
 */

export const BENCH = {
  "env": "Chrome 152 · Windows 11 · Intel(R) UHD Graphics 770 (integrated) · 32 GB · DPR 1",
  "runs": "Median of 3 in-page repetitions at 50 000, and of 3 separate sweeps at 1 000 000. Absolute figures move with whatever else the machine is doing — repeat sweeps varied by up to 4x on unchanged engine code — so read the comparison between engines, not the numbers on their own",
  "scenarios": [
    {
      "key": "points",
      "label": "Points",
      "unit": "points",
      "note": "One point layer, panned and zoomed for ~3s while frames are sampled.",
      "columns": [
        [
          "Load",
          "Load"
        ],
        [
          "FPS",
          "FPS"
        ],
        [
          "p95 frame",
          "p95"
        ],
        [
          "Dropped",
          "drop%"
        ],
        [
          "Worst block",
          "Longest task"
        ],
        [
          "Heap added",
          "Heap"
        ]
      ],
      "rows": [
        {
          "name": "Orihon",
          "note": "WebGL",
          "bad": [],
          "self": true,
          "Load": [
            "72.4 ms",
            "143 ms"
          ],
          "FPS": [
            "59",
            "56.3"
          ],
          "p95": [
            "16.8 ms",
            "33.2 ms"
          ],
          "drop%": [
            "2%",
            "6%"
          ],
          "Longest task": [
            "212 ms",
            "61.0 ms"
          ],
          "Heap": [
            "1.4 MB",
            "16.8 MB"
          ]
        },
        {
          "name": "Leaflet",
          "note": "canvas",
          "bad": [
            "FPS",
            "p95",
            "drop%"
          ],
          "Load": [
            "184 ms",
            "69.1 s"
          ],
          "FPS": [
            "17.7",
            "0.4"
          ],
          "p95": [
            "100 ms",
            "3.4 s"
          ],
          "drop%": [
            "83%",
            "100%"
          ],
          "Longest task": [
            "109 ms",
            "3.3 s"
          ],
          "Heap": [
            "32.2 MB",
            "621.3 MB"
          ]
        },
        {
          "name": "OpenLayers",
          "note": "WebGL points",
          "bad": [
            "FPS",
            "p95",
            "drop%"
          ],
          "Load": [
            "384 ms",
            "9.6 s"
          ],
          "FPS": [
            "57.7",
            "5.5"
          ],
          "p95": [
            "16.8 ms",
            "217 ms"
          ],
          "drop%": [
            "3%",
            "94%"
          ],
          "Longest task": [
            "124 ms",
            "5.4 s"
          ],
          "Heap": [
            "80.6 MB",
            "1.58 GB"
          ]
        },
        {
          "name": "MapLibre",
          "note": "raw GL layer",
          "bad": [
            "drop%"
          ],
          "Load": [
            "65.6 ms",
            "165 ms"
          ],
          "FPS": [
            "59",
            "32.8"
          ],
          "p95": [
            "16.8 ms",
            "66.6 ms"
          ],
          "drop%": [
            "1%",
            "55%"
          ],
          "Longest task": [
            "204 ms",
            "80.0 ms"
          ],
          "Heap": [
            "1.6 MB",
            "9.5 MB"
          ]
        }
      ],
      "verdict": "Orihon and MapLibre load a million points within 25 ms of each other — 143 against 165 — and the difference is what happens next: Orihon holds 56 FPS and drops 6% of frames where MapLibre settles to 33 and drops 55%. MapLibre keeps the memory lead, 9.5 MB against 16.8. The CPU renderers are not in the same problem: Leaflet needs 69 seconds and then paints 0.4 frames a second, OpenLayers asks 1.58 GB to manage 5.5."
    },
    {
      "key": "clusters",
      "label": "Clusters",
      "unit": "points",
      "note": "The same set clustered, stepped across discrete views, counting the markers actually drawn.",
      "columns": [
        [
          "Load",
          "Load"
        ],
        [
          "FPS",
          "FPS"
        ],
        [
          "p95 frame",
          "p95"
        ],
        [
          "Dropped",
          "drop%"
        ],
        [
          "Markers drawn",
          "Markers"
        ],
        [
          "Worst block",
          "Longest task"
        ],
        [
          "Heap added",
          "Heap"
        ]
      ],
      "rows": [
        {
          "name": "Orihon",
          "note": "ObjectManager",
          "bad": [],
          "self": true,
          "Load": [
            "133 ms",
            "699 ms"
          ],
          "FPS": [
            "60",
            "60"
          ],
          "p95": [
            "16.8 ms",
            "16.8 ms"
          ],
          "drop%": [
            "0%",
            "1%"
          ],
          "Markers": [
            "294",
            "330"
          ],
          "Longest task": [
            "none",
            "190 ms"
          ],
          "Heap": [
            "16.5 MB",
            "225.9 MB"
          ]
        },
        {
          "name": "Leaflet",
          "note": "markercluster",
          "bad": [],
          "Load": [
            "984 ms",
            "—"
          ],
          "FPS": [
            "60",
            "—"
          ],
          "p95": [
            "16.8 ms",
            "—"
          ],
          "drop%": [
            "0%",
            "—"
          ],
          "Longest task": [
            "50.0 ms",
            "—"
          ],
          "Heap": [
            "164.1 MB",
            "—"
          ]
        },
        {
          "name": "OpenLayers",
          "note": "OL Cluster",
          "bad": [],
          "Load": [
            "202 ms",
            "—"
          ],
          "FPS": [
            "52.8",
            "—"
          ],
          "p95": [
            "33.4 ms",
            "—"
          ],
          "drop%": [
            "9%",
            "—"
          ],
          "Markers": [
            "243",
            "—"
          ],
          "Longest task": [
            "71.0 ms",
            "—"
          ],
          "Heap": [
            "77.4 MB",
            "—"
          ]
        },
        {
          "name": "MapLibre",
          "note": "GeoJSON cluster",
          "bad": [],
          "Load": [
            "368 ms",
            "6.3 s"
          ],
          "FPS": [
            "60",
            "60"
          ],
          "p95": [
            "16.8 ms",
            "16.8 ms"
          ],
          "drop%": [
            "0%",
            "0%"
          ],
          "Markers": [
            "62",
            "60"
          ],
          "Longest task": [
            "66.0 ms",
            "1.5 s"
          ],
          "Heap": [
            "10.2 MB",
            "119.4 MB"
          ]
        }
      ],
      "caveat": "Leaflet and OpenLayers are absent at a million: a million circle markers exhausts the tab before a run can start. Marker counts differ because each engine chooses its own grouping.",
      "verdict": "Orihon groups a million points in 699 ms against MapLibre's 6.3 s, and both then hold 60 FPS; Orihon draws 330 clusters where MapLibre draws 60, and its worst block is 190 ms against 1.5 s. MapLibre keeps the memory lead, 119 MB against 226. At 50 000 every engine but OpenLayers holds 60 FPS; Orihon loads in 133 ms against 202 for OpenLayers, 368 for MapLibre and 984 for Leaflet, and is the only one of the four that never blocks the main thread for a frame."
    },
    {
      "key": "heatmap",
      "label": "Heatmap",
      "unit": "points",
      "note": "A density field built from the same points and repainted while the camera moves.",
      "columns": [
        [
          "Load",
          "Load"
        ],
        [
          "FPS",
          "FPS"
        ],
        [
          "p95 frame",
          "p95"
        ],
        [
          "Dropped",
          "drop%"
        ],
        [
          "Worst block",
          "Longest task"
        ],
        [
          "Heap added",
          "Heap"
        ]
      ],
      "rows": [
        {
          "name": "Orihon",
          "note": "heatLayer, WASM worker",
          "bad": [],
          "self": true,
          "Load": [
            "183 ms",
            "299 ms"
          ],
          "FPS": [
            "58",
            "57.7"
          ],
          "p95": [
            "16.8 ms",
            "16.8 ms"
          ],
          "drop%": [
            "2%",
            "2%"
          ],
          "Longest task": [
            "none",
            "none"
          ],
          "Heap": [
            "6.5 MB",
            "36.2 MB"
          ]
        },
        {
          "name": "Leaflet",
          "note": "native radius + blur",
          "bad": [
            "FPS",
            "p95",
            "drop%"
          ],
          "Load": [
            "83.4 ms",
            "317 ms"
          ],
          "FPS": [
            "28.1",
            "6.4"
          ],
          "p95": [
            "50.1 ms",
            "200 ms"
          ],
          "drop%": [
            "87%",
            "100%"
          ],
          "Longest task": [
            "156 ms",
            "337 ms"
          ],
          "Heap": [
            "26.5 MB",
            "71.8 MB"
          ]
        },
        {
          "name": "OpenLayers",
          "note": "native radius + blur",
          "bad": [
            "FPS",
            "p95",
            "drop%"
          ],
          "Load": [
            "471 ms",
            "4.1 s"
          ],
          "FPS": [
            "31",
            "4.3"
          ],
          "p95": [
            "50.1 ms",
            "567 ms"
          ],
          "drop%": [
            "70%",
            "100%"
          ],
          "Longest task": [
            "174 ms",
            "2.1 s"
          ],
          "Heap": [
            "315.6 MB",
            "2.09 GB"
          ]
        },
        {
          "name": "MapLibre",
          "note": "equivalent 21px kernel",
          "bad": [
            "drop%"
          ],
          "Load": [
            "778 ms",
            "12.8 s"
          ],
          "FPS": [
            "58",
            "22"
          ],
          "p95": [
            "16.9 ms",
            "100 ms"
          ],
          "drop%": [
            "3%",
            "55%"
          ],
          "Longest task": [
            "69.0 ms",
            "1.9 s"
          ],
          "Heap": [
            "58.5 MB",
            "283.0 MB"
          ]
        }
      ],
      "verdict": "At a million weighted points Orihon builds the field in 299 ms where MapLibre needs 12.8 s, and then holds 58 FPS to its 22 while dropping 2% of frames against 55%. Leaflet builds a small field faster than anyone — 83 ms against 183 — because it paints blobs where Orihon builds a density field, but it drops 87% of its frames doing it, and at a million it manages 6.4 FPS. OpenLayers asks 2.09 GB to reach 4.3. Orihon is the only one of the four that never blocks the main thread for a frame's worth of time at either size."
    },
    {
      "key": "geojson",
      "label": "GeoJSON lines",
      "unit": "LineString features",
      "note": "N LineString features of four vertices each, parsed, styled and drawn.",
      "columns": [
        [
          "Load",
          "Load"
        ],
        [
          "FPS",
          "FPS"
        ],
        [
          "p95 frame",
          "p95"
        ],
        [
          "Dropped",
          "drop%"
        ],
        [
          "Worst block",
          "Longest task"
        ],
        [
          "Heap added",
          "Heap"
        ]
      ],
      "rows": [
        {
          "name": "Orihon",
          "note": "packed WebGL paths",
          "bad": [],
          "self": true,
          "Load": [
            "82.3 ms",
            "734 ms"
          ],
          "FPS": [
            "60",
            "60"
          ],
          "p95": [
            "16.8 ms",
            "16.8 ms"
          ],
          "drop%": [
            "0%",
            "0%"
          ],
          "Longest task": [
            "none",
            "none"
          ],
          "Heap": [
            "33.5 MB",
            "63.3 MB"
          ]
        },
        {
          "name": "Leaflet",
          "note": "GeoJSON layer",
          "bad": [
            "FPS",
            "p95",
            "drop%"
          ],
          "Load": [
            "711 ms",
            "13.9 s"
          ],
          "FPS": [
            "4.5",
            "0.1"
          ],
          "p95": [
            "483 ms",
            "9.5 s"
          ],
          "drop%": [
            "100%",
            "100%"
          ],
          "Longest task": [
            "206 ms",
            "9.9 s"
          ],
          "Heap": [
            "121.1 MB",
            "2.77 GB"
          ]
        },
        {
          "name": "OpenLayers",
          "note": "GeoJSON layer",
          "bad": [
            "FPS",
            "p95",
            "drop%"
          ],
          "Load": [
            "692 ms",
            "6.3 s"
          ],
          "FPS": [
            "6.3",
            "1.6"
          ],
          "p95": [
            "317 ms",
            "1.2 s"
          ],
          "drop%": [
            "79%",
            "50%"
          ],
          "Longest task": [
            "236 ms",
            "6.2 s"
          ],
          "Heap": [
            "118.4 MB",
            "2.20 GB"
          ]
        },
        {
          "name": "MapLibre",
          "note": "line layer",
          "bad": [
            "drop%"
          ],
          "Load": [
            "715 ms",
            "10.2 s"
          ],
          "FPS": [
            "60",
            "44.2"
          ],
          "p95": [
            "16.8 ms",
            "33.5 ms"
          ],
          "drop%": [
            "0%",
            "29%"
          ],
          "Longest task": [
            "100 ms",
            "1.4 s"
          ],
          "Heap": [
            "44.1 MB",
            "258.8 MB"
          ]
        }
      ],
      "verdict": "At 50 000 features three engines load in about 700 ms and Orihon in 82, more than eight times faster; Leaflet and OpenLayers then run at 4.5 and 6.3 FPS while Orihon and MapLibre hold 60. At a million Orihon draws them in 734 ms at 60 FPS with no long task, on 63 MB — the draw buffer and nothing else. MapLibre takes 10.2 s to get there and then runs at 44 on 259 MB, blocking for 1.4 s at worst. Leaflet and OpenLayers finish in 13.9 and 6.3 s and then paint at 0.1 and 1.6 FPS on well over two gigabytes each."
    },
    {
      "key": "live",
      "label": "Live updates",
      "unit": "points",
      "note": "Every position rewritten into reused typed arrays each frame for ~3s, then uploaded once.",
      "columns": [
        [
          "FPS",
          "FPS"
        ],
        [
          "p95 frame",
          "p95"
        ],
        [
          "Worst frame",
          "max"
        ],
        [
          "Dropped",
          "drop%"
        ],
        [
          "Worst block",
          "Longest task"
        ],
        [
          "Heap added",
          "Heap"
        ]
      ],
      "rows": [
        {
          "name": "Orihon",
          "note": "WebGL",
          "bad": [],
          "self": true,
          "FPS": [
            "60",
            "59"
          ],
          "p95": [
            "16.8 ms",
            "16.8 ms"
          ],
          "max": [
            "16.8 ms",
            "50.0 ms"
          ],
          "drop%": [
            "0%",
            "1%"
          ],
          "Longest task": [
            "none",
            "none"
          ],
          "Heap": [
            "3.6 MB",
            "65.2 MB"
          ]
        },
        {
          "name": "Leaflet",
          "note": "canvas",
          "bad": [
            "FPS",
            "p95",
            "drop%"
          ],
          "FPS": [
            "34",
            "1.8"
          ],
          "p95": [
            "33.4 ms",
            "733 ms"
          ],
          "max": [
            "49.9 ms",
            "733 ms"
          ],
          "drop%": [
            "75%",
            "100%"
          ],
          "Longest task": [
            "none",
            "732 ms"
          ],
          "Heap": [
            "32.2 MB",
            "625.3 MB"
          ]
        },
        {
          "name": "OpenLayers",
          "note": "WebGL points",
          "bad": [
            "FPS",
            "p95",
            "drop%"
          ],
          "FPS": [
            "25.1",
            "0.8"
          ],
          "p95": [
            "50.1 ms",
            "1.3 s"
          ],
          "max": [
            "50.1 ms",
            "1.3 s"
          ],
          "drop%": [
            "100%",
            "100%"
          ],
          "Longest task": [
            "76.0 ms",
            "1.8 s"
          ],
          "Heap": [
            "83.9 MB",
            "1.62 GB"
          ]
        },
        {
          "name": "MapLibre",
          "note": "raw GL layer",
          "bad": [
            "drop%"
          ],
          "FPS": [
            "60",
            "34.1"
          ],
          "p95": [
            "16.8 ms",
            "33.4 ms"
          ],
          "max": [
            "16.8 ms",
            "66.7 ms"
          ],
          "drop%": [
            "0%",
            "73%"
          ],
          "Longest task": [
            "none",
            "none"
          ],
          "Heap": [
            "3.5 MB",
            "53.0 MB"
          ]
        }
      ],
      "verdict": "A million points moving every frame used to be past every engine here. It no longer is: Orihon holds 59 FPS with 1% dropped and never blocks the main thread, because the position update is two stores per point and the projection happens on the GPU. MapLibre, which projects on the CPU, reaches 34 and drops 73%. The canvas renderers manage 1.8 and 0.8 FPS with single blocks of 0.7 and 1.8 s. At 50 000 Orihon and MapLibre both hold 60."
    },
    {
      "key": "pick",
      "label": "Hit-testing",
      "unit": "points",
      "note": "Screen-space nearest-feature queries against the whole set, timed per query.",
      "columns": [
        [
          "Load",
          "Load"
        ],
        [
          "Pick p50",
          "Pick p50"
        ],
        [
          "Pick p95",
          "Pick p95"
        ],
        [
          "Worst block",
          "Longest task"
        ],
        [
          "Heap added",
          "Heap"
        ]
      ],
      "rows": [
        {
          "name": "Orihon",
          "note": "project scan",
          "bad": [],
          "self": true,
          "Load": [
            "49.5 ms",
            "82.9 ms"
          ],
          "Pick p50": [
            "4.4 ms",
            "89.4 ms"
          ],
          "Pick p95": [
            "4.7 ms",
            "95.5 ms"
          ],
          "Longest task": [
            "none",
            "111 ms"
          ],
          "Heap": [
            "1.2 MB",
            "16.5 MB"
          ]
        },
        {
          "name": "Leaflet",
          "note": "project scan",
          "bad": [],
          "Load": [
            "100 ms",
            "14.1 s"
          ],
          "Pick p50": [
            "5.6 ms",
            "113 ms"
          ],
          "Pick p95": [
            "6.0 ms",
            "115 ms"
          ],
          "Longest task": [
            "none",
            "499 ms"
          ],
          "Heap": [
            "32.1 MB",
            "621.4 MB"
          ]
        },
        {
          "name": "OpenLayers",
          "note": "project scan",
          "bad": [],
          "Load": [
            "433 ms",
            "2.6 s"
          ],
          "Pick p50": [
            "4.6 ms",
            "99.8 ms"
          ],
          "Pick p95": [
            "4.9 ms",
            "106 ms"
          ],
          "Longest task": [
            "65.0 ms",
            "1.2 s"
          ],
          "Heap": [
            "82.2 MB",
            "1.58 GB"
          ]
        },
        {
          "name": "MapLibre",
          "note": "project scan",
          "bad": [],
          "Load": [
            "415 ms",
            "9.1 s"
          ],
          "Pick p50": [
            "4.1 ms",
            "83.6 ms"
          ],
          "Pick p95": [
            "4.4 ms",
            "87.4 ms"
          ],
          "Longest task": [
            "58.0 ms",
            "1.5 s"
          ],
          "Heap": [
            "11.9 MB",
            "213.7 MB"
          ]
        }
      ],
      "verdict": "The query is the same screen-space scan everywhere, so at a million the four land within 30 ms of each other: 84 for MapLibre, 89 for Orihon, 100 for OpenLayers, 113 for Leaflet. Getting the data on screen to be scanned is the whole difference — 83 ms for Orihon against 2.6 s for OpenLayers, 9.1 s for MapLibre and 14.1 s for Leaflet — on 16.5 MB where Leaflet takes 621."
    }
  ]
};

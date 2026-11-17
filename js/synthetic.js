/* CREAMINO_SYNTHETIC_DEMO_V1 – programmatic, seeded generator.
   SYNTHETIC DEMONSTRATION DATA — NOT EXPERIMENTALLY VALIDATED.
   Fully separate from the experimental Terrain 1 file (N = 56); no values are copied from it. */
(function (root) {
  'use strict';
  var CR = root.CR || (root.CR = {});

  var SPEC = {
    id: 'CREAMINO_SYNTHETIC_DEMO_V1',
    version: '1.0.0',
    seed: 20261117,
    field: { name: 'Demo Pitch A (synthetic)', width: 100, height: 64, unit: 'm' },
    points: [
      { id: 'C1', x: 15, y: 12 }, { id: 'C2', x: 85, y: 12 },
      { id: 'C3', x: 15, y: 52 }, { id: 'C4', x: 85, y: 52 },
      { id: 'V1', x: 35, y: 32 }, { id: 'V2', x: 50, y: 32 }, { id: 'V3', x: 65, y: 32 }
    ],
    sessions: [
      { id: 'S1', label: 'Demo day 1 · morning', scenario: 'Standard irrigation, morning', vwcBase: 24.0, tempEffect: 0 },
      { id: 'S2', label: 'Demo day 1 · afternoon', scenario: 'Same day, afternoon drying', vwcBase: 21.5, tempEffect: 3 },
      { id: 'S3', label: 'Demo day 2 · morning', scenario: 'Modified irrigation (wetter)', vwcBase: 27.0, tempEffect: -1 },
      { id: 'S4', label: 'Demo day 3 · afternoon', scenario: 'Hot afternoon', vwcBase: 18.5, tempEffect: 6 },
      { id: 'S5', label: 'Demo day 4 · morning', scenario: 'No irrigation for 24 h (dry)', vwcBase: 14.0, tempEffect: 4 },
      { id: 'S6', label: 'Demo day 5 · morning', scenario: 'Extended irrigation (wet)', vwcBase: 33.0, tempEffect: -2 },
      { id: 'S7', label: 'Demo day 6 · morning', scenario: 'Standard conditions (repeat)', vwcBase: 24.0, tempEffect: 0 },
      { id: 'S8', label: 'Demo day 7 · morning', scenario: 'Standard conditions', vwcBase: 23.5, tempEffect: 1 }
    ],
    ranges: { vwc: [10, 40], gmax: [40, 160] },
    rules: [
      'Random numbers: mulberry32 PRNG, seed 20261117; normal deviates by Box–Muller.',
      'Latent moisture = session base + wet low corner (+4 % vol, Gaussian, σ = 20 m, centre 10/58 m) − worn centre (−3 % vol, σ = 15 m, centre 50/32 m) + noise N(0, 1.0).',
      'Latent hardness Gmax = 80 + 2.2·(23 − moisture) + centre compaction (+18 G, σ = 14 m) + session temperature effect + noise N(0, 4).',
      'Values are clipped to the demo ranges VWC 10–40 % vol and Gmax 40–160 G.',
      'Reference "instruments": TDR = latent moisture + N(0, 0.5); Clegg = latent hardness + N(0, 2.5).',
      'Synthetic CSI features: F1 = −40 − 0.55·moisture + session drift N(0, 0.6) + N(0, 0.8) dB; F4 = −0.05 − 0.008·moisture + N(0, 0.02); F7 = 0.20 + 0.004·(Gmax − 80) + N(0, 0.03).',
      'No target accuracy was set and no values were adjusted after generation. Predictions are produced in the app by fitting models to F1/F4/F7.'
    ]
  };

  function clip(v, r) { return Math.min(r[1], Math.max(r[0], v)); }
  function gauss2(x, y, cx, cy, s) { return Math.exp(-((x - cx) * (x - cx) + (y - cy) * (y - cy)) / (2 * s * s)); }

  function generate() {
    var rand = CR.rng.mulberry32(SPEC.seed), N = CR.rng.normalFrom(rand);
    var rows = [];
    SPEC.sessions.forEach(function (s) {
      var drift = N(0, 0.6);
      SPEC.points.forEach(function (p) {
        var m = s.vwcBase + 4 * gauss2(p.x, p.y, 10, 58, 20) - 3 * gauss2(p.x, p.y, 50, 32, 15) + N(0, 1.0);
        m = clip(m, SPEC.ranges.vwc);
        var g = 80 + 2.2 * (23 - m) + 18 * gauss2(p.x, p.y, 50, 32, 14) + s.tempEffect + N(0, 4);
        g = clip(g, SPEC.ranges.gmax);
        var vwcRef = clip(m + N(0, 0.5), SPEC.ranges.vwc);
        var gRef = clip(g + N(0, 2.5), SPEC.ranges.gmax);
        rows.push({
          obs_id: s.id + '-' + p.id, session: s.id, point: p.id, x: p.x, y: p.y,
          vwc_ref: round(vwcRef, 1), gmax_ref: round(gRef, 1),
          f1: round(-40 - 0.55 * m + drift + N(0, 0.8), 2),
          f4: round(-0.05 - 0.008 * m + N(0, 0.02), 3),
          f7: round(0.20 + 0.004 * (g - 80) + N(0, 0.03), 3)
        });
      });
    });
    return rows;
  }
  function round(v, d) { var f = Math.pow(10, d); return Math.round(v * f) / f; }

  function dataset() {
    return {
      id: SPEC.id, version: SPEC.version, created: '2026-11-17',
      status: 'SYNTHETIC DEMO', locked: true,
      source: 'Generated programmatically in the browser by js/synthetic.js (seed ' + SPEC.seed + ')',
      method: 'Seeded simulation – see generation rules',
      dataType: 'Synthetic', field: SPEC.field, sessions: SPEC.sessions, points: SPEC.points,
      units: { vwc_ref: '% vol', gmax_ref: 'G (Clegg gravities)', x: 'm', y: 'm', f1: 'dB', f4: 'slope (unitless)', f7: 'index (unitless)' },
      limitations: 'Synthetic data for software demonstration only. Not measurements, not experimentally validated, coordinates are not those of any real pitch.',
      rules: SPEC.rules,
      rows: generate()
    };
  }

  CR.synthetic = { SPEC: SPEC, generate: generate, dataset: dataset };
  if (typeof module !== 'undefined' && module.exports) module.exports = CR;
})(typeof window !== 'undefined' ? window : globalThis);

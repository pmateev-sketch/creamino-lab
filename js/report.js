/* Creamino Software Demo – PDF technical report (jsPDF, A4 portrait). */
(function (root) {
  'use strict';
  var CR = root.CR || (root.CR = {});
  var NAVY = [30, 42, 56], CYAN = [105, 208, 230], MUTED = [95, 107, 120], RED = [180, 35, 24], LINE = [227, 231, 236];

  /* standard PDF fonts cover WinAnsi only – map the few symbols we use */
  function t(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/²/g, '^2').replace(/σ/g, 'sigma').replace(/±/g, '+/-').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/√/g, 'sqrt').replace(/Σ/g, 'sum ').replace(/ŷ/g, 'y_hat')
      .replace(/ẑ/g, 'z_hat').replace(/wᵢ/g, 'w_i').replace(/zᵢ/g, 'z_i').replace(/dᵢ/g, 'd_i').replace(/ᵖ/g, '^p').replace(/−/g, '-')
      .replace(/→/g, '->').replace(/Ω/g, 'Omega').replace(/[^\x00-\xFF–—‘’“”•…€]/g, '?');
  }
  function f(v, d) { return CR.fmt(v, d); }

  function generate(c) {
    var doc = new c.jsPDF({ unit: 'mm', format: 'a4' }), W = 210, H = 297, M = 16, y = 0, page = 0;
    var syn = c.ds.status === 'SYNTHETIC DEMO';
    var gen = new Date(), genStr = gen.toISOString().slice(0, 10) + ' ' + gen.toISOString().slice(11, 16) + ' UTC';

    function header() {
      page++;
      doc.setFillColor.apply(doc, NAVY); doc.rect(0, 0, W, 16, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('POINT SURFACE', M, 10);
      doc.setTextColor.apply(doc, CYAN); doc.text('CREAMINO', M + 33, 10);
      doc.setTextColor(200, 214, 224); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text('Technical surface report · Software demo v1.0', W - M, 10, { align: 'right' });
      if (syn) {
        doc.setFillColor(253, 236, 236); doc.rect(0, 16, W, 7, 'F');
        doc.setTextColor.apply(doc, RED); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
        doc.text('SYNTHETIC DEMONSTRATION DATA - NOT EXPERIMENTALLY VALIDATED', W / 2, 20.8, { align: 'center' });
      } else {
        doc.setFillColor(255, 247, 230); doc.rect(0, 16, W, 7, 'F');
        doc.setTextColor(122, 74, 6); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
        doc.text(t('DATASET STATUS: ' + c.ds.status), W / 2, 20.8, { align: 'center' });
      }
      doc.setTextColor.apply(doc, MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(t(c.ds.id + ' v' + (c.ds.version || '1') + ' · generated ' + genStr), M, H - 8);
      doc.text('Page ' + page, W - M, H - 8, { align: 'right' });
      y = 32;
    }
    function need(hgt) { if (y + hgt > H - 16) { doc.addPage(); header(); } }
    function h1(s) { need(14); doc.setTextColor.apply(doc, NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(t(s), M, y); doc.setDrawColor.apply(doc, CYAN); doc.setLineWidth(0.8); doc.line(M, y + 2, M + 18, y + 2); y += 9; }
    function para(s, size, color) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size || 9.5); doc.setTextColor.apply(doc, color || NAVY);
      var lines = doc.splitTextToSize(t(s), W - 2 * M);
      lines.forEach(function (ln) { need(5); doc.text(ln, M, y); y += (size || 9.5) * 0.45; });
      y += 2;
    }
    function table(cols, rows, opt) {
      opt = opt || {};
      var widths = cols.map(function (cc) { return cc.w; }), total = widths.reduce(function (a, b) { return a + b; }, 0), scale = (W - 2 * M) / total;
      widths = widths.map(function (w) { return w * scale; });
      var rh = opt.rh || 5.6;
      function head() {
        need(rh + 2); doc.setFillColor(241, 244, 247); doc.rect(M, y - 4, W - 2 * M, rh, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(opt.fs || 8); doc.setTextColor.apply(doc, NAVY);
        var x = M; cols.forEach(function (cc, i) { doc.text(t(cc.label), cc.left ? x + 1.5 : x + widths[i] - 1.5, y, { align: cc.left ? 'left' : 'right' }); x += widths[i]; });
        y += rh;
      }
      head();
      doc.setFont('helvetica', 'normal');
      rows.forEach(function (r, k) {
        if (y + rh > H - 16) { doc.addPage(); header(); head(); doc.setFont('helvetica', 'normal'); }
        if (k % 2) { doc.setFillColor(250, 251, 252); doc.rect(M, y - 4, W - 2 * M, rh, 'F'); }
        doc.setFontSize(opt.fs || 8); doc.setTextColor.apply(doc, NAVY);
        var x = M; cols.forEach(function (cc, i) { doc.text(t(r[i]), cc.left ? x + 1.5 : x + widths[i] - 1.5, y, { align: cc.left ? 'left' : 'right' }); x += widths[i]; });
        doc.setDrawColor.apply(doc, LINE); doc.setLineWidth(0.15); doc.line(M, y + 1.6, W - M, y + 1.6);
        y += rh;
      });
      y += 3;
    }
    function image(img, wmm) {
      var hmm = wmm * img.h / img.w; need(hmm + 4);
      doc.addImage(img.data, img.data.indexOf('image/png') > 0 ? 'PNG' : 'JPEG', M + (W - 2 * M - wmm) / 2, y, wmm, hmm); y += hmm + 4;
    }

    /* ---- page 1: title + summary ---- */
    header();
    doc.setTextColor.apply(doc, NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text(t(c.fieldName), M, y + 4); y += 11;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor.apply(doc, MUTED); doc.text(t('Surface condition report · ' + c.sessionLabel), M, y); y += 9;
    var vw = c.rows.map(function (r) { return r.vwc_ref; }), gm = c.rows.map(function (r) { return r.gmax_ref; }), S = CR.stats;
    var dev = c.rows.filter(function (r) { return r.srs > 0.35; }).length;
    h1('1  Summary');
    table([{ label: 'Item', w: 60, left: true }, { label: 'Value', w: 120, left: true }], [
      ['Field', c.fieldName + ' (' + c.field.width + ' x ' + c.field.height + ' m, demo coordinates)'],
      ['Session', c.sessionLabel],
      ['Report generated', genStr],
      ['Dataset', c.ds.id + ' · version ' + (c.ds.version || '1')],
      ['Dataset status', c.ds.status],
      ['Data type / source', (c.ds.dataType || '') + ' · ' + (c.ds.source || '')]
    ]);
    table([{ label: 'Indicator', w: 70, left: true }, { label: 'Value', w: 40 }, { label: 'Min', w: 35 }, { label: 'Max', w: 35 }], [
      ['Observations', String(c.rows.length), '', ''],
      ['VWC, reference (% vol)', f(S.mean(vw), 1), f(S.min(vw), 1), f(S.max(vw), 1)],
      ['Gmax, reference (G)', f(S.mean(gm), 1), f(S.min(gm), 1), f(S.max(gm), 1)],
      ['Observations with SRS > 0.35', String(dev), '', ''],
      ['Mean SRS', f(S.mean(c.rows.map(function (r) { return r.srs; })), 3), f(S.min(c.rows.map(function (r) { return r.srs; })), 3), f(S.max(c.rows.map(function (r) { return r.srs; })), 3)]
    ]);
    if (syn) para('All values in this report come from the synthetic dataset ' + c.ds.id + ', generated programmatically with a fixed random seed for software demonstration. They are not measurements and do not show the accuracy of Creamino on any real surface.', 9, RED);

    /* ---- measurements ---- */
    h1('2  Measurements');
    table([{ label: 'Obs.', w: 22, left: true }, { label: 'Point', w: 14, left: true }, { label: 'X m', w: 13 }, { label: 'Y m', w: 13 }, { label: 'VWC ref', w: 18 }, { label: 'VWC pred', w: 19 }, { label: 'Gmax ref', w: 19 }, { label: 'Gmax pred', w: 20 }, { label: 'SRS', w: 15 }, { label: 'Class', w: 14 }],
      c.rows.map(function (r) { return [r.obs_id, r.point, f(r.x, 1), f(r.y, 1), f(r.vwc_ref, 1), f(r.vwc_pred, 2), f(r.gmax_ref, 1), f(r.gmax_pred, 1), f(r.srs, 3), 'SRS-' + r.cls]; }), { fs: 7.5, rh: 5 });
    para('Units: VWC in % vol (TDR reference); Gmax in G (Clegg reference). Predicted values are out-of-sample Leave-One-Session-Out predictions.', 8, MUTED);

    /* ---- model performance ---- */
    doc.addPage(); header();
    h1('3  Model performance (Leave-One-Session-Out)');
    if (!c.hasFeatures) para('The dataset has no CSI features; no model performance can be reported.');
    else {
      table([{ label: 'Variable', w: 40, left: true }, { label: 'N', w: 14 }, { label: 'RMSE', w: 24 }, { label: 'MAE', w: 24 }, { label: 'R^2', w: 20 }, { label: 'Bias', w: 22 }, { label: 'Pearson r', w: 22 }], [
        ['VWC (% vol)', String(c.metV.n), f(c.metV.rmse, 2), f(c.metV.mae, 2), f(c.metV.r2, 3), f(c.metV.bias, 2), f(c.metV.r, 3)],
        ['Gmax (G)', String(c.metG.n), f(c.metG.rmse, 2), f(c.metG.mae, 2), f(c.metG.r2, 3), f(c.metG.bias, 2), f(c.metG.r, 3)]
      ]);
      if (!c.metV.ok) para('Fewer than 5 paired observations in the selected session: metrics are not meaningful and are shown as dashes.', 8.5, RED);
      para('Model: linear regression on synthetic CSI features F1, F4 and F7, standardization fitted on the training sessions only. Each session is predicted by a model that never saw it.' + (syn ? ' Results come from SYNTHETIC DEMONSTRATION DATA.' : ''), 8.5, MUTED);
      image(c.imgV, 120); image(c.imgG, 120);
    }

    /* ---- spatial ---- */
    doc.addPage(); header();
    h1('4  Spatial map');
    para('Layer: ' + c.map.layer.name + (c.map.layer.unit ? ' (' + c.map.layer.unit + ')' : '') + ' · Inverse Distance Weighting, p = 2, 1 x 1 m cells, coverage radius 35 m. ' + (c.session === 'ALL' ? 'Values per point are means over all sessions.' : ''), 9);
    image({ data: c.map.data, w: c.map.w, h: c.map.h }, W - 2 * M);
    /* legend */
    need(12);
    var lx = M, lw = 60;
    for (var i = 0; i < 60; i++) { var col = c.map.ramp(i / 59, c.map.layer.kind).match(/\d+/g).map(Number); doc.setFillColor(col[0], col[1], col[2]); doc.rect(lx + i * lw / 60, y, lw / 60 + 0.2, 4, 'F'); }
    doc.setFontSize(8); doc.setTextColor.apply(doc, MUTED);
    doc.text(f(c.map.vmin, c.map.layer.d), lx, y + 8); doc.text(f(c.map.vmax, c.map.layer.d) + ' ' + c.map.layer.unit, lx + lw, y + 8, { align: 'right' });
    doc.text(t('White circles = measured input points · coloured cells = interpolated values · hatched = not covered.'), lx + lw + 6, y + 3);
    y += 13;
    para('DEMONSTRATION INTERPOLATION - SYNTHETIC COORDINATES. Interpolated cells are estimates between input points, not measurements.', 8.5, syn ? RED : MUTED);

    /* ---- SRS ---- */
    h1('5  Surface Risk Score');
    var D = c.srsDef, cnt = { L: 0, M: 0, H: 0 }; c.rows.forEach(function (r) { cnt[r.cls]++; });
    para('SRS = 0.4 · Moist_dev + 0.6 · Hard_dev; Moist_dev = |VWC - 23| / 23; Hard_dev = |Gmax - 80| / 80 (VWC_opt = ' + D.vwcOpt + ' % vol, G_opt = ' + D.gOpt + ' G). Classes: SRS-L <= 0.35 < SRS-M <= 0.65 < SRS-H.', 9);
    table([{ label: 'Class', w: 50, left: true }, { label: 'Range', w: 60, left: true }, { label: 'Observations', w: 40 }], [
      ['SRS-L · low deviation', 'SRS <= 0.35', String(cnt.L)], ['SRS-M · medium deviation', '0.35 < SRS <= 0.65', String(cnt.M)], ['SRS-H · high deviation', 'SRS > 0.65', String(cnt.H)]]);
    var top = c.rows.slice().sort(function (a, b) { return b.srs - a.srs; }).slice(0, 10);
    table([{ label: 'Highest SRS', w: 30, left: true }, { label: 'VWC', w: 20 }, { label: 'Gmax', w: 20 }, { label: 'Moist_dev', w: 24 }, { label: 'Hard_dev', w: 24 }, { label: 'SRS', w: 20 }, { label: 'Class', w: 18 }],
      top.map(function (r) { return [r.obs_id, f(r.vwc_ref, 1), f(r.gmax_ref, 1), f(r.moist_dev, 3), f(r.hard_dev, 3), f(r.srs, 3), 'SRS-' + r.cls]; }));
    para('SRS is an analytical surface deviation indicator. It is not a medical, clinical, injury prediction or sports-surface certification index.', 8.5, RED);

    /* ---- methodology ---- */
    doc.addPage(); header();
    h1('6  Methodology');
    para('Metrics. RMSE = sqrt(mean((y - y_hat)^2)); MAE = mean(|y - y_hat|); R² = 1 - SSE/SST; bias = mean(y_hat - y); Pearson r between reference and prediction. y = reference value, y_hat = prediction.');
    para('Validation. Leave-One-Session-Out (LOSO): for each session, the model is trained on all other sessions and tested on the held-out session only. Feature standardization is fitted on the training part of every fold. Random K-fold and grouped cross-validation are available in the Validation Lab of the software.');
    para('Spatial interpolation. Inverse Distance Weighting: z_hat(x) = sum(w_i z_i) / sum(w_i), w_i = 1 / d_i^p. Cells farther than the coverage radius from the nearest input point are not estimated. SRS maps are computed per cell from the interpolated VWC and Gmax.');
    if (c.ds.rules) { para('Synthetic data generation (' + c.ds.id + '):', 9.5); c.ds.rules.forEach(function (r) { para('• ' + r, 8.5, MUTED); }); }

    /* ---- limitations + provenance ---- */
    h1('7  Limitations and data provenance');
    [
      syn ? 'The dataset is synthetic. No result in this report is a measurement or evidence of the accuracy of Creamino.' : 'The dataset status is "' + c.ds.status + '". Validation of the values is the responsibility of the data provider.',
      'Wi-Fi CSI features are inputs to a statistical model, not direct measurements of moisture or hardness.',
      'Interpolated values are estimates between input points; uncovered areas are not estimated.',
      'With few observations per session, per-session metrics are unstable.',
      'The report does not certify a sports surface and makes no claim about injury prevention.'
    ].forEach(function (s) { para('• ' + s, 9); });
    if (c.log && c.log.length) {
      table([{ label: 'Time', w: 38, left: true }, { label: 'Action', w: 26, left: true }, { label: 'Status', w: 50, left: true }, { label: 'Record', w: 66, left: true }],
        c.log.map(function (l) { return [l.time, l.action, (l.from ? l.from + ' -> ' : '') + l.to, String(l.reason).slice(0, 60)]; }), { fs: 7.5 });
    }

    var name = 'Creamino_report_' + c.ds.id + '_' + (c.session === 'ALL' ? 'all' : c.session) + '_' + gen.toISOString().slice(0, 10) + '.pdf';
    return { name: name, blob: doc.output('blob'), pages: page };
  }

  CR.report = { generate: generate, sanitize: t };
})(typeof window !== 'undefined' ? window : globalThis);

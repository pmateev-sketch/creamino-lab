// Writes the synthetic demo dataset to data/ (same generator and seed as the app).
const fs = require('fs'); const path = require('path');
const CR = require('../js/core.js'); require('../js/synthetic.js');
const ds = CR.synthetic.dataset(); const out = path.join(__dirname, '..', 'data');
const cols = ['obs_id','session','point','x','y','vwc_ref','gmax_ref','f1','f4','f7'].map(k => ({ key: k }));
fs.writeFileSync(path.join(out, 'CREAMINO_SYNTHETIC_DEMO_V1.csv'),
  '# CREAMINO_SYNTHETIC_DEMO_V1 v1.0.0 · seed ' + CR.synthetic.SPEC.seed + ' · SYNTHETIC DEMONSTRATION DATA — NOT EXPERIMENTALLY VALIDATED\n' + CR.csv.toCSV(ds.rows, cols) + '\n');
fs.writeFileSync(path.join(out, 'CREAMINO_SYNTHETIC_DEMO_V1.json'), JSON.stringify(ds, null, 2) + '\n');
console.log('wrote', ds.rows.length, 'rows');

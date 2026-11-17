const CR = require('../js/core.js'); require('../js/synthetic.js');
const assert = require('assert'); let pass=0; const t=(n,f)=>{f();pass++;console.log('ok -',n)};
const ds = CR.synthetic.dataset(); const rows = ds.rows;
t('56 synthetic rows, 8 sessions x 7 points', ()=>{assert.equal(rows.length,56);assert.equal(new Set(rows.map(r=>r.session)).size,8);assert.equal(new Set(rows.map(r=>r.point)).size,7)});
t('reproducible with fixed seed', ()=>{assert.deepStrictEqual(CR.synthetic.generate(), rows)});
t('within demo ranges', ()=>{rows.forEach(r=>{assert(r.vwc_ref>=10&&r.vwc_ref<=40);assert(r.gmax_ref>=40&&r.gmax_ref<=160)})});
t('metrics formulas match hand calculation', ()=>{const m=CR.stats.metrics([1,2,3,4,5],[1.5,2,2.5,4.5,5]);
 assert(Math.abs(m.rmse-Math.sqrt((0.25+0+0.25+0.25+0)/5))<1e-12); assert(Math.abs(m.mae-0.3)<1e-12);
 assert(Math.abs(m.r2-(1-0.75/10))<1e-12); assert(Math.abs(m.bias-0.1)<1e-12);});
t('OLS recovers exact linear relation', ()=>{const X=[[1,2],[2,1],[3,5],[4,3],[5,8],[6,2]];const y=X.map(r=>3+2*r[0]-0.5*r[1]);
 const m=CR.models.fitOLS(X,y); assert(Math.abs(m.intercept-3)<1e-9); assert(Math.abs(m.coef[0]-2)<1e-9); assert(Math.abs(m.coef[1]+0.5)<1e-9);});
t('LOSO: test session never in training', ()=>{const g=rows.map(r=>r.session);const f=CR.validation.losoSplit(g);assert.equal(f.length,8);
 f.forEach(fo=>{const s=new Set(fo.test.map(i=>g[i]));assert.equal(s.size,1)})});
t('Grouped CV: no session split across folds', ()=>{const g=rows.map(r=>r.session);const f=CR.validation.groupedSplit(g,4,1);
 const where={};f.forEach((fo,k)=>fo.test.forEach(i=>{if(where[g[i]]!==undefined)assert.equal(where[g[i]],k);where[g[i]]=k}));assert.equal(f.length,4)});
t('K-fold covers every row once', ()=>{const f=CR.validation.kfoldSplit(56,5,1);const all=f.flatMap(x=>x.test).sort((a,b)=>a-b);assert.deepStrictEqual(all,[...Array(56).keys()])});
t('no leakage: LOSO fold model refit differs from full fit', ()=>{const res=CR.validation.validate(rows,{method:'loso',model:'ols3',target:'vwc_ref'});
 const full=CR.models.fitOLS(rows.map(r=>[r.f1,r.f4,r.f7]),rows.map(r=>r.vwc_ref));
 res.folds.forEach(fo=>assert.equal(fo.nTrain,49)); assert(res.folds.some(fo=>Math.abs(fo.intercept-full.intercept)>1e-6));
 // manual check of fold 1
 const g=rows.map(r=>r.session); const tr=rows.filter(r=>r.session!=='S1'); const m=CR.models.fitOLS(tr.map(r=>[r.f1,r.f4,r.f7]),tr.map(r=>r.vwc_ref));
 rows.forEach((r,i)=>{ if(r.session==='S1') assert(Math.abs(m.predict([r.f1,r.f4,r.f7])-res.pred[i])<1e-9)});});
t('SRS definition', ()=>{const s=CR.srs.compute(23,80);assert.equal(s.srs,0);const s2=CR.srs.compute(11.5,120);
 assert(Math.abs(s2.moistDev-0.5)<1e-12);assert(Math.abs(s2.hardDev-0.5)<1e-12);assert(Math.abs(s2.srs-0.5)<1e-12);assert.equal(s2.cls,'M');
 assert.equal(CR.srs.compute(23,108).cls,'L'); assert.equal(CR.srs.compute(23,80+0.65/0.6*80+1).cls,'H');});
t('IDW exact at points and bounded', ()=>{const pts=[{x:0,y:0,z:10},{x:10,y:0,z:20}];const c=CR.idw.at(pts,0,0,2,Infinity);assert.equal(c.z,10);
 const m=CR.idw.at(pts,5,0,2,Infinity);assert(Math.abs(m.z-15)<1e-12); const g=CR.idw.grid(pts,{width:10,height:4,res:1,power:2});assert.equal(g.cells.length,40);
 g.cells.forEach(c=>assert(c.z>=10&&c.z<=20));});
t('CSV round trip + validation', ()=>{const cols=['obs_id','session','point','x','y','vwc_ref','gmax_ref','f1','f4','f7'].map(k=>({key:k}));
 const csv=CR.csv.toCSV(rows,cols); const v=CR.csv.validateImport(CR.csv.parse(csv)); assert.equal(v.errors.length,0); assert.equal(v.rows.length,56);
 const bad=CR.csv.validateImport(CR.csv.parse('session,point,x,y,vwc_ref,gmax_ref\nS1,C1,1,1,abc,90\nS1,C2,1,1,95,90\nS1,C3,1,1,20,90'));
 assert.equal(bad.rows.length,1); assert.equal(bad.excluded,2);
 const miss=CR.csv.validateImport(CR.csv.parse('session,point,vwc_ref\nS1,C1,20')); assert(miss.errors.length>0);});
t('validation warns instead of inventing results', ()=>{const r=CR.validation.validate(rows.slice(0,6),{method:'loso',model:'ols3',target:'vwc_ref'});assert(r.warnings.length>0);assert(!r.pooled)});
for (const target of ['vwc_ref','gmax_ref']) for (const method of ['kfold','grouped','loso']) for (const model of ['ols3','ols1','mean']) {
 const r=CR.validation.validate(rows,{method,model,target,k:5,seed:7}); console.log(target,method.padEnd(8),model.padEnd(5),'R2',CR.fmt(r.pooled.r2,3),'RMSE',CR.fmt(r.pooled.rmse,2),'MAE',CR.fmt(r.pooled.mae,2));}
console.log(pass,'tests passed');
// data file in data/ equals the in-browser generator
const fs=require('fs'),path=require('path');
const file=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','CREAMINO_SYNTHETIC_DEMO_V1.json'),'utf8'));
require('assert').deepStrictEqual(file.rows, CR.synthetic.generate()); console.log('ok - data/ JSON identical to generator output');

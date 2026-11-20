/* Creamino™ – потребителски слой: сигнали, нови места, „спортувах тук“. Данните са в Supabase (ЕС). */
(function(){
const CFG=window.CREAMINO_SB||{};const map=window.CMAP;if(!map)return;
const KIND={hole:['Дупка / неравност','⚠️'],broken:['Счупен уред','🔧'],glass:['Стъкла / боклук','🧹'],dogs:['Агресивни кучета','🐕'],dark:['Няма осветление','💡'],flood:['Вода / кал','💧'],ice:['Лед','🧊'],traffic:['Опасно пресичане','🚗'],other:['Друго','❗']};
const PK={park:'Парк',court:'Площадка',fitness:'Фитнес на открито',path:'Алея / трасе',water:'Чешма',dog:'Парк за кучета',other:'Друго'};
const ACTV={run:'Бягане',walk:'Ходене',bike:'Колело',workout:'Фитнес',swim:'Плуване',ski:'Ски',ball:'Игра с топка',other:'Друго'};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const css=document.createElement('style');css.textContent=`
#cbtn{position:absolute;right:12px;bottom:28px;z-index:900;min-height:48px;padding:0 18px;border-radius:24px;border:0;background:#0b1a14;color:#fff;font:700 15px inherit;box-shadow:0 2px 8px #0005;cursor:pointer}
#cdlg{position:absolute;right:12px;bottom:84px;z-index:901;width:min(340px,calc(100% - 24px));max-height:calc(100% - 100px);overflow:auto;background:#fff;border-radius:14px;box-shadow:0 4px 20px #0004;padding:14px;display:none;font-size:14px}
#cdlg h3{margin:0 0 8px;font-size:16px}#cdlg .row{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
#cdlg button.o{min-height:40px;padding:0 12px;border-radius:10px;border:1px solid #dfe7dc;background:#f4f7f2;font:inherit;cursor:pointer}
#cdlg button.o[aria-pressed=true]{background:#0b1a14;color:#fff}#cdlg .go{background:#138a45;color:#fff;border:0;min-height:44px;border-radius:10px;width:100%;font:700 15px inherit;margin-top:6px;cursor:pointer}
#cdlg small{color:#5b6b62;display:block;margin-top:6px}#cdlg textarea{width:100%;min-height:54px;border-radius:10px;border:1px solid #dfe7dc;font:15px inherit;padding:6px}
.rk{font-size:20px;line-height:1;filter:drop-shadow(0 1px 1px #0006)}`;document.head.appendChild(css);
const box=document.getElementById('map');box.style.position='relative';
const btn=document.createElement('button');btn.id='cbtn';btn.textContent='＋ Сигнал / място';box.appendChild(btn);
const dlg=document.createElement('div');dlg.id='cdlg';dlg.setAttribute('role','dialog');box.appendChild(dlg);
L.DomEvent.disableClickPropagation(btn);L.DomEvent.disableClickPropagation(dlg);L.DomEvent.disableScrollPropagation(dlg);
if(!CFG.url||!CFG.key){async function mod(){dlg.innerHTML='<h3>Модерация</h3>Зареждам…';
 const[p,r]=await Promise.all([sb.from('places').select('id,kind,name,note,lat,lon,created_at').eq('status','pending').order('created_at'),sb.from('reports').select('id,kind,note,lat,lon,created_at').eq('hidden',false).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(50)]);
 const P=p.data||[],R=r.data||[];const day=t=>new Date(t).toLocaleDateString('bg');
 dlg.innerHTML=`<h3>Модерация</h3><b>Нови места (${P.length})</b>${P.map(x=>`<div style="border-top:1px solid #eee;padding:6px 0"><b>${esc(x.name)}</b> <small style="display:inline">${PK[x.kind]||''} · ${day(x.created_at)}</small>${x.note?`<div>${esc(x.note)}</div>`:''}<div class="row"><button class="o" data-go="${x.lat},${x.lon}">Покажи</button><button class="o" data-ok="${x.id}">Одобри</button><button class="o" data-no="${x.id}">Откажи</button></div></div>`).join('')||'<small>Няма чакащи.</small>'}
 <b style="display:block;margin-top:8px">Активни сигнали (${R.length})</b>${R.map(x=>`<div style="border-top:1px solid #eee;padding:6px 0">${(KIND[x.kind]||KIND.other)[1]} ${(KIND[x.kind]||KIND.other)[0]} <small style="display:inline">${day(x.created_at)}</small>${x.note?`<div>${esc(x.note)}</div>`:''}<div class="row"><button class="o" data-go="${x.lat},${x.lon}">Покажи</button><button class="o" data-hide="${x.id}">Скрий</button></div></div>`).join('')||'<small>Няма активни.</small>'}<button class="o" id="cback" style="margin-top:8px;width:100%">Назад</button>`;
 dlg.querySelector('#cback').onclick=form;
 dlg.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{const[a,o]=b.dataset.go.split(',').map(Number);map.setView([a,o],17)});
 const act=(q,b)=>q.then(({error})=>{b.parentElement.outerHTML=`<small>${error?'Грешка: '+esc(error.message):'Готово.'}</small>`;if(!error)load()});
 dlg.querySelectorAll('[data-ok]').forEach(b=>b.onclick=()=>act(sb.from('places').update({status:'approved'}).eq('id',b.dataset.ok),b));
 dlg.querySelectorAll('[data-no]').forEach(b=>b.onclick=()=>act(sb.from('places').update({status:'rejected'}).eq('id',b.dataset.no),b));
 dlg.querySelectorAll('[data-hide]').forEach(b=>b.onclick=()=>act(sb.from('reports').update({hidden:true}).eq('id',b.dataset.hide),b))}
btn.onclick=()=>{dlg.style.display=dlg.style.display==='block'?'none':'block';dlg.innerHTML='<h3>Скоро</h3>Тук ще можете да отбелязвате опасности, да добавяте места за спорт и да споделяте къде спортувате.'};return}
let sb=null,user=null,admin=false,layer=L.layerGroup().addTo(map),heat=L.layerGroup(),st={};
import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').then(m=>{sb=m.createClient(CFG.url,CFG.key);
 const chk=()=>{admin=false;if(user)sb.rpc('is_admin').then(({data})=>{admin=!!data;if(dlg.style.display==='block')menu()})};sb.auth.getSession().then(({data})=>{user=data.session&&data.session.user;chk()});sb.auth.onAuthStateChange((_e,s)=>{const was=user&&user.id;user=s&&s.user;if((user&&user.id)!==was)chk();if(dlg.style.display==='block')menu()});load()}).catch(()=>{btn.disabled=true;btn.textContent='Няма връзка'});
function load(){sb.from('live_reports').select('*').then(({data})=>{layer.clearLayers();(data||[]).forEach(r=>{const k=KIND[r.kind]||KIND.other;
  L.marker([r.lat,r.lon],{icon:L.divIcon({className:'',html:`<span class="rk">${k[1]}</span>`,iconSize:[22,22]})}).bindPopup(()=>{const d=Math.max(0,Math.round((Date.now()-new Date(r.created_at))/864e5));
   const el=document.createElement('div');el.className='pop';el.innerHTML=`<h3>${k[1]} ${k[0]}</h3>${r.note?`<div>${esc(r.note)}</div>`:''}<div class="st">преди ${d?d+' дни':'по-малко от ден'} · потвърдили ${r.still} · няма го ${r.gone}</div><div class="row" style="display:flex;gap:6px;margin-top:6px"><button data-v="1" style="min-height:36px">Още е там</button><button data-v="0" style="min-height:36px">Няма го</button></div>`;
   el.querySelectorAll('button').forEach(b=>b.onclick=()=>vote(r.id,b.dataset.v==='1',el));return el}).addTo(layer)})});
 sb.from('approved_places').select('*').then(({data})=>{(data||[]).forEach(p=>L.circleMarker([p.lat,p.lon],{radius:7,color:'#fff',weight:2,fillColor:'#0b6fb8',fillOpacity:1}).bindPopup(`<div class="pop"><h3>${esc(p.name)}</h3><div class="st">${PK[p.kind]||''} · добавено от потребител</div>${p.note?`<div>${esc(p.note)}</div>`:''}</div>`).addTo(layer))});
 sb.from('activity_heat').select('*').then(({data})=>{heat.clearLayers();(data||[]).forEach(h=>L.circle([h.lat,h.lon],{radius:500,stroke:false,fillColor:'#e0703a',fillOpacity:Math.min(.6,.12+h.people*.04)}).bindPopup(`<div class="pop"><b>${ACTV[h.activity]||''}</b><div class="st">${h.people} души за 30 дни</div></div>`).addTo(heat))});}
window.CREAMINO_HEAT=on=>{on?heat.addTo(map):heat.remove()};
function vote(id,still,el){if(!user){el.querySelector('.row').outerHTML='<small>Влезте от „＋ Сигнал / място“, за да потвърдите.</small>';return}
 sb.from('report_votes').upsert({report_id:id,still_there:still},{onConflict:'report_id,user_id',ignoreDuplicates:false}).then(({error})=>{el.querySelector('.row').outerHTML=`<small>${error?'Не се записа: '+esc(error.message):'Благодарим!'}</small>`;if(!error)load()})}
function where(){return new Promise(res=>{if(st.here==='me'&&navigator.geolocation)navigator.geolocation.getCurrentPosition(p=>res([p.coords.latitude,p.coords.longitude]),()=>res(null),{enableHighAccuracy:true,timeout:10000});else{const c=map.getCenter();res([c.lat,c.lng])}})}
function opts(name,obj,cur){return `<div class="row">${Object.entries(obj).map(([k,v])=>`<button class="o" data-${name}="${k}" aria-pressed="${k===cur}">${Array.isArray(v)?v[1]+' '+v[0]:v}</button>`).join('')}</div>`}
function bind(){dlg.querySelectorAll('[data-t],[data-k],[data-here]').forEach(b=>b.onclick=()=>{if(b.dataset.t&&b.dataset.t!==st.t)st.k=undefined;Object.assign(st,{...b.dataset});form()})}
function menu(){if(!user){dlg.innerHTML=`<h3>Вход с имейл</h3><input id="cem" type="email" autocomplete="email" placeholder="вашият имейл" style="width:100%"><button class="go" id="cgo">Изпрати линк за вход</button><small>Пращаме еднократен линк, без парола. На картата не се показват имейл, име или маршрут. <a href="privacy.html" target="_blank">Лични данни</a></small>`;
  dlg.querySelector('#cgo').onclick=()=>{const e=dlg.querySelector('#cem').value.trim();if(!/^\S+@\S+\.\S+$/.test(e))return;sb.auth.signInWithOtp({email:e,options:{emailRedirectTo:location.href.split('#')[0]}}).then(({error})=>{dlg.innerHTML=error?'<h3>Грешка</h3>'+esc(error.message):'<h3>Проверете пощата си</h3>Отворете линка от същото устройство.'})};return}
 st={t:st.t||'r',here:st.here||'me'};form()}
function form(){const t=st.t;let h=`<h3>Какво отбелязвате?</h3>${opts('t',{r:'Опасност',p:'Ново място',c:'Спортувах тук'},t)}`;
 if(t==='r')h+=opts('k',KIND,st.k)+'<textarea id="cnote" maxlength="140" placeholder="Кратко описание (по желание)"></textarea>';
 if(t==='p')h+=opts('k',PK,st.k)+'<input id="cname" maxlength="80" placeholder="Име на мястото" style="width:100%"><textarea id="cnote" maxlength="200" placeholder="Какво има там (по желание)"></textarea><small>Новите места се показват след проверка.</small>';
 if(t==='c')h+=opts('k',ACTV,st.k)+'<input id="cmin" type="number" min="5" max="600" inputmode="numeric" placeholder="Минути (по желание)" style="width:100%"><small>Пазим само мястото, закръглено до ~100 m, и деня – без маршрут. На картата се показва само там, където са спортували поне 3 души.</small>';
 h+=`<div style="margin-top:8px;font-weight:600">Къде?</div>${opts('here',{me:'Където съм',center:'Центъра на картата'},st.here)}<button class="go" id="csend">Изпрати</button><div class="row" style="margin-top:6px">${admin?'<button class="o" id="cmod">Модерация</button>':''}<button class="o" id="cout">Изход</button><button class="o" id="cdel">Изтрий профила ми</button></div><small><a href="privacy.html" target="_blank">Лични данни</a></small>`;
 dlg.innerHTML=h;bind();dlg.querySelector('#cout').onclick=()=>sb.auth.signOut();
 dlg.querySelector('#cdel').onclick=()=>{dlg.innerHTML='<h3>Изтриване на профила</h3>Ще бъдат изтрити имейлът ви и всичко, което сте добавили. Това не може да се върне.<button class="go" id="cyes" style="background:#b3261e">Изтрий окончателно</button><button class="o" id="cno" style="margin-top:6px;width:100%">Отказ</button>';
  dlg.querySelector('#cno').onclick=form;dlg.querySelector('#cyes').onclick=()=>sb.rpc('delete_me').then(({error})=>{if(error){dlg.innerHTML='<h3>Грешка</h3>'+esc(error.message);return}sb.auth.signOut();dlg.innerHTML='<h3>Профилът е изтрит</h3>Всичките ви данни са премахнати.';load()})};
 const mb=dlg.querySelector('#cmod');if(mb)mb.onclick=mod;dlg.querySelector('#csend').onclick=send}
async function send(){const t=st.t,k=st.k;if(!k){dlg.querySelector('#csend').textContent='Изберете вид';return}
 const ll=await where();if(!ll){dlg.querySelector('#csend').textContent='Няма достъп до местоположението – изберете „Центъра на картата“';return}
 const v=id=>{const e=dlg.querySelector(id);return e?e.value.trim():''};let q;
 if(t==='r')q=sb.from('reports').insert({kind:k,lat:ll[0],lon:ll[1],note:v('#cnote')||null});
 else if(t==='p'){if(v('#cname').length<2){dlg.querySelector('#csend').textContent='Въведете име';return}q=sb.from('places').insert({kind:k,name:v('#cname'),note:v('#cnote')||null,lat:ll[0],lon:ll[1]})}
 else q=sb.from('checkins').insert({activity:k,minutes:+v('#cmin')||null,lat:ll[0],lon:ll[1]});
 const{error}=await q;dlg.innerHTML=error?`<h3>Не се записа</h3>${esc(error.message)}`:`<h3>Благодарим!</h3>${t==='p'?'Мястото ще се появи след проверка.':t==='r'?'Сигналът е на картата за 14 дни или докато хората го отбележат като изчезнал.':'Записано.'}`;if(!error){st={};load();map.setView(ll,Math.max(map.getZoom(),15))}}
async function mod(){dlg.innerHTML='<h3>Модерация</h3>Зареждам…';
 const[p,r]=await Promise.all([sb.from('places').select('id,kind,name,note,lat,lon,created_at').eq('status','pending').order('created_at'),sb.from('reports').select('id,kind,note,lat,lon,created_at').eq('hidden',false).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(50)]);
 const P=p.data||[],R=r.data||[];const day=t=>new Date(t).toLocaleDateString('bg');
 dlg.innerHTML=`<h3>Модерация</h3><b>Нови места (${P.length})</b>${P.map(x=>`<div style="border-top:1px solid #eee;padding:6px 0"><b>${esc(x.name)}</b> <small style="display:inline">${PK[x.kind]||''} · ${day(x.created_at)}</small>${x.note?`<div>${esc(x.note)}</div>`:''}<div class="row"><button class="o" data-go="${x.lat},${x.lon}">Покажи</button><button class="o" data-ok="${x.id}">Одобри</button><button class="o" data-no="${x.id}">Откажи</button></div></div>`).join('')||'<small>Няма чакащи.</small>'}
 <b style="display:block;margin-top:8px">Активни сигнали (${R.length})</b>${R.map(x=>`<div style="border-top:1px solid #eee;padding:6px 0">${(KIND[x.kind]||KIND.other)[1]} ${(KIND[x.kind]||KIND.other)[0]} <small style="display:inline">${day(x.created_at)}</small>${x.note?`<div>${esc(x.note)}</div>`:''}<div class="row"><button class="o" data-go="${x.lat},${x.lon}">Покажи</button><button class="o" data-hide="${x.id}">Скрий</button></div></div>`).join('')||'<small>Няма активни.</small>'}<button class="o" id="cback" style="margin-top:8px;width:100%">Назад</button>`;
 dlg.querySelector('#cback').onclick=form;
 dlg.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{const[a,o]=b.dataset.go.split(',').map(Number);map.setView([a,o],17)});
 const act=(q,b)=>q.then(({error})=>{b.parentElement.outerHTML=`<small>${error?'Грешка: '+esc(error.message):'Готово.'}</small>`;if(!error)load()});
 dlg.querySelectorAll('[data-ok]').forEach(b=>b.onclick=()=>act(sb.from('places').update({status:'approved'}).eq('id',b.dataset.ok),b));
 dlg.querySelectorAll('[data-no]').forEach(b=>b.onclick=()=>act(sb.from('places').update({status:'rejected'}).eq('id',b.dataset.no),b));
 dlg.querySelectorAll('[data-hide]').forEach(b=>b.onclick=()=>act(sb.from('reports').update({hidden:true}).eq('id',b.dataset.hide),b))}
btn.onclick=()=>{const open=dlg.style.display!=='block';dlg.style.display=open?'block':'none';if(open)menu()};
if(/[?&]add=1/.test(location.search)){const t=setInterval(()=>{if(sb){clearInterval(t);setTimeout(()=>btn.click(),400)}},200);setTimeout(()=>clearInterval(t),10000)}
})();

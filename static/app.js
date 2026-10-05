const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let snapshot = {projects:[], launches:[], state:{}}, selected = null, filter = 'all', view = 'discovery', token = '', lastRender = '';
$('#source-filter').insertAdjacentHTML('beforeend','<option value="hn">Hacker News · бесплатно</option>');
$('#source-filter').insertAdjacentHTML('beforeend','<option value="spider">Spider · видимая лента X</option>');
const labels = {shortlisted:'SHORTLIST',held:'НУЖНЫ ДАННЫЕ',rejected:'ОТКЛОНЁН'};
function notice(message) { $('#notice').textContent = message; $('#notice').hidden = !message; }
async function api(path, body) {
  const response = await fetch('/api/' + path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-Gem-Token':token},body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function setView(next) {
  view = next;
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== 'view-' + next);
  document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.view === next));
  $('#view-title').textContent = {discovery:'Discovery',launches:'Launch studio',activity:'Activity log',settings:'Connections'}[next];
  $('#page-title').innerHTML = {discovery:'Find the next <em>signal.</em>',launches:'From narrative to <em>launch.</em>',activity:'Every decision. <em>Recorded.</em>',settings:'Connect your <em>sources.</em>'}[next];
}
function render() {
  const {projects, state, runs, events} = snapshot;
  const auto=snapshot.automation;
  if(auto){
    $('#automation-panel').innerHTML=`<div><span class="eyebrow">ECONOMY AUTOLAUNCH</span><h3>${auto.mode==='live'?'LIVE · Solana / Pump.fun':'DRY RUN · без отправки транзакций'}</h3><p>${auto.missing.length?'Для live нужны: '+esc(auto.missing.join(', ')):'Подключения настроены'}${auto.error?' · '+esc(auto.error):''}</p></div><div class="auto-budget"><b>${auto.used} <small>/ 5</small></b><span>попыток за 24 ч</span></div><div class="auto-budget"><b>0.025 <small>SOL</small></b><span>потолок на запуск</span></div><div class="auto-budget"><b>${auto.reserved_sol.toFixed(3)} <small>/ 0.125</small></b><span>SOL зарезервировано · ${auto.mode}</span></div><button id="pause-launches" class="secondary">${auto.enabled?'Ⅱ Пауза очереди':'▶ Продолжить'}</button>`;
    $('#auto-jobs').innerHTML=auto.jobs.length?auto.jobs.map(j=>`<div class="launch-item"><span class="badge ${j.status==='confirmed'?'':'held'}">${esc(j.mode)} / ${esc(j.status)}</span><h3>${esc(j.name)} <span class="muted">$${esc(j.symbol)}</span></h3><p>${esc(j.narrative)}</p><p>${esc(j.reason||'Ожидает свободной квоты')}</p>${Number.isFinite(j.actual_lamports)?`<p>Расход: ${(j.actual_lamports/1e9).toFixed(6)} SOL · Остаток в отдельном кошельке: ${((j.residual_lamports||0)/1e9).toFixed(6)} SOL</p>`:''}${j.signature?`<a href="https://solscan.io/tx/${encodeURIComponent(j.signature)}" target="_blank" rel="noopener noreferrer">Транзакция ↗</a>`:''}${j.mint?`<p class="project-meta">Mint: ${esc(j.mint)}</p>`:''}</div>`).join(''):'<div class="empty">Очередь заполняется автоматически из свежего shortlist.<br>Демопроекты в неё не попадают. Пять — потолок, а не обязательная норма.</div>';
  }
  $('#pipeline-status').textContent = state.running ? state.stage : state.autopilot ? 'Economy scanner active' : 'Scanner ready';
  $('#pipeline-detail').textContent = state.last_poll ? 'Последний опрос: ' + new Date(state.last_poll).toLocaleTimeString() : 'Демо и импорт доступны';
  $('#demo').disabled = state.running;
  $('#import-button').disabled = state.running;
  $('#autopilot').classList.toggle('on', state.autopilot);
  $('#autopilot').innerHTML = `Автопилот: ${state.autopilot ? 'ON' : 'OFF'} <span class="switch"></span>`;
  if (state.error) notice(state.error);
  const source = $('#source-filter').value;
  const subset = projects.filter(p => source === 'all' || p.source === source);
  const latest = runs.find(r => source === 'all' || r.source === source);
  $('#stats').innerHTML = [["Постов в последнем скане",latest?.posts || 0,latest ? `${latest.source.toUpperCase()} · ${new Date(latest.created).toLocaleTimeString()}` : 'Запусти первый скан'],['Кандидатов',subset.length,'Уникальные страницы проектов'],['Нужны данные',subset.filter(p=>p.status==='held').length,'Есть пробелы в свидетельствах'],['В shortlist',subset.filter(p=>p.status==='shortlisted').length,'Прошли 4 из 4 проверок']].map(([label,value,foot])=>`<div class="stat"><div class="stat-label">${esc(label)} <span>↗</span></div><div class="stat-value">${value}</div><div class="stat-foot">${esc(foot)}</div></div>`).join('');
  const visible = subset.filter(p => filter === 'all' || p.status === filter);
  $('#candidate-count').textContent = visible.length;
  if (!visible.some(p=>p.id===selected)) selected = visible[0]?.id;
  $('#projects').innerHTML = visible.length ? visible.map(p=>`<button class="project ${selected===p.id?'selected':''}" data-id="${p.id}"><span class="project-icon">${esc(p.name.slice(0,1))}</span><span class="project-body"><span class="project-name">${esc(p.name)} ${p.source==='demo'?'<span class="badge demo">DEMO</span>':''}</span><span class="project-meta">${p.signals.mentions} упоминаний · ${p.signals.authors} авторов · ${p.signals.growth ? '×'+p.signals.growth+' к пред. часу' : 'нет базы роста'}</span></span><span class="project-side"><span class="score">${p.score/25}<small> / 4</small></span><br><span class="badge ${p.status}">${labels[p.status]}</span></span></button>`).join('') : '<div class="empty"><div class="glyph">◈</div>Здесь появятся найденные проекты.<br>Запусти демо или импортируй JSON с упоминаниями.</div>';
  const p = projects.find(p=>p.id===selected);
  $('#detail').innerHTML = p ? `<div class="detail-top"><span class="eyebrow">SIGNAL DOSSIER</span><span class="badge ${p.status}">${labels[p.status]}</span></div><h2>${esc(p.name)}</h2><a class="detail-link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.url)} ↗</a>${p.source==='demo'?'<p class="project-meta">Вымышленный пример. Свидетельства синтетические.</p>':''}<div class="subheading">FOUR-SEAT REVIEW · RULE ENGINE</div><div class="votes">${p.votes.map((v,i)=>`<div class="vote"><span class="seat-icon">${['◉','⌘','◇','↗'][i]}</span><div><div class="vote-name">${v.seat}</div><p>${esc(v.reason)}</p></div><span class="vote-result ${v.vote}">${v.vote}</span></div>`).join('')}</div><div class="subheading">COLLECTED EVIDENCE</div>${p.evidence.pages.map(e=>`<a class="evidence" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.kind)} ↗<span>${esc(e.url)}</span></a>`).join('') || '<p class="project-meta">Страницы не получены</p>'}${p.evidence.errors.map(e=>`<p class="project-meta">${esc(e.error)}</p>`).join('')}<button class="primary" id="concept">Подготовить токен-концепцию ↗</button>` : '<div class="empty"><div class="glyph">⌕</div>Выбери проект,<br>чтобы изучить свидетельства.</div>';
  $('#events').innerHTML = events.length ? events.map(e=>`<div class="event"><time>${esc(new Date(e.created).toLocaleString())}</time><span>${esc(e.message)}</span></div>`).join('') : '<div class="empty">Событий пока нет.</div>';
  const connections = snapshot.connections || {};
  $('#connections').innerHTML = [['JSON / inbox','Подключено'],['X API',connections.x?'Ключ настроен':'Нужен X_BEARER_TOKEN'],['Crawler','Публичные HTTP(S) страницы · до 3 страниц'],['DOTS','Четыре проверки по правилам'],['Token launch',connections.launch || 'Ожидает выбора сети и кошелька']].map(([name,status])=>`<div class="connection"><b>${name}</b><span>${esc(status)}</span></div>`).join('') + (connections.x ? '<button id="scan-x" class="primary">Сканировать X</button>' : '');
  $('#connections').insertAdjacentHTML('afterbegin',`<div class="spider-connect"><div class="eyebrow">THE NARRATIVE SPIDER</div><h3>Подключи расширение к этому компьютеру</h3><p>Загрузи папку <code>extension/</code> через chrome://extensions → Developer mode → Load unpacked. Скопируй код в popup расширения, открой X и нажми Release spider.</p><button id="copy-pairing" class="primary">Скопировать код подключения</button><p>Собрано: ${snapshot.spider?.captured||0} · В очереди: ${snapshot.spider?.pending||0}</p><p>Grok: ${snapshot.grok?.enabled?(snapshot.grok.configured?'подключён':'нужен XAI_API_KEY'):'выключен'} · ${esc(snapshot.grok?.model||'')} · вызовов ${snapshot.grok?.calls_used||0}/${snapshot.grok?.calls_limit||12} за 24 часа.</p></div>`);
  if(p?.grok){$('#detail').insertAdjacentHTML('beforeend',`<div class="subheading">GROK SEATS · ${esc(p.grok.model)} · ${esc(p.grok.status)}</div><div class="votes">${p.grok.votes.map(v=>`<div class="vote"><span class="seat-icon">✦</span><div><div class="vote-name">${esc(v.seat)}</div><p>${esc(v.reason)}</p><p>${esc((v.evidence_ids||[]).join(', '))}</p></div><span class="vote-result ${v.vote}">${esc(v.vote)}</span></div>`).join('')}</div>`);}
  $('#launch-connection').textContent = connections.launch || 'Черновики доступны. Реальный запуск не подключён.';
  $('#launches').innerHTML = snapshot.launches?.length ? snapshot.launches.map(l=>`<div class="launch-item"><span class="badge held">${esc(l.status)}</span><h3>${esc(l.name)} <span class="muted">$${esc(l.symbol)}</span></h3><p>${esc(l.description)}</p><p class="project-meta">${esc(l.narrative)} · Dev buy: ${esc(l.amount)} SOL</p><div class="actions"><button class="secondary download-metadata" data-id="${esc(l.id)}">Метаданные ↓</button><button class="secondary simulate" data-id="${esc(l.id)}">Проверить черновик</button></div>${l.result?`<p>${esc(l.result)}</p>`:''}</div>`).join('') : '<div class="empty"><div class="glyph">↗</div>Создай первый черновик.<br>Он сохранится локально и не отправит транзакцию.</div>';
}
async function refresh(force=false) {
  try { const data=await api('state'); token=data.token; snapshot=data; const next=JSON.stringify(data); if(force||next!==lastRender){lastRender=next;render();} } catch(e){notice('Сервер недоступен: '+e.message);}
}
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.querySelectorAll('.nav').forEach(el=>el.onclick=()=>setView(el.dataset.view));
document.querySelectorAll('.filter').forEach(el=>el.onclick=()=>{filter=el.dataset.filter;document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b===el));render();});
$('#source-filter').onchange=render;
$('#automation-panel').onclick=async e=>{if(e.target.id==='pause-launches'){try{await api('launch-control',{enabled:!snapshot.automation.enabled});await refresh(true);}catch(error){notice(error.message);}}};
$('#connections').onclick=async e=>{if(e.target.id==='copy-pairing'){try{await navigator.clipboard.writeText(snapshot.pairing_code);notice('Код скопирован. Вставь его в popup Gem Search.');}catch{notice('Копирование недоступно. Код: '+snapshot.pairing_code);}}if(e.target.id==='scan-x'){try{await api('x',{});notice('X: запрошены последние 100 постов по настроенному запросу.');await refresh(true);}catch(error){notice(error.message);}}};
$('#projects').onclick=e=>{const el=e.target.closest('[data-id]');if(el){selected=el.dataset.id;render();}};
$('#detail').onclick=e=>{if(e.target.id==='concept'){const p=snapshot.projects.find(p=>p.id===selected);setView('launches');const f=$('#launch-form');f.elements.name.value='';f.elements.symbol.value='';f.elements.narrative.value=(p.source==='demo'?'DEMO: ':'')+p.name+' — '+p.url;f.elements.description.value='Independent community token inspired by a research narrative. Not affiliated with or endorsed by the referenced project.';f.elements.name.focus();}};
$('#demo').onclick=async()=>{try{notice('');await api('demo',{});await refresh(true);}catch(e){notice(e.message);}};
$('#autopilot').onclick=async()=>{try{await api('autopilot',{enabled:!snapshot.state.autopilot});await refresh(true);}catch(e){notice(e.message);}};
$('#import-button').onclick=()=>$('#import-file').click();
$('#import-file').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>2_000_000)throw new Error('Файл больше 2 MB');await api('import',JSON.parse(await file.text()));notice('Импорт принят. Проверки выполняются в фоне.');await refresh(true);}catch(error){notice(error.message);}finally{e.target.value='';}};
$('#export').onclick=()=>download('gem-search-report.json',{exported_at:new Date().toISOString(),projects:snapshot.projects});
$('#launch-form').onsubmit=async e=>{e.preventDefault();try{const body=Object.fromEntries(new FormData(e.target));body.amount=Number(body.amount);body.priority_fee=Number(body.priority_fee);await api('launches',body);e.target.reset();notice('Черновик сохранён.');await refresh(true);}catch(error){notice(error.message);}};
$('#launches').onclick=async e=>{const button=e.target.closest('button');if(!button)return;const l=snapshot.launches.find(l=>l.id===button.dataset.id);if(button.classList.contains('download-metadata'))download(l.symbol+'-metadata.json',{name:l.name,symbol:l.symbol,description:l.description});if(button.classList.contains('simulate')){try{await api('launches/check',{id:l.id});await refresh(true);}catch(error){notice(error.message);}}};
refresh(true);setInterval(()=>refresh(),2000);

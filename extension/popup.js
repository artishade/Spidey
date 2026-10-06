const $=s=>document.querySelector(s);
async function send(type,extra={}){const result=await chrome.runtime.sendMessage({type,...extra});if(!result?.ok)throw Error(result?.error||'Extension unavailable');return result;}
function statusLine(s){
  if(s.engine)return 'Local engine paired · '+(s.engine.grok?.enabled?'Grok enabled':'local rules');
  if(s.provider)return 'Standalone · AI via '+s.provider.name+(s.aiReviews?'':' · reviews off');
  return 'Standalone · local analysis';
}
function renderLeads(leads){
  const box=$('#leads-box'),list=$('#lead-list');
  if(!leads.length){box.hidden=true;return;}
  box.hidden=false;list.innerHTML='';
  for(const lead of leads){
    const item=document.createElement('li');
    const badge=document.createElement('i');badge.className=lead.status;badge.title=lead.status;
    const review=lead.review?` · ${lead.review.provider||lead.review.model}: `+lead.review.votes.map(v=>v.vote[0].toUpperCase()).join(''):'' ;
    item.append(badge,Object.assign(document.createElement('b'),{textContent:lead.name}),
      Object.assign(document.createElement('span'),{textContent:` ${lead.score} · ${lead.signals.authors} authors${review}`}));
    item.title=lead.votes.map(v=>`${v.seat}: ${v.vote} — ${v.reason}`).join('\n');
    list.append(item);
  }
}
async function refresh(){
  const s=await send('get-status');
  $('#connection').textContent=statusLine(s);
  $('#dot').classList.toggle('ready',!!s.engine||!!s.provider||s.posts>0);
  $('#captured').textContent=s.engine?.spider?.captured||s.posts||0;
  $('#leads').textContent=s.engine?.leads||s.leadCount||0;
  $('#queued').textContent=s.queued;
  renderLeads(s.standalone?s.leads:[]);
}
for(const type of ['connect','start','stop','disconnect']){$('#'+type).onclick=async()=>{const b=$('#'+type);b.disabled=true;try{await send(type,type==='connect'?{code:$('#pairing').value.trim()}:type==='start'?{autoScroll:$('#auto-scroll').checked}:{});$('#message').textContent={connect:'Connected. Open X and release your spider.',start:'Spider released. It follows visible posts.',stop:'Spider paused.',disconnect:'Pairing and local data cleared.'}[type];if(type==='connect')$('#pairing').value='';await refresh();}catch(e){$('#message').textContent=e.message;}finally{b.disabled=false;}};}
$('#providers').onclick=()=>chrome.runtime.openOptionsPage();
$('#review-now').onclick=async()=>{const b=$('#review-now');b.disabled=true;try{await send('review-now');await refresh();$('#message').textContent='Provider review updated the top lead.';}catch(e){$('#message').textContent=e.message;}finally{b.disabled=false;}};
refresh().catch(e=>$('#message').textContent=e.message);
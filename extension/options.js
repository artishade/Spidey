const $=s=>document.querySelector(s);
let editing=null;
const send=(type,extra={})=>chrome.runtime.sendMessage({type,...extra});
function escapeHtml(value){const node=document.createElement('i');node.textContent=String(value);return node.innerHTML;}
function say(text,ok=false){const box=$('#message');box.textContent=text;box.classList.toggle('ok',ok);}
async function readState(){const {providers=[],settings={}}=await chrome.storage.local.get(['providers','settings']);return {providers,settings};}
async function writeProviders(providers,settings){
  await chrome.storage.local.set({providers,settings:settings||{}});}
function ensureOrigin(provider){
  const origin=GemProviders.hostOrigin(provider);
  return chrome.permissions.contains({origins:[origin]}).then(has=>has||chrome.permissions.request({origins:[origin]}));
}
function render(providers,activeId){
  const list=$('#list');list.innerHTML='';
  if(!providers.length){list.innerHTML='<p class="empty">No providers yet. The spider still analyses posts locally; AI reviews stay off until you add one.</p>';return;}
  for(const p of providers){
    const row=document.createElement('div');row.className='provider';row.dataset.id=p.id;
    row.innerHTML=`<div class="head"><label class="radio"><input type="radio" name="active" ${p.id===activeId?'checked':''}>active</label><b>${escapeHtml(p.name)}</b><span class="model">${escapeHtml(p.model)}</span></div>
      <code>${escapeHtml(p.baseUrl)}</code><code class="key">${p.apiKey?'key ••••'+escapeHtml(p.apiKey.slice(-4)):'no key (local engine)'}</code>
      <div class="actions"><button data-act="test">Test</button><button data-act="edit">Edit</button><button data-act="remove" class="danger">Remove</button></div><span class="result"></span>`;
    list.append(row);
  }
}
async function refresh(){
  const {providers,settings}=await readState();
  $('#ai-reviews').checked=settings.aiReviews!==false;
  render(providers,settings.activeProviderId||(providers[0]&&providers[0].id));
}
function resetForm(){
  editing=null;$('#form-title').textContent='Add a provider';$('#save').textContent='Add provider';
  for(const id of ['name','base','key','model'])$('#'+id).value='';
  $('#cancel').hidden=true;
}
$('#ai-reviews').onchange=async event=>{
  const {providers,settings}=await readState();
  settings.aiReviews=event.target.checked;
  await writeProviders(providers,settings);
  say(event.target.checked?'AI reviews on for the active provider.':'AI reviews off. Local analysis continues.',true);
};
$('#list').addEventListener('change',async event=>{
  if(event.target.name!=='active')return;
  const {providers,settings}=await readState();
  settings.activeProviderId=event.target.closest('.provider').dataset.id;
  await writeProviders(providers,settings);
  say('Active provider updated.',true);
});
$('#list').addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  const row=button.closest('.provider');const id=row.dataset.id;
  const {providers,settings}=await readState();
  const provider=providers.find(p=>p.id===id);if(!provider)return;
  const act=button.dataset.act;
  if(act==='edit'){
    editing=id;$('#form-title').textContent='Edit provider';$('#save').textContent='Save changes';
    $('#name').value=provider.name;$('#base').value=provider.baseUrl;$('#key').value=provider.apiKey;$('#model').value=provider.model;
    $('#cancel').hidden=false;$('#name').focus();return;
  }
  if(act==='remove'){
    const rest=providers.filter(p=>p.id!==id);
    chrome.permissions.remove({origins:[GemProviders.hostOrigin(provider)]}).catch(()=>{});
    if(settings.activeProviderId===id)settings.activeProviderId=rest[0]?.id??null;
    await writeProviders(rest,settings);resetForm();await refresh();say('Provider removed.',true);return;
  }
  if(act==='test'){
    button.disabled=true;const result=row.querySelector('.result');result.textContent='Testing…';result.classList.remove('error');
    try{
      if(!await ensureOrigin(provider))throw Error('Permission denied.');
      await send('test-provider',{provider});
      result.textContent='Reachable ✓';
    }catch(error){result.textContent=error.message;result.classList.add('error');}
    finally{button.disabled=false;}
  }
});
for(const preset of document.querySelectorAll('.preset'))preset.onclick=()=>{
  $('#base').value=preset.dataset.base;$('#model').value=preset.dataset.model;$('#key').focus();
};
$('#save').onclick=async()=>{
  const button=$('#save');button.disabled=true;
  try{
    const provider=GemProviders.normalizeProvider({id:editing||undefined,name:$('#name').value,baseUrl:$('#base').value,apiKey:$('#key').value,model:$('#model').value});
    if(!provider)throw Error('A name, an https (or localhost) base URL and a model are required.');
    if(!await ensureOrigin(provider))throw Error('Chrome permission denied; reviews cannot reach this address.');
    const {providers,settings}=await readState();
    const wasEditing=!!editing;
    if(editing){
      const index=providers.findIndex(p=>p.id===editing);
      providers[index]={...provider,id:editing};
    }else{
      provider.id=crypto.randomUUID().replace(/-/g,'').slice(0,24);
      providers.push(provider);
    }
    settings.activeProviderId=settings.activeProviderId||provider.id;
    await writeProviders(providers,settings);
    resetForm();await refresh();
    say(wasEditing?'Provider updated.':'Saved. Reviews will use this provider for the strongest leads.',true);
  }catch(error){say(error.message);}
  finally{button.disabled=false;}
};
$('#cancel').onclick=resetForm;
refresh().catch(error=>say(error.message));
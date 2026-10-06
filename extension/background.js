import './shared.js';
import './engine.js';
import './providers.js';
const BASE='http://127.0.0.1:8787';
const LEADS_LIMIT=12,REVIEW_TTL=24*3600*1000;
let serial=Promise.resolve();
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
chrome.alarms.create('flush',{periodInMinutes:1});
function exclusive(fn){const p=serial.then(fn,fn);serial=p.catch(()=>{});return p;}
async function backend(path,body){
  const {pairing}=await chrome.storage.local.get('pairing');
  if(!pairing)throw Error('Connect the local engine first.');
  const response=await fetch(BASE+'/api/extension/'+path,{method:body?'POST':'GET',headers:{'X-Gem-Extension':pairing,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error(response.status===403?'Pairing code rejected. Reconnect from the popup.':'Engine HTTP '+response.status);
  return response.json();
}
async function activeProvider(){
  const {providers=[],settings={}}=await chrome.storage.local.get(['providers','settings']);
  return providers.find(p=>p.id===settings.activeProviderId)||providers[0]||null;
}
async function reviewsEnabled(){
  const {settings={},providers=[]}=await chrome.storage.local.get(['settings','providers']);
  return settings.aiReviews!==false&&providers.length>0&&await activeProvider()!==null;
}
async function engineFlush(){
  const {queue=[]}=await chrome.storage.local.get('queue');
  if(queue.length){const chunk=queue.slice(0,20);await backend('ingest',{posts:chunk});await chrome.storage.local.set({queue:queue.slice(chunk.length),lastError:''});}
  const status=await backend('status');await chrome.storage.local.set({engine:status,lastError:''});
  return status;
}
async function standalone(force=false){
  const {queue=[],posts=[],leads=[]}=await chrome.storage.local.get(['queue','posts','leads']);
  let store=posts,nextLeads=leads,reviewed=null;
  if(queue.length){
    const now=Date.now()/1000;
    const merged=GemEngine.mergePosts(posts,queue,now);
    store=merged.posts;
    nextLeads=GemEngine.analyze(store,now).slice(0,LEADS_LIMIT).map(lead=>{
      const old=leads.find(l=>l.id===lead.id);
      // A fresh review survives re-analysis while its evidence is under a day old.
      return old?.review&&Date.now()-old.review.at<REVIEW_TTL?{...lead,review:old.review}:lead;
    });
    await chrome.storage.local.set({queue:[],posts:store,leads:nextLeads,lastError:''});
  }
  if(await reviewsEnabled()){
    const provider=await activeProvider();
    const target=nextLeads.find(l=>l.status!=='rejected'&&(!l.review||force||Date.now()-l.review.at>REVIEW_TTL));
    if(provider&&target){
      const review=await GemProviders.reviewProject(provider,target);
      reviewed=target.id;
      nextLeads=nextLeads.map(l=>l.id===target.id?{...l,review}:l);
      await chrome.storage.local.set({leads:nextLeads,lastError:''});
    }
  }
  return {captured:store.length,leads:nextLeads,reviewed};
}
async function flush(force=false){
  const {pairing}=await chrome.storage.local.get('pairing');
  if(pairing){
    const status=await engineFlush();
    const tabs=await chrome.tabs.query({});
    for(const tab of tabs){if(tab.id)chrome.tabs.sendMessage(tab.id,{type:'engine-status',leads:status.leads,status:status.grok?.enabled?'Grok reviews enabled · '+status.spider.pending+' posts queued':'Local research · '+status.spider.pending+' posts queued'}).catch(()=>{});}
    return status;
  }
  const local=await standalone(force);
  const provider=await activeProvider();
  const shortlisted=local.leads.filter(l=>l.status==='shortlisted').length;
  const status=provider?'Standalone · '+provider.name+(shortlisted?' · '+shortlisted+' strong leads':''):'Standalone · local analysis';
  const tabs=await chrome.tabs.query({});
  for(const tab of tabs){if(tab.id)chrome.tabs.sendMessage(tab.id,{type:'engine-status',leads:shortlisted,status}).catch(()=>{});}
  return {spider:{captured:local.captured,pending:0},leads:shortlisted,standalone:true,provider:provider?.name||null};
}
chrome.alarms.onAlarm.addListener(()=>exclusive(()=>flush()).catch(e=>chrome.storage.local.set({lastError:e.message})));
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  const ui=!sender.tab&&sender.url?.startsWith(chrome.runtime.getURL(''));
  const task=async()=>{
    if(message.type==='capture'){
      if(!sender.tab||!GemExtract.supported(sender.tab.url||sender.url))throw Error('Capture is supported only on X feed pages.');
      if(!Array.isArray(message.posts)||message.posts.length>20)throw Error('Invalid capture batch');
      const posts=message.posts.map(GemExtract.normalize).filter(Boolean);
      const {queue=[]}=await chrome.storage.local.get('queue');
      const ids=new Set(queue.map(p=>p.id));const fresh=posts.filter(p=>!ids.has(p.id));
      if(queue.length+fresh.length>200)throw Error('Local queue full. Start the engine before continuing.');
      await chrome.storage.local.set({queue:[...queue,...fresh]});
      try{await flush();return {ok:true,queued:false};}catch(e){await chrome.storage.local.set({lastError:e.message});return {ok:true,queued:true};}
    }
    if(message.type==='open-options'){await chrome.runtime.openOptionsPage();return {ok:true};}
    if(!ui)throw Error('Popup-only action');
    if(message.type==='connect'){
      if(typeof message.code!=='string'||!/^[A-Za-z0-9_-]{40,100}$/.test(message.code))throw Error('Paste the pairing code from the dashboard.');
      await chrome.storage.local.set({pairing:message.code});
      return {ok:true,engine:await flush()};
    }
    if(message.type==='start'){
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!tab||!GemExtract.supported(tab.url))throw Error('Open an X feed or search page first.');
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['shared.js','spider-ui.js','content.js']});
      await chrome.tabs.sendMessage(tab.id,{type:'configure',autoScroll:message.autoScroll===true});return {ok:true};
    }
    if(message.type==='stop'){
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(tab?.id)await chrome.tabs.sendMessage(tab.id,{type:'stop'}).catch(()=>{});return {ok:true};
    }
    if(message.type==='disconnect'){await chrome.storage.local.remove(['pairing','queue','engine','posts','leads','lastError']);return {ok:true};}
    if(message.type==='get-status'){
      const {queue=[],posts=[],leads=[],engine,lastError,pairing,providers=[],settings={}}=await chrome.storage.local.get(['queue','posts','leads','engine','lastError','pairing','providers','settings']);
      const provider=providers.find(p=>p.id===settings.activeProviderId)||providers[0]||null;
      return {ok:true,paired:!!pairing,queued:queue.length,engine,lastError,
        standalone:!pairing,posts:posts.length,leads:leads.slice(0,5),leadCount:leads.length,
        provider:provider?{name:provider.name,model:provider.model,id:provider.id}:null,
        aiReviews:settings.aiReviews!==false&&!!provider};
    }
    if(message.type==='test-provider'){
      const provider=GemProviders.normalizeProvider(message.provider);
      if(!provider)throw Error('Name, an https base URL and a model are required.');
      await GemProviders.testProvider(provider);
      return {ok:true};
    }
    if(message.type==='review-now'){await flush(true);return {ok:true};}
    throw Error('Unknown action');
  };
  exclusive(task).then(reply).catch(e=>reply({ok:false,error:e.message}));return true;
});
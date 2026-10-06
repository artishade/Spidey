import './shared.js';
const BASE='http://127.0.0.1:8787';
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
async function flush(){
  const {queue=[]}=await chrome.storage.local.get('queue');
  if(queue.length){const chunk=queue.slice(0,20);await backend('ingest',{posts:chunk});await chrome.storage.local.set({queue:queue.slice(chunk.length),lastError:''});}
  const status=await backend('status');await chrome.storage.local.set({engine:status,lastError:''});
  const tabs=await chrome.tabs.query({});
  for(const tab of tabs){if(tab.id)chrome.tabs.sendMessage(tab.id,{type:'engine-status',leads:status.leads,status:status.grok?.enabled?'Grok reviews enabled · '+status.spider.pending+' posts queued':'Local research · '+status.spider.pending+' posts queued'}).catch(()=>{});}
  return status;
}
chrome.alarms.onAlarm.addListener(()=>exclusive(flush).catch(e=>chrome.storage.local.set({lastError:e.message})));
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
    if(message.type==='disconnect'){await chrome.storage.local.remove(['pairing','queue','engine']);return {ok:true};}
    if(message.type==='get-status'){
      const {queue=[],engine,lastError,pairing}=await chrome.storage.local.get(['queue','engine','lastError','pairing']);
      return {ok:true,paired:!!pairing,queued:queue.length,engine,lastError};
    }
    throw Error('Unknown action');
  };
  exclusive(task).then(reply).catch(e=>reply({ok:false,error:e.message}));return true;
});

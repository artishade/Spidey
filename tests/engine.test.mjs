import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../extension/engine.js';
import '../extension/providers.js';
const {cashtags,isSolanaAddress,solanaAddresses,emergingPhrases,candidate,hydrate,mergePosts,analyze,phrases}=globalThis.GemEngine;
const {normalizeProvider,parseJsonLoose,validateVote,reviewProject,testProvider,hostOrigin}=globalThis.GemProviders;
const NOW=1_800_000_000;
const post=(id,author,text,extra={})=>({id:String(id),author,text,url:`https://x.com/${author}/status/${id}`,
  created_at:new Date((NOW-1200)*1000).toISOString(),timestamp:NOW-1200,links:[],captured_at:NOW-1100,...extra});
const vote={vote:'hold',reason:'Unclear',evidence_ids:['post-0'],unknowns:['n/a']};
const chatResponse=body=>async(url,request)=>{
  if(!request.headers.Authorization&&JSON.parse(request.body).model)throw Error('missing auth');
  return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(vote)}}]})};
};

test('cashtags skip majors, fiat and mid-word tokens',()=>{
  assert.deepEqual([...cashtags('$GEMS launch with $BTC $usd and ask$NOPE')],['GEMS']);
});
test('solana addresses decode to exactly 32 bytes',()=>{
  assert.ok(isSolanaAddress('So11111111111111111111111111111111111111112'));
  assert.ok(isSolanaAddress('11111111111111111111111111111111'));
  assert.equal(isSolanaAddress('1111111111111111111111111111111'),false);
});
test('emerging phrases need three distinct authors inside six hours',()=>{
  const posts=[post(1,'a','the alpha launch is live'),post(2,'b','that alpha launch again'),post(3,'c','alpha launch details soon'),post(4,'d','alpha launch spam by one more author')];
  const found=emergingPhrases(posts,NOW);
  assert.equal(found.length,1);assert.equal(found[0][0],'alpha launch');
  assert.deepEqual(emergingPhrases(posts.slice(0,2),NOW),[]); // two authors are not a narrative
});
test('candidate scores the four seats and rejects risk posts',()=>{
  const group=[post(1,'a','fresh agent framework https://docs.example.com'),post(2,'b','fresh agent framework again'),
    post(3,'c','fresh agent framework three'),post(4,'d','fresh agent framework four',{links:['https://project.example']}),post(5,'d','fresh agent framework five')];
  const lead=candidate(group,'phrase','fresh agent','id','Fresh agent',NOW);
  assert.equal(lead.score,100);assert.equal(lead.status,'shortlisted');
  const risky=candidate([...group,post(6,'e','send seed phrase to claim')],'phrase','x','id2','X',NOW);
  assert.equal(risky.status,'rejected');
  assert.ok(risky.votes.some(v=>v.seat==='skeptic'&&v.vote==='reject'));
});
test('merge dedupes by id and prunes the week-old window',()=>{
  const existing=[post(1,'a','kept',{timestamp:NOW-1000})];
  const {posts,added}=mergePosts(existing,[{url:'https://x.com/b/status/2',text:'new',created_at:new Date(NOW*1000).toISOString(),links:[]},
    {url:'https://x.com/a/status/1',text:'dupe',created_at:new Date(NOW*1000).toISOString(),links:[]}],NOW);
  assert.equal(added,1);assert.equal(posts.length,2);
  const pruned=mergePosts([post(9,'old','ancient',{timestamp:NOW-8*86400})],[],NOW);
  assert.deepEqual(pruned.posts,[]);
});
test('analyze surfaces topic, ticker and phrase leads',()=>{
  const posts=[...Array(6)].map((_,i)=>post(10+i,['a','b','c','d','e','f'][i],'agentic coding is accelerating '+i));
  posts.push(post(20,'g','watch $NOVA this week'),post(21,'h','buying more $NOVA today'));
  const leads=analyze(posts,NOW);
  assert.ok(leads.some(l=>l.kind==='topic'&&l.key==='agents'));
  assert.ok(leads.some(l=>l.kind==='ticker'&&l.key==='NOVA'));
});
test('hydrate restores author and timestamp from the permalink',()=>{
  const restored=hydrate({url:'https://x.com/bob/status/42?utm=1',text:'hello',created_at:new Date(NOW*1000).toISOString(),links:['https://example.com']},NOW);
  assert.equal(restored.author,'bob');assert.equal(restored.id,'42');assert.equal(restored.timestamp,NOW);
  assert.equal(hydrate({url:'https://x.com/bob/status/42',text:'x',created_at:'nope',links:[]},NOW),null);
});
test('providers require a name, model and a public https or localhost base',()=>{
  assert.equal(normalizeProvider({name:'x',baseUrl:'ftp://bad',model:'m'}),null);
  assert.equal(normalizeProvider({name:'x',baseUrl:'http://evil.example.com',model:'m'}),null);
  assert.equal(normalizeProvider({name:'x',baseUrl:'https://api.x.ai/v1/',model:''}),null);
  const ok=normalizeProvider({name:'xAI',baseUrl:'https://api.x.ai/v1/',model:'grok-4.7',apiKey:'k'});
  assert.equal(ok.baseUrl,'https://api.x.ai/v1');assert.equal(hostOrigin(ok),'https://api.x.ai/*');
  const local=normalizeProvider({name:'Ollama',baseUrl:'http://localhost:11434/v1',model:'llama3.1',apiKey:''});
  assert.equal(local.baseUrl,'http://localhost:11434/v1');
});
test('vote validation enforces evidence-bound passes',()=>{
  assert.throws(()=>validateVote({...vote,vote:'maybe'},new Set(['post-0'])));
  assert.throws(()=>validateVote({...vote,vote:'pass',evidence_ids:[]},new Set(['post-0'])));
  assert.throws(()=>validateVote({...vote,evidence_ids:['post-9']},new Set(['post-0'])));
  assert.deepEqual(validateVote(vote,new Set(['post-0'])),vote);
});
test('loose JSON parsing survives fenced and chatty replies',()=>{
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'),{a:1});
  assert.deepEqual(parseJsonLoose('Sure! {"a":2} hope that helps'),{a:2});
  assert.throws(()=>parseJsonLoose('no json here'));
});
test('project review collects four seats through one provider',async()=>{
  const provider=normalizeProvider({name:'xAI',baseUrl:'https://api.x.ai/v1',model:'grok-4.7',apiKey:'k'});
  const lead=candidate([post(1,'a','lead text https://docs.example.com'),post(2,'b','lead text'),post(3,'c','lead text'),
    post(4,'d','lead text',{links:['https://project.example']}),post(5,'e','lead text')],'phrase','lead','id','Lead',NOW);
  const result=await reviewProject(provider,lead,chatResponse());
  assert.equal(result.status,'complete');assert.equal(result.votes.length,4);
  assert.ok(result.votes.every(v=>v.available&&v.vote==='hold'));
});
test('provider probe fails loudly on bad replies',async()=>{
  const provider=normalizeProvider({name:'xAI',baseUrl:'https://api.x.ai/v1',model:'grok-4.7',apiKey:'k'});
  await assert.rejects(()=>testProvider(provider,async()=>({ok:false,status:401,json:async()=>({})})));
  assert.equal(await testProvider(provider,async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:'OK'}}]})})),true);
});
test('phrases drop stopwords and links before pairing words',()=>{
  assert.deepEqual(Object.keys(phrases('Check https://x.com/a the alpha launch now')),['alpha launch']);
});
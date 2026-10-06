// Called only by the durable Python queue. Private keys never leave this process.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, VersionedTransaction, TransactionMessage, SystemProgram, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { CAP, fundingAmount, validateCreate, resolveKeys } from './guard.mjs';
import { deliverOnce } from './transport.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const walletPath=process.env.SOLANA_KEYPAIR_PATH || path.join(ROOT,'data/wallets/treasury.json');
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
function key(file){if(!fs.existsSync(file))write(file,Array.from(Keypair.generate().secretKey));if(fs.statSync(file).mode & 0o077)throw new Error('Wallet file permissions must be 600');return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file))));}
const print=value=>process.stdout.write(JSON.stringify(value)+'\n');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  if(process.argv[2]==='init-wallet'){const k=key(walletPath);print({public_key:k.publicKey.toBase58(),key_file:walletPath});return;}
  if(process.env.LAUNCH_MODE!=='live')throw new Error('Live execution is disabled');
  if(!fs.existsSync(walletPath) || !process.env.PINATA_JWT)throw new Error('Missing wallet or PINATA_JWT');
  let input='';for await(const part of process.stdin)input+=part;
  const draft=JSON.parse(input);
  if(!/^[a-f0-9]{24}$/.test(draft.id) || draft.amount!==0)throw new Error('Invalid job; developer buys are disabled');
  const dir=path.join(ROOT,'data/launch-jobs',draft.id);
  const file=path.join(dir,'state.json');
  let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{id:draft.id,status:'preparing'};
  const save=()=>write(file,state);
  const result=()=>{const {status,mint,signature,funding_signature,estimated_lamports,actual_lamports,residual_lamports,reason}=state;return {status,mint,signature,funding_signature,estimated_lamports,actual_lamports,residual_lamports,reason};};
  if(['confirmed','failed','blocked'].includes(state.status)){print(result());return;}
  const treasury=key(walletPath), child=key(path.join(dir,'creator.json')), mint=key(path.join(dir,'mint.json'));
  state.mint=mint.publicKey.toBase58();save();
  const endpoint=process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  if(!endpoint.startsWith('https://'))throw new Error('RPC must use HTTPS');
  const rpc=new Connection(endpoint,{commitment:'finalized',disableRetryOnRateLimit:true,fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(20_000)})});
  if(await rpc.getGenesisHash()!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')throw new Error('Pump launch requires Solana mainnet');
  async function deliver(slot){
    return deliverOnce(state,slot,rpc,save,()=>fs.existsSync(path.join(ROOT,'data/launch-paused')),sleep);
  }
  async function upload(bytes,name,mime){
    const form=new FormData();form.append('network','public');form.append('file',new Blob([bytes],{type:mime}),name);
    const res=await fetch('https://uploads.pinata.cloud/v3/files',{method:'POST',headers:{Authorization:'Bearer '+process.env.PINATA_JWT},body:form,signal:AbortSignal.timeout(30000)});
    if(!res.ok)throw new Error('Pinata upload HTTP '+res.status);
    const cid=(await res.json())?.data?.cid;
    if(typeof cid!=='string' || !/^[a-zA-Z0-9]{20,120}$/.test(cid))throw new Error('Invalid IPFS CID');
    return 'https://ipfs.io/ipfs/'+cid;
  }
  if(!state.image){state.image=await upload(Buffer.from(draft.image_base64,'base64'),'token.png','image/png');save();}
  if(!state.uri){state.uri=await upload(JSON.stringify({name:draft.name,symbol:draft.symbol,description:draft.description,image:state.image,showName:true}),'metadata.json','application/json');save();}
  // Ask provider to construct an unsigned creation BEFORE allocating SOL.
  async function buildCreate(){
    const response=await fetch('https://pumpportal.fun/api/trade-local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({publicKey:child.publicKey.toBase58(),action:'create',tokenMetadata:{name:draft.name,symbol:draft.symbol,uri:state.uri},mint:state.mint,denominatedInSol:'true',amount:0,slippage:1,priorityFee:0.00001,pool:'pump',isMayhemMode:false}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('PumpPortal create HTTP '+response.status+'; zero-buy may not be supported');
    const bytes=await response.arrayBuffer();if(bytes.byteLength>4096)throw new Error('Unexpected transaction size');
    const tx=VersionedTransaction.deserialize(new Uint8Array(bytes));
    validateCreate(tx,{payer:child.publicKey.toBase58(),mint:state.mint,name:draft.name,symbol:draft.symbol,uri:state.uri},await resolveKeys(tx,rpc));
    return tx;
  }
  if(!state.funding){
    await buildCreate();
    const block=await rpc.getLatestBlockhash('finalized');
    const message=amount=>new TransactionMessage({payerKey:treasury.publicKey,recentBlockhash:block.blockhash,instructions:[SystemProgram.transfer({fromPubkey:treasury.publicKey,toPubkey:child.publicKey,lamports:amount})]}).compileToV0Message();
    const fee=(await rpc.getFeeForMessage(message(1),'finalized')).value;
    const amount=fundingAmount(fee);
    if(await rpc.getBalance(treasury.publicKey,'finalized')<CAP)throw new Error('Treasury needs at least 0.025 SOL');
    const tx=new VersionedTransaction(message(amount));tx.sign([treasury]);
    state.funding={raw:Buffer.from(tx.serialize()).toString('base64'),signature:bs58.encode(tx.signatures[0]),lastValidBlockHeight:block.lastValidBlockHeight,lamports:amount,fee};
    state.funding_signature=state.funding.signature;save();
  }
  if(!await deliver('funding')){print(result());return;}
  if(!state.creation){
    const tx=await buildCreate();
    const block=await rpc.getLatestBlockhash('finalized');tx.message.recentBlockhash=block.blockhash;tx.sign([child,mint]);
    const balance=await rpc.getBalance(child.publicKey,'finalized');
    const sim=await rpc.simulateTransaction(tx,{sigVerify:true,commitment:'finalized',accounts:{encoding:'base64',addresses:[child.publicKey.toBase58()]}});
    if(sim.value.err)throw new Error('Creation simulation failed; allocated SOL remains in the isolated wallet');
    const after=sim.value.accounts?.[0]?.lamports;
    const fee=(await rpc.getFeeForMessage(tx.message,'finalized')).value;
    if(!Number.isSafeInteger(after)||!Number.isSafeInteger(fee)||after<0)throw new Error('Incomplete simulation cost');
    // Add fee conservatively even if this RPC already includes it in simulated balances.
    const estimated=Math.max(0,balance-after)+fee+state.funding.fee;
    state.estimated_lamports=estimated;
    if(estimated>CAP)throw new Error('Simulation exceeds the 0.025 SOL cap');
    state.creation={raw:Buffer.from(tx.serialize()).toString('base64'),signature:bs58.encode(tx.signatures[0]),lastValidBlockHeight:block.lastValidBlockHeight};
    state.signature=state.creation.signature;save();
  }
  if(!await deliver('creation')){print(result());return;}
  const confirmed=await rpc.getTransaction(state.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  if(!confirmed?.meta){state.status='pending';state.reason='Waiting for transaction accounting';save();print(result());return;}
  state.actual_lamports=state.funding.fee+confirmed.meta.preBalances[0]-confirmed.meta.postBalances[0];
  state.residual_lamports=await rpc.getBalance(child.publicKey,'finalized');
  if(!state.sweep && state.residual_lamports>0){
    const block=await rpc.getLatestBlockhash('finalized');
    const message=amount=>new TransactionMessage({payerKey:child.publicKey,recentBlockhash:block.blockhash,instructions:[SystemProgram.transfer({fromPubkey:child.publicKey,toPubkey:treasury.publicKey,lamports:amount})]}).compileToV0Message();
    const fee=(await rpc.getFeeForMessage(message(1),'finalized')).value;
    if(Number.isSafeInteger(fee) && state.residual_lamports>fee){
      const tx=new VersionedTransaction(message(state.residual_lamports-fee));tx.sign([child]);
      state.sweep={raw:Buffer.from(tx.serialize()).toString('base64'),signature:bs58.encode(tx.signatures[0]),lastValidBlockHeight:block.lastValidBlockHeight,fee};save();
    }
  }
  if(state.sweep){
    if(!await deliver('sweep')){print(result());return;}
    state.actual_lamports+=state.sweep.fee;
    state.residual_lamports=await rpc.getBalance(child.publicKey,'finalized');
  }
  state.status='confirmed';state.reason='Creation finalized; unused SOL returned where sufficient to cover return fee';save();print(result());
}
main().catch(error=>{
  // No raw RPC URLs, credentials or upstream response bodies in public logs.
  const safe = /^(Invalid job|Live execution|Missing wallet|Wallet file permissions|RPC must|Pump launch|Unexpected |Only one |Metadata or creator|Mint mismatch|Creator signer|Missing Pump|Unrecognized |Unsupported instruction|Address lookup|Invalid funding|Invalid string|Invalid boolean|Pinata upload HTTP \d+$|PumpPortal create HTTP \d+; zero-buy may not be supported$|Invalid IPFS|Treasury needs|Creation simulation failed|Incomplete simulation|Simulation exceeds)/;
  print({status:'worker_error',reason:safe.test(error.message)?error.message:'Launch worker stopped on a network or provider error; no replacement transaction is created automatically.'});
  process.exitCode=1;
});

// Intentionally never regenerates/rebroadcasts an ambiguous transaction.
export async function deliverOnce(state, slot, rpc, save, paused, sleep) {
  const record=state[slot];
  let status=(await rpc.getSignatureStatuses([record.signature],{searchTransactionHistory:true})).value[0];
  if(!status && !record.attempted){
    if(paused()){state.status='pending';state.reason='Paused before submission';save();return false;}
    record.attempted=true;save();
    try{await rpc.sendRawTransaction(Buffer.from(record.raw,'base64'),{skipPreflight:false,maxRetries:0,preflightCommitment:'finalized'});}catch{ /* timeout is not proof of failure */ }
  }
  for(let i=0;i<8;i++){
    status=(await rpc.getSignatureStatuses([record.signature],{searchTransactionHistory:true})).value[0];
    if(status?.confirmationStatus==='finalized'){
      if(status.err){state.status='failed';state.reason=slot+' transaction failed on chain';save();return false;}
      return true;
    }
    await sleep(1200);
  }
  state.status='pending';state.reason='Awaiting finalized '+slot+' signature; no replacement will be sent';save();return false;
}

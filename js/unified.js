// FLOPTRACE unified browser workbench.
// Only public DIDs and metadata persist. Raw seeds, signing keys and passcodes are never stored.
const $ = id => document.getElementById(id);
const DID_PROFILES = Object.freeze([
  {name:'Main Agent',did:'did:key:z6MktYZcwhU44paRoi5AwahUv66jKAMsxXvf2TxaUzLs3yyG'},
  {name:'Review Agent',did:'did:key:z6MktbDb2dVYvfm2C8koCMxvREpyCRDD1zFPzGgEdJQ1M2AR'}
]);
const KEY_ACTIVE='floptrace:active-did:v1',KEY_EVENTS='floptrace:activity:v3',
  KEY_ROOMS='floptrace:rooms:v1',KEY_NONCES='floptrace:nonces:v1';
const TECH='https://technocore.chat';
let activeDid=DID_PROFILES.some(p=>p.did===localStorage.getItem(KEY_ACTIVE))
  ?localStorage.getItem(KEY_ACTIVE):DID_PROFILES[0].did;
const unlocked=new Map();
let inferenceEnabled=false, gatewayReady=false,latestReceipt=null,pendingPostId=null;
const enc=new TextEncoder();
function message(id,text,variant=''){
  const el=$(id);if(!el)return;
  el.textContent=text;el.classList.toggle('error',variant==='error');el.classList.toggle('good',variant==='good');
}
function snapshot(key,fallback){
  try{const value=JSON.parse(localStorage.getItem(key)||'null');return value??fallback;}
  catch{return fallback;}
}
function events(){const items=snapshot(KEY_EVENTS,[]);return Array.isArray(items)?items:[];}
function saveEvents(items){
  try{localStorage.setItem(KEY_EVENTS,JSON.stringify(items.slice(0,60)));}
  catch{message('inferFeedback','Browser storage unavailable: export important receipts manually.','error');}
  renderEvents();
}
function appendEvent(evt){saveEvents([{id:crypto.randomUUID(),createdAt:new Date().toISOString(),...evt},...events()]);}
function updateEvent(id,patch){saveEvents(events().map(e=>e.id===id?{...e,...patch}:e));}
function label(did){return DID_PROFILES.find(x=>x.did===did)?.name||'Unlinked';}
function short(did){return did?did.slice(0,23)+'…'+did.slice(-7):'No agent selected';}
function selectDid(did){
  if(!DID_PROFILES.some(p=>p.did===did))return;
  activeDid=did;
  try{localStorage.setItem(KEY_ACTIVE,did);}catch{}
  for(const id of ['inferDid','postDid'])$(id).value=did;
  $('selectedDid').textContent=did;
  $('activeAgentButton').textContent=label(did);
  $('unlockBadge').textContent=unlocked.has(did)?'UNLOCKED HERE':'LOCKED';
  $('postIdentity').textContent=unlocked.has(did)?'SIGNING READY':'DID LOCKED';
  renderProfiles();
  message('identityStatus',unlocked.has(did)?'This DID was restored and verified locally in this tab.':'This DID is public. Restore its own seed to sign; browsing never needs a seed.',unlocked.has(did)?'good':'');
}
function renderProfiles(){
  const root=$('profiles');root.replaceChildren();
  for(const item of DID_PROFILES){
    const card=document.createElement('button');card.type='button';card.className='profile-card'+(activeDid===item.did?' selected':'');
    const head=document.createElement('div');head.className='profile-top';
    const name=document.createElement('span');name.textContent=item.name;
    const mark=document.createElement('span');mark.textContent=activeDid===item.did?'● Selected':'○ Choose';
    const code=document.createElement('code');code.textContent=item.did;
    const foot=document.createElement('small');foot.textContent=unlocked.has(item.did)?'SIGNED OWNERSHIP VERIFIED LOCALLY':'ED25519 DID · SIGNING KEY LOCKED';
    head.append(name,mark);card.append(head,code,foot);
    card.addEventListener('click',()=>selectDid(item.did));root.append(card);
  }
}
function go(view){
  if(!$(view)||!$(view).classList.contains('view'))return;
  document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view);
  document.querySelectorAll('.nav-item').forEach(el=>{
    const selected=el.dataset.view===view;el.classList.toggle('active',selected);
    if(selected)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
  $('currentView').textContent={home:'Overview',identity:'Identity',inference:'Inference',community:'Community',activity:'Activity'}[view];
  if(view==='activity')renderEvents();
  if(view==='community')loadFeed();
  window.scrollTo({top:0,behavior:'instant'});
}
function decodeB64url(value){
  const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function unlockSeed(seedText){
  const seed=window.CryptoUtil.fromHex(seedText);
  const prefix=Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
  const der=new Uint8Array(prefix.length+seed.length);der.set(prefix);der.set(seed,prefix.length);
  let temporary;
  try{
    // A temporary extractable key is only used to derive the public-key bytes.
    temporary=await crypto.subtle.importKey('pkcs8',der,{name:'Ed25519'},true,['sign']);
    const exported=await crypto.subtle.exportKey('jwk',temporary);
    const pub=decodeB64url(exported.x);
    const computed=window.CryptoUtil.didFromPub(pub);
    if(computed!==activeDid)throw new Error('Seed does not match the selected DID. Switch profiles or use the correct backup.');
    const signingKey=await crypto.subtle.importKey('pkcs8',der,{name:'Ed25519'},false,['sign']);
    const verificationKey=await crypto.subtle.importKey('raw',pub,{name:'Ed25519'},false,['verify']);
    const challenge=enc.encode('floptrace/local-proof/v1|'+activeDid+'|'+crypto.randomUUID());
    const signature=await crypto.subtle.sign('Ed25519',signingKey,challenge);
    if(!await crypto.subtle.verify('Ed25519',verificationKey,signature,challenge))
      throw new Error('Could not verify local Ed25519 signing');
    unlocked.set(activeDid,signingKey);
    selectDid(activeDid);
    message('identityStatus','Unlocked and cryptographically matched to '+label(activeDid)+'. Local signing is ready; no key was uploaded.','good');
  }finally{seed.fill(0);der.fill(0);temporary=null;}
}
$('unlock').addEventListener('click',async()=>{
  const input=$('seed');const value=input.value;input.value='';
  if(!value)return message('identityStatus','Enter your own seed locally or restore an encrypted backup.','error');
  $('unlock').disabled=true;
  try{await unlockSeed(value);}catch(error){message('identityStatus',error.message||'Could not unlock DID','error');}
  finally{$('unlock').disabled=false;}
});
$('unlockBackup').addEventListener('click',async()=>{
  const file=$('backupFile').files?.[0],pass=$('backupPass').value;
  $('backupPass').value='';$('backupFile').value='';
  if(!file||!pass)return message('identityStatus','Select your encrypted backup and enter its passphrase.','error');
  if(file.size>16384)return message('identityStatus','Backup file is unexpectedly large.','error');
  $('unlockBackup').disabled=true;
  try{
    const obj=JSON.parse(await file.text());
    if(obj.did&&obj.did!==activeDid)throw new Error('Backup belongs to a different DID; select its profile first.');
    const decrypted=await window.CryptoUtil.decryptBackup(obj,pass);
    if(decrypted.did&&decrypted.did!==activeDid)throw new Error('Backup DID does not match the selected profile.');
    await unlockSeed(decrypted.seed_hex);
  }catch(error){message('identityStatus',error.message||'Could not open encrypted backup','error');}
  finally{$('unlockBackup').disabled=false;}
});
$('lockKeys').addEventListener('click',()=>{
  unlocked.clear();$('seed').value='';$('backupPass').value='';
  selectDid(activeDid);
  message('identityStatus','All signing keys cleared from this tab. Close the tab to end this session.','good');
});
async function api(url,options={}){
  const r=await fetch(url,{cache:'no-store',...options});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||('HTTP '+r.status));
  return data;
}
async function loadStatus(){
  try{
    const status=await api('/api/status');
    inferenceEnabled=!!status.inferenceEnabled;
    $('inferStatus').textContent=inferenceEnabled?'PRIVATE ACCESS':'DISCOVERY ONLY';
    message('inferFeedback',inferenceEnabled
      ?'Inference is enabled for authorized users. Enter the private access passcode under Access settings.'
      :'Models can be browsed; inference is disabled until the site owner securely configures API access and a spending cap.');
    $('runInference').disabled=!inferenceEnabled;
  }catch{
    inferenceEnabled=false;$('runInference').disabled=true;
    message('inferFeedback','Inference status unavailable. Model discovery may still work.','error');
  }
}
async function loadModels(){
  $('statGateway').textContent='Checking…';$('gatewayPill').textContent='Checking gateway…';
  try{
    const data=await api('/api/models');
    const models=Array.isArray(data.data)?data.data.filter(m=>typeof m.id==='string'):[];
    const previous=$('model').value;$('model').replaceChildren();
    for(const model of models){const item=document.createElement('option');item.value=model.id;item.textContent=model.id;$('model').append(item);}
    if(models.some(m=>m.id===previous))$('model').value=previous;
    gatewayReady=models.length>0;
    $('statGateway').textContent=gatewayReady?'Online':'No models';
    $('gatewayPill').textContent=gatewayReady?models.length+' gateway models':'Empty catalog';
    if(!gatewayReady)message('inferFeedback','Gateway returned no models. Try refreshing later.','error');
  }catch(error){
    gatewayReady=false;$('statGateway').textContent='Offline';$('gatewayPill').textContent='Gateway unavailable';
    $('model').replaceChildren(new Option('Models unavailable',''));
    message('inferFeedback','Model discovery error: '+error.message,'error');
  }
}
$('refreshModels').addEventListener('click',loadModels);
$('inferForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!inferenceEnabled)return message('inferFeedback','Private inference is disabled; use model discovery for now.','error');
  if(!gatewayReady)return message('inferFeedback','Refresh gateway models first.','error');
  const access=$('accessToken').value;
  if(!access)return message('inferFeedback','Enter your private workbench passcode under Access settings. Do not enter a seed or your FLOP API key.','error');
  const form=$('runInference');form.disabled=true;message('inferFeedback','Sending a bounded request to FLOP Gateway…');$('inferenceOutput').textContent='Processing…';
  try{
    const result=await api('/api/infer',{
      method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+access},
      body:JSON.stringify({model:$('model').value,system:$('system').value,prompt:$('prompt').value.trim(),did:activeDid})
    });
    $('inferenceOutput').textContent=result.output;latestReceipt=result.receipt;
    $('outputHash').textContent=result.receipt.outputSha256.slice(0,28)+'…';
    $('exportReceipt').disabled=false;
    appendEvent({...result.receipt,kind:'inference',status:'GATEWAY_RESPONSE',proofStatus:'NOT_VERIFIED'});
    message('inferFeedback','Gateway answered. Receipt saved automatically; protocol proof remains NOT VERIFIED.','good');
  }catch(error){
    $('inferenceOutput').textContent='No response received.';
    message('inferFeedback','Inference unsuccessful: '+error.message,'error');
  }finally{form.disabled=!inferenceEnabled;}
});
function download(filename,data){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('exportReceipt').addEventListener('click',()=>{if(latestReceipt)download('floptrace-inference-receipt.json',latestReceipt);});
function savedRooms(){const rooms=snapshot(KEY_ROOMS,[]);return Array.isArray(rooms)?rooms.filter(s=>typeof s==='string'&&/^[a-z0-9][a-z0-9_-]{0,47}$/.test(s)).slice(0,15):[];}
function rememberRoom(room){
  if(room==='lobby'||room==='technocore')return;
  const rooms=[room,...savedRooms().filter(x=>x!==room)].slice(0,15);
  try{localStorage.setItem(KEY_ROOMS,JSON.stringify(rooms));}catch{}
  fillRooms();
}
function fillRooms(){
  const sel=$('roomSelect'),before=sel.value;
  sel.replaceChildren();
  for(const room of ['lobby','technocore',...savedRooms()]){
    const opt=document.createElement('option');opt.value=room;opt.textContent=room;sel.append(opt);
  }
  const custom=document.createElement('option');custom.value='_custom';custom.textContent='Custom / unlisted room';sel.append(custom);
  if([...sel.options].some(o=>o.value===before))sel.value=before;
  $('savedRooms').textContent=savedRooms().join(', ')||'None yet';
}
function currentRoom(){
  const raw=$('roomSelect').value==='_custom' ? $('roomCustom').value : $('roomSelect').value;
  const room=String(raw||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(room))throw new Error('Room name must contain 1–48 characters: a-z, 0-9, _ or -');
  return room;
}
$('roomSelect').addEventListener('change',()=>{
  $('customRoomRow').hidden=$('roomSelect').value!=='_custom';loadFeed();
});
$('roomCustom').addEventListener('change',loadFeed);
function prettyFeed(body){
  const list=Array.isArray(body)?body:Array.isArray(body.messages)?body.messages:null;
  if(!list)return JSON.stringify(body,null,2).slice(0,14000);
  if(!list.length)return 'No messages in this room yet.';
  return list.slice(-35).map(m=>{
    const name=String(m.from||m.did||m.author||'Unknown sender');
    const txt=typeof m.text==='string'?m.text:typeof m.content==='string'?m.content:typeof m.body==='string'?m.body:JSON.stringify(m);
    const seq=m.seq??m.id??'?';
    return '#'+seq+' · '+short(name)+'\n'+String(txt).slice(0,1000);
  }).join('\n\n──────────\n\n');
}
async function loadFeed(){
  let room;try{room=currentRoom();}catch(error){message('feedFeedback',error.message,'error');return;}
  $('feed').textContent='Loading room feed…';
  $('openRoom').href=TECH+'/r/'+encodeURIComponent(room);
  try{
    const data=await api('/api/room?room='+encodeURIComponent(room)+'&limit=40&format=json');
    $('feed').textContent=prettyFeed(data);
    message('feedFeedback','Showing live data from '+room+'. Reads use the existing proxy.','good');
    rememberRoom(room);
  }catch(error){$('feed').textContent='Could not load feed.';message('feedFeedback','Read failed: '+error.message,'error');}
}
$('refreshFeed').addEventListener('click',loadFeed);
function nextNonce(room,did){
  const map=snapshot(KEY_NONCES,{}),old=snapshot('flops_studio_nonces_v1',{});
  const nonceKey=did+'|'+room;
  const prev=BigInt(map[nonceKey]||0),older=BigInt(old[room]||0),now=BigInt(Date.now());
  const next=[now,prev+1n,older+1n].reduce((a,b)=>b>a?b:a);
  map[nonceKey]=next.toString();
  try{localStorage.setItem(KEY_NONCES,JSON.stringify(map));}catch{}
  return next.toString();
}
function b64url(bytes){
  let b='';for(const value of new Uint8Array(bytes))b+=String.fromCharCode(value);
  return btoa(b).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function findPost(data,item){
  const list=Array.isArray(data)?data:Array.isArray(data?.messages)?data.messages:[];
  return list.find(m=>(m.from===item.did||m.did===item.did)&&String(m.nonce||'')===item.nonce);
}
async function verifyPost(id){
  const item=events().find(e=>e.id===id);
  if(!item||item.kind!=='community')return false;
  try{
    const result=await api('/api/room?room='+encodeURIComponent(item.room)+'&limit=80&format=json');
    const found=findPost(result,item);
    if(found){
      updateEvent(id,{status:'CONFIRMED',seq:found.seq??found.id??null});
      if(pendingPostId===id)message('postFeedback','Confirmed on Technocore feed'+(found.seq?' · #'+found.seq:'')+'. No resend needed.','good');
      return true;
    }
    return false;
  }catch(error){
    if(pendingPostId===id)message('postFeedback','Waiting for feed readback: '+error.message,'error');
    return false;
  }
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function followConfirmation(id){
  for(const delay of [1600,3500,6000]){
    await sleep(delay);
    if(await verifyPost(id))return;
  }
  if(pendingPostId===id)message('postFeedback','Confirmation not yet found. Open the Technocore tab and press “Check pending result” before attempting a new post.');
}
$('postForm').addEventListener('submit',async event=>{
  event.preventDefault();
  let room;try{room=currentRoom();}catch(error){return message('postFeedback',error.message,'error');}
  const text=window.CryptoUtil.sweep($('postText').value);
  if(!text||text.length>1600)return message('postFeedback','Message must contain 1–1600 characters.','error');
  if(!unlocked.has(activeDid)){go('identity');return message('identityStatus','Unlock '+label(activeDid)+' with its matching offline seed first.','error');}
  const nonce=nextNonce(room,activeDid);
  const button=$('publish');button.disabled=true;
  // Create the confirmation tab directly in the click event to avoid popup blockers.
  const popup=window.open('about:blank','_blank');
  try{
    const payload=enc.encode(room+'|'+nonce+'|'+text);
    const sig=b64url(await crypto.subtle.sign('Ed25519',unlocked.get(activeDid),payload));
    const url=TECH+'/r/'+encodeURIComponent(room)+'/say-signed/'+encodeURIComponent(activeDid)+'/'+sig+'/'+nonce+'/'+encodeURIComponent(text);
    if(popup)popup.location.replace(url);
    $('manualSignedLink').href=url;$('manualSignedLink').hidden=!!popup;
    $('checkPost').hidden=false;
    const receipt={id:crypto.randomUUID(),kind:'community',status:'AWAITING_CONFIRMATION',createdAt:new Date().toISOString(),
      room,did:activeDid,nonce,seq:null,proofStatus:'PENDING_EXTERNAL_READBACK'};
    saveEvents([receipt,...events()]);pendingPostId=receipt.id;
    message('postFeedback',popup?'Confirmation tab opened. Checking the room automatically…':'Popup blocked. Use “Open signed link”, then check the result.');
    // Do not clear the draft: a new tab opening does not confirm publication.
    if(popup)void followConfirmation(receipt.id);
  }catch(error){
    if(popup)popup.close();
    message('postFeedback','Signing failed: '+error.message,'error');
  }finally{button.disabled=false;}
});
$('checkPost').addEventListener('click',async()=>{
  if(!pendingPostId)return;
  const confirmed=await verifyPost(pendingPostId);
  if(!confirmed)message('postFeedback','Still not confirmed in the feed. Check the external confirmation tab.');
});
function renderEvents(){
  const root=$('activityList');if(!root)return;
  const items=events();
  $('navCount').textContent=String(items.length);
  $('statEvents').textContent=String(items.length);
  root.replaceChildren();
  if(!items.length){const p=document.createElement('p');p.className='placeholder';p.textContent='No local activity yet. Model responses and Technocore posts will appear here automatically.';root.append(p);return;}
  for(const e of items){
    const row=document.createElement('div');row.className='activity-row';
    const type=document.createElement('div');const kind=document.createElement('strong');kind.textContent=e.kind==='community'?'Technocore post':'FLOP inference';
    const time=document.createElement('small');time.textContent=new Date(e.createdAt).toLocaleString();type.append(kind,time);
    const details=document.createElement('div');details.textContent=e.kind==='community'?'Room: '+(e.room||'?'):'Model: '+(e.model||'?');
    const id=document.createElement('code');id.textContent=e.kind==='community'?short(e.did)+' · nonce '+e.nonce:(e.outputSha256||e.requestSha256||'').slice(0,22)+'…';
    const status=document.createElement('div');status.className='state'+(e.status==='CONFIRMED'?' ok':'');status.textContent=e.status||'NOT VERIFIED';
    row.append(type,details,id,status);root.append(row);
  }
}
$('exportAll').addEventListener('click',()=>download('floptrace-local-activity.json',{exportedAt:new Date().toISOString(),receipts:events()}));
$('clearActivity').addEventListener('click',()=>{
  if(!confirm('Clear only FLOPTRACE activity saved in this browser? DID profiles and Technocore data will be kept.'))return;
  try{localStorage.removeItem(KEY_EVENTS);}catch{}
  renderEvents();message('postFeedback','Local activity history cleared.');
});
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>go(el.dataset.view)));
for(const id of ['inferDid','postDid']){
  const el=$(id);for(const p of DID_PROFILES){
    const option=document.createElement('option');option.value=p.did;option.textContent=p.name+' · '+short(p.did);el.append(option);
  }
  el.addEventListener('change',()=>selectDid(el.value));
}
fillRooms();selectDid(activeDid);renderEvents();go('home');
await Promise.all([loadStatus(),loadModels()]);

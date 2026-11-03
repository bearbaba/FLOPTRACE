import {isValidEd25519Did,normalizedProfiles,addProfile,removeProfile} from './did-utils.mjs';
const $ = id => document.getElementById(id);
const KEY_PROFILES='floptrace:profiles:v4';
const KEY_ACTIVE='floptrace:active-did:v1',KEY_EVENTS='floptrace:activity:v3',
  KEY_ROOMS='floptrace:rooms:v1',KEY_NONCES='floptrace:nonces:v1';
const TECH='https://technocore.chat';
let DID_PROFILES=(()=>{try{return normalizedProfiles(JSON.parse(localStorage.getItem(KEY_PROFILES)||'[]'));}catch{return [];}})();
let activeDid=DID_PROFILES.some(p=>p.did===localStorage.getItem(KEY_ACTIVE))
  ?localStorage.getItem(KEY_ACTIVE):(DID_PROFILES[0]?.did||'');
const unlocked=new Map();
let inferenceEnabled=false, gatewayReady=false,latestReceipt=null,pendingPostId=null;
let publicModels=[];
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
function label(did){return DID_PROFILES.find(x=>x.did===did)?.name||'No agent';}
function short(did){return did?did.slice(0,23)+'…'+did.slice(-7):'No agent selected';}
function persistProfiles(){
  try{localStorage.setItem(KEY_PROFILES,JSON.stringify(DID_PROFILES));}catch{}
  $('statAgents').textContent=String(DID_PROFILES.length);
}
function populateAgentPickers(){
  for(const id of ['inferDid','postDid']){
    const el=$(id);el.replaceChildren();
    const empty=document.createElement('option');empty.value='';empty.textContent='Select an agent';el.append(empty);
    for(const p of DID_PROFILES){
      const option=document.createElement('option');
      option.value=p.did;option.textContent=p.name+' · '+short(p.did);el.append(option);
    }
    el.value=activeDid;
  }
}
function selectDid(did){
  if(did&&!DID_PROFILES.some(p=>p.did===did))return;
  activeDid=did||'';
  try{if(activeDid)localStorage.setItem(KEY_ACTIVE,activeDid);else localStorage.removeItem(KEY_ACTIVE);}catch{}
  for(const id of ['inferDid','postDid'])$(id).value=activeDid;
  $('selectedDid').textContent=activeDid||'No agent selected';
  $('activeAgentButton').textContent=activeDid?label(activeDid):'Create an agent';
  $('unlockBadge').textContent=unlocked.has(activeDid)?'UNLOCKED HERE':'LOCKED';
  $('postIdentity').textContent=unlocked.has(activeDid)?'SIGNING READY':'DID LOCKED';
  renderProfiles();
  renderEvents();
  if(!activeDid)message('identityStatus','Create a new DID, restore an encrypted backup, or add an existing public DID.');
  else message('identityStatus',unlocked.has(activeDid)
    ?'This DID is verified locally in this tab. You can sign messages.'
    :'Public profile selected. Unlock its matching seed locally to sign.',unlocked.has(activeDid)?'good':'');
}
function renderProfiles(){
  const root=$('profiles');root.replaceChildren();
  $('statAgents').textContent=String(DID_PROFILES.length);
  if(!DID_PROFILES.length){
    const hint=document.createElement('p');hint.className='placeholder';
    hint.textContent='No identities yet. Create your first DID or add an existing one below.';
    root.append(hint);return;
  }
  for(const item of DID_PROFILES){
    const card=document.createElement('div');card.className='profile-card'+(activeDid===item.did?' selected':'');
    const top=document.createElement('div');top.className='profile-top';
    const name=document.createElement('strong');name.textContent=item.name;
    const status=document.createElement('span');status.textContent=unlocked.has(item.did)?'● Signing ready':'○ Key locked';
    const code=document.createElement('code');code.textContent=item.did;
    const actions=document.createElement('div');actions.className='profile-actions';
    const choose=document.createElement('button');choose.className='secondary';choose.type='button';
    choose.textContent=activeDid===item.did?'Selected':'Use this agent';
    choose.disabled=activeDid===item.did;
    choose.addEventListener('click',()=>selectDid(item.did));
    const forget=document.createElement('button');forget.className='inline-button danger-text';forget.type='button';
    forget.textContent='Remove';
    forget.addEventListener('click',()=>{
      if(!confirm('Remove '+item.name+' from this browser? The DID can only be restored with your own seed or backup. Local activity history will remain.'))return;
      DID_PROFILES=removeProfile(DID_PROFILES,item.did);
      unlocked.delete(item.did);persistProfiles();populateAgentPickers();
      selectDid(DID_PROFILES[0]?.did||'');
    });
    top.append(name,status);actions.append(choose,forget);
    card.append(top,code,actions);root.append(card);
  }
}
function registerProfile(did,name){
  DID_PROFILES=addProfile(DID_PROFILES,{did,name});
  persistProfiles();populateAgentPickers();selectDid(did);
  return did;
}
function go(view){
  if(!$(view)||!$(view).classList.contains('view'))return;
  document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view);
  document.querySelectorAll('.nav-item').forEach(el=>{
    const selected=el.dataset.view===view;el.classList.toggle('active',selected);
    if(selected)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
  $('currentView').textContent={home:'Overview',devnet:'Devnet Hub',identity:'Identity',inference:'Inference',community:'Community',activity:'Activity'}[view];
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
  if(!activeDid)return message('identityStatus','Select or import a DID before unlocking its seed.','error');
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
  let inserted=null;
  try{
    const obj=JSON.parse(await file.text());
    const decrypted=await window.CryptoUtil.decryptBackup(obj,pass);
    const did=decrypted.did||obj.did;
    if(!isValidEd25519Did(did))throw new Error('This file does not contain a valid public Ed25519 DID.');
    if(!DID_PROFILES.some(p=>p.did===did)){
      inserted=did;registerProfile(did,'Restored Agent');
    }else selectDid(did);
    await unlockSeed(decrypted.seed_hex);
    message('identityStatus','Encrypted backup restored. Your DID was matched and unlocked locally.','good');
  }catch(error){
    if(inserted){
      DID_PROFILES=removeProfile(DID_PROFILES,inserted);persistProfiles();populateAgentPickers();
      selectDid(DID_PROFILES[0]?.did||'');
    }
    message('identityStatus',error.message||'Could not open encrypted backup','error');
  }finally{$('unlockBackup').disabled=false;}
});
$('importAgent').addEventListener('click',()=>{
  const did=$('importDid').value.trim(),name=$('importName').value.trim();
  try{
    registerProfile(did,name||'Imported Agent');
    $('importDid').value='';$('importName').value='';
    message('identityStatus','Public DID added locally. To sign, unlock it using its matching seed.','good');
  }catch(error){message('identityStatus',error.message,'error');}
});
$('createAgent').addEventListener('click',async()=>{
  const name=$('createName').value.trim()||'My Agent';
  const pass=$('createPass').value,again=$('createPassConfirm').value;
  $('createPass').value='';$('createPassConfirm').value='';
  if(pass.length<12||pass!==again)return message('identityStatus','Enter a matching backup passphrase of at least 12 characters.','error');
  $('createAgent').disabled=true;
  try{
    if(!crypto.subtle||!crypto.subtle.generateKey)throw new Error('Secure browser cryptography is unavailable.');
    const pair=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
    const pubJwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
    const privJwk=await crypto.subtle.exportKey('jwk',pair.privateKey);
    const publicBytes=decodeB64url(pubJwk.x);
    const seed=decodeB64url(privJwk.d);
    if(seed.length!==32)throw new Error('Unsupported Ed25519 key format.');
    const seedHex=Array.from(seed,b=>b.toString(16).padStart(2,'0')).join('');
    const did=window.CryptoUtil.didFromPub(publicBytes);
    const backup=await window.CryptoUtil.encryptBackup(seedHex,did,pass);
    seed.fill(0);
    // Never persist an unencrypted seed. The encrypted backup must be retained by its owner.
    download('floptrace-'+did.slice(-9)+'-ENCRYPTED.json',backup);
    registerProfile(did,name);
    await unlockSeed(seedHex);
    $('createName').value='';
    message('identityStatus','Agent created and unlocked. An encrypted backup download was initiated. Confirm you have saved the file and passphrase before closing the tab.','good');
  }catch(error){message('identityStatus',error.message||'Unable to create an identity','error');}
  finally{$('createAgent').disabled=false;}
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
function renderModelCatalogue(){
  const root=$('modelResults');
  if(!root)return;
  root.replaceChildren();
  const query=$('modelSearch').value.trim().toLowerCase();
  const filtered=publicModels.filter(m=>m.id.toLowerCase().includes(query));
  $('modelCount').textContent=publicModels.length?filtered.length+' of '+publicModels.length+' models':'No models';
  if(!filtered.length){
    const item=document.createElement('p');item.className='placeholder';
    item.textContent=publicModels.length?'No model ID matches your search.':'Public model catalogue is unavailable.';
    root.append(item);return;
  }
  for(const model of filtered.slice(0,18)){
    const item=document.createElement('div');item.className='model-item';
    const name=document.createElement('code');name.textContent=model.id;
    const row=document.createElement('div');row.className='row';
    const choose=document.createElement('button');choose.type='button';choose.className='inline-button';
    choose.textContent='Use model →';
    choose.addEventListener('click',()=>{
      $('model').value=model.id;
      $('model').focus();
      message('inferFeedback','Model selected. Public discovery is available; completions require authorized access.');
    });
    const copy=document.createElement('button');copy.type='button';copy.className='inline-button';
    copy.textContent='Copy ID';
    copy.addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(model.id);message('inferFeedback','Model ID copied.');}
      catch{message('inferFeedback','Clipboard unavailable. Select and copy the model ID manually.','error');}
    });
    row.append(choose,copy);item.append(name,row);root.append(item);
  }
  if(filtered.length>18){
    const hint=document.createElement('p');hint.className='placeholder';
    hint.textContent='Showing the first 18 matches. Refine your search to find more models.';
    root.append(hint);
  }
}
$('modelSearch').addEventListener('input',renderModelCatalogue);
async function loadModels(){
  $('statGateway').textContent='Checking…';$('gatewayPill').textContent='Checking gateway…';
  try{
    const data=await api('/api/models');
    const models=Array.isArray(data.data)?data.data.filter(m=>typeof m.id==='string'):[];
    publicModels=models;
    const previous=$('model').value;$('model').replaceChildren();
    for(const model of models){const item=document.createElement('option');item.value=model.id;item.textContent=model.id;$('model').append(item);}
    if(models.some(m=>m.id===previous))$('model').value=previous;
    gatewayReady=models.length>0;
    $('statGateway').textContent=gatewayReady?'Available':'No models';
    $('gatewayPill').textContent=gatewayReady?models.length+' gateway models':'Empty catalog';
    renderModelCatalogue();
    if(!gatewayReady)message('inferFeedback','Gateway returned no models. Try refreshing later.','error');
  }catch(error){
    publicModels=[];renderModelCatalogue();
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
      body:JSON.stringify({model:$('model').value,system:$('system').value,prompt:$('prompt').value.trim(),did:activeDid||null})
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
      if(pendingPostId===id)void loadFeed();
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
  if(popup)popup.opener=null;
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
  const items=events().filter(e=>activeDid?e.did===activeDid:!e.did);
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
$('exportAll').addEventListener('click',()=>download('floptrace-agent-activity.json',{exportedAt:new Date().toISOString(),selectedDid:activeDid||null,receipts:events().filter(e=>activeDid?e.did===activeDid:!e.did)}));
$('clearActivity').addEventListener('click',()=>{
  if(!confirm('Clear local activity for '+(activeDid?label(activeDid):'unlinked activity')+' only? Other agent records will be kept.'))return;
  saveEvents(events().filter(e=>activeDid?e.did!==activeDid:!!e.did));
  message('postFeedback','Selected agent activity cleared from this browser.');
});
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>go(el.dataset.view)));
for(const id of ['inferDid','postDid']){
  $(id).addEventListener('change',()=>selectDid($(id).value));
}
populateAgentPickers();
// Read-only Devnet helper: the SS58 address is never sent to FLOPTRACE or stored locally.
$('copyAddress').addEventListener('click',async()=>{
  const address=$('devnetAddress').value.trim();
  if(!/^[1-9A-HJ-NP-Za-km-z]{35,64}$/.test(address)){
    return message('addressFeedback','That does not resemble a public SS58 address. Do not enter a DID or seed phrase.','error');
  }
  try{
    await navigator.clipboard.writeText(address);
    message('addressFeedback','Address copied. Paste it into the official Faucet. This only checks its appearance, not its checksum or balance.','good');
  }catch{
    message('addressFeedback','Clipboard unavailable. Select your address and copy it manually.','error');
  }
});
for(const button of document.querySelectorAll('[data-copy-target]')){
  button.addEventListener('click',async()=>{
    const source=$(button.dataset.copyTarget);
    if(!source)return;
    try{
      await navigator.clipboard.writeText(source.textContent.trim());
      message('copyFeedback','Copied. Check the official docs before running any command.','good');
    }catch{
      message('copyFeedback','Clipboard unavailable. Select the command and copy it manually.','error');
    }
  });
}

fillRooms();selectDid(activeDid);renderEvents();go('home');
await Promise.all([loadStatus(),loadModels()]);

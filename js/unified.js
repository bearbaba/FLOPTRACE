import {isValidEd25519Did,normalizedProfiles,addProfile,removeProfile} from './did-utils.mjs';
import {createLocalIdentity} from './identity-create.mjs';
import {validateSs58} from './ss58-utils.mjs';
import { LAUNCH_UTC, getLaunchCountdown } from './launch-clock.mjs';
const $ = id => document.getElementById(id);
const KEY_PROFILES='floptrace:profiles:v4';
const MAX_LOCAL_DIDS=2;
const KEY_ACTIVE='floptrace:active-did:v1',KEY_EVENTS='floptrace:activity:v3',
  KEY_ROOMS='floptrace:rooms:v1',KEY_NONCES='floptrace:nonces:v1';
const TECH='https://technocore.chat';
let DID_PROFILES=(()=>{try{return normalizedProfiles(JSON.parse(localStorage.getItem(KEY_PROFILES)||'[]'));}catch{return [];}})();
let activeDid=DID_PROFILES.some(p=>p.did===localStorage.getItem(KEY_ACTIVE))
  ?localStorage.getItem(KEY_ACTIVE):(DID_PROFILES[0]?.did||'');
if(!DID_PROFILES.slice(0,MAX_LOCAL_DIDS).some(p=>p.did===activeDid))activeDid=DID_PROFILES[0]?.did||'';
const unlocked=new Map();
let pendingPostId=null;
let publicModels=[];
// Only an encrypted backup can be re-downloaded; no raw seed or passphrase is stored.
let recentEncryptedBackup=null;
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
function updateEvent(id,patch){saveEvents(events().map(e=>e.id===id?{...e,...patch}:e));}
function label(did){return DID_PROFILES.find(x=>x.did===did)?.name||'No agent';}
function short(did){return did?did.slice(0,23)+'…'+did.slice(-7):'No DID selected';}
function persistProfiles(){
  try{localStorage.setItem(KEY_PROFILES,JSON.stringify(DID_PROFILES));}catch{}
  $('statAgents').textContent=String(DID_PROFILES.length);
}
function allowedLocalDid(did){
  return DID_PROFILES.slice(0,MAX_LOCAL_DIDS).some(p=>p.did===did);
}
function ensureNewDidCapacity(){
  if(DID_PROFILES.length>=MAX_LOCAL_DIDS)
    throw Error('This browser already has two saved DIDs. Remove a local profile to add another. Keep a backup before removing any DID.');
}
function assertDidUsage(did){
  if(!allowedLocalDid(did))
    throw Error('Only the two saved DID profiles on this browser can sign through FLOPTRACE.');
}
function refreshDidQuotaStatus(){
  const el=$('didQuotaStatus');
  if(el)el.textContent=DID_PROFILES.length+' of '+MAX_LOCAL_DIDS+
    ' DID profiles saved in this browser. No IP tracking, invite link or server registration.';
}
function populateAgentPickers(){
  const el=$('postDid');
  el.replaceChildren();
  const empty=document.createElement('option');empty.value='';empty.textContent='Select a DID';el.append(empty);
  for(const p of DID_PROFILES.slice(0,MAX_LOCAL_DIDS)){
    const option=document.createElement('option');
    option.value=p.did;option.textContent=p.name+' · '+short(p.did);el.append(option);
  }
  el.value=activeDid;
}
function updateJourney(){
  const hasDid=!!activeDid,canSign=hasDid&&unlocked.has(activeDid);
  const did=$('journeyDidStatus'),chat=$('journeyChatStatus'),community=$('communityState');
  if(did)did.textContent=hasDid?'Saved: '+label(activeDid):'No DID saved on this device';
  if(chat)chat.textContent=!hasDid?'Start with step 1 · Create or import a DID'
    :canSign?'Unlocked · Ready to sign':'DID saved · Unlock before posting';
  if(community)community.textContent=!hasDid
    ?'No DID yet. Create one or import an existing DID to get started.'
    :canSign?'DID is ready to sign on this device.':'DID selected. Unlock its signing key locally before posting.';
}
function selectDid(did){
  if(did&&!allowedLocalDid(did))return;
  activeDid=did||'';
  try{if(activeDid)localStorage.setItem(KEY_ACTIVE,activeDid);else localStorage.removeItem(KEY_ACTIVE);}catch{}
  $('postDid').value=activeDid;
  $('chatNext').textContent=unlocked.has(activeDid)?'Open TechnoCore chat':'Unlock DID to chat';
  $('selectedDid').textContent=activeDid||'No agent selected';
  $('activeAgentButton').textContent=activeDid?'DID: '+label(activeDid):'Create agent DID';
  $('unlockBadge').textContent=unlocked.has(activeDid)?'UNLOCKED':'LOCKED';
  $('postIdentity').textContent=unlocked.has(activeDid)?'READY TO SIGN':'DID LOCKED';
  renderProfiles();
  renderEvents();
  updateJourney();
  const nextStep=$('identityNextStep'),nextText=$('identityNextText');
  if(nextStep)nextStep.hidden=!activeDid;
  if(nextText&&activeDid)nextText.textContent=unlocked.has(activeDid)
    ?'Your DID is saved on this device. The unlocked signing key exists only in this tab; verify that you downloaded your encrypted backup before closing it.'
    :'Your public DID is saved in this browser and survives reloads. Restore its matching private Ed25519 key locally to sign.';
  if(!activeDid)message('identityStatus','Create a DID, restore an encrypted backup, or import a public DID to get started.');
  else message('identityStatus',unlocked.has(activeDid)
    ?'Your DID is unlocked locally. You can sign TechnoCore posts.'
    :'Public DID saved. Unlock its matching private Ed25519 key locally to sign.',unlocked.has(activeDid)?'good':'');
}
function renderProfiles(){
  const limitReached=DID_PROFILES.length>=MAX_LOCAL_DIDS;
  refreshDidQuotaStatus();
  const wizard=$('createWizard'),limitNote=$('didCreateLimit');
  if(wizard)wizard.hidden=limitReached;
  if(limitNote)limitNote.hidden=!limitReached;
  if(limitReached&&$('createAnother'))$('createAnother').hidden=true;
  const root=$('profiles');root.replaceChildren();
  $('statAgents').textContent=String(DID_PROFILES.length);
  if(!DID_PROFILES.length){
    const hint=document.createElement('p');hint.className='placeholder';
    hint.textContent='No DID yet. Select Create a new DID or Import DID below.';
    root.append(hint);return;
  }
  for(const item of DID_PROFILES.slice(0,MAX_LOCAL_DIDS)){
    const card=document.createElement('div');card.className='profile-card'+(activeDid===item.did?' selected':'');
    const top=document.createElement('div');top.className='profile-top';
    const name=document.createElement('strong');name.textContent=item.name;
    const status=document.createElement('span');status.textContent=unlocked.has(item.did)?'● Signing ready':'○ Key locked';
    const code=document.createElement('code');code.textContent=item.did;
    const actions=document.createElement('div');actions.className='profile-actions';
    const choose=document.createElement('button');choose.className='secondary';choose.type='button';
    choose.textContent=activeDid===item.did?'Selected':'Use this DID';
    choose.disabled=activeDid===item.did;
    choose.addEventListener('click',()=>selectDid(item.did));
    const forget=document.createElement('button');forget.className='inline-button danger-text';forget.type='button';
    forget.textContent='Remove from device';
    forget.addEventListener('click',()=>{
      if(!confirm('Remove '+item.name+' from this browser? You will need your encrypted backup or original key to restore it. Local activity history will remain.'))return;
      DID_PROFILES=removeProfile(DID_PROFILES,item.did);
      unlocked.delete(item.did);persistProfiles();populateAgentPickers();
      selectDid(DID_PROFILES[0]?.did||'');
    });
    top.append(name,status);actions.append(choose,forget);
    card.append(top,code,actions);root.append(card);
  }
  if(DID_PROFILES.length>MAX_LOCAL_DIDS){
    const note=document.createElement('p');
    note.className='field-hint';
    note.textContent='Older profiles over the two-DID limit remain in browser storage but cannot be used here. Back up their signing keys before clearing browser data.';
    root.append(note);
  }
}
function registerProfile(did,name){
  if(!DID_PROFILES.some(p=>p.did===did)&&DID_PROFILES.length>=MAX_LOCAL_DIDS)
    throw Error('Two DID profiles maximum per browser. Save a backup before removing one.');
  const next=addProfile(DID_PROFILES,{did,name});
  try{
    localStorage.setItem(KEY_PROFILES,JSON.stringify(next));
  }catch{
    throw new Error('This browser blocked local DID storage. Enable site storage or leave private browsing mode and try again.');
  }
  DID_PROFILES=next;
  $('statAgents').textContent=String(DID_PROFILES.length);
  populateAgentPickers();selectDid(did);
  return did;
}
function currentRouteView(){
  if(/^\/devnet\/?$/.test(window.location.pathname))return 'devnet';
  const requested=new URLSearchParams(window.location.search).get('view');
  return ['home','devnet','identity','inference','community','activity'].includes(requested)?requested:'home';
}
function go(view,updateHistory=true){
  if(!$(view)||!$(view).classList.contains('view'))return;
  document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view);
  document.querySelectorAll('.nav-item').forEach(el=>{
    const selected=el.dataset.view===view;el.classList.toggle('active',selected);
    if(selected)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
  $('currentView').textContent={home:'Home',devnet:'Devnet archive',identity:'Agent DID',inference:'Devnet models',community:'Chat TechnoCore',activity:'Activity'}[view];
  if(updateHistory){
    const path=view==='devnet'?'/devnet':view==='home'?'/':'/?view='+encodeURIComponent(view);
    if(path!==window.location.pathname+window.location.search)history.pushState({view},'',path);
  }
  if(view==='activity')renderEvents();
  if(view==='community')loadFeed();
  if(view==='devnet')void loadDevnetHealth();
  window.scrollTo({top:0,behavior:'instant'});
}
window.addEventListener('popstate',()=>go(currentRouteView(),false));
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
    assertDidUsage(activeDid);
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
      ensureNewDidCapacity();
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
function identityFeedback(field,description,variant=''){
  message(field,description,variant);
  message('identityStatus',description,variant);
}
$('importAgent').addEventListener('click',async()=>{
  const did=$('importDid').value.trim(),name=$('importName').value.trim();
  if(!isValidEd25519Did(did))return identityFeedback('importFeedback','Paste your complete public Ed25519 did:key (not a wallet address).','error');
  try{
    if(DID_PROFILES.some(p=>p.did===did)){
      selectDid(did);
      identityFeedback('importFeedback','This DID is already saved here. Profile selected — no need to recreate it.','good');
    }else{
      ensureNewDidCapacity();
      registerProfile(did,name||'Imported Agent');
      identityFeedback('importFeedback','Your public DID is saved in this browser. Import does not create or restore its private signing key.','good');
    }
    $('importDid').value='';$('importName').value='';
  }catch(error){identityFeedback('importFeedback',error.message||'Unable to add DID','error');}
});
let createStage=1;
function showCreateStage(stage){
  createStage=stage;
  for(let n=1;n<=3;n++)$('createStage'+n).hidden=n!==stage;
  message('createFeedback','');
  $([null,'createName','createPass','createPassConfirm'][stage]).focus();
}
$('backToName').addEventListener('click',()=>showCreateStage(1));
$('backToPassword').addEventListener('click',()=>showCreateStage(2));
$('createAnother').addEventListener('click',()=>{
  $('createdDidResult').hidden=true;
  $('createAnother').hidden=true;
  $('createWizard').hidden=false;
  showCreateStage(1);
});
$('createWizard').addEventListener('submit',async event=>{
  event.preventDefault();
  if(createStage===1){showCreateStage(2);return;}
  if(createStage===2){
    if($('createPass').value.length<12){
      $('createPass').focus();
      return identityFeedback('createFeedback','Choose a backup password of at least 12 characters.','error');
    }
    $('createPassConfirm').value='';
    showCreateStage(3);return;
  }
  const button=$('createAgent');
  if(button.disabled)return;
  const name=$('createName').value.trim()||'My Agent';
  const pass=$('createPass').value,again=$('createPassConfirm').value;
  if(pass.length<12)return identityFeedback('createFeedback','Enter a new password of at least 12 characters to protect your agent backup.','error');
  if(pass!==again)return identityFeedback('createFeedback','The two backup passwords must match. Enter the same password in both fields.','error');
  button.disabled=true;
  $('backToPassword').disabled=true;
  identityFeedback('createFeedback','Creating and locally verifying your encrypted agent backup…');
  try{
    ensureNewDidCapacity();
    const {did,backup,signingKey}=await createLocalIdentity(pass,{webCrypto:crypto,cryptoUtil:window.CryptoUtil});
    const filename='floptrace-'+did.slice(-9)+'-ENCRYPTED.json';
    recentEncryptedBackup={did,filename,backup};
    $('createdDidValue').textContent=did;
    $('createdDidResult').hidden=false;
    // Persist the public DID only after the encrypted backup is ready.
    // No IP address, external account or private key is sent to a server.
    registerProfile(did,name);
    unlocked.set(did,signingKey);
    selectDid(did);
    $('createName').value='';
    let downloadMessage='Your DID was created, signed and verified locally. Encrypted backup download started; confirm the JSON file is saved before closing this tab.';
    try{download(filename,backup);}
    catch{
      downloadMessage='Your DID is created, but the backup download could not start automatically. Use “Download encrypted backup again” below before closing this tab.';
    }
    $('createWizard').hidden=true;
    $('createAnother').hidden=DID_PROFILES.length>=MAX_LOCAL_DIDS;
    $('copyCreatedDid').focus();
    identityFeedback('createFeedback',downloadMessage,'good');
  }catch(error){
    identityFeedback('createFeedback',error?.message||'Could not create a DID. Try an updated browser with HTTPS and enabled storage.','error');
  }finally{
    $('createPass').value='';$('createPassConfirm').value='';
    if(!$('createWizard').hidden){
      createStage=2;$('createStage3').hidden=true;$('createStage2').hidden=false;$('createPass').focus();
    }
    $('backToPassword').disabled=false;
    button.disabled=false;
  }
});
$('copyCreatedDid').addEventListener('click',async()=>{
  const did=$('createdDidValue').textContent.trim();
  if(!isValidEd25519Did(did))return;
  try{
    await navigator.clipboard.writeText(did);
    identityFeedback('createFeedback','Public DID copied. Only share the public DID, never its private key or backup passphrase.','good');
  }catch{
    identityFeedback('createFeedback','Clipboard access was blocked. Select the public DID shown above and copy it manually.','error');
  }
});
$('downloadCreatedBackup').addEventListener('click',()=>{
  if(!recentEncryptedBackup)return identityFeedback('createFeedback','No backup is available in this tab. Restore an existing encrypted backup if needed.','error');
  try{
    download(recentEncryptedBackup.filename,recentEncryptedBackup.backup);
    identityFeedback('createFeedback','Encrypted backup download started again. Check that the file was saved.','good');
  }catch{
    identityFeedback('createFeedback','Your browser blocked the download. Allow downloads for FLOPTRACE and try again.','error');
  }
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
    const copy=document.createElement('button');copy.type='button';copy.className='inline-button';
    copy.textContent='Copy ID';
    copy.addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(model.id);message('inferFeedback','Model ID copied.');}
      catch{message('inferFeedback','Clipboard unavailable. Select and copy the model ID manually.','error');}
    });
    row.append(copy);item.append(name,row);root.append(item);
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
    const gatewayReady=models.length>0;
    $('statGateway').textContent=gatewayReady?'Available':'No models';
    $('gatewayPill').textContent=gatewayReady?models.length+' gateway models':'Empty catalog';
    renderModelCatalogue();
    if(!gatewayReady)message('inferFeedback','Gateway returned no models. Try refreshing later.','error');
  }catch(error){
    publicModels=[];renderModelCatalogue();
    $('statGateway').textContent='Offline';$('gatewayPill').textContent='Gateway unavailable';
    message('inferFeedback','Model discovery error: '+error.message,'error');
  }
}
$('refreshModels').addEventListener('click',loadModels);
function download(filename,data){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');
  a.href=url;a.download=filename;
  document.body.append(a);
  try{a.click();}
  finally{
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30_000);
  }
}
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
  return list.find(m=>(m.from===item.did||m.did===item.did)&&String(m.nonce||'')===item.nonce&&(!item.sig||item.sig===m.sig));
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
  if(!activeDid){go('identity');$('importDid').focus();return;}
  if(!unlocked.has(activeDid)){openSigner();return message('identityStatus','Unlock '+label(activeDid)+' with its matching offline seed first.','error');}
  const did=activeDid;
  try{assertDidUsage(did);}catch(error){return message('postFeedback',error.message,'error');}
  const nonce=nextNonce(room,did);
  const button=$('publish');button.disabled=true;
  // Create the confirmation tab directly in the click event to avoid popup blockers.
  const popup=window.open('about:blank','_blank');
  if(popup)popup.opener=null;
  try{
    const payload=enc.encode(room+'|'+nonce+'|'+text);
    const sig=b64url(await crypto.subtle.sign('Ed25519',unlocked.get(did),payload));
    const url=TECH+'/r/'+encodeURIComponent(room)+'/say-signed/'+encodeURIComponent(did)+'/'+sig+'/'+nonce+'/'+encodeURIComponent(text);
    if(popup)popup.location.replace(url);
    $('manualSignedLink').href=url;$('manualSignedLink').hidden=!!popup;
    $('checkPost').hidden=false;
    const receipt={id:crypto.randomUUID(),kind:'community',status:'AWAITING_CONFIRMATION',createdAt:new Date().toISOString(),
      room,did,nonce,sig,seq:null,proofStatus:'PENDING_EXTERNAL_READBACK'};
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

/* Read-only Testnet cutover. The backend verifies operator-pinned official genesis against RPC.
   Neither the clock nor a passing date can activate this interface. */
let testnetVerified=false;
function applyTestnetReadiness(readiness){
  const verified=readiness?.testnetVerified===true
    && readiness?.status==='GENESIS_VERIFIED'
    && /^0x[0-9a-f]{64}$/.test(readiness?.genesisHash||'');
  testnetVerified=verified;
  document.body.classList.toggle('testnet-verified',verified);
  for(const id of ['navDevnet','navDevnetInference','homeDevnetCTA','homeDevnetCard',
    'devnetHomeDisclaimer','gatewayStatCard','gatewayPill','checkLaunchCTA']){
    const el=$(id);if(el)el.hidden=verified;
  }
  const hero=$('testnetStartHero'),ready=$('testnetReadyPanel'),clock=$('testnetCountdownPanel');
  const timing=document.querySelector('#home .launch-timing');
  if(hero)hero.hidden=!verified;
  if(ready)ready.hidden=!verified;
  if(clock)clock.hidden=verified;
  if(timing)timing.hidden=verified;
  const badge=document.querySelector('#home .launch-state');
  if(badge)badge.textContent=verified?'TESTNET LIVE · REWARDS NOT ACTIVE':'TESTNET ANNOUNCED · VERIFYING RPC';
  const sideBadge=$('sideNetworkBadge'),sideNote=$('sideNetworkNote');
  if(sideBadge?.lastChild?.nodeType===3)sideBadge.lastChild.textContent=verified?' FLOP TESTNET · UNSCORED':' FLOP DEVNET';
  if(sideNote)sideNote.textContent=verified
    ?'Testnet verified · Rewards not active'
    :'Independent community portal · Devnet is unscored';
  const optionalSelectors=['#home .testnet-opening-notice','#home .reward-explainer',
    '#home .launch-steps','#home .testnet-more','#home .launch-actions',
    '#home .launch-safety'];
  for(const selector of optionalSelectors){
    const node=document.querySelector(selector);
    if(node)node.hidden=verified;
  }
  const title=$('launchGuideTitle'),headline=$('heroTitle'),intro=$('heroIntro'),bring=$('bringMyDidCTA');
  if(title)title.textContent=verified?'Testnet live · Rewards not active':'Verifying Testnet RPC';
  if(headline){
    const first=document.createTextNode('Your DID.');
    const breakLine=document.createElement('br');
    const highlight=document.createElement('em');
    highlight.textContent='Your agent.';
    headline.replaceChildren(first,breakLine,highlight);
  }
  if(intro)intro.textContent=verified
    ?'Create or import an agent DID, then sign TechnoCore posts from your own device. FLOP Testnet genesis is verified, but rewards are not active.'
    :'You can still manage your DID and use TechnoCore. Testnet genesis verification is unavailable: do not assume the chain or faucet is ready.';
  if(bring)bring.textContent='Create or import DID ↗';
  if(bring){bring.classList.remove('secondary');bring.classList.add('primary');}
  const announcement=$('testnetAnnouncementLink');
  if(announcement)announcement.href=verified?readiness.officialAnnouncement:'https://ask.flop.finance/networks/testnet';
  const genesis=$('verifiedGenesisHash');
  if(genesis)genesis.textContent=verified?readiness.genesisHash:'—';
  if($('home')&&!$('home').hidden)$('currentView').textContent='Home';
}
async function loadTestnetFaucet(){
  // The public button is a direct external link to FLOP, never a claim or signing proxy.
  // Keep it visible even when status checks fail; never imply grants are available.
  const setStatus=text=>{
    $('testnetFaucetState').textContent=text;
    $('journeyFaucetStatus').textContent=text;
  };
  try{
    const {network,status}=await api('/api/testnet-faucet');
    const verified=network==='testnet'&&testnetVerified;
    setStatus(!verified?'Faucet Testnet identity not verified. Confirm the official network before signing.':
      status==='open'?'Faucet reports open · Grants still depend on eligibility and balance':
      status==='low_balance'?'Faucet low balance · Token grants are currently unavailable':
      'Faucet token grants not confirmed. Check the official website.');
  }catch{
    setStatus('Faucet status unavailable. Check the official FLOP website before signing.');
  }
}
async function loadTestnetReadiness(){
  try{
    const status=await api('/api/testnet-readiness');
    applyTestnetReadiness(status);
    if(status.testnetVerified)await loadTestnetFaucet();
    else{
      $('journeyFaucetStatus').textContent='Testnet genesis unverified · Verify the official network before signing';
    }
  }catch{
    // Fail closed on malformed/failed API, even if the target clock reached zero.
    applyTestnetReadiness(null);
    $('journeyFaucetStatus').textContent='RPC unavailable · Verify the official network before signing';
  }
}


/* A launch TARGET clock, never a claim that the Testnet is live. */
function updateLaunchTarget(){
  const local=$('testnetLocalTime'), note=$('testnetCountdown');
  const panel=$('testnetCountdownPanel'), clock=$('testnetCountdownClock');
  if(!local||!note||!panel||!clock)return;
  const target=new Date(LAUNCH_UTC);
  local.textContent=new Intl.DateTimeFormat(undefined,{
    year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'
  }).format(target);
  const countdown=getLaunchCountdown();
  const format=n=>String(n).padStart(2,'0');
  for(const [id,value] of [['clockDays',countdown.days],['clockHours',countdown.hours],
    ['clockMinutes',countdown.minutes],['clockSeconds',countdown.seconds]]){
    const cell=$(id);
    if(cell)cell.textContent=format(value);
  }
  const wasElapsed=panel.dataset.phase==='elapsed';
  if(countdown.elapsed){
    panel.dataset.phase='elapsed';
    clock.setAttribute('aria-label','The announced FLOP Testnet target time has passed');
    if(!wasElapsed){
      note.textContent='FLOP has announced an early, unscored Testnet opening. Independent RPC confirmation on FLOPTRACE is still pending; no vouchers are earned yet.';
    }
  }else{
    panel.dataset.phase='counting';
    // Static message avoids announcing every changing second to screen readers.
    if(wasElapsed){
      note.textContent='Official opening is announced but reward activation has not been published. A clock alone does not verify RPC or vouchers.';
    }
  }
}
updateLaunchTarget();
setInterval(updateLaunchTarget,1000);
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)updateLaunchTarget();
});

$('postDid').addEventListener('change',()=>selectDid($('postDid').value));
function openSigner(){
  go('identity');
  document.querySelector('.identity-advanced').open=true;
  $('seed').focus();
}
$('chatNext').addEventListener('click',()=>{
  if(unlocked.has(activeDid)){go('community');$('postText').focus();}
  else openSigner();
});
populateAgentPickers();
let lastHealthCheck=0,healthLoading=false;
async function loadDevnetHealth(force=false){
  if(healthLoading||(!force&&Date.now()-lastHealthCheck<45_000))return;
  healthLoading=true;
  $('refreshFaucet').disabled=true;
  message('faucetNote','Checking the official service and explorer. Grant availability is never inferred from health alone.');
  try{
    const r=await api('/api/devnet-health');
    lastHealthCheck=Date.now();
    $('faucetService').textContent=r.faucetService==='reachable'?'Reachable':r.faucetService==='degraded'?'Degraded':'Unknown';
    $('faucetIndexer').textContent=r.explorerIndexer==='live'?
      'Live'+(r.headLag!==null?' · lag '+r.headLag:''):
      r.explorerIndexer==='catching_up'?'Catching up':'Unknown';
    message('faucetNote','Test FLOP grants are NOT VERIFIED. A healthy service can still reject requests (for example, HTTP 503). Use the official faucet and verify any grant on Explorer.');
  }catch{
    $('faucetService').textContent='Unknown';$('faucetIndexer').textContent='Unknown';
    message('faucetNote','Live diagnostics unavailable. Faucet grant availability remains unknown. Open the official service for details.','error');
  }finally{healthLoading=false;$('refreshFaucet').disabled=false;}
}
$('refreshFaucet').addEventListener('click',()=>loadDevnetHealth(true));
// Read-only wallet helper: validate full SS58 checksum locally before copying.
$('copyAddress').addEventListener('click',async()=>{
  const address=$('devnetAddress').value.trim();
  const validation=await validateSs58(address);
  if(!validation.valid) return message('addressFeedback',validation.reason,'error');
  try{
    await navigator.clipboard.writeText(address);
    message('addressFeedback','SS58 checksum valid. Address copied; paste into official Faucet. This does not prove account ownership or network compatibility.','good');
  }catch{
    message('addressFeedback','Checksum valid, but clipboard unavailable. Select and copy the address manually.','error');
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

fillRooms();selectDid(activeDid);renderEvents();go(currentRouteView(),false);
await Promise.all([loadModels(),loadTestnetReadiness()]);
setInterval(loadTestnetReadiness,60_000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void loadTestnetReadiness();});

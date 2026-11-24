// Wallet-free FLOPTRACE WL. Admission requires a random one-use invitation
// (1 seat of a 100-seat batch), a public X handle, and a verified CAPTCHA.
// The server is the only authority: all privileged APIs validate session cookies.
const $=id=>document.getElementById(id);
const endpoint='/api/community-access';
let state={configured:false,isMember:false,isAdmin:false,handle:null,siteKey:null};
let changed=()=>{},joinWidget=null,adminWidget=null,loadingTurnstile=null;
export function memberToolsAllowed(){return state.isMember===true;}
function show(id,value){const el=$(id);if(el)el.hidden=!value;}
function note(value,bad=false){
  $('accessFeedback').textContent=value;
  $('accessFeedback').classList.toggle('error',bad);
  $('accessFeedback').classList.toggle('good',!bad);
}
async function post(action,body={}){
  const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...body})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'Request failed ('+response.status+').');
  return result;
}
function render(){
  $('accessBadge').textContent=state.isMember?'MEMBER':state.configured?'INVITE ONLY':'SETUP REQUIRED';
  const slots=state.slots||{};
  const claimed=Number(slots.claimed)||0;
  const size=Number(slots.capacity)||100;
  $('accessSlotsText').textContent=!state.configured?'Hệ thống lời mời chưa kích hoạt':
    slots.closed?'Đợt hiện tại đã đóng':
    slots.active?claimed+' / '+size+' suất đã sử dụng · '+Math.max(0,size-claimed)+' suất còn lại':
      'Chưa có đợt lời mời đang mở';
  $('accessSlotsFill').style.width=Math.min(100,Math.max(0,claimed/size*100))+'%';
  $('accessMember').textContent=state.isMember?'Đã đăng nhập thành viên @'+state.handle+'.':
    'Chưa có phiên thành viên đang hoạt động.';
  $('accessJoin').disabled=!state.configured||state.isMember;
  $('accessAdminSignIn').disabled=!state.configured;
  show('accessLogout',!!state.isMember||!!state.isAdmin);
  show('accessAdminLogin',!state.isAdmin);
  show('accessAdminPanel',!!state.isAdmin);
  $('accessIssueBatch').disabled=!state.isAdmin||!!(slots.active&&slots.remaining>0);
  $('accessCloseBatch').disabled=!state.isAdmin||!slots.active||!slots.remaining;
  for(const el of document.querySelectorAll('.nav-item[data-view="identity"],.nav-item[data-view="inference"],.nav-item[data-view="community"],.nav-item[data-view="activity"]')){
    el.hidden=!memberToolsAllowed();
  }
  if(!state.configured)note('Đang chuẩn bị. Chưa có cấu hình lưu thành viên và CAPTCHA nên hệ thống không nhận link hay cấp quyền. Không cần kết nối ví.',true);
  else if(state.isMember)note('Đã kích hoạt thành viên. Các chức năng riêng vẫn được máy chủ xác minh trước mỗi yêu cầu.');
  else note('Mở một link mời riêng, điền Handle X và giải CAPTCHA để kích hoạt một suất. Không cần ký ví.');
}
async function refresh(){
  try{
    const response=await fetch(endpoint,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw Error('Membership service unavailable');
    state=await response.json();
  }catch{state={configured:false,isMember:false,isAdmin:false,handle:null,siteKey:null};}
  render();changed();
}
function captchaValue(widget){return widget!==null&&window.turnstile?window.turnstile.getResponse(widget)||'':'';}
function captchaReset(widget){if(widget!==null&&window.turnstile)window.turnstile.reset(widget);}
async function loadTurnstile(){
  if(window.turnstile)return window.turnstile;
  if(loadingTurnstile)return loadingTurnstile;
  loadingTurnstile=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async=true;
    script.addEventListener('load',()=>{
      if(window.turnstile)resolve(window.turnstile);
      else reject(Error('CAPTCHA chưa khởi tạo được.'));
    },{once:true});
    script.addEventListener('error',()=>reject(Error('Không tải được dịch vụ CAPTCHA.')),{once:true});
    document.head.append(script);
  });
  return loadingTurnstile;
}
export async function activateAccessCaptcha(){
  if(!state.configured||!state.siteKey)return;
  try{
    const widget=await loadTurnstile();
    if(joinWidget===null&&!$('access').hidden){
      joinWidget=widget.render('#accessCaptcha',{sitekey:state.siteKey,action:'floptrace_join',theme:'light',size:'flexible'});
    }
    const admin=document.querySelector('.access-admin-tools');
    if(adminWidget===null&&admin?.open){
      adminWidget=widget.render('#accessAdminCaptcha',{sitekey:state.siteKey,action:'floptrace_admin',theme:'light',size:'flexible'});
    }
  }catch(error){note(error.message,true);}
}
function readPrivateInviteFromLink(){
  const found=window.location.hash.match(/^#invite=([a-f0-9]{64})$/i);
  if(!found)return;
  $('accessInvite').value=found[1];
  // Strip secret fragment from history immediately; fragment never hits HTTP or referrer.
  history.replaceState(history.state,'',window.location.pathname+window.location.search);
}
async function join(){
  const button=$('accessJoin');
  button.disabled=true;
  try{
    const inviteCode=$('accessInvite').value.trim(),handle=$('accessHandle').value.trim();
    if(!/^[a-f0-9]{64}$/i.test(inviteCode))throw Error('Bạn cần một link mời riêng còn hiệu lực.');
    const captchaToken=captchaValue(joinWidget);
    if(!captchaToken)throw Error('Vui lòng giải CAPTCHA để kích hoạt.');
    const result=await post('join',{inviteCode,handle,captchaToken});
    $('accessInvite').value='';
    $('accessHandle').value='';
    await refresh();
    note('Kích hoạt thành công cho @'+result.handle+'. Đã sử dụng '+result.claimed+'/100 suất. Không cần kết nối ví.');
  }catch(error){note(error.message||'Không kích hoạt được link.',true);}
  finally{button.disabled=!state.configured||state.isMember;captchaReset(joinWidget);}
}
async function logout(){
  try{await post('logout');await refresh();}catch(error){note(error.message||'Không đăng xuất được.',true);}
}
async function adminLogin(){
  const button=$('accessAdminSignIn');button.disabled=true;
  try{
    const captchaToken=captchaValue(adminWidget);
    if(!captchaToken)throw Error('Quản trị viên cần giải CAPTCHA trước.');
    await post('admin-login',{passphrase:$('accessAdminSecret').value,captchaToken});
    $('accessAdminSecret').value='';
    await refresh();
    await listMembers();
    note('Quản trị viên đã đăng nhập. Có thể tạo 100 link mời riêng và xem suất còn lại.');
  }catch(error){note(error.message||'Không đăng nhập được.',true);}
  finally{button.disabled=!state.configured;captchaReset(adminWidget);}
}
function node(tag,value='',cls=''){
  const x=document.createElement(tag);x.textContent=String(value);if(cls)x.className=cls;
  return x;
}
async function issueBatch(){
  if(!confirm('Tạo 100 link mời bí mật (mỗi link 1 suất)? Hãy tải danh sách ngay sau khi tạo; hệ thống không lưu mã gốc.'))return;
  const button=$('accessIssueBatch');button.disabled=true;
  try{
    const result=await post('issue-batch');
    if(!Array.isArray(result.links)||result.links.length!==100)throw Error('Server did not return exactly 100 invitation links.');
    $('accessInvitationValue').value=result.links.join('\n');
    show('accessInvitation',true);
    await refresh();
    note('Đã tạo đợt 100 suất. Hãy tải file TXT ngay và chỉ gửi từng link riêng cho người được mời.');
  }catch(error){note(error.message||'Không thể mở đợt mời.',true);}
  finally{button.disabled=false;}
}
async function closeBatch(){
  if(!confirm('Đóng đợt hiện tại? Mọi link chưa dùng trong đợt này sẽ không còn kích hoạt được.'))return;
  try{
    await post('close-batch');
    $('accessInvitationValue').value='';show('accessInvitation',false);
    await refresh();
    note('Đã đóng đợt. Bạn có thể tạo đợt 100 link mới.');
  }catch(error){note(error.message||'Không đóng được đợt.',true);}
}
async function reviewRevoke(handle){
  if(!confirm('Thu hồi quyền của @'+handle+'? Phiên đang sử dụng cũng sẽ bị chặn tại API.'))return;
  try{
    await post('revoke',{handle});
    note('Đã thu hồi quyền của @'+handle+'.');
    await listMembers();
  }catch(error){note(error.message||'Không thu hồi được quyền.',true);}
}
async function listMembers(){
  const root=$('accessApplicationList');
  root.replaceChildren(node('p','Đang tải thành viên…'));
  try{
    const response=await fetch(endpoint+'?view=members',{credentials:'same-origin',cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||'Không thể xem danh sách.');
    root.replaceChildren();
    if(!data.members?.length){root.append(node('p','Chưa có thành viên.'));return;}
    for(const member of data.members){
      const card=node('article','','access-application');
      const x=node('a','@'+member.handle);
      x.href='https://x.com/'+encodeURIComponent(member.handle);
      x.target='_blank';x.rel='noopener noreferrer';card.append(x);
      card.append(node('small','Trạng thái: '+member.status));
      if(member.status==='ACTIVE'){
        const button=node('button','Thu hồi quyền');button.type='button';button.className='secondary';
        button.addEventListener('click',()=>reviewRevoke(member.handle));
        card.append(button);
      }
      root.append(card);
    }
  }catch(error){root.replaceChildren(node('p',error.message));}
}
function inviteText(){return $('accessInvitationValue').value.trim();}
async function copyInvites(){
  if(!inviteText())return;
  try{await navigator.clipboard.writeText(inviteText());note('Đã sao chép danh sách. Không đăng 100 link lên trang công khai.');}
  catch{note('Không sao chép tự động được; chọn toàn bộ nội dung và sao chép.',true);}
}
function downloadInvites(){
  const content=inviteText();if(!content)return;
  const link=document.createElement('a'),blob=new Blob([content+'\n'],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  link.href=url;link.download='FLOPTRACE-100-private-invites.txt';document.body.append(link);
  try{link.click();}
  finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  note('Đã bắt đầu tải danh sách 100 link; hãy xác nhận file được lưu trước khi rời trang.');
}
export async function setupCommunityAccess(callback){
  changed=typeof callback==='function'?callback:()=>{};
  readPrivateInviteFromLink();
  $('accessJoin').addEventListener('click',join);
  $('accessLogout').addEventListener('click',logout);
  $('accessAdminSignIn').addEventListener('click',adminLogin);
  $('accessIssueBatch').addEventListener('click',issueBatch);
  $('accessCloseBatch').addEventListener('click',closeBatch);
  $('accessAdminRefresh').addEventListener('click',listMembers);
  $('accessCopyInvitation').addEventListener('click',copyInvites);
  $('accessDownloadInvites').addEventListener('click',downloadInvites);
  document.querySelector('.access-admin-tools').addEventListener('toggle',()=>{void activateAccessCaptcha();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  await refresh();
  if(!$('access').hidden)await activateAccessCaptcha();
  if(state.isAdmin)void listMembers();
}

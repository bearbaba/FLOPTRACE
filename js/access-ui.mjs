// No wallet connections or signatures. X handle + CAPTCHA submits a pending request.
// A separately delivered secret invitation is needed to activate member rights.
const $=id=>document.getElementById(id);
const endpoint='/api/community-access';
let state={configured:false,isMember:false,isAdmin:false,handle:null,siteKey:null};
let readyCallback=()=>{},joinWidget=null,adminWidget=null,loadingTurnstile=null;
export function memberToolsAllowed(){return state.isMember===true;}
function show(id,visible){const el=$(id);if(el)el.hidden=!visible;}
function say(value,bad=false){
  const el=$('accessFeedback');el.textContent=value;
  el.classList.toggle('error',bad);el.classList.toggle('good',!bad);
}
async function post(action,fields={}){
  const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...fields})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(data.error||'Request failed ('+r.status+').');
  return data;
}
async function refresh(){
  try{
    const r=await fetch(endpoint,{cache:'no-store',credentials:'same-origin'});
    if(!r.ok)throw Error('Membership service unreachable');
    state=await r.json();
  }catch{state={configured:false,isMember:false,isAdmin:false,handle:null,siteKey:null};}
  render();
  readyCallback();
}
function render(){
  $('accessBadge').textContent=state.isMember?'MEMBER':state.configured?'APPLICATIONS OPEN':'SETUP REQUIRED';
  $('accessMember').textContent=state.isMember
    ?'Đã kích hoạt quyền thành viên FLOPTRACE cho @'+state.handle+'.'
    :'Chưa có phiên thành viên được xác thực trên thiết bị này.';
  show('accessLogout',state.isMember||state.isAdmin);
  show('accessAdminLogin',!state.isAdmin);
  show('accessAdminPanel',!!state.isAdmin);
  $('accessRedeem').disabled=!state.configured||state.isMember;
  $('accessApply').disabled=!state.configured;
  $('accessAdminSignIn').disabled=!state.configured;
  for(const node of document.querySelectorAll('.nav-item[data-view="identity"],.nav-item[data-view="inference"],.nav-item[data-view="community"],.nav-item[data-view="activity"]')){
    node.hidden=!memberToolsAllowed();
  }
  if(!state.configured)say('Danh sách truy cập chưa kích hoạt: thiếu cấu hình CAPTCHA, dữ liệu thành viên hoặc mật khẩu quản trị trên máy chủ. Không cần kết nối ví. Không có quyền nào được cấp khi hệ thống chưa sẵn sàng.',true);
  else if(state.isMember)say('Quyền thành viên đã hoạt động. API được bảo vệ vẫn kiểm tra phiên và hạn mức trước mỗi yêu cầu.');
  else say('Nhập Handle X, hoàn thành CAPTCHA và gửi đơn. Quản trị viên xác minh tài khoản trước khi cấp mã riêng.');
}
function getCaptcha(id){
  if(!window.turnstile||id===null)return '';
  return window.turnstile.getResponse(id)||'';
}
function resetCaptcha(id){if(window.turnstile&&id!==null)window.turnstile.reset(id);}
async function loadTurnstile(){
  if(window.turnstile)return window.turnstile;
  if(loadingTurnstile)return loadingTurnstile;
  loadingTurnstile=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async=true;script.defer=true;
    script.addEventListener('load',()=>{
      const check=()=>{
        if(window.turnstile)resolve(window.turnstile);
        else reject(Error('CAPTCHA widget could not initialize.'));
      };
      check();
    },{once:true});
    script.addEventListener('error',()=>reject(Error('CAPTCHA service could not be loaded.')),{once:true});
    document.head.append(script);
  });
  return loadingTurnstile;
}
export async function activateAccessCaptcha(){
  if(!state.configured||!state.siteKey)return;
  try{
    const turnstile=await loadTurnstile();
    if(joinWidget===null&&$('accessCaptcha')&&!$('access').hidden){
      joinWidget=turnstile.render('#accessCaptcha',{sitekey:state.siteKey,action:'floptrace_join',theme:'light',size:'flexible'});
    }
    const details=document.querySelector('.access-admin-tools');
    if(adminWidget===null&&details?.open){
      adminWidget=turnstile.render('#accessAdminCaptcha',{sitekey:state.siteKey,action:'floptrace_admin',theme:'light',size:'flexible'});
    }
  }catch(error){say(error.message,true);}
}
async function apply(){
  const b=$('accessApply');b.disabled=true;
  try{
    const token=getCaptcha(joinWidget);
    if(!token)throw Error('Vui lòng giải CAPTCHA trước khi gửi đơn.');
    const result=await post('apply',{handle:$('accessHandle').value,captchaToken:token});
    say(result.status==='PENDING'?'Đã nhận đơn. Quản trị viên sẽ xét duyệt và gửi mã mời riêng sau khi xác minh tài khoản X.':'Handle X này đã có yêu cầu trước đó. Liên hệ quản trị viên để xác minh.');
    $('accessHandle').value='';
  }catch(error){say(error.message||'Không gửi được đơn.',true);}
  finally{b.disabled=!state.configured;resetCaptcha(joinWidget);}
}
async function redeem(){
  const b=$('accessRedeem');b.disabled=true;
  try{
    const result=await post('redeem',{inviteCode:$('accessInvite').value.trim()});
    $('accessInvite').value='';
    await refresh();
    say('Kích hoạt thành công cho @'+result.handle+'. Không cần ký ví.',false);
  }catch(error){say(error.message||'Không kích hoạt được mã mời.',true);}
  finally{b.disabled=!state.configured||state.isMember;}
}
async function logout(){
  try{await post('logout');await refresh();}catch(error){say(error.message,true);}
}
async function adminLogin(){
  const b=$('accessAdminSignIn');b.disabled=true;
  try{
    const token=getCaptcha(adminWidget);
    if(!token)throw Error('Quản trị viên cần giải CAPTCHA trước khi đăng nhập.');
    await post('admin-login',{passphrase:$('accessAdminSecret').value,captchaToken:token});
    $('accessAdminSecret').value='';
    await refresh();await listApplications();
    say('Quản trị viên đã đăng nhập. Kiểm tra quyền sở hữu X handle trước khi cấp mã mời.');
  }catch(error){say(error.message||'Không đăng nhập được.',true);}
  finally{b.disabled=!state.configured;resetCaptcha(adminWidget);}
}
function element(tag,textValue='',className=''){
  const e=document.createElement(tag);e.textContent=String(textValue);
  if(className)e.className=className;
  return e;
}
function clearInvitation(){
  $('accessInvitationValue').textContent='';
  show('accessInvitation',false);
}
async function review(action,handle){
  if(action==='approve'&&!confirm('Bạn đã xác minh người nộp đơn sở hữu tài khoản X @'+handle+'? Mã mời sẽ cấp quyền truy cập FLOPTRACE.'))return;
  if(action==='revoke'&&!confirm('Thu hồi ngay quyền của @'+handle+'? Các phiên thành viên sẽ mất quyền ở API.'))return;
  if(action==='reissue'&&!confirm('Tạo lại mã mời @'+handle+'? Mã cũ sẽ không còn hiệu lực.'))return;
  try{
    const data=await post(action,{handle});
    clearInvitation();
    if(data.inviteCode){
      $('accessInvitationValue').textContent=data.inviteCode;
      show('accessInvitation',true);
      say('Đã tạo mã mời cho @'+handle+'. Chỉ gửi RIÊNG cho chủ tài khoản X đã xác minh. Mã không lưu trên trình duyệt.');
    }else say('Đã thu hồi quyền của @'+handle+'.');
    await listApplications();
  }catch(error){say(error.message||'Không cập nhật được thành viên.',true);}
}
async function listApplications(){
  const root=$('accessApplicationList');root.replaceChildren(element('p','Đang tải đơn tham gia…'));
  try{
    const r=await fetch(endpoint+'?view=applications',{credentials:'same-origin',cache:'no-store'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(data.error||'Danh sách không có sẵn.');
    root.replaceChildren();
    if(!data.members?.length){root.append(element('p','Chưa có đơn tham gia.'));return;}
    for(const m of data.members){
      const article=element('article','','access-application');
      const link=element('a','@'+m.handle);link.href='https://x.com/'+encodeURIComponent(m.handle);
      link.target='_blank';link.rel='noopener noreferrer';article.append(link);
      article.append(element('small','Trạng thái: '+m.status));
      const actions=element('div','','row');
      if(m.status==='PENDING'){
        const b=element('button','Đã xác minh X · Duyệt');b.type='button';b.className='primary';b.addEventListener('click',()=>review('approve',m.handle));actions.append(b);
      }else if(m.status==='APPROVED'){
        const b=element('button','Tạo lại mã mời');b.type='button';b.className='secondary';b.addEventListener('click',()=>review('reissue',m.handle));actions.append(b);
      }
      if(['APPROVED','ACTIVE'].includes(m.status)){
        const b=element('button','Thu hồi');b.type='button';b.className='secondary';
        b.addEventListener('click',()=>review('revoke',m.handle));actions.append(b);
      }
      article.append(actions);root.append(article);
    }
  }catch(error){root.replaceChildren(element('p',error.message||'Không tải được đơn.'));}
}
async function copyInvitation(){
  const value=$('accessInvitationValue').textContent.trim();
  if(!value)return;
  try{await navigator.clipboard.writeText(value);say('Mã đã sao chép. Gửi riêng tới chủ tài khoản X đã xác minh, không đăng công khai.');}
  catch{say('Không thể sao chép tự động. Chọn mã hiển thị và sao chép thủ công.',true);}
}
export async function setupCommunityAccess(callback){
  readyCallback=typeof callback==='function'?callback:()=>{};
  $('accessApply').addEventListener('click',apply);
  $('accessRedeem').addEventListener('click',redeem);
  $('accessLogout').addEventListener('click',logout);
  $('accessAdminSignIn').addEventListener('click',adminLogin);
  $('accessAdminRefresh').addEventListener('click',listApplications);
  $('accessCopyInvitation').addEventListener('click',copyInvitation);
  document.querySelector('.access-admin-tools').addEventListener('toggle',()=>{void activateAccessCaptcha();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  await refresh();
  if(!$('access').hidden)await activateAccessCaptcha();
  if(state.isAdmin)void listApplications();
}

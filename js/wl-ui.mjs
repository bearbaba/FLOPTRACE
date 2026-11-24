// FLOPTRACE community access UI. This module never grants privileges.
// Membership is verified by the server on every protected API request.
const $=id=>document.getElementById(id);
const route='/api/wl';
let state={configured:false,signedIn:false,approved:false,isAdmin:false,status:'CHECKING',wallet:null};
let onAccessChanged=()=>{};
export function memberToolsAllowed(){return !!state.configured&&(!!state.approved||!!state.isAdmin);}
function show(id,yes){const el=$(id);if(el)el.hidden=!yes;}
function note(text,error=false){
  const el=$('wlFeedback');if(!el)return;
  el.textContent=text;el.classList.toggle('error',error);el.classList.toggle('good',!error);
}
async function post(action,extra={}){
  const r=await fetch(route,{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra})});
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(body.error||'Server request was rejected ('+r.status+').');
  return body;
}
async function refresh(){
  try{
    const r=await fetch(route,{credentials:'same-origin',cache:'no-store'});
    if(!r.ok)throw Error('Membership service is not reachable.');
    state=await r.json();
  }catch{
    state={configured:false,signedIn:false,approved:false,isAdmin:false,status:'UNAVAILABLE',wallet:null};
  }
  render();
  onAccessChanged();
}
function render(){
  $('wlBadge').textContent=state.approved?'APPROVED':state.isAdmin?'ADMIN':state.signedIn?state.status:state.configured?'GUEST':'NOT READY';
  $('wlAddress').textContent=state.wallet||'Chưa kết nối ví';
  show('wlLogout',!!state.signedIn);
  show('wlLogin',!!state.configured&&!state.signedIn);
  if($('wlLogin'))$('wlLogin').disabled=!state.configured;
  show('wlApplySection',!!state.configured&&!!state.signedIn&&!state.approved&&!state.isAdmin&&state.status!=='PENDING'&&state.status!=='REVOKED');
  show('wlAdminSection',!!state.isAdmin);
  const privateButtons=document.querySelectorAll('.nav-item[data-view="identity"],.nav-item[data-view="inference"],.nav-item[data-view="community"],.nav-item[data-view="activity"]');
  for(const el of privateButtons)el.hidden=!memberToolsAllowed();
  if(!state.configured)note('Danh sách truy cập chưa được kích hoạt vì máy chủ chưa có kho lưu thành viên và ví quản trị. Không ai được tự cấp WL. Các công cụ dành cho thành viên được tạm khóa an toàn đến khi WL được cấu hình; dữ liệu DID cục bộ cũ không bị xóa.',true);
  else if(state.approved)note('Ví đã được quản trị viên duyệt. Những API được mở vẫn kiểm tra quyền WL và hạn mức ở phía máy chủ.');
  else if(state.isAdmin)note('Đã xác thực bằng ví quản trị. Bạn có thể xem hồ sơ và duyệt thành viên; quyền inference vẫn cần trạng thái member ACTIVE.');
  else if(state.status==='PENDING')note('Đơn của ví này đang chờ quản trị viên xem xét. Không được sử dụng các API dành riêng cho thành viên.');
  else if(state.status==='REVOKED')note('Quyền của ví này đã bị thu hồi. Liên hệ quản trị viên để giải quyết.');
  else if(state.signedIn)note('Đã xác thực ví. Bạn có thể nộp đơn xin vào Danh sách truy cập FLOPTRACE.');
  else note('Khách có thể xem tài liệu, trạng thái Testnet và đăng ký tham gia sau khi ký thông điệp đăng nhập.');
}
async function login(){
  const button=$('wlLogin');button.disabled=true;
  try{
    const provider=window.ethereum;
    if(!provider?.request)throw Error('Không tìm thấy ví EVM. Hãy cài ví trình duyệt phù hợp hoặc mở FLOPTRACE bên trong trình duyệt ví.');
    const accounts=await provider.request({method:'eth_requestAccounts'});
    if(!Array.isArray(accounts)||!accounts[0])throw Error('Không có địa chỉ ví để xác thực.');
    const wallet=accounts[0];
    note('Đang yêu cầu thông điệp đăng nhập. Kiểm tra nội dung trong ví trước khi ký…');
    const challenge=await post('challenge',{wallet});
    const signature=await provider.request({method:'personal_sign',params:[challenge.message,wallet]});
    await post('login',{nonce:challenge.nonce,signature});
    await refresh();
  }catch(error){
    note(error.message||'Đăng nhập không thành công.',true);
  }finally{button.disabled=!state.configured||state.signedIn;}
}
async function apply(){
  const button=$('wlApply');button.disabled=true;
  try{
    const r=await post('apply',{displayName:$('wlDisplayName').value.trim()});
    await refresh();
    if(r.status==='PENDING')note('Đã gửi đơn tham gia. Chỉ quản trị viên được phép duyệt ví.');
  }catch(error){note(error.message||'Không gửi được đơn.',true);}
  finally{button.disabled=false;}
}
async function logout(){
  try{await post('logout');await refresh();}catch(error){note(error.message,true);}
}
function text(tag,value,cls=''){
  const node=document.createElement(tag);node.textContent=String(value);if(cls)node.className=cls;return node;
}
async function review(operation,info){
  try{
    await post('review',{operation,...info});
    note('Cập nhật quyền thành viên đã được lưu trên máy chủ.');
    await list();
  }catch(error){note(error.message||'Không cập nhật được quyền thành viên.',true);}
}
async function list(){
  const root=$('wlMemberList');root.replaceChildren(text('p','Đang tải đơn tham gia...'));
  try{
    const r=await fetch(route+'?view=applications',{credentials:'same-origin',cache:'no-store'});
    const result=await r.json();
    if(!r.ok)throw Error(result.error||'Không đọc được danh sách.');
    root.replaceChildren();
    if(!Array.isArray(result.members)||!result.members.length)root.append(text('p','Chưa có đơn tham gia.'));
    for(const m of result.members.slice(0,100)){
      const card=document.createElement('article');card.className='wl-member';
      card.append(text('strong',m.displayName||'Community member'));
      card.append(text('code',m.wallet||''));
      card.append(text('small',m.status||'UNKNOWN'));
      const row=document.createElement('div');row.className='row';
      if(m.status==='PENDING'){
        const approve=text('button','Duyệt ví');approve.type='button';approve.className='primary';
        approve.addEventListener('click',()=>review('approve',{wallet:m.wallet}));row.append(approve);
      }else if(m.status==='ACTIVE'){
        const revoke=text('button','Thu hồi quyền');revoke.type='button';revoke.className='secondary';
        revoke.addEventListener('click',()=>{if(confirm('Thu hồi quyền của '+m.wallet+'?'))review('revoke',{wallet:m.wallet});});
        row.append(revoke);
      }
      card.append(row);root.append(card);
    }
  }catch(error){root.replaceChildren(text('p',error.message||'Không tải được hồ sơ.'));}
}
async function rotate(){
  const oldWallet=$('wlOldWallet').value.trim(),newWallet=$('wlNewWallet').value.trim();
  if(!/^0x[\da-fA-F]{40}$/.test(oldWallet)||!/^0x[\da-fA-F]{40}$/.test(newWallet))
    return note('Nhập đúng hai địa chỉ EVM. Ví mới phải có đơn chờ duyệt.',true);
  if(!confirm('Chuyển quyền sang ví mới và vô hiệu hóa ví cũ?'))return;
  await review('rotate',{oldWallet,newWallet});
  $('wlOldWallet').value='';$('wlNewWallet').value='';
}
export async function setupWL(callback){
  onAccessChanged=typeof callback==='function'?callback:()=>{};
  $('wlLogin').addEventListener('click',login);
  $('wlLogout').addEventListener('click',logout);
  $('wlApply').addEventListener('click',apply);
  $('wlRefreshMembers').addEventListener('click',list);
  $('wlRotate').addEventListener('click',rotate);
  await refresh();
  if(state.isAdmin)void list();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
}

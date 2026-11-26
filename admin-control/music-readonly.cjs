'use strict';
// Only public GET endpoints. Do not copy customer details or use Music database credentials.
const base='https://iextra.net';
const endpoints={shows:base+'/api/public/shows',inventory:base+'/api/public/show-inventory'};
const statuses={announced:'Đã công bố',pending:'Đang chuẩn bị',sold_out:'Hết vé',live:'Đang diễn',ended:'Đã kết thúc'};
const venues={ccc:'CCC Sa Pa',moana:'Moana Sa Pa',laocai:'Lào Cai'};
const isText=(x,n)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000;
function parseShows(body){
 if(!Array.isArray(body?.shows)||body.shows.length>600)throw Error('invalid_shows');
 const seen=new Set();
 return body.shows.map(s=>{
  if(!s||!isText(s.id,150)||seen.has(s.id)||!isText(s.artist,200)||!isText(s.venue,100)||
     typeof s.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||!Number.isFinite(Date.parse(s.date+'T00:00:00Z'))||
     !/^\d{2}:\d{2}(?::\d{2})?$/.test(s.time)||!Object.hasOwn(statuses,s.status))throw Error('invalid_show');
  seen.add(s.id);
  return {id:s.id,artist:s.artist,date:s.date,time:s.time.slice(0,5),venue:s.venue,status:s.status};
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
}
function parseInventory(body){
 if(body?.available!==true||!Array.isArray(body.inventory)||body.inventory.length>600)throw Error('invalid_inventory');
 const result=new Map();
 for(const s of body.inventory){
  if(!s||!isText(s.showId,150)||result.has(s.showId)||!count(s.capacity)||!count(s.sold)||!count(s.remaining)||
     s.sold>s.capacity||s.remaining>s.capacity||s.sold+s.remaining>s.capacity)throw Error('invalid_inventory_row');
  result.set(s.showId,{capacity:s.capacity,sold:s.sold,remaining:s.remaining});
 }
 return result;
}
async function readEndpoint(url,parse,request){
 try{
  const response=await request(url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json'},signal:AbortSignal.timeout(7000)});
  if(!response.ok)throw Error('http_error');
  return {ok:true,data:parse(await response.json())};
 }catch{return {ok:false,data:null};}
}
async function readMusicSnapshot(request=fetch,now=()=>new Date()){
 const [shows,inventory]=await Promise.all([readEndpoint(endpoints.shows,parseShows,request),readEndpoint(endpoints.inventory,parseInventory,request)]);
 return {source:'music_public_api',checkedAt:now().toISOString(),showsAvailable:shows.ok,inventoryAvailable:inventory.ok,
  rows:shows.ok?shows.data.map(s=>({...s,inventory:inventory.ok?inventory.data.get(s.id)??null:null})):[]};
}
function renderMusicSnapshot(data,esc){
 const n=x=>x==null?'—':x.toLocaleString('vi-VN');
 const when=new Date(data.checkedAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
 const rows=data.rows.map(s=>'<tr><td>'+esc(s.artist)+'</td><td>'+esc(s.date.split('-').reverse().join('/')+' '+s.time)+'</td><td>'+esc(venues[s.venue]??s.venue)+'</td><td>'+esc(statuses[s.status]??s.status)+'</td><td>'+esc(n(s.inventory?.capacity))+'</td><td>'+esc(n(s.inventory?.sold))+'</td><td>'+esc(n(s.inventory?.remaining))+'</td></tr>').join('');
 return '<main class="os-content"><section class="os-panel"><p><a href="/#platforms">‹ Nền tảng EXTRA OS</a> · <a href="/music">Làm mới</a></p><h1>Music · Lịch show và số ghế công khai</h1>'+
 '<p>Nguồn: <a href="https://iextra.net/">iextra.net</a> · truy vấn '+esc(when)+' (giờ Việt Nam). Chỉ đọc, không giữ ghế, không mở bán.</p>'+
 '<p>Lịch show: '+(data.showsAvailable?'Đọc được API':'Chưa đọc được API')+' · Số ghế: '+(data.inventoryAvailable?'Đọc được API':'Chưa đọc được API')+'</p>'+
 '<p>Lịch công khai có thể sử dụng dữ liệu dự phòng của Music. Số ghế do API công bố, chưa trừ ghế đang giữ; không phải đối soát thanh toán hay doanh thu.</p>'+
 (data.showsAvailable?'<div class="scroll"><table><thead><tr><th>Nghệ sĩ</th><th>Ngày giờ</th><th>Địa điểm</th><th>Trạng thái</th><th>Sức chứa</th><th>Đã bán theo API</th><th>Còn theo API</th></tr></thead><tbody>'+(rows||'<tr><td colspan="7">Không có show trong phản hồi.</td></tr>')+'</tbody></table></div>':'<p>Chưa có lịch để hiển thị. Không suy diễn dữ liệu khi kết nối lỗi.</p>')+
 '</section></main>';
}
module.exports={readMusicSnapshot,renderMusicSnapshot};

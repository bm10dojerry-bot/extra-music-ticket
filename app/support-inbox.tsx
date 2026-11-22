"use client";
import {useEffect,useMemo,useState,type FormEvent} from "react";
import "./support-inbox.css";

type Chat={id:string;show_id:string|null;customer_name:string;customer_phone:string|null;status:"open"|"closed";created_at:string;updated_at:string;last_customer_at:string|null;last_staff_at:string|null;assigned_staff_id:string|null;assigned_at:string|null};
type Message={id:number;sender:"staff"|"customer";body:string;staff_name:string|null;created_at:string};
type Sale={id:string;display_name:string;openCount:number};
type Filter="mine"|"open"|"unread"|"queue"|"all";
const slugNames:Record<string,string>={"dinh-dung-2811":"Đình Dũng 28/11","minh-vuong-0512":"Minh Vương 05/12","trinh-dinh-quang-1212":"Trịnh Đình Quang 12/12","khanh-phuong-1912":"Khánh Phương 19/12","ho-quang-hieu-2412":"Hồ Quang Hiếu 24/12","khac-viet-2612":"Khắc Việt 26/12","thai-hoc-3112":"Thái Học 31/12"};
const fmt=(x:string)=>{try{return new Date(x).toLocaleString("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}catch{return ""}};
const unread=(c:Chat)=>c.status==="open"&&!!c.last_customer_at&&(!c.last_staff_at||new Date(c.last_customer_at).getTime()>new Date(c.last_staff_at).getTime());
const overdue=(c:Chat,now:number)=>unread(c)&&now-new Date(c.last_customer_at!).getTime()>=60000;
const quickReplies=[
 {label:"Chào khách",text:"Em chào anh/chị! Em là nhân viên tư vấn +1 Extra. Em có thể hỗ trợ mình chọn hạng ghế và vị trí phù hợp ạ."},
 {label:"Chọn chỗ",text:"Anh/chị muốn chọn bao nhiêu chỗ, ưu tiên gần sân khấu hay khu vực dễ di chuyển ạ? Em sẽ hướng dẫn mình xem trên sơ đồ."},
 {label:"Hướng dẫn đặt chỗ",text:"Anh/chị truy cập link show → chọn chỗ trên sơ đồ → điền họ tên, số điện thoại và email → quét mã QR thanh toán → nhận mã QR xác nhận chỗ qua email."},
 {label:"Thanh toán QR",text:"Anh/chị vui lòng quét mã QR ngân hàng trên trang đặt chỗ, chuyển đúng số tiền và mã đơn hiển thị. Nếu đã chuyển mà chưa nhận email, em sẽ hỗ trợ kiểm tra ạ."},
 {label:"Kiểm tra email",text:"Anh/chị vui lòng kiểm tra Hộp thư đến và thư Spam. Nếu vẫn chưa nhận mã QR xác nhận chỗ, cho em biết email hoặc số điện thoại đã dùng khi đặt chỗ để được hỗ trợ."},
 {label:"Địa điểm & giờ",text:"Anh/chị vui lòng đối chiếu ngày giờ và địa điểm ghi trên trang show trước khi di chuyển. Nếu cần xác nhận thêm, em sẽ hướng dẫn ạ."}
];
export default function SupportInbox({embedded=false}:{embedded?:boolean}){
 const [chats,setChats]=useState<Chat[]>([]),[selected,setSelected]=useState(""),[current,setCurrent]=useState<Chat|null>(null),[messages,setMessages]=useState<Message[]>([]);
 const [staff,setStaff]=useState<Sale[]>([]),[actorId,setActorId]=useState(""),[isManager,setIsManager]=useState(false),[myOpen,setMyOpen]=useState(0),[waiting,setWaiting]=useState(0);
 const [filter,setFilter]=useState<Filter>("mine"),[search,setSearch]=useState(""),[targetStaff,setTargetStaff]=useState("");
 const [draft,setDraft]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[loading,setLoading]=useState(true),[now,setNow]=useState(Date.now());
 async function refresh(){
  const r=await fetch("/api/staff/support-chats",{cache:"no-store"});
  const d=await r.json();if(!r.ok)throw Error(d.error||"Không tải được hộp thư");
  const list=(d.chats||[]) as Chat[];setChats(list);setStaff(d.staff||[]);
  setActorId(d.actorId||"");setIsManager(Boolean(d.isManager));setMyOpen(d.myOpenCount||0);setWaiting(d.waitingCount||0);
  setFilter(v=>v==="mine"&&d.isManager?"open":v);
  setSelected(s=>list.some(c=>c.id===s)?s:list.find(c=>c.assigned_staff_id===d.actorId&&c.status==="open")?.id||list[0]?.id||"");
  setError("");setLoading(false);
 }
 useEffect(()=>{
  let live=true;async function poll(){try{if(live)await refresh()}catch(e){if(live){setError(e instanceof Error?e.message:"Không kết nối được hộp thư");setLoading(false)}}}
  void poll();const timer=setInterval(()=>void poll(),9000),clock=setInterval(()=>setNow(Date.now()),8000);
  return()=>{live=false;clearInterval(timer);clearInterval(clock)};
 },[]);
 const listed=chats.find(c=>c.id===selected)||null;
 useEffect(()=>{
  if(!selected||!listed){setCurrent(null);setMessages([]);return}
  if(!isManager&&listed.assigned_staff_id!==actorId){setCurrent(listed);setMessages([]);return}
  let live=true;
  async function loadMessages(){
   try{const r=await fetch("/api/staff/support-chats?chatId="+encodeURIComponent(selected),{cache:"no-store"});
    const d=await r.json();if(!r.ok)throw Error(d.error||"Không tải được nội dung");
    if(live){setCurrent(d.chat||null);setMessages(d.messages||[])}
   }catch(e){if(live)setError(e instanceof Error?e.message:"Không tải được tin nhắn")}
  }
  void loadMessages();const timer=setInterval(()=>void loadMessages(),6000);return()=>{live=false;clearInterval(timer)};
 },[selected,listed?.assigned_staff_id,actorId,isManager]);
 const visible=useMemo(()=>chats.filter(c=>{
  const match=filter==="all"||filter==="mine"&&c.status==="open"&&c.assigned_staff_id===actorId
   ||filter==="open"&&c.status==="open"||filter==="unread"&&unread(c)||filter==="queue"&&c.status==="open"&&!c.assigned_staff_id;
  return match&&(c.customer_name+" "+(c.customer_phone||"")+" "+(slugNames[c.show_id||""]||c.show_id||"")).toLowerCase().includes(search.toLowerCase().trim());
 }),[chats,filter,search,actorId]);
 const lateCount=chats.filter(c=>overdue(c,now)&&Boolean(c.assigned_staff_id)).length;
 const needs=chats.filter(unread).length;
 const assignedName=(c:Chat)=>staff.find(s=>s.id===c.assigned_staff_id)?.display_name||"Sale EXTRA";
 const canReply=Boolean(current&&current.status==="open"&&(isManager||current.assigned_staff_id===actorId));
 const showQueue=Boolean(current&&current.status==="open"&&!current.assigned_staff_id);
 const otherStaff=staff.filter(s=>s.id!==current?.assigned_staff_id&&s.openCount<8);
 async function doAction(payload:Record<string,unknown>){
  if(busy)return;setBusy(true);setError("");
  try{const r=await fetch("/api/staff/support-chats",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   const d=await r.json();if(!r.ok)throw Error(d.error||"Không cập nhật được");
   setTargetStaff("");await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Có lỗi khi xử lý")}finally{setBusy(false)}
 }
 async function send(e:FormEvent){
  e.preventDefault();if(!canReply||!selected||draft.trim().length<2||busy)return;
  setBusy(true);setError("");
  try{const r=await fetch("/api/staff/support-chats",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chatId:selected,message:draft.trim()})});
   const d=await r.json();if(!r.ok)throw Error(d.error||"Không gửi được");
   setMessages(d.messages||[]);setDraft("");await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Chưa gửi được tin nhắn")}finally{setBusy(false)}
 }
 return <section className={"extra-inbox "+(embedded?"extra-inbox-embedded":"")} aria-label="Hộp thư tư vấn đặt chỗ">
  <div className="extra-inbox-title"><div><small>+1 EXTRA · SALE SUPPORT</small><h2>Hộp thư tư vấn trực tuyến</h2><p>Khách được tự phân công cho Sale còn chỗ. Mỗi Sale tối đa 8 cuộc chat đang mở.</p></div><div className="extra-inbox-counts"><strong>{needs}</strong><span>Cần phản hồi</span></div></div>
  <div className="extra-inbox-kpis">
   <div><strong>{isManager?chats.filter(c=>c.status==="open"&&Boolean(c.assigned_staff_id)).length:myOpen}<span>/{isManager?staff.length*8:8}</span></strong><small>{isManager?"Đã phân công cho Sale":"Khách của tôi"}</small></div>
   <div><strong>{waiting}</strong><small>Khách chờ phân công</small></div>
   <div className={lateCount?"extra-inbox-danger":""}><strong>{lateCount}</strong><small>Chờ quá 60 giây</small></div>
   <div><strong>{staff.length}</strong><small>Sale đang hoạt động</small></div>
  </div>
  {lateCount>0&&<p className="extra-inbox-alert" role="status">⚠ Có {lateCount} khách đã chờ quá 60 giây chưa được phản hồi. Ưu tiên xử lý các cuộc chat đánh dấu đỏ.</p>}
  <div className="extra-inbox-controls"><label>Tìm khách hoặc show<input aria-label="Tìm khách hoặc show" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Tên, SĐT hoặc nghệ sĩ..."/></label><div>{([["mine","Khách của tôi"],["queue","Chờ phân công"],["unread","Chưa phản hồi"],["open","Đang mở"],["all","Tất cả"]] as const).map(([v,label])=><button type="button" key={v} className={filter===v?"active":""} onClick={()=>setFilter(v)}>{label}</button>)}</div></div>
  {isManager&&<div className="extra-inbox-team"><b>Tải Sale:</b>{staff.map(s=><span key={s.id}>{s.display_name}: <strong>{s.openCount}/8</strong></span>)}<button type="button" disabled={busy||waiting===0} onClick={()=>void doAction({action:"dispatch"})}>Phân công khách chờ</button></div>}
  {error&&<p className="extra-inbox-error" role="alert">{error}</p>}
  <div className="extra-inbox-main">
   <div className="extra-inbox-list" aria-label="Danh sách khách đang chờ tư vấn">
    {loading?<p className="extra-inbox-muted">Đang tải...</p>:visible.length===0?<p className="extra-inbox-muted">Chưa có cuộc trò chuyện nào phù hợp.</p>:
    visible.map(c=><button type="button" key={c.id} onClick={()=>setSelected(c.id)} className={"extra-inbox-person "+(selected===c.id?"active":"")+(overdue(c,now)?" extra-inbox-late":"")}>
     <span className="extra-inbox-person-head"><b>{c.customer_name}</b>{overdue(c,now)?<em className="extra-inbox-late-tag">Quá 60s</em>:unread(c)?<i title="Khách chưa được trả lời" aria-label="Cần phản hồi"/>:null}</span>
     <span className="extra-inbox-person-meta">{c.show_id?slugNames[c.show_id]||c.show_id:"Tư vấn chung"}{c.customer_phone?" · "+c.customer_phone:""}</span>
     <small>{c.assigned_staff_id?c.assigned_staff_id===actorId?"Đang giao cho bạn":"Phụ trách: "+assignedName(c):"⏳ Chờ phân công"} · {fmt(c.updated_at)}</small>
    </button>)}
   </div>
   <div className="extra-inbox-thread">
    {current?<><div className="extra-inbox-thread-head">
     <div><strong>{current.customer_name}</strong><span>{current.show_id?slugNames[current.show_id]||current.show_id:"Tư vấn chung"}</span>{current.customer_phone&&<a href={"tel:"+current.customer_phone}>☎ {current.customer_phone}</a>}
      <span>{current.assigned_staff_id?"Sale phụ trách: "+assignedName(current):"Khách đang ở hàng chờ"}</span>
     </div>
     <div className="extra-inbox-head-actions">
      <button type="button" onClick={()=>void doAction({chatId:current.id,status:current.status==="open"?"closed":"open"})} disabled={busy||current.status==="closed"&&!isManager||!isManager&&current.assigned_staff_id!==actorId}>
       {current.status==="open"?"Đóng hội thoại":"Mở lại"}
      </button>
     </div>
    </div>
    {showQueue&&<div className="extra-inbox-queue-intro"><p>Khách chưa có Sale phụ trách. Tin nhắn được lưu an toàn trong hàng chờ.</p>
     {!isManager&&<button type="button" disabled={busy||myOpen>=8} onClick={()=>void doAction({action:"claim",chatId:current.id})}>{myOpen>=8?"Bạn đã đủ 8 khách":"Nhận khách để tư vấn"}</button>}
    </div>}
    <div className="extra-inbox-messages" role="log" aria-live="polite">
     {canReply?messages.map(m=><div key={m.id} className={"extra-inbox-msg "+(m.sender==="staff"?"staff":"customer")}><small>{m.sender==="staff"?(m.staff_name||"Sale EXTRA"):"Khách hàng"} · {fmt(m.created_at)}</small><p>{m.body}</p></div>):
       <p className="extra-inbox-muted">Nhận khách trước khi xem và trả lời nội dung trò chuyện.</p>}
     {canReply&&messages.length===0&&<p className="extra-inbox-muted">Chưa có tin nhắn.</p>}
    </div>
    {current.status==="open"&&(canReply||isManager)&&<div className="extra-inbox-transfer"><span><strong>Chuyển khách cho Sale khác</strong><small>Chỉ chọn nhân viên còn dưới 8 cuộc đang mở</small></span>
     <select aria-label="Chọn nhân viên nhận bàn giao" value={targetStaff} onChange={e=>setTargetStaff(e.target.value)}>
      <option value="">— Chọn Sale tiếp nhận —</option>{otherStaff.map(s=><option key={s.id} value={s.id}>{s.display_name} · {s.openCount}/8</option>)}
     </select>
     <button type="button" disabled={!targetStaff||busy} onClick={()=>void doAction({action:"transfer",chatId:current.id,targetStaffId:targetStaff})}>Bàn giao</button>
     {current.assigned_staff_id&&<button type="button" disabled={busy} onClick={()=>void doAction({action:"auto",chatId:current.id})}>Chuyển tự động</button>}
    </div>}
    {canReply&&<form className="extra-inbox-reply" onSubmit={e=>void send(e)}>
     <label htmlFor="extra-inbox-reply-text">Trả lời khách</label>
     <div className="extra-inbox-quick-replies">{quickReplies.map(q=><button key={q.label} type="button" onClick={()=>setDraft(q.text)}>{q.label}</button>)}</div>
     <textarea id="extra-inbox-reply-text" rows={3} maxLength={1200} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Chào anh/chị, em từ +1 Extra. Em hỗ trợ mình chọn chỗ nhé!"/>
     <div><span className="extra-inbox-muted">Câu trả lời mẫu chỉ điền nội dung; bấm Gửi để gửi thật.</span><button className="extra-inbox-send" type="submit" disabled={busy||draft.trim().length<2}>{busy?"Đang gửi...":"Gửi phản hồi ↗"}</button></div>
    </form>}</>:<div className="extra-inbox-empty">Chọn một cuộc trò chuyện để xem, nhận khách hoặc phản hồi.</div>}
   </div>
  </div>
 </section>;
}

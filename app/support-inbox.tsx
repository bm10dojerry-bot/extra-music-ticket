"use client";
import {useEffect,useMemo,useState,type FormEvent} from "react";
import "./support-inbox.css";

type Chat={id:string;show_id:string|null;customer_name:string;customer_phone:string|null;status:"open"|"closed";created_at:string;updated_at:string;last_customer_at:string|null;last_staff_at:string|null};
type Message={id:number;sender:"staff"|"customer";body:string;staff_name:string|null;created_at:string};
const slugNames:Record<string,string>={"dinh-dung-2811":"Đình Dũng 28/11","minh-vuong-0512":"Minh Vương 05/12","trinh-dinh-quang-1212":"Trịnh Đình Quang 12/12","khanh-phuong-1912":"Khánh Phương 19/12","ho-quang-hieu-2412":"Hồ Quang Hiếu 24/12","khac-viet-2612":"Khắc Việt 26/12","thai-hoc-3112":"Thái Học 31/12"};
const time=(x:string)=>{try{return new Date(x).toLocaleString("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}catch{return ""}};
const unread=(c:Chat)=>c.status==="open"&&!!c.last_customer_at&&(!c.last_staff_at||new Date(c.last_customer_at)>new Date(c.last_staff_at));
export default function SupportInbox({embedded=false}:{embedded?:boolean}){
 const [chats,setChats]=useState<Chat[]>([]),[selected,setSelected]=useState(""),[current,setCurrent]=useState<Chat|null>(null),[messages,setMessages]=useState<Message[]>([]);
 const [filter,setFilter]=useState<"all"|"unread"|"open">("open"),[search,setSearch]=useState("");
 const [draft,setDraft]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 useEffect(()=>{
  let live=true;
  async function load(){
   try{const r=await fetch("/api/staff/support-chats",{cache:"no-store"});const d=await r.json();
    if(!r.ok)throw Error(d.error||"Không tải được hộp thư");
    if(live){const list=(d.chats||[]) as Chat[];setChats(list);setSelected(s=>s||list[0]?.id||"");setError("")}
   }catch(e){if(live)setError(e instanceof Error?e.message:"Không kết nối được hộp thư")}finally{if(live)setLoading(false)}
  }
  void load();const poll=setInterval(()=>void load(),9000);
  return()=>{live=false;clearInterval(poll)};
 },[]);
 useEffect(()=>{
  if(!selected){setCurrent(null);setMessages([]);return}
  let live=true;
  async function fetchMessages(){
   try{const r=await fetch("/api/staff/support-chats?chatId="+encodeURIComponent(selected),{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error||"Không tải được nội dung");if(live){setCurrent(d.chat||null);setMessages(d.messages||[])}}catch(e){if(live)setError(e instanceof Error?e.message:"Không tải được tin nhắn")}
  }
  void fetchMessages();const poll=setInterval(()=>void fetchMessages(),6000);return()=>{live=false;clearInterval(poll)};
 },[selected]);
 const visible=useMemo(()=>chats.filter(c=>(filter==="all"||filter==="open"&&c.status==="open"||filter==="unread"&&unread(c))&&((c.customer_name+" "+(c.customer_phone||"")+" "+(slugNames[c.show_id||""]||c.show_id||"")).toLowerCase().includes(search.toLowerCase().trim()))),[chats,filter,search]);
 async function send(e:FormEvent){
  e.preventDefault();if(!selected||draft.trim().length<2||busy)return;
  setBusy(true);setError("");
  try{const r=await fetch("/api/staff/support-chats",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chatId:selected,message:draft.trim()})});
   const d=await r.json();if(!r.ok)throw Error(d.error||"Không gửi được");setMessages(d.messages||[]);setDraft("");setCurrent(x=>x?{...x,status:"open",last_staff_at:new Date().toISOString()}:x);setChats(a=>a.map(c=>c.id===selected?{...c,status:"open",last_staff_at:new Date().toISOString()}:c))
  }catch(e){setError(e instanceof Error?e.message:"Chưa gửi được tin nhắn")}finally{setBusy(false)}
 }
 async function toggleStatus(){
  if(!current||busy)return;const status=current.status==="open"?"closed":"open";
  setBusy(true);setError("");
  try{const r=await fetch("/api/staff/support-chats",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({chatId:current.id,status})});const d=await r.json();if(!r.ok)throw Error(d.error||"Không đổi được trạng thái");
   setCurrent(c=>c?{...c,status}:c);setChats(list=>list.map(c=>c.id===current.id?{...c,status}:c))
  }catch(e){setError(e instanceof Error?e.message:"Không đổi được trạng thái")}finally{setBusy(false)}
 }
 return <section className={"extra-inbox "+(embedded?"extra-inbox-embedded":"")} aria-label="Hộp thư tư vấn đặt chỗ">
  <div className="extra-inbox-title"><div><small>+1 EXTRA · SALE SUPPORT</small><h2>Hộp thư tư vấn trực tuyến</h2><p>Khách nhắn ngay tại iextra.net. Nhân viên Sale hoặc Admin có thể tiếp nhận và trả lời ở đây.</p></div><div className="extra-inbox-counts"><strong>{chats.filter(unread).length}</strong><span>Cần phản hồi</span></div></div>
  <div className="extra-inbox-controls"><label>Tìm khách hoặc show<input aria-label="Tìm khách hoặc show" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Tên, SĐT hoặc nghệ sĩ..."/></label><div>{([["open","Đang mở"],["unread","Chưa phản hồi"],["all","Tất cả"]] as const).map(([v,label])=><button type="button" key={v} className={filter===v?"active":""} onClick={()=>setFilter(v)}>{label}</button>)}</div></div>
  {error&&<p className="extra-inbox-error" role="alert">{error}</p>}
  <div className="extra-inbox-main">
   <div className="extra-inbox-list" aria-label="Danh sách khách đang chờ tư vấn">
    {loading?<p className="extra-inbox-muted">Đang tải...</p>:visible.length===0?<p className="extra-inbox-muted">Chưa có cuộc trò chuyện nào phù hợp.</p>:
    visible.map(c=><button type="button" key={c.id} onClick={()=>setSelected(c.id)} className={"extra-inbox-person "+(selected===c.id?"active":"")}>
     <span className="extra-inbox-person-head"><b>{c.customer_name}</b>{unread(c)&&<i title="Khách chưa được trả lời" aria-label="Cần phản hồi"/>}</span>
     <span className="extra-inbox-person-meta">{c.show_id?slugNames[c.show_id]||c.show_id:"Tư vấn chung"}{c.customer_phone?" · "+c.customer_phone:""}</span>
     <small>{time(c.updated_at)} · {c.status==="open"?"Đang mở":"Đã kết thúc"}</small>
    </button>)}
   </div>
   <div className="extra-inbox-thread">
    {current?<><div className="extra-inbox-thread-head">
     <div><strong>{current.customer_name}</strong><span>{current.show_id?slugNames[current.show_id]||current.show_id:"Tư vấn chung"}</span>{current.customer_phone&&<a href={"tel:"+current.customer_phone}>☎ {current.customer_phone}</a>}</div>
     <button type="button" onClick={()=>void toggleStatus()} disabled={busy}>{current.status==="open"?"Đóng cuộc trò chuyện":"Mở lại"}</button>
    </div>
    <div className="extra-inbox-messages" role="log" aria-live="polite">
     {messages.map(m=><div key={m.id} className={"extra-inbox-msg "+(m.sender==="staff"?"staff":"customer")}><small>{m.sender==="staff"?(m.staff_name||"Sale EXTRA"):"Khách hàng"} · {time(m.created_at)}</small><p>{m.body}</p></div>)}
     {messages.length===0&&<p className="extra-inbox-muted">Chưa có tin nhắn.</p>}
    </div>
    <form className="extra-inbox-reply" onSubmit={e=>void send(e)}>
     <label htmlFor="extra-inbox-reply-text">Trả lời khách</label>
     <textarea id="extra-inbox-reply-text" rows={3} maxLength={1200} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Chào anh/chị, em từ +1 Extra. Em hỗ trợ mình chọn chỗ nhé!"/>
     <div><button type="button" onClick={()=>setDraft("Chào anh/chị! Em là nhân viên tư vấn +1 Extra. Anh/chị muốn chọn chỗ hạng A, B, C hay D ạ?")}>Mẫu tư vấn</button><button className="extra-inbox-send" type="submit" disabled={busy||draft.trim().length<2}>{busy?"Đang gửi...":"Gửi phản hồi ↗"}</button></div>
    </form></>:<div className="extra-inbox-empty">Chọn một cuộc trò chuyện bên trái để xem và phản hồi.</div>}
   </div>
  </div>
 </section>;
}

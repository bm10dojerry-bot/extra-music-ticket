"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import "./support-chat.css";
import {createPortal} from "react-dom";

type ChatSession={id:string;token:string};
type Message={id:number;sender:"customer"|"staff";body:string;staff_name:string|null;created_at:string};
type PublicChat={id:string;status:string;showId:string|null;customerName:string;assigned:boolean};
type Props={showId?:string;showName?:string;mode?:"inline"|"floating";label?:string};
const defaultName="Khách truy cập";
const formatTime=(s:string)=>{try{return new Date(s).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"})}catch{return ""}};
export default function SupportChat({showId="",showName="",mode="inline",label="Nhờ tư vấn chọn chỗ"}:Props){
 const key="extra_support_chat_v1_"+(showId||"general");
 const [open,setOpen]=useState(false),[session,setSession]=useState<ChatSession|null>(null),[chat,setChat]=useState<PublicChat|null>(null),[messages,setMessages]=useState<Message[]>([]);
 const [customerName,setCustomerName]=useState(""),[customerPhone,setCustomerPhone]=useState(""),[draft,setDraft]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const bottom=useRef<HTMLDivElement|null>(null),postLock=useRef(false);
 useEffect(()=>{
  setSession(null);setChat(null);setMessages([]);setError("");
  try{const raw=localStorage.getItem(key);if(!raw)return;const obj=JSON.parse(raw) as ChatSession;
   if(/^[a-f0-9-]{36}$/i.test(obj.id||"")&&/^[a-f0-9]{64}$/i.test(obj.token||""))setSession(obj);
   else localStorage.removeItem(key);
  }catch{try{localStorage.removeItem(key)}catch{}}
 },[key]);
 useEffect(()=>{
  if(!open||!session)return;
  let live=true;
  const refresh=async()=>{
   try{const res=await fetch("/api/public/support-chat?chatId="+encodeURIComponent(session.id),{headers:{"x-extra-chat-token":session.token},cache:"no-store"});
    const data=await res.json();
    if(!live)return;
    if(!res.ok){if([401,404].includes(res.status)){setSession(null);setChat(null);setMessages([]);try{localStorage.removeItem(key)}catch{}}return}
    setMessages(data.messages||[]);setChat(data.chat||null);
   }catch{}
  };
  void refresh();const timer=setInterval(()=>void refresh(),6000);
  return()=>{live=false;clearInterval(timer)};
 },[open,session?.id,session?.token,key]);
 useEffect(()=>{if(open)bottom.current?.scrollIntoView({behavior:"smooth",block:"nearest"})},[messages.length,open]);
 async function send(e:FormEvent){
  e.preventDefault();if(busy||postLock.current||draft.trim().length<2)return;
  postLock.current=true;setBusy(true);setError("");
  try{
   const res=await fetch("/api/public/support-chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chatId:session?.id,token:session?.token,showId,name:customerName.trim()||defaultName,phone:customerPhone.trim(),message:draft.trim()})});
   const data=await res.json();
   if(!res.ok){if(data.reset){setSession(null);setChat(null);setMessages([]);try{localStorage.removeItem(key)}catch{}}throw Error(data.error||"Chưa gửi được tin nhắn")}
   if(data.token&&data.chat?.id){
    const saved={id:data.chat.id,token:data.token};setSession(saved);
    try{localStorage.setItem(key,JSON.stringify(saved))}catch{}
   }
   setChat(data.chat||null);setMessages(data.messages||[]);setDraft("");
  }catch(e){setError(e instanceof Error?e.message:"Không gửi được tin nhắn")}finally{postLock.current=false;setBusy(false)}
 }
 return <div className={mode==="floating"?"extra-support-trigger extra-support-trigger-floating":"extra-support-trigger"}>
  <button type="button" className={mode==="floating"?"extra-support-fab":"extra-show-support-cta"} onClick={()=>setOpen(true)} aria-label={label} title={mode==="floating"?"Mở chat hỗ trợ":"Chat với EXTRA ngay trên trang này"}>
   <span className="extra-support-button-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="M20 11.5a7.7 7.7 0 0 1-7.8 7.7 8.6 8.6 0 0 1-3.5-.7L4 20l1.5-4.5A7.7 7.7 0 1 1 20 11.5Z"/><path d="M9 11.7h6"/></svg>
   </span>
   <span>{mode==="floating"?label:"Tư vấn chọn chỗ"}</span>
  </button>
  {open&&createPortal(<div className="extra-support-backdrop" role="presentation">
   <section className="extra-support-window" role="dialog" aria-modal="false" aria-label="Chat tư vấn trực tiếp trên website +1 Extra">
    <header className="extra-support-head">
     <div className="extra-support-avatar" aria-hidden="true">+1</div>
     <div><strong>EXTRA · Tư vấn đặt chỗ</strong><span>Chat trực tiếp trên iextra.net</span></div>
     <button type="button" className="extra-support-close" onClick={()=>setOpen(false)} aria-label="Đóng hộp chat">×</button>
    </header>
    {showName&&<div className="extra-support-context">🎤 Đang tư vấn show: <strong>{showName}</strong></div>}
    {chat&&<div className={"extra-support-routing "+(chat.assigned?"extra-support-assigned":"extra-support-queued")} role="status">{chat.assigned?"✓ Tin nhắn đã chuyển tới nhân viên Sale phụ trách.":"⏳ Sale đang bận. Tin nhắn của bạn đã được lưu và đang chờ phân công."}</div>}
    <div className="extra-support-messages" aria-live="polite" aria-relevant="additions text">
     <div className="extra-support-welcome"><strong>Chào mừng bạn đến với +1 Extra! ❤️</strong><p>Bạn cần tư vấn hạng chỗ, giá, sơ đồ ghế hoặc thanh toán QR? Hãy nhắn ngay tại đây. Tin nhắn sẽ được gửi tới hộp thư Sale/Admin của Extra.</p></div>
     {messages.map(item=><article key={item.id} className={"extra-support-bubble "+(item.sender==="customer"?"extra-support-mine":"extra-support-theirs")}>
      {item.sender==="staff"&&<small>{item.staff_name||"Tư vấn EXTRA"}</small>}
      <p>{item.body}</p><time>{formatTime(item.created_at)}</time>
     </article>)}
     <div ref={bottom}/>
    </div>
    {!session&&<div className="extra-support-contact-fields">
     <label>Tên của bạn (không bắt buộc)<input maxLength={100} autoComplete="name" placeholder="Nhập tên để tiện xưng hô" value={customerName} onChange={e=>setCustomerName(e.target.value)}/></label>
     <label>Số điện thoại (không bắt buộc)<input maxLength={25} type="tel" autoComplete="tel" placeholder="Để Sale liên hệ nếu bạn muốn" value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)}/></label>
    </div>}
    <form className="extra-support-compose" onSubmit={e=>void send(e)}>
     <label htmlFor={"support-message-"+(showId||"home")}>Nội dung cần hỗ trợ</label>
     <div><textarea id={"support-message-"+(showId||"home")} rows={2} maxLength={1200} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Ví dụ: Em muốn chọn 2 chỗ ngồi gần sân khấu..." onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit()}}}/><button type="submit" disabled={busy||draft.trim().length<2}>{busy?"...":"Gửi"}</button></div>
    </form>
    {error&&<p className="extra-support-error" role="alert">{error}</p>}
    <p className="extra-support-footnote">Sale sẽ phản hồi khi có nhân viên trực. Nếu cần gấp, gọi <a href="tel:0948650259">094 865 02 59</a>. Không chia sẻ mã QR cá nhân hoặc thông tin thanh toán nhạy cảm.</p>
   </section>
  </div>,document.body)}
 </div>;
}

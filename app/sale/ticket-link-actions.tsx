"use client";

import {useEffect,useRef,useState} from "react";
import styles from "./ticket-link-actions.module.css";

type CopyState="idle"|"copied"|"manual";
type EmailStatus="sent"|"sending"|"queued"|null;

function checkedTicketUrl(value:unknown,orderCode:string):string{
 if(typeof value!=="string")throw Error("Chưa nhận được đường dẫn vé. Vui lòng thử lại.");
 const url=new URL(value);
 const ticket=url.searchParams.get("ticket");
 if(url.origin!=="https://iextra.net"||url.pathname!=="/ve"||url.username||url.password||url.hash||
  [...url.searchParams.keys()].length!==1||!ticket||!/^EX[0-9A-F]{16}\.[a-f0-9]{64}$/.test(ticket)||!ticket.startsWith(orderCode+"."))
  throw Error("Đường dẫn vé chưa hợp lệ. Vui lòng thử lại.");
 return url.href;
}

export default function TicketLinkActions({orderCode}:{orderCode:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const [url,setUrl]=useState(""),[copyState,setCopyState]=useState<CopyState>("idle");
 const [emailStatus,setEmailStatus]=useState<EmailStatus>(null);
 const controller=useRef<AbortController|null>(null),copying=useRef(false);
 const manualInput=useRef<HTMLInputElement|null>(null);

 useEffect(()=>{
  setUrl("");setError("");setCopyState("idle");setEmailStatus(null);setBusy(false);copying.current=false;
  return()=>controller.current?.abort();
 },[orderCode]);
 useEffect(()=>{if(copyState==="manual"){manualInput.current?.focus();manualInput.current?.select();}},[copyState]);

 async function copy(){
  if(copying.current)return;
  copying.current=true;controller.current?.abort();
  const request=new AbortController();controller.current=request;
  setBusy(true);setError("");setCopyState("idle");setUrl("");setEmailStatus(null);
  try{
   const response=await fetch("/api/staff/ticket-link?code="+encodeURIComponent(orderCode),{cache:"no-store",signal:request.signal});
   const data=await response.json().catch(()=>null);
   if(!response.ok)throw Error(typeof data?.error==="string"?data.error:"Không lấy được đường dẫn vé. Vui lòng thử lại.");
   if(data?.code!==orderCode)throw Error("Đường dẫn không khớp mã đơn. Vui lòng thử lại.");
   const link=checkedTicketUrl(data.url,orderCode);
   if(request.signal.aborted)return;
   setUrl(link);
   setEmailStatus(["sent","sending","queued"].includes(data.emailStatus)?data.emailStatus:null);
   try{
    if(!navigator.clipboard?.writeText)throw Error("Manual copy required");
    await navigator.clipboard.writeText(link);
    if(!request.signal.aborted)setCopyState("copied");
   }catch{if(!request.signal.aborted)setCopyState("manual");}
  }catch(cause){if(!request.signal.aborted)setError(cause instanceof Error?cause.message:"Không lấy được đường dẫn vé.");}
  finally{if(!request.signal.aborted){setBusy(false);copying.current=false;}}
 }

 return <div className={styles.actions}>
  <div className={styles.buttons}>
   <button type="button" className={styles.copyButton} disabled={busy} aria-busy={busy} aria-label={"Sao chép đường dẫn vé "+orderCode} onClick={()=>void copy()}>
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="7" y="7" width="10" height="11" rx="2"/><path d="M12 7V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/></svg>
    {busy?"Đang lấy vé…":copyState==="copied"?"Đã sao chép":"Sao chép đường dẫn vé"}
   </button>
   {url?<a className={styles.openLink} href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Mở vé ↗</a>:null}
  </div>
  {copyState==="copied"?<p className={styles.success} role="status">Đã sao chép. Dán đường dẫn vào tin nhắn để gửi khách.</p>:null}
  {copyState==="manual"?<label className={styles.manual}>Chọn đường dẫn bên dưới để sao chép và gửi khách.
   <input ref={manualInput} aria-label={"Đường dẫn vé "+orderCode} readOnly value={url} onFocus={event=>event.currentTarget.select()}/>
  </label>:null}
  {emailStatus?<p className={styles.email}>{emailStatus==="sent"?"Email vé đã được gửi.":emailStatus==="sending"?"Email vé đang được gửi.":"Email vé đang chờ gửi."}</p>:null}
  {error?<p className={styles.error} role="alert">{error}</p>:null}
 </div>;
}

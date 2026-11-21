"use client";
import {usePathname} from "next/navigation";
const messengerUrl="https://m.me/61594194236470";
export default function MessengerSupport(){
 const pathname=usePathname();
 if(pathname!=="/"&&pathname!=="/ve")return null;
 return <a href={messengerUrl} target="_blank" rel="noopener noreferrer" aria-label="Nhắn tin với +1 EXTRA qua Facebook Messenger" title="Chat hỗ trợ đặt vé qua Messenger" style={{position:"fixed",right:18,bottom:20,zIndex:90,display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderRadius:999,background:"#0866ff",color:"#fff",fontWeight:700,fontSize:14,boxShadow:"0 8px 28px #0008",textDecoration:"none",maxWidth:"calc(100vw - 36px)"}}>
 <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.14 2 11.25c0 2.91 1.46 5.51 3.75 7.21V22l3.43-1.88c.9.25 1.85.38 2.82.38 5.52 0 10-4.14 10-9.25S17.52 2 12 2Zm1.02 12.43-2.54-2.71-4.95 2.71 5.45-5.79 2.59 2.71 4.9-2.71-5.45 5.79Z"/></svg>
 <span>Chat với EXTRA</span></a>;
}

"use client";
import {useEffect} from "react";
import {usePathname} from "next/navigation";

type VisitorStage="viewing"|"selecting"|"payment";
const key="extra_live_presence_session_v1";
export function useLiveVisitorPresence(showId:string,stage:VisitorStage){
 useEffect(()=>{
  if(!showId)return;
  let sessionId="";
  try{
   sessionId=sessionStorage.getItem(key)||"";
   if(!/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(sessionId)){
    sessionId=crypto.randomUUID();sessionStorage.setItem(key,sessionId);
   }
  }catch{return}
  const pulse=()=>{
   if(document.visibilityState!=="visible")return;
   void fetch("/api/public/live-presence",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({sessionId,showId,stage}),cache:"no-store"}).catch(()=>{});
  };
  pulse();const timer=window.setInterval(pulse,20000);
  document.addEventListener("visibilitychange",pulse);
  return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",pulse)};
 },[showId,stage]);
}
export function OtherPublicPresence(){
 const path=usePathname();
 const excluded=!path||path==="/"||path.startsWith("/show/")||["/admin","/sale","/staff","/checkin","/api","/reset-password"].some(p=>path===p||path.startsWith(p+"/"));
 useLiveVisitorPresence(excluded?"":"site","viewing");
 return null;
}
export function useLiveSalePresence(){
 useEffect(()=>{
  const pulse=()=>{
   if(document.visibilityState!=="visible")return;
   void fetch("/api/staff/live-presence",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",cache:"no-store"}).catch(()=>{});
  };
  pulse();const timer=window.setInterval(pulse,20000);
  document.addEventListener("visibilitychange",pulse);
  return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",pulse)};
 },[]);
}

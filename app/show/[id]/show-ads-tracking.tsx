"use client";
import {useEffect,useRef,useState} from "react";
type EventName="view"|"checkout"|"purchase";
type AdsWindow=Window&{fbq?:(...args:unknown[])=>void;gtag?:(...args:unknown[])=>void;dataLayer?:unknown[]};
const consentKey="extra_ads_consent_v1";
export default function ShowAdsTracking({showId,artist,pixelId,ga4Id,event,amount,orderCode}:{showId:string;artist:string;pixelId:string;ga4Id:string;event:EventName;amount:number;orderCode?:string}){
 const [consent,setConsent]=useState<"yes"|"no"|null>(null);
 const [ready,setReady]=useState(false);
 const fired=useRef(new Set<string>());
 useEffect(()=>{try{const v=sessionStorage.getItem(consentKey);if(v==="yes"||v==="no")setConsent(v)}catch{}},[]);
 useEffect(()=>{if(consent!=="yes")return;const w=window as AdsWindow;let mounted=true;const jobs:Promise<void>[]=[];
 if(pixelId&&/^[0-9]{8,25}$/.test(pixelId)){
  if(!w.fbq){type QueuedFbq=((...args:unknown[])=>void)&{queue:unknown[][];loaded?:boolean;version?:string};const fn=function(...args:unknown[]){fn.queue.push(args)} as QueuedFbq;fn.queue=[];fn.loaded=true;fn.version="2.0";w.fbq=fn;const script=document.createElement("script");script.async=true;script.src="https://connect.facebook.net/en_US/fbevents.js";document.head.appendChild(script)}
  w.fbq?.("init",pixelId);
 }
 if(ga4Id&&/^G-[A-Z0-9]{6,20}$/.test(ga4Id)){
  w.dataLayer=w.dataLayer||[];
  if(!w.gtag)w.gtag=(...args:unknown[])=>{w.dataLayer?.push(args)};
  w.gtag("js",new Date());w.gtag("config",ga4Id,{send_page_view:false});
  jobs.push(new Promise<void>(resolve=>{const script=document.createElement("script");script.async=true;script.src="https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(ga4Id);script.onload=()=>resolve();script.onerror=()=>resolve();document.head.appendChild(script)}));
 }
 Promise.all(jobs).then(()=>{if(mounted)setReady(true)});if(!jobs.length)setReady(true);
 return()=>{mounted=false};
 },[consent,pixelId,ga4Id]);
 useEffect(()=>{if(consent!=="yes"||!ready)return;const w=window as AdsWindow;const key=event==="purchase"?"purchase:"+orderCode:event+":"+showId;if(event==="purchase"&&!orderCode)return;if(fired.current.has(key))return;
 if(event==="purchase"){try{const seen=localStorage.getItem("extra_ads_"+key);if(seen)return}catch{}}
 fired.current.add(key);
 const common={content_ids:[showId],content_name:artist,content_type:"product",currency:"VND",value:amount};
 if(pixelId&&w.fbq){if(event==="view")w.fbq("trackSingle",pixelId,"ViewContent",common);if(event==="checkout")w.fbq("trackSingle",pixelId,"InitiateCheckout",common);if(event==="purchase")w.fbq("trackSingle",pixelId,"Purchase",{...common,order_id:orderCode})}
 if(ga4Id&&w.gtag){const ecommerce={currency:"VND",value:amount,items:[{item_id:showId,item_name:artist,quantity:1,price:amount}]};w.gtag("event",event==="view"?"view_item":event==="checkout"?"begin_checkout":"purchase",event==="purchase"?{...ecommerce,transaction_id:orderCode}:{...ecommerce})}
 if(event==="purchase")try{localStorage.setItem("extra_ads_"+key,"1")}catch{}
 },[consent,ready,event,showId,artist,amount,orderCode,pixelId,ga4Id]);
 function choose(value:"yes"|"no"){try{sessionStorage.setItem(consentKey,value)}catch{}setConsent(value)}
 if((!pixelId&&!ga4Id)||consent!==null)return null;
 return <div className="extra-ads-consent" role="dialog" aria-label="Tùy chọn đo lường quảng cáo"><p><strong>Quyền riêng tư</strong> · EXTRA sử dụng Meta Pixel và Google Analytics để đo hiệu quả quảng cáo của show này. Chỉ tải công cụ đo lường khi bạn đồng ý. Việc từ chối không ảnh hưởng đặt vé.</p><div><button type="button" onClick={()=>choose("no")}>Không đồng ý</button><button type="button" onClick={()=>choose("yes")}>Đồng ý</button></div></div>
}

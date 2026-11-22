"use client";
import {useEffect,useRef,useState} from "react";

type EventName="view"|"checkout"|"purchase";
type Consent="yes"|"no"|null;
type AdsWindow=Window&{
 fbq?:(...args:unknown[])=>void;
 gtag?:(...args:unknown[])=>void;
 dataLayer?:unknown[];
 __extraPixelIds?:string[];
 __extraGoogleIds?:string[];
};
type Props={
 showId:string;artist:string;pixelId:string;ga4Id:string;
 googleAdsId?:string;googleAdsLabel?:string;
 event:EventName;amount:number;orderCode?:string;
};
const consentKey="extra_ads_consent_v1";
const sessionKey="extra_ads_session_v1";
const validPixel=(id:string)=>/^[0-9]{8,25}$/.test(id);
const validGa4=(id:string)=>/^G-[A-Z0-9]{6,20}$/.test(id);
const validAds=(id:string)=>/^AW-[0-9]{6,20}$/.test(id);
const validLabel=(id:string)=>/^[A-Za-z0-9_-]{4,100}$/.test(id);

export default function ShowAdsTracking({showId,artist,pixelId,ga4Id,googleAdsId="",googleAdsLabel="",event,amount,orderCode}:Props){
 const [consent,setConsent]=useState<Consent>(null);
 const [loaded,setLoaded]=useState(false);
 const fired=useRef(new Set<string>());
 const meta=validPixel(pixelId)?pixelId:"";
 const ga4=validGa4(ga4Id)?ga4Id:"";
 const ads=validAds(googleAdsId)?googleAdsId:"";
 const label=validLabel(googleAdsLabel)?googleAdsLabel:"";
 useEffect(()=>{try{const value=sessionStorage.getItem(consentKey);if(value==="yes"||value==="no")setConsent(value)}catch{}},[]);
 useEffect(()=>{
  setLoaded(false);
  if(consent!=="yes")return;
  const w=window as AdsWindow;let active=true;
  if(meta){
   if(!w.fbq){
    type QueuedFbq=((...args:unknown[])=>void)&{queue:unknown[][];loaded?:boolean;version?:string};
    const fn=function(...args:unknown[]){fn.queue.push(args)} as QueuedFbq;
    fn.queue=[];fn.loaded=true;fn.version="2.0";w.fbq=fn;
    const script=document.createElement("script");script.async=true;script.src="https://connect.facebook.net/en_US/fbevents.js";document.head.appendChild(script);
   }
   w.__extraPixelIds=w.__extraPixelIds||[];
   if(!w.__extraPixelIds.includes(meta)){w.fbq?.("init",meta);w.__extraPixelIds.push(meta)}
  }
  if(ga4||ads){
   w.dataLayer=w.dataLayer||[];
   if(!w.gtag)w.gtag=(...args:unknown[])=>{w.dataLayer?.push(args)};
   w.__extraGoogleIds=w.__extraGoogleIds||[];
   const ids=[...new Set([ga4,ads].filter(Boolean))];
   if(!document.querySelector('script[data-extra-gtag="yes"]')){
    w.gtag("js",new Date());
    const script=document.createElement("script");script.async=true;script.dataset.extraGtag="yes";
    script.src="https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(ids[0]);
    document.head.appendChild(script);
   }
   for(const id of ids){if(!w.__extraGoogleIds.includes(id)){w.gtag("config",id,{send_page_view:false});w.__extraGoogleIds.push(id)}}
  }
  if(active)setLoaded(true);
  return()=>{active=false};
 },[consent,meta,ga4,ads]);
 useEffect(()=>{
  if(consent!=="yes"||!loaded)return;
  const w=window as AdsWindow;
  if(event==="purchase"&&!orderCode)return;
  const key=event==="purchase"?"purchase:"+orderCode:event+":"+showId;
  if(fired.current.has(key))return;
  if(event==="purchase"){try{if(localStorage.getItem("extra_ads_"+key))return}catch{}}
  fired.current.add(key);
  if(event!=="purchase"){
   try{
    let sessionId=sessionStorage.getItem(sessionKey);
    if(!sessionId){sessionId=crypto.randomUUID();sessionStorage.setItem(sessionKey,sessionId)}
    void fetch("/api/public/landing-funnel",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({showId,sessionId,eventName:event,consent:true})}).catch(()=>{});
   }catch{}
  }
  const safeAmount=Number.isFinite(amount)&&amount>=0?amount:0;
  const common={content_ids:[showId],content_name:artist,content_type:"product",currency:"VND",value:safeAmount};
  if(meta&&w.fbq){
   if(event==="view")w.fbq("trackSingle",meta,"ViewContent",common);
   if(event==="checkout")w.fbq("trackSingle",meta,"InitiateCheckout",common);
   if(event==="purchase")w.fbq("trackSingle",meta,"Purchase",{...common,order_id:orderCode},{eventID:"extra_purchase_"+orderCode});
  }
  if(w.gtag){
   if(ga4){
    const ecommerce={currency:"VND",value:safeAmount,items:[{item_id:showId,item_name:artist,quantity:1,price:safeAmount}]};
    const gaEvent=event==="view"?"view_item":event==="checkout"?"begin_checkout":"purchase";
    w.gtag("event",gaEvent,event==="purchase"?{...ecommerce,transaction_id:orderCode,send_to:ga4}:{...ecommerce,send_to:ga4});
   }
   if(ads&&label&&event==="purchase")w.gtag("event","conversion",{send_to:ads+"/"+label,value:safeAmount,currency:"VND",transaction_id:orderCode});
  }
  if(event==="purchase")try{localStorage.setItem("extra_ads_"+key,"1")}catch{}
 },[consent,loaded,event,showId,artist,amount,orderCode,meta,ga4,ads,label]);
 function choose(value:"yes"|"no"){try{sessionStorage.setItem(consentKey,value)}catch{}setConsent(value)}
 if((!meta&&!ga4&&!ads)||consent!==null)return null;
 return <div className="extra-ads-consent" role="dialog" aria-label="Tùy chọn đo lường quảng cáo">
  <p><strong>Quyền riêng tư</strong> · EXTRA sử dụng Meta Pixel và công cụ đo lường của Google nếu bạn đồng ý, để đo hiệu quả đặt vé. Từ chối không ảnh hưởng đến việc mua vé.</p>
  <div><button type="button" onClick={()=>choose("no")}>Không đồng ý</button><button type="button" onClick={()=>choose("yes")}>Đồng ý</button></div>
 </div>;
}

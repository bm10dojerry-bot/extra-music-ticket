"use client";
import {useEffect,useRef,useState} from "react";
import {usePathname} from "next/navigation";
import {ensureGoogleTags,googleAnalyticsPageFields,isPublicMeasurementPage,useGlobalMeasurementId,useMeasurementConsent,validGa4MeasurementId} from "../../../lib/measurement-client";

type EventName="view"|"checkout"|"purchase";
type AdsWindow=Window&{
 fbq?:(...args:unknown[])=>void;
 gtag?:(...args:unknown[])=>void;
 dataLayer?:unknown[];
 __extraPixelIds?:string[];
 __extraGoogleIds?:string[];
};
type Props={
 showId:string;artist:string;pixelId:string;marketingPixelId?:string;ga4Id:string;
 googleAdsId?:string;googleAdsLabel?:string;
 event:EventName;amount:number;orderCode?:string;
};
const sessionKey="extra_ads_session_v1";
const validPixel=(id:string)=>/^[0-9]{8,25}$/.test(id);
const validAds=(id:string)=>/^AW-[0-9]{6,20}$/.test(id);
const validLabel=(id:string)=>/^[A-Za-z0-9_-]{4,100}$/.test(id);

export default function ShowAdsTracking({showId,artist,pixelId,marketingPixelId="",ga4Id,googleAdsId="",googleAdsLabel="",event,amount,orderCode}:Props){
 const pathname=usePathname();
 const globalAnalytics=useGlobalMeasurementId(pathname);
 const [consent,choose]=useMeasurementConsent();
 const [loaded,setLoaded]=useState(false);
 const fired=useRef(new Set<string>());
 const meta=validPixel(pixelId)?pixelId:"";
 // Đình Dũng uses an additional Pixel on ad account extra 02; keep the original Pixel intact.
 const extra02Pixel=showId==="dinh-dung-2811"&&meta?"2335529170354111":"";
 const marketingMeta=validPixel(marketingPixelId)?marketingPixelId:"";
 // Keep existing ecommerce destinations independent of the optional site-wide
 // Analytics lookup. The global ID only enables this page's consent chooser.
 const ga4=validGa4MeasurementId(ga4Id)?ga4Id:"";
 const ads=validAds(googleAdsId)?googleAdsId:"";
 const label=validLabel(googleAdsLabel)?googleAdsLabel:"";
 useEffect(()=>{
  setLoaded(false);
  if(consent!=="yes"||!isPublicMeasurementPage(window.location.hostname,window.location.pathname))return;
  const w=window as AdsWindow;let active=true;
  if(meta||extra02Pixel||marketingMeta){
   if(!w.fbq){
    type QueuedFbq=((...args:unknown[])=>void)&{queue:unknown[][];loaded?:boolean;version?:string};
    const fn=function(...args:unknown[]){fn.queue.push(args)} as QueuedFbq;
    fn.queue=[];fn.loaded=true;fn.version="2.0";w.fbq=fn;
    const script=document.createElement("script");script.async=true;script.src="https://connect.facebook.net/en_US/fbevents.js";document.head.appendChild(script);
   }
   w.__extraPixelIds=w.__extraPixelIds||[];
   for(const id of [...new Set([meta,extra02Pixel,marketingMeta].filter(Boolean))]){
    if(!w.__extraPixelIds.includes(id)){w.fbq?.("init",id);w.__extraPixelIds.push(id)}
   }
  }
  if(ga4||ads){
   ensureGoogleTags([ga4,ads]);
  }
  if(active)setLoaded(true);
  return()=>{active=false};
 },[consent,meta,extra02Pixel,marketingMeta,ga4,ads,pathname]);
 useEffect(()=>{
  if(consent!=="yes"||!loaded||!isPublicMeasurementPage(window.location.hostname,window.location.pathname))return;
  const w=window as AdsWindow;
  if(event==="purchase"&&!orderCode)return;
  const key=event==="purchase"?"purchase:"+orderCode:event+":"+showId;
  // A destination can arrive after the show content fetch. Dedupe each one
  // independently so a late pixel receives the event without repeating the
  // original pixel or Google's event. Preserve old purchase markers for the
  // destinations which the previous tracker already used.
  const sendOnce=(destination:string,send:()=>void,legacyDestination=false)=>{
   const destinationKey=destination+":"+key;
   if(fired.current.has(destinationKey))return;
   if(event==="purchase"){
    try{if(localStorage.getItem("extra_ads_"+destinationKey)||(legacyDestination&&localStorage.getItem("extra_ads_"+key)))return;}catch{}
   }
   try{
    send();fired.current.add(destinationKey);
    if(event==="purchase")try{localStorage.setItem("extra_ads_"+destinationKey,"1")}catch{}
   }catch{}
  };
  if(event!=="purchase"){
   sendOnce("funnel",()=>{
    let sessionId=sessionStorage.getItem(sessionKey);
    if(!sessionId){sessionId=crypto.randomUUID();sessionStorage.setItem(sessionKey,sessionId)}
    void fetch("/api/public/landing-funnel",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({showId,sessionId,eventName:event,consent:true})}).catch(()=>{});
   });
  }
  const safeAmount=Number.isFinite(amount)&&amount>=0?amount:0;
  const common={content_ids:[showId],content_name:artist,content_type:"product",currency:"VND",value:safeAmount};
  if(w.fbq){
   for(const id of [...new Set([meta,extra02Pixel,marketingMeta].filter(Boolean))]){
    sendOnce("meta:"+id,()=>{
     if(event==="view")w.fbq?.("trackSingle",id,"ViewContent",common);
     if(event==="checkout")w.fbq?.("trackSingle",id,"InitiateCheckout",common);
     if(event==="purchase")w.fbq?.("trackSingle",id,"Purchase",{...common,order_id:orderCode},{eventID:"extra_purchase_"+orderCode});
    },id===meta||id===extra02Pixel);
   }
  }
  if(w.gtag){
   if(ga4){
    const ecommerce={currency:"VND",value:safeAmount,items:[{item_id:showId,item_name:artist,quantity:1,price:safeAmount}],...googleAnalyticsPageFields()};
    const gaEvent=event==="view"?"view_item":event==="checkout"?"begin_checkout":"purchase";
    sendOnce("ga4:"+ga4,()=>w.gtag?.("event",gaEvent,event==="purchase"?{...ecommerce,transaction_id:orderCode,send_to:ga4}:{...ecommerce,send_to:ga4}),true);
   }
   if(ads&&label&&event==="purchase")sendOnce("ads:"+ads+"/"+label,()=>w.gtag?.("event","conversion",{send_to:ads+"/"+label,value:safeAmount,currency:"VND",transaction_id:orderCode}),true);
  }
 },[consent,loaded,event,showId,artist,amount,orderCode,meta,extra02Pixel,marketingMeta,ga4,ads,label,pathname]);
 if((!meta&&!marketingMeta&&!ga4&&!ads&&!globalAnalytics.measurementId)||consent!==null)return null;
 return <div className="extra-ads-consent" role="dialog" aria-label="Tùy chọn đo lường quảng cáo">
  <p><strong>Quyền riêng tư</strong> · EXTRA sử dụng Meta Pixel và công cụ đo lường của Google nếu bạn đồng ý, để thống kê lượt truy cập, khu vực tổng hợp và hiệu quả đặt chỗ. Từ chối không ảnh hưởng đến việc đặt chỗ.</p>
  <div><button type="button" onClick={()=>choose("no")}>Không đồng ý</button><button type="button" onClick={()=>choose("yes")}>Đồng ý</button></div>
 </div>;
}

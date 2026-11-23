"use client";

import {useEffect,useState,useSyncExternalStore} from "react";

export type MeasurementConsent="yes"|"no"|null;
export type GoogleMeasurementWindow=Window&{
 gtag?:(...args:unknown[])=>void;
 dataLayer?:unknown[];
 __extraGoogleIds?:string[];
 __extraGa4InitialPageViews?:string[];
};

const consentKey="extra_ads_consent_v1";
const consentEvent="extra:measurement-consent";
const privatePaths=["/admin","/sale","/staff","/checkin","/api","/reset-password","/ve"];
let memoryConsent:MeasurementConsent|undefined;
let configCache:{measurementId:string;expiresAt:number}|null=null;
let configRequest:Promise<string>|null=null;

export const validGa4MeasurementId=(id:string)=>/^G-[A-Z0-9]{6,20}$/.test(id);
const validGoogleAdsId=(id:string)=>/^AW-[0-9]{6,20}$/.test(id);

export function isPublicMeasurementPage(hostname:string,pathname:string):boolean {
 // An empty hostname is used only for the SSR-safe path check in render.
 // Runtime measurement belongs to the public production site, not previews.
 if(hostname&&!['iextra.net','www.iextra.net'].includes(hostname.toLowerCase()))return false;
 let path=pathname;
 try{path=decodeURIComponent(path)}catch{}
 path=path.toLowerCase().replace(/\/{2,}/g,"/");
 return !privatePaths.some(prefix=>path===prefix||path.startsWith(prefix+"/"));
}

function readConsent():MeasurementConsent {
 if(typeof window==="undefined")return null;
 if(memoryConsent!==undefined)return memoryConsent;
 try{
  const value=window.sessionStorage.getItem(consentKey);
  if(value==="yes"||value==="no")return value;
 }catch{}
 return null;
}

function subscribeConsent(listener:()=>void){
 const storageChanged=(event:StorageEvent)=>{if(event.key===consentKey||event.key===null){memoryConsent=undefined;listener()}};
 window.addEventListener(consentEvent,listener);
 window.addEventListener("storage",storageChanged);
 return()=>{window.removeEventListener(consentEvent,listener);window.removeEventListener("storage",storageChanged)};
}

export function setGoogleAnalyticsDisabled(disabled:boolean){
 if(typeof window==="undefined")return;
 const w=window as GoogleMeasurementWindow;
 for(const id of w.__extraGoogleIds||[]){
  if(validGa4MeasurementId(id))(w as unknown as Record<string,unknown>)["ga-disable-"+id]=disabled;
 }
}

export function chooseMeasurementConsent(value:"yes"|"no"){
 if(typeof window==="undefined")return;
 memoryConsent=value;
 try{window.sessionStorage.setItem(consentKey,value)}catch{}
 if(value==="no")setGoogleAnalyticsDisabled(true);
 window.dispatchEvent(new Event(consentEvent));
}

export function useMeasurementConsent(){
 const consent=useSyncExternalStore(subscribeConsent,readConsent,()=>null);
 return [consent,chooseMeasurementConsent] as const;
}

/** Only a public measurement ID crosses this endpoint. Cache/dedupe the lookup
 * for the global banner and show tracker; do not contact Google here. */
async function loadGlobalMeasurementId():Promise<string>{
 if(configCache&&configCache.expiresAt>Date.now())return configCache.measurementId;
 if(configRequest)return configRequest;
 const controller=new AbortController();
 const timeout=window.setTimeout(()=>controller.abort(),5000);
 configRequest=(async()=>{
  try{
   const response=await fetch("/api/public/google-analytics",{cache:"no-store",credentials:"same-origin",signal:controller.signal});
   if(!response.ok)return "";
   const value:unknown=await response.json();
   const id=value&&typeof value==="object"&&"measurementId" in value?value.measurementId:"";
   return typeof id==="string"&&validGa4MeasurementId(id)?id:"";
  }catch{return ""}
 })().then(measurementId=>{
  configCache={measurementId,expiresAt:Date.now()+30000};
  return measurementId;
 }).finally(()=>{window.clearTimeout(timeout);configRequest=null});
 return configRequest;
}

export function useGlobalMeasurementId(pathname:string|null){
 const [state,setState]=useState({measurementId:"",ready:false});
 useEffect(()=>{
  let active=true;
  if(!pathname||!isPublicMeasurementPage(window.location.hostname,pathname)){
   setState({measurementId:"",ready:true});
   return;
  }
  setState({measurementId:"",ready:false});
  void loadGlobalMeasurementId().then(measurementId=>{
   if(active)setState({measurementId,ready:true});
  });
  return()=>{active=false};
 },[pathname]);
 return state;
}

/** Strip query strings and fragments before sending a URL to Analytics. */
export function safeMeasurementUrl(value:string):string{
 try{
  const url=new URL(value);
  return url.protocol==="https:"||url.protocol==="http:"?url.origin+url.pathname:"";
 }catch{return ""}
}

export function googleAnalyticsPageFields(){
 return {page_location:safeMeasurementUrl(window.location.href),page_referrer:safeMeasurementUrl(document.referrer)};
}

/** Shared bootstrap with the existing show/Ads tracker. The ordinary function
 * deliberately queues Arguments objects, matching Google's gtag snippet. */
export function ensureGoogleTags(tagIds:string[]):GoogleMeasurementWindow|null{
 if(typeof window==="undefined"||readConsent()!=="yes"||
  !isPublicMeasurementPage(window.location.hostname,window.location.pathname))return null;
 const ids=[...new Set(tagIds.filter(id=>validGa4MeasurementId(id)||validGoogleAdsId(id)))];
 if(!ids.length)return null;
 const w=window as GoogleMeasurementWindow;
 w.dataLayer=w.dataLayer||[];
 if(!w.gtag)w.gtag=function(){w.dataLayer?.push(arguments)};
 w.__extraGoogleIds=w.__extraGoogleIds||[];
 if(!document.querySelector('script[data-extra-gtag="yes"]')){
  w.gtag("js",new Date());
  const script=document.createElement("script");script.async=true;script.dataset.extraGtag="yes";
  script.referrerPolicy="strict-origin";
  script.src="https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(ids[0]);
  document.head.appendChild(script);
 }
 for(const id of ids){
  if(validGa4MeasurementId(id))(w as unknown as Record<string,unknown>)["ga-disable-"+id]=false;
  if(w.__extraGoogleIds.includes(id))continue;
  w.gtag("config",id,validGa4MeasurementId(id)?{send_page_view:false,...googleAnalyticsPageFields()}:{send_page_view:false});
  w.__extraGoogleIds.push(id);
 }
 return w;
}

export function sendInitialGooglePageView(measurementId:string){
 if(!validGa4MeasurementId(measurementId))return;
 const w=ensureGoogleTags([measurementId]);
 if(!w)return;
 w.__extraGa4InitialPageViews=w.__extraGa4InitialPageViews||[];
 if(w.__extraGa4InitialPageViews.includes(measurementId))return;
 w.__extraGa4InitialPageViews.push(measurementId);
 w.gtag?.("event","page_view",{send_to:measurementId,...googleAnalyticsPageFields()});
 // Enhanced Measurement may send history pageviews independently of
 // send_page_view:false. Do not also emit manual pageviews on SPA navigation.
}

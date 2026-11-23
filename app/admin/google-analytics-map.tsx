"use client";

import {useEffect,useId,useRef,useState,type FormEvent} from "react";
import {
 GOOGLE_ANALYTICS_CALLBACK_MESSAGES,
 type GoogleAnalyticsResponse,
 type GoogleAnalyticsPropertyOption,
 type GoogleAnalyticsStreamOption,
} from "../../lib/google-analytics-types";
import {COUNTRY_SHAPES} from "./ga4-world-map-data";
import {COUNTRY_POINTS} from "./ga4-country-points";
import {REGIONAL_COUNTRY_SHAPES} from "./ga4-region-map-data";
import {REGIONAL_LABELS} from "./ga4-region-labels";
import {ARCHIPELAGO_REFERENCES} from "./ga4-vietnam-archipelagos";
import {analyticsMapViewport,pointInMapViewport,projectMapPoint,type AnalyticsMapView} from "./ga4-map-viewport";
import styles from "./google-analytics-map.module.css";

const formatNumber=new Intl.NumberFormat("vi-VN");
const regionNames=typeof Intl.DisplayNames==="function"?new Intl.DisplayNames(["vi"],{type:"region"}):null;
const GOOGLE_ANALYTICS_URL="https://analytics.google.com/analytics/web/";
const REFRESH_MS=60000;
const regionalCountryIds=new Set(REGIONAL_COUNTRY_SHAPES.map(shape=>shape.id));
// The world's enlarged centroid circles are location aids, not coastlines.
const regionalShapes=[...COUNTRY_SHAPES.filter(shape=>!regionalCountryIds.has(shape.id)&&!shape.path.includes("a1.5,1.5")),...REGIONAL_COUNTRY_SHAPES];

const countryKey=(countryId:string)=>countryId.trim().toUpperCase()||"__unknown";
function placeLabel(name:string){return !name||name==="(not set)"?"Chưa xác định":name==="(other)"?"Khu vực khác":name;}
function countryLabel(row:{countryId:string;country:string}){
 const id=countryKey(row.countryId);
 if(/^[A-Z]{2}$/.test(id)&&id!=="ZZ"){
  const name=regionNames?.of(id);
  if(name&&name!==id)return name;
 }
 return placeLabel(row.country);
}
function errorMessage(value:unknown,fallback:string){
 return value&&typeof value==="object"&&"error" in value&&typeof value.error==="string"?value.error.slice(0,500):fallback;
}
function updatedTime(value:string){
 const date=new Date(value);
 return Number.isFinite(date.getTime())?date.toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",minute:"2-digit",day:"2-digit",month:"2-digit"}):"—";
}

export default function GoogleAnalyticsMap(){
 const mapTitleId=useId(),mapDescriptionId=useId(),tooltipId=useId(),settingsId=useId(),settingsHeadingId=useId(),landFadeId=useId(),landMaskId=useId();
 const [data,setData]=useState<GoogleAnalyticsResponse|null>(null);
 const [loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false);
 const [loadError,setLoadError]=useState(""),[refreshKey,setRefreshKey]=useState(0);
 const [callbackCode,setCallbackCode]=useState("");
 const [manageOpen,setManageOpen]=useState(false);
 const [properties,setProperties]=useState<GoogleAnalyticsPropertyOption[]>([]);
 const [streams,setStreams]=useState<GoogleAnalyticsStreamOption[]>([]);
 const [propertiesLoading,setPropertiesLoading]=useState(false),[streamsLoading,setStreamsLoading]=useState(false);
 const [propertiesError,setPropertiesError]=useState(""),[streamsError,setStreamsError]=useState("");
 const [propertyDraft,setPropertyDraft]=useState(""),[streamDraft,setStreamDraft]=useState("");
 const [optionsRefresh,setOptionsRefresh]=useState(0);
 const [action,setAction]=useState<"save"|"disconnect"|null>(null);
 const [actionError,setActionError]=useState(""),[actionNotice,setActionNotice]=useState("");
 const [confirmDisconnect,setConfirmDisconnect]=useState(false);
 const [selectedCountry,setSelectedCountry]=useState("");
 const [hoverCountry,setHoverCountry]=useState("");
 const [focusedCountry,setFocusedCountry]=useState("");
 const [mapView,setMapView]=useState<AnalyticsMapView>("vietnam");
 const [mapSize,setMapSize]=useState({width:0,height:0});
 const panelRef=useRef<HTMLElement>(null);
 const canvasRef=useRef<HTMLDivElement>(null);
 const dialogRef=useRef<HTMLDialogElement>(null);
 const reportController=useRef<AbortController|null>(null);
 const actionController=useRef<AbortController|null>(null);
 const mutating=useRef(false),mounted=useRef(false);

 useEffect(()=>{
  mounted.current=true;
  setCallbackCode(new URLSearchParams(window.location.search).get("ga4")||"");
  return()=>{mounted.current=false;actionController.current?.abort();};
 },[]);

 useEffect(()=>{
  const dialog=dialogRef.current;
  if(manageOpen&&!dialog?.open)dialog?.showModal();
  else if(!manageOpen&&dialog?.open)dialog.close();
 },[manageOpen]);

 useEffect(()=>{
  const canvas=canvasRef.current;
  if(!canvas)return;
  const measure=()=>setMapSize({width:canvas.clientWidth,height:canvas.clientHeight});
  measure();
  const observer=typeof ResizeObserver==="undefined"?null:new ResizeObserver(measure);
  observer?.observe(canvas);
  if(!observer)window.addEventListener("resize",measure);
  return()=>{observer?.disconnect();window.removeEventListener("resize",measure);};
 },[]);

 useEffect(()=>{
  let active=true;
  let inViewport=typeof IntersectionObserver==="undefined";
  async function load(){
   if(document.visibilityState==="hidden"||!inViewport||mutating.current)return;
   reportController.current?.abort();
   const controller=new AbortController();reportController.current=controller;
   setRefreshing(true);
   try{
    const response=await fetch("/api/admin/google-analytics",{cache:"no-store",signal:controller.signal});
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw Error(errorMessage(result,"Không tải được dữ liệu Google Analytics. Vui lòng thử lại."));
    if(!result||!["not_connected","select_property","ready","error"].includes(result.status))throw Error("Google Analytics chưa trả về dữ liệu hợp lệ.");
    if(active&&!controller.signal.aborted){
     const next=result as GoogleAnalyticsResponse;
     setData(next);setLoadError("");setHoverCountry("");
     const hasCountry=(id:string)=>next.report?.countries.some(country=>countryKey(country.countryId)===id&&country.activeUsers>0);
     setSelectedCountry(current=>hasCountry(current)?current:"");
     setFocusedCountry(current=>hasCountry(current)?current:"");
    }
   }catch(error){
    if(active&&!controller.signal.aborted)setLoadError(error instanceof Error?error.message:"Không kết nối được Google Analytics. Vui lòng thử lại.");
   }finally{
    if(active&&!controller.signal.aborted){setLoading(false);setRefreshing(false);}
   }
  }
  function visibilityChanged(){
   if(document.visibilityState==="visible")void load();
   else {reportController.current?.abort();setRefreshing(false);}
  }
  void load();
  const timer=setInterval(()=>void load(),REFRESH_MS);
  const observer=typeof IntersectionObserver==="undefined"?null:new IntersectionObserver(entries=>{
   const wasVisible=inViewport;inViewport=Boolean(entries[0]?.isIntersecting);
   if(inViewport&&!wasVisible)void load();
   if(!inViewport){reportController.current?.abort();setRefreshing(false);}
  });
  if(panelRef.current)observer?.observe(panelRef.current);
  document.addEventListener("visibilitychange",visibilityChanged);
  return()=>{active=false;clearInterval(timer);observer?.disconnect();reportController.current?.abort();document.removeEventListener("visibilitychange",visibilityChanged);};
 },[refreshKey]);

 const showManagement=Boolean(data?.canManage&&manageOpen&&data.status!=="not_connected");
 const savedPropertyId=data?.property?.id||"",savedStreamId=data?.property?.streamId||"";
 useEffect(()=>{
  if(!showManagement)return;
  const controller=new AbortController();
  setPropertiesLoading(true);setPropertiesError("");
  async function load(){
   try{
    const response=await fetch("/api/admin/google-analytics/properties",{cache:"no-store",signal:controller.signal});
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw Error(errorMessage(result,"Chưa tải được danh sách tài sản Google Analytics."));
    if(!Array.isArray(result?.properties))throw Error("Chưa nhận được danh sách tài sản Google Analytics.");
    if(!controller.signal.aborted){
     const options=result.properties as GoogleAnalyticsPropertyOption[];
     setProperties(options);
     setPropertyDraft(current=>options.some(item=>item.id===current)?current:options.some(item=>item.id===savedPropertyId)?savedPropertyId:options.length===1?options[0].id:"");
    }
   }catch(error){if(!controller.signal.aborted){setProperties([]);setPropertiesError(error instanceof Error?error.message:"Chưa tải được danh sách tài sản.");}}
   finally{if(!controller.signal.aborted)setPropertiesLoading(false);}
  }
  void load();return()=>controller.abort();
 },[showManagement,savedPropertyId,optionsRefresh]);

 useEffect(()=>{
  if(!showManagement||!propertyDraft){setStreams([]);setStreamDraft("");setStreamsLoading(false);setStreamsError("");return;}
  const controller=new AbortController();
  setStreamsLoading(true);setStreamsError("");setStreams([]);setStreamDraft("");
  async function load(){
   try{
    const response=await fetch("/api/admin/google-analytics/properties?propertyId="+encodeURIComponent(propertyDraft),{cache:"no-store",signal:controller.signal});
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw Error(errorMessage(result,"Chưa tải được luồng dữ liệu website."));
    if(!Array.isArray(result?.streams))throw Error("Chưa nhận được danh sách luồng dữ liệu website.");
    if(!controller.signal.aborted){
     const options=result.streams as GoogleAnalyticsStreamOption[];
     const compatible=options.filter(item=>item.compatible);
     setStreams(options);
     setStreamDraft(propertyDraft===savedPropertyId&&compatible.some(item=>item.id===savedStreamId)?savedStreamId:compatible.length===1?compatible[0].id:"");
    }
   }catch(error){if(!controller.signal.aborted)setStreamsError(error instanceof Error?error.message:"Chưa tải được luồng dữ liệu website.");}
   finally{if(!controller.signal.aborted)setStreamsLoading(false);}
  }
  void load();return()=>controller.abort();
 },[showManagement,propertyDraft,savedPropertyId,savedStreamId,optionsRefresh]);

 async function updateConnection(operation:"save"|"disconnect"){
  if(mutating.current||!data?.canManage)return;
  if(operation==="save"&&(!propertyDraft||!streams.some(stream=>stream.id===streamDraft&&stream.compatible)))return;
  mutating.current=true;reportController.current?.abort();setRefreshing(false);
  const controller=new AbortController();actionController.current=controller;
  setAction(operation);setActionError("");setActionNotice("");
  try{
   const response=await fetch("/api/admin/google-analytics",{
    method:operation==="save"?"PUT":"DELETE",headers:{"Content-Type":"application/json"},
    ...(operation==="save"?{body:JSON.stringify({propertyId:propertyDraft,streamId:streamDraft})}:{}),signal:controller.signal,
   });
   const result=await response.json().catch(()=>null);
   if(!response.ok)throw Error(errorMessage(result,operation==="save"?"Chưa lưu được nguồn dữ liệu. Vui lòng thử lại.":"Chưa ngắt được kết nối. Vui lòng thử lại."));
   if(mounted.current&&!controller.signal.aborted){
    setManageOpen(false);setConfirmDisconnect(false);setCallbackCode("");setSelectedCountry("");setHoverCountry("");setFocusedCountry("");
    setData(null);setLoading(true);setLoadError("");setActionNotice(operation==="save"?"Đã lưu nguồn dữ liệu Google Analytics.":"Đã ngắt kết nối Google Analytics khỏi Admin.");
    if(operation==="disconnect"){setPropertyDraft("");setStreamDraft("");setProperties([]);setStreams([]);}
    setRefreshKey(value=>value+1);
   }
  }catch(error){if(mounted.current&&!controller.signal.aborted)setActionError(error instanceof Error?error.message:"Chưa hoàn tất thay đổi. Vui lòng thử lại.");}
  finally{mutating.current=false;if(mounted.current)setAction(null);}
 }
 function save(event:FormEvent<HTMLFormElement>){event.preventDefault();void updateConnection("save");}
 function closeManagement(){setManageOpen(false);setConfirmDisconnect(false);setActionError("");}

 const report=data?.status==="ready"?data.report:undefined;
 const countries=(report?.countries||[]).filter(country=>country.activeUsers>0);
 const countryIndex=new Map(countries.map(country=>[countryKey(country.countryId),country]));
 const pointIndex=new Map(COUNTRY_POINTS.map(point=>[point.id,point]));
 const activePoints=COUNTRY_POINTS.filter(point=>countryIndex.has(point.id));
 const viewport=analyticsMapViewport(mapView,mapSize);
 const visiblePoints=activePoints.filter(point=>pointInMapViewport(point,viewport));
 const labelCanvas=mapSize.width>0&&mapSize.height>0?mapSize:{width:800,height:420};
 const geographicLabels=mapView==="vietnam"?REGIONAL_LABELS.filter(label=>{
  const screen=projectMapPoint(label,viewport),half=label.width/2;
  return screen.x-half>=12&&screen.x+half<=labelCanvas.width-12&&screen.y>=18&&screen.y<=labelCanvas.height-16
   &&!(screen.y<52&&(screen.x-half<180||screen.x+half>labelCanvas.width-48));
 }):[];
 const unmappedCountries=countries.some(country=>!pointIndex.has(countryKey(country.countryId)));
 const highlightedId=hoverCountry||focusedCountry||selectedCountry;
 const highlightedPoint=visiblePoints.find(point=>point.id===highlightedId);
 const highlighted=highlightedPoint?countryIndex.get(highlightedId):undefined;
 const {x:pointX,y:pointY}=highlightedPoint?projectMapPoint(highlightedPoint,viewport):{x:0,y:0};
 const tooltipBelow=pointY<100;
 const selectedStream=streams.find(stream=>stream.id===streamDraft&&stream.compatible);
 const canSave=Boolean(properties.some(property=>property.id===propertyDraft)&&selectedStream&&!propertiesError&&!streamsError&&!propertiesLoading&&!streamsLoading&&!action);
 const callbackNotice=callbackCode==="connected"?(data?.status==="select_property"?"Đã kết nối tài khoản Google. Chọn dữ liệu của iextra.net để hoàn tất.":data?.status==="ready"?"Kết nối Google Analytics đã sẵn sàng.":""):GOOGLE_ANALYTICS_CALLBACK_MESSAGES[callbackCode]||"";
 const callbackError=Boolean(callbackNotice&&callbackCode!=="connected");
 const reportError=loadError||data?.error||"";
 const needsAttention=Boolean(reportError||callbackError||data?.status==="not_connected"||data?.status==="select_property");
 const statusText=reportError?(report?"Chưa cập nhật được dữ liệu; đang hiển thị lần cập nhật "+updatedTime(report.updatedAt):"Chưa tải được dữ liệu Google Analytics")
  :callbackError?"Kết nối Google Analytics cần được kiểm tra"
  :loading&&!data?"Đang tải dữ liệu Google Analytics"
  :data?.status==="not_connected"?"Chưa kết nối Google Analytics"
  :data?.status==="select_property"?"Chờ chọn nguồn dữ liệu Google Analytics"
  :report?.totalActiveUsers===0?"Chưa ghi nhận người dùng hoạt động trong 30 phút qua"
  :report&&!activePoints.length?"Có truy cập nhưng chưa xác định được quốc gia trên bản đồ"
  :report?"Google Analytics: người dùng hoạt động trong 30 phút qua; cập nhật "+updatedTime(report.updatedAt)
  :"Chưa có dữ liệu Google Analytics";
 const controlLabel=(data?.canManage?"Cài đặt bản đồ. ":"Thông tin bản đồ. ")+statusText;
 function openManagement(){setHoverCountry("");setFocusedCountry("");setSelectedCountry("");setManageOpen(true);}
 function changeMapView(view:AnalyticsMapView){setMapView(view);setHoverCountry("");setFocusedCountry("");setSelectedCountry("");}

 return <section ref={panelRef} className={styles.mapSection} aria-labelledby={mapTitleId} aria-busy={loading}>
  <h2 id={mapTitleId} className={styles.srOnly}>Khách truy cập theo khu vực</h2>
  <p id={mapDescriptionId} className={styles.srOnly}>Google Analytics 4. {mapView==="vietnam"?"Bản đồ khu vực lấy Việt Nam làm trung tâm, có nhãn quần đảo Hoàng Sa và quần đảo Trường Sa.":"Bản đồ toàn thế giới."} Tên địa danh và ký hiệu đảo là thông tin nền. Mỗi chấm sáng biểu thị một quốc gia có người dùng hoạt động trong 30 phút qua, không phải vị trí chính xác của từng người.</p>
  <p className={styles.srOnly} role="status">{statusText}{report?.limited?" Một số khu vực vượt quá giới hạn báo cáo.":""}{unmappedCountries?" Có lượt truy cập chưa thể đặt lên bản đồ.":""}</p>
  <div className={styles.viewToggle} role="group" aria-label="Phạm vi bản đồ">
   <button type="button" className={mapView==="vietnam"?styles.viewActive:styles.viewButton} aria-pressed={mapView==="vietnam"} onClick={()=>changeMapView("vietnam")}>Việt Nam</button>
   <button type="button" className={mapView==="world"?styles.viewActive:styles.viewButton} aria-pressed={mapView==="world"} onClick={()=>changeMapView("world")}>Thế giới</button>
  </div>
  <div ref={canvasRef} className={styles.canvas} onClick={event=>{if(event.target===event.currentTarget){setSelectedCountry("");setHoverCountry("");}}}>
   <svg viewBox={[viewport.x,viewport.y,viewport.width,viewport.height].join(" ")} preserveAspectRatio="xMidYMid meet" role="group" aria-labelledby={mapTitleId} aria-describedby={mapDescriptionId} className={styles.map+(mapView==="vietnam"?" "+styles.vietnamView:"")} onClick={event=>{if(event.target===event.currentTarget){setSelectedCountry("");setHoverCountry("");}}}>
    <defs>
     <linearGradient id={landFadeId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="white" stopOpacity=".15"/><stop offset=".1" stopColor="white"/><stop offset=".86" stopColor="white"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient>
     <mask id={landMaskId} maskUnits="userSpaceOnUse" x={viewport.x} y={viewport.y} width={viewport.width} height={viewport.height}><rect x={viewport.x} y={viewport.y} width={viewport.width} height={viewport.height} fill={"url(#"+landFadeId+")"}/></mask>
    </defs>
    <g aria-hidden="true" className={styles.land} mask={"url(#"+landMaskId+")"}>{(mapView==="vietnam"?regionalShapes:COUNTRY_SHAPES).map((shape,index)=><path key={shape.id+"-"+index} d={shape.path} className={mapView==="vietnam"&&shape.id==="VN"?styles.vietnamLand:undefined}/>)}</g>
    <g aria-hidden="true" className={styles.geographicLabels}>{geographicLabels.map(label=><g key={label.name} transform={"translate("+label.x+" "+label.y+")"}><text className={styles.geographicLabel+("primary" in label?" "+styles.primaryLabel:"")} transform={"scale("+(1/viewport.scale)+")"} textLength={label.width} lengthAdjust="spacingAndGlyphs">{label.name}</text></g>)}</g>
    {ARCHIPELAGO_REFERENCES.map(reference=><g key={reference.id} className={styles.archipelago} role="img" aria-label={"Quần đảo "+reference.name} data-geographic-reference={reference.id}>
     <title>{"Quần đảo "+reference.name+" · Ký hiệu địa lý"}</title>
     {reference.islands.map(island=><g key={island.name} aria-hidden="true" transform={"translate("+island.x+" "+island.y+")"}><path className={styles.islandSymbol} transform={"scale("+(1/viewport.scale)+")"} d="M-1.4 .8 -.7 -.8 .7 -1.1 1.5 .25 .2 .95Z"/></g>)}
     {mapView==="vietnam"?<g aria-hidden="true" transform={"translate("+reference.x+" "+Math.max(...reference.islands.map(island=>island.y))+")"}><text className={styles.archipelagoLabel} transform={"scale("+(1/viewport.scale)+")"}><tspan x="0" y="16" textLength="41" lengthAdjust="spacingAndGlyphs">Quần đảo</tspan><tspan x="0" y="29" textLength={reference.id==="hoang-sa"?48:58} lengthAdjust="spacingAndGlyphs">{reference.name}</tspan></text></g>:null}
    </g>)}
    {visiblePoints.map(point=>{
     const country=countryIndex.get(point.id)!;
     // Keep adjacent countries from intercepting one another's pointer targets.
     const hitRadius=Math.min(22,...visiblePoints.filter(other=>other.id!==point.id).map(other=>Math.hypot(other.x-point.x,other.y-point.y)*viewport.scale/2));
     const label=countryLabel(country)+": "+formatNumber.format(country.activeUsers)+" người dùng hoạt động trong 30 phút qua. Tổng hợp theo quốc gia.";
     return <g key={point.id} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={label} aria-pressed={selectedCountry===point.id} aria-describedby={highlightedId===point.id?tooltipId:undefined} className={`${styles.marker} ${highlightedId===point.id?styles.markerActive:""}`} onMouseEnter={()=>setHoverCountry(point.id)} onMouseLeave={()=>setHoverCountry("")} onFocus={()=>setFocusedCountry(point.id)} onBlur={()=>setFocusedCountry("")} onClick={()=>setSelectedCountry(current=>current===point.id?"":point.id)} onKeyDown={event=>{
      if(event.key==="Enter"||event.key===" "){event.preventDefault();setSelectedCountry(current=>current===point.id?"":point.id);}
      if(event.key==="Escape"){setSelectedCountry("");setHoverCountry("");setFocusedCountry("");}
     }}>
      <g transform={"scale("+(1/viewport.scale)+")"}>
       <circle className={styles.hitArea} r={hitRadius}/>
       <circle className={styles.glow} r="12"/>
       <circle className={styles.pulse} r="8"/>
       <circle className={styles.focusRing} r="9"/>
       <circle className={styles.dot} r="3.5"/>
      </g>
     </g>;
    })}
   </svg>
   {highlighted&&highlightedPoint&&mapSize.width>0?<div id={tooltipId} role="tooltip" className={`${styles.tooltip} ${tooltipBelow?styles.tooltipBelow:""}`} style={{left:Math.max(108,Math.min(mapSize.width-108,pointX)),top:pointY+(tooltipBelow?17:-17)}}><strong>{countryLabel(highlighted)}</strong><span>{formatNumber.format(highlighted.activeUsers)} người dùng · 30 phút qua</span><small>Tổng hợp theo quốc gia{reportError&&report?" · Dữ liệu lúc "+updatedTime(report.updatedAt):""}</small></div>:null}
  </div>
  <button type="button" className={`${styles.mapControl} ${needsAttention?styles.controlAttention:""}`} title={controlLabel} aria-label={controlLabel} aria-haspopup="dialog" aria-expanded={manageOpen} aria-controls={settingsId} onClick={openManagement}>
   {data?.canManage?<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9.5 3-.7 2.1-1.4.8-2.2-.4-2.5 4.3 1.5 1.7v1.6l-1.5 1.7 2.5 4.3 2.2-.4 1.4.8.7 2.1h5l.7-2.1 1.4-.8 2.2.4 2.5-4.3-1.5-1.7v-1.6l1.5-1.7-2.5-4.3-2.2.4-1.4-.8-.7-2.1h-5Z"/><circle cx="12" cy="12" r="3"/></svg>:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 10.5v6M12 7v.5"/></svg>}
  </button>

  <dialog ref={dialogRef} id={settingsId} className={styles.settings} aria-labelledby={settingsHeadingId} onCancel={event=>{event.preventDefault();closeManagement();}} onClose={()=>{setManageOpen(false);setConfirmDisconnect(false);}} onClick={event=>{if(event.target===event.currentTarget){const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)closeManagement();}}}>
   <div className={styles.settingsHeading}><div><h3 id={settingsHeadingId}>Google Analytics 4</h3><p>Người dùng hoạt động trong 30 phút qua</p></div><button type="button" className={styles.closeButton} aria-label="Đóng cài đặt bản đồ" onClick={closeManagement} autoFocus>×</button></div>
   <p className={styles.statusDetail}>{statusText}</p>
   {callbackNotice?<div className={callbackError?styles.warning:styles.notice} role="status"><span>{callbackNotice}</span><button type="button" className={styles.dismiss} aria-label="Ẩn thông báo kết nối" onClick={()=>setCallbackCode("")}>×</button></div>:null}
   {actionNotice?<p className={styles.notice} role="status">{actionNotice}</p>:null}
   {reportError?<p className={styles.error} role="alert">{reportError}{report?" Các chấm đang hiển thị dữ liệu của lần cập nhật trước.":""}</p>:null}
   {report?<p className={styles.explanation}>Mỗi chấm đại diện cho một quốc gia có truy cập. Đây là vị trí tổng hợp gần đúng, không phải địa chỉ chính xác của từng người. Số liệu có thể cập nhật chậm và tự làm mới mỗi phút khi xem bản đồ.</p>:null}
   {report?.limited?<p className={styles.warning}>Google Analytics trả về nhiều khu vực hơn giới hạn của báo cáo; bản đồ có thể chưa hiển thị đầy đủ.</p>:null}
   {unmappedCountries?<p className={styles.explanation}>Một số lượt truy cập chưa xác định được quốc gia hoặc chưa có điểm tương ứng trên bản đồ. Các lượt này không được đặt chấm.</p>:null}
   <button type="button" className={styles.textButton} onClick={()=>setRefreshKey(value=>value+1)} disabled={refreshing||Boolean(action)}>{refreshing?"Đang cập nhật…":"↻ Cập nhật dữ liệu"}</button>

   {data?.status==="not_connected"?<div className={styles.connectionStart}>{data.canManage?(data.connectAvailable?<><p>Kết nối tài khoản Google có quyền xem dữ liệu của iextra.net.</p><form method="post" action="/api/admin/google-analytics/connect"><button type="submit" className={styles.primary}>Kết nối Google Analytics</button></form></>:<p>Chưa sẵn sàng kết nối. Quản trị viên cần hoàn tất cấu hình Google OAuth trên hệ thống.</p>):<p>Chủ quản trị cần kết nối Google Analytics để hiển thị dữ liệu truy cập.</p>}</div>:null}
   {data?.status==="select_property"&&!data.canManage?<p className={styles.explanation}>Chủ quản trị cần chọn nguồn dữ liệu của iextra.net để hoàn tất kết nối.</p>:null}
   {showManagement?<div className={styles.management}>
    <p className={styles.explanation}>Chọn tài sản và luồng dữ liệu thuộc iextra.net.</p>
    {propertiesError||streamsError?<div className={styles.error} role="alert"><span>{propertiesError||streamsError}</span><button type="button" className={styles.textButton} onClick={()=>setOptionsRefresh(value=>value+1)} disabled={propertiesLoading||streamsLoading}>Tải lại danh sách</button></div>:null}
    <form onSubmit={save} className={styles.configurationForm}>
     <label>Tài sản Google Analytics<select value={propertyDraft} disabled={propertiesLoading||Boolean(action)} onChange={event=>{setPropertyDraft(event.target.value);setStreamDraft("");setActionError("");}}><option value="">{propertiesLoading?"Đang tải tài sản…":"Chọn tài sản"}</option>{properties.map(property=><option key={property.id} value={property.id}>{property.name}{property.accountName?" · "+property.accountName:""}</option>)}</select></label>
     <label>Luồng dữ liệu website<select value={streamDraft} disabled={!propertyDraft||streamsLoading||Boolean(action)} onChange={event=>{setStreamDraft(event.target.value);setActionError("");}}><option value="">{streamsLoading?"Đang tải luồng dữ liệu…":"Chọn luồng iextra.net"}</option>{streams.map(stream=><option key={stream.id} value={stream.id} disabled={!stream.compatible}>{stream.name} · {stream.siteUrl||"Không có địa chỉ web"}{!stream.compatible?" (không thuộc iextra.net)":""}</option>)}</select></label>
     <button type="submit" className={styles.primary} disabled={!canSave}>{action==="save"?"Đang lưu…":"Lưu nguồn dữ liệu"}</button>
    </form>
    {!propertiesLoading&&!propertiesError&&properties.length===0?<p className={styles.setupHint}>Tài khoản này chưa có tài sản Analytics mà bạn được phép xem. <a href={GOOGLE_ANALYTICS_URL} target="_blank" rel="noreferrer noopener">Mở Google Analytics</a> để tạo hoặc kiểm tra quyền truy cập, rồi tải lại danh sách.</p>:null}
    {propertyDraft&&!streamsLoading&&!streamsError&&streams.length>0&&!streams.some(stream=>stream.compatible)?<p className={styles.setupHint}>Tài sản này chưa có luồng dữ liệu cho iextra.net. Chọn tài sản khác hoặc <a href={GOOGLE_ANALYTICS_URL} target="_blank" rel="noreferrer noopener">kiểm tra trong Google Analytics</a>.</p>:null}
    {propertyDraft&&!streamsLoading&&!streamsError&&streams.length===0?<p className={styles.setupHint}>Chưa có luồng dữ liệu website trong tài sản này. <a href={GOOGLE_ANALYTICS_URL} target="_blank" rel="noreferrer noopener">Mở Google Analytics</a> để kiểm tra hoặc tạo luồng cho iextra.net.</p>:null}
    {actionError?<p className={styles.error} role="alert">{actionError}</p>:null}
    <div className={styles.connectionActions}>{data?.connectAvailable?<form method="post" action="/api/admin/google-analytics/connect"><button type="submit" className={styles.secondary} disabled={Boolean(action)}>Kết nối lại tài khoản Google</button></form>:null}<button type="button" className={styles.disconnectButton} disabled={Boolean(action)} onClick={()=>setConfirmDisconnect(true)}>Ngắt kết nối</button></div>
    {confirmDisconnect?<div className={styles.confirmation} role="group" aria-label="Xác nhận ngắt kết nối Google Analytics"><strong>Ngắt kết nối khỏi Admin?</strong><p>Dữ liệu trong tài khoản Google Analytics vẫn được giữ nguyên.</p><div><button type="button" className={styles.secondary} disabled={Boolean(action)} onClick={()=>setConfirmDisconnect(false)}>Giữ kết nối</button><button type="button" className={styles.danger} disabled={Boolean(action)} onClick={()=>void updateConnection("disconnect")}>{action==="disconnect"?"Đang ngắt…":"Xác nhận ngắt"}</button></div></div>:null}
   </div>:null}
  </dialog>
 </section>;
}

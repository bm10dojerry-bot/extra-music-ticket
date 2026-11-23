"use client";

import {useEffect,useId,useRef,useState,type FormEvent} from "react";
import {
 GOOGLE_ANALYTICS_CALLBACK_MESSAGES,
 type GoogleAnalyticsResponse,
 type GoogleAnalyticsPropertyOption,
 type GoogleAnalyticsStreamOption,
 type GoogleAnalyticsReport,
} from "../../lib/google-analytics-types";
import {COUNTRY_SHAPES} from "./ga4-world-map-data";
import styles from "./google-analytics-map.module.css";

const formatNumber=new Intl.NumberFormat("vi-VN");
const regionNames=typeof Intl.DisplayNames==="function"?new Intl.DisplayNames(["vi"],{type:"region"}):null;
const GOOGLE_ANALYTICS_URL="https://analytics.google.com/analytics/web/";
const REFRESH_MS=60000;
type PlaceMode="countries"|"cities";
type PlaceRow=GoogleAnalyticsReport["countries"][number]&{city?:string};

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
function heatColor(users:number,maximum:number){
 const strength=Math.sqrt(users/Math.max(1,maximum));
 return `hsl(${194-strength*20} ${40+strength*17}% ${27+strength*35}%)`;
}

export default function GoogleAnalyticsMap(){
 const mapTitleId=useId();
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
 const [mode,setMode]=useState<PlaceMode>("countries");
 const [selectedCountry,setSelectedCountry]=useState("");
 const [hoverCountry,setHoverCountry]=useState("");
 const [visibleRows,setVisibleRows]=useState(20);
 const panelRef=useRef<HTMLElement>(null);
 const rankingHeading=useRef<HTMLHeadingElement>(null);
 const reportController=useRef<AbortController|null>(null);
 const actionController=useRef<AbortController|null>(null);
 const mutating=useRef(false),mounted=useRef(false);

 useEffect(()=>{
  mounted.current=true;
  setCallbackCode(new URLSearchParams(window.location.search).get("ga4")||"");
  return()=>{mounted.current=false;actionController.current?.abort();};
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
     setSelectedCountry(current=>next.report?.countries.some(country=>countryKey(country.countryId)===current)?current:"");
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

 const showManagement=Boolean(data?.canManage&&(manageOpen||data.status==="select_property")&&data.status!=="not_connected");
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
    setManageOpen(false);setConfirmDisconnect(false);setCallbackCode("");setSelectedCountry("");setHoverCountry("");
    setData(null);setLoading(true);setLoadError("");setActionNotice(operation==="save"?"Đã lưu nguồn dữ liệu Google Analytics.":"Đã ngắt kết nối Google Analytics khỏi Admin.");
    if(operation==="disconnect"){setPropertyDraft("");setStreamDraft("");setProperties([]);setStreams([]);}
    setRefreshKey(value=>value+1);
   }
  }catch(error){if(mounted.current&&!controller.signal.aborted)setActionError(error instanceof Error?error.message:"Chưa hoàn tất thay đổi. Vui lòng thử lại.");}
  finally{mutating.current=false;if(mounted.current)setAction(null);}
 }
 function save(event:FormEvent<HTMLFormElement>){event.preventDefault();void updateConnection("save");}
 function selectCountry(id:string){setSelectedCountry(current=>current===id?"":id);setMode("cities");setVisibleRows(20);rankingHeading.current?.focus();}
 function changeMode(next:PlaceMode){setMode(next);setVisibleRows(20);}
 function closeManagement(){setManageOpen(false);setConfirmDisconnect(false);setActionError("");}

 const report=data?.status==="ready"?data.report:undefined;
 const countries=[...(report?.countries||[])].sort((a,b)=>b.activeUsers-a.activeUsers||countryLabel(a).localeCompare(countryLabel(b),"vi"));
 const countryIndex=new Map(countries.map(country=>[countryKey(country.countryId),country]));
 const maxUsers=Math.max(1,...countries.map(country=>country.activeUsers));
 const selected=countryIndex.get(selectedCountry);
 const highlighted=countryIndex.get(hoverCountry)||selected;
 const cities=[...(report?.cities||[])].filter(city=>!selectedCountry||countryKey(city.countryId)===selectedCountry).sort((a,b)=>b.activeUsers-a.activeUsers||a.city.localeCompare(b.city,"vi"));
 const placeRows:PlaceRow[]=mode==="countries"?countries:cities;
 const selectedStream=streams.find(stream=>stream.id===streamDraft&&stream.compatible);
 const canSave=Boolean(properties.some(property=>property.id===propertyDraft)&&selectedStream&&!propertiesError&&!streamsError&&!propertiesLoading&&!streamsLoading&&!action);
 const callbackNotice=callbackCode==="connected"?(data?.status==="select_property"?"Đã kết nối tài khoản Google. Chọn dữ liệu của iextra.net để hoàn tất.":data?.status==="ready"?"Kết nối Google Analytics đã sẵn sàng.":""):GOOGLE_ANALYTICS_CALLBACK_MESSAGES[callbackCode]||"";
 const reportError=loadError||data?.error||"";
 const unavailable=!report&&!loading;
 const emptyTitle=data?.status==="not_connected"?"Kết nối để xem khách truy cập":data?.status==="select_property"?"Chọn nguồn dữ liệu của website":reportError?"Chưa tải được bản đồ truy cập":"Chưa có dữ liệu Google Analytics";
 const emptyDescription=data?.status==="not_connected"?(data.canManage?"Xem khu vực có người dùng hoạt động trên iextra.net bằng dữ liệu Google Analytics 4.":"Chủ quản trị cần kết nối Google Analytics để hiển thị dữ liệu truy cập."):data?.status==="select_property"?(data.canManage?"Chọn tài sản và luồng dữ liệu iextra.net bên dưới để bắt đầu xem báo cáo.":"Chủ quản trị cần chọn nguồn dữ liệu của iextra.net để hoàn tất kết nối."):"Vui lòng cập nhật lại để kiểm tra kết nối và dữ liệu mới nhất.";

 return <section ref={panelRef} className={styles.panel} aria-labelledby="ga4-map-heading" aria-busy={loading}>
  <header className={styles.header}>
   <div><div className={styles.headingRow}><h2 id="ga4-map-heading">Khách truy cập theo khu vực</h2><span className={styles.source}><span aria-hidden="true" className={styles.sourceIcon}>▥</span> Google Analytics 4</span></div><p>Người dùng hoạt động trong 30 phút qua</p></div>
   <div className={styles.headerActions}>
    <button type="button" className={styles.secondary} onClick={()=>setRefreshKey(value=>value+1)} disabled={refreshing||Boolean(action)} aria-label="Cập nhật dữ liệu Google Analytics">{refreshing?"Đang cập nhật…":"↻ Cập nhật"}</button>
    {data?.canManage&&data.status!=="not_connected"&&data.status!=="select_property"?<button type="button" className={styles.settingsButton} aria-expanded={showManagement} aria-controls="ga4-connection-settings" disabled={Boolean(action)} onClick={()=>showManagement?closeManagement():setManageOpen(true)}>{showManagement?"Đóng cài đặt":"Cài đặt kết nối"}</button>:null}
   </div>
  </header>

  {callbackNotice?<div className={callbackCode==="connected"?styles.notice:styles.warning} role="status"><span>{callbackNotice}</span><button type="button" className={styles.dismiss} aria-label="Ẩn thông báo kết nối" onClick={()=>setCallbackCode("")}>×</button></div>:null}
  {actionNotice?<p className={styles.notice} role="status">{actionNotice}</p>:null}
  {reportError?<div className={styles.error} role="alert"><span>{reportError}{report?" Dữ liệu bên dưới được giữ ở lần cập nhật gần nhất.":""}</span><button type="button" className={styles.secondary} disabled={refreshing||Boolean(action)} onClick={()=>setRefreshKey(value=>value+1)}>Thử lại</button></div>:null}

  <div className={styles.content}>
   <div className={styles.mapColumn}>
    <div className={styles.mapSummary}>
     <div className={styles.activeMetric}><span>Người dùng hoạt động</span><strong>{report?formatNumber.format(report.totalActiveUsers):"—"}</strong><small>Trong 30 phút qua</small></div>
     <div className={styles.mapStatus}><span className={report&&!reportError?styles.connected:styles.waiting}><i aria-hidden="true"/>{report?reportError?"Dữ liệu trước đó":"Đã kết nối":loading?"Đang tải":data?.status==="not_connected"?"Chưa kết nối":"Chờ dữ liệu"}</span><small>{report?"Cập nhật "+updatedTime(report.updatedAt):"Nguồn dữ liệu Google Analytics"}</small></div>
    </div>
    <div className={styles.mapCanvas}>
     <svg viewBox="0 0 800 420" role="group" aria-labelledby={mapTitleId} className={styles.map}>
      <title id={mapTitleId}>Bản đồ quốc gia có người dùng hoạt động trong 30 phút qua</title>
      <g className={styles.grid} aria-hidden="true"><path d="M0 105H800M0 210H800M0 315H800M200 0V420M400 0V420M600 0V420"/></g>
      <g>{COUNTRY_SHAPES.map((shape,index)=>{
       const row=countryIndex.get(shape.id),interactive=Boolean(report&&row&&row.activeUsers>0);
       return <path key={shape.id+"-"+index} d={shape.path} style={interactive&&row?{fill:heatColor(row.activeUsers,maxUsers)}:undefined} className={`${styles.country} ${interactive?styles.activeCountry:""} ${selectedCountry===shape.id?styles.selectedCountry:""}`} role={interactive?"button":undefined} tabIndex={interactive?0:undefined} aria-hidden={!interactive} aria-label={interactive&&row?`${countryLabel(row)}: ${formatNumber.format(row.activeUsers)} người dùng. Xem thành phố.`:undefined} aria-pressed={interactive?selectedCountry===shape.id:undefined} onMouseEnter={()=>interactive&&setHoverCountry(shape.id)} onMouseLeave={()=>setHoverCountry("")} onFocus={()=>interactive&&setHoverCountry(shape.id)} onBlur={()=>setHoverCountry("")} onClick={()=>interactive&&selectCountry(shape.id)} onKeyDown={event=>{if(interactive&&(event.key==="Enter"||event.key===" ")){event.preventDefault();selectCountry(shape.id);}}}>{row?<title>{countryLabel(row)} · {formatNumber.format(row.activeUsers)} người dùng</title>:null}</path>;
      })}</g>
     </svg>
     {loading&&!data?<div className={styles.mapOverlay} role="status"><span className={styles.loadingMark} aria-hidden="true"/><strong>Đang tải dữ liệu truy cập…</strong></div>:unavailable?<div className={styles.mapOverlay}><div className={styles.emptyIcon} aria-hidden="true">⌖</div><h3>{emptyTitle}</h3><p>{emptyDescription}</p>{data?.status==="not_connected"&&data.canManage?(data.connectAvailable?<form method="post" action="/api/admin/google-analytics/connect"><button type="submit" className={styles.primary}>Kết nối Google Analytics</button></form>:<p className={styles.setupHint}>Chưa sẵn sàng kết nối. Quản trị viên cần hoàn tất cấu hình kết nối Google trên hệ thống.</p>):null}</div>:report?.totalActiveUsers===0?<div className={styles.zeroState}><strong>Chưa ghi nhận người dùng trong 30 phút qua</strong><span>Bản đồ sẽ cập nhật khi Google Analytics ghi nhận truy cập mới.</span></div>:null}
     {report&&report.totalActiveUsers>0?<div className={styles.mapSelection} aria-live="polite">{highlighted?<><strong>{countryLabel(highlighted)}</strong><span>{formatNumber.format(highlighted.activeUsers)} người dùng</span></>:<span>Chọn một quốc gia để xem các thành phố.</span>}</div>:null}
    </div>
    <div className={styles.mapLegend}><span>{report?"Mức độ truy cập":"Bản đồ sẽ hiển thị sau khi có dữ liệu"}</span>{report?<><span>Ít</span><i aria-hidden="true"/><span>Nhiều</span></>:null}</div>
   </div>

   <div className={styles.ranking}>
    <div className={styles.rankingHeader}><h3 ref={rankingHeading} tabIndex={-1}>Khu vực truy cập</h3><div className={styles.modeButtons} aria-label="Chọn cấp khu vực"><button type="button" aria-pressed={mode==="countries"} onClick={()=>changeMode("countries")}>Quốc gia</button><button type="button" aria-pressed={mode==="cities"} onClick={()=>changeMode("cities")}>Thành phố</button></div></div>
    {selectedCountry&&mode==="cities"?<div className={styles.countryFilter}><span>{selected?countryLabel(selected):"Khu vực đã chọn"}</span><button type="button" aria-label="Bỏ lọc quốc gia" onClick={()=>{setSelectedCountry("");setVisibleRows(20);}}>×</button></div>:null}
    <div className={styles.rankingScroll} tabIndex={0} role="region" aria-label={mode==="countries"?"Số người dùng theo quốc gia":"Số người dùng theo thành phố"}>
     <table><thead><tr><th scope="col">{mode==="countries"?"Quốc gia":"Thành phố"}</th><th scope="col">Người dùng</th></tr></thead><tbody>{report&&placeRows.length?placeRows.slice(0,visibleRows).map((row,index)=>{
      const isCity=typeof row.city==="string",name=isCity?placeLabel(row.city||""):countryLabel(row);
      return <tr key={`${countryKey(row.countryId)}-${isCity?row.city:"country"}-${index}`} className={!isCity&&countryKey(row.countryId)===selectedCountry?styles.selectedRow:undefined}><th scope="row"><div className={styles.placeName}><span className={styles.rank}>{index+1}</span><div>{isCity?<strong>{name}</strong>:<button type="button" onClick={()=>selectCountry(countryKey(row.countryId))}>{name}<span className={styles.srOnly}> — xem các thành phố</span></button>}{isCity?<small>{countryLabel(row)}</small>:null}</div></div></th><td>{formatNumber.format(row.activeUsers)}</td></tr>;
     }):<tr><td colSpan={2} className={styles.tableEmpty}>{loading&&!data?"Đang tải…":!report?"Chưa có dữ liệu để hiển thị.":report.totalActiveUsers===0?"Chưa ghi nhận truy cập trong khoảng thời gian này.":selectedCountry&&mode==="cities"?"Chưa có dữ liệu thành phố của khu vực này.":"Chưa có thông tin vị trí từ Google Analytics."}</td></tr>}</tbody></table>
    </div>
    {report&&placeRows.length>visibleRows?<button type="button" className={styles.moreButton} onClick={()=>setVisibleRows(value=>value+20)}>Xem thêm · {visibleRows}/{placeRows.length} khu vực</button>:null}
    <p className={styles.rankingNote}>Vị trí gần đúng theo khu vực, không phải địa chỉ chính xác của từng người.</p>
   </div>
  </div>

  {report?.limited?<p className={styles.warning} role="status">Google Analytics trả về nhiều khu vực hơn giới hạn hiển thị. Tổng người dùng được lấy riêng từ báo cáo tổng.</p>:null}
  {data?.property?<div className={styles.propertySummary}><span><strong>{data.property.name}</strong> · {data.property.streamName}</span><span>{data.property.siteUrl}</span></div>:null}

  {showManagement?<section id="ga4-connection-settings" className={styles.settings} aria-labelledby="ga4-settings-heading">
   <div className={styles.settingsHeading}><div><h3 id="ga4-settings-heading">Kết nối Google Analytics</h3><p>Chọn tài sản và luồng dữ liệu thuộc iextra.net.</p></div>{data?.status!=="select_property"?<button type="button" className={styles.settingsButton} onClick={closeManagement} disabled={Boolean(action)}>Đóng</button>:null}</div>
   {propertiesError||streamsError?<div className={styles.error} role="alert"><span>{propertiesError||streamsError}</span><button type="button" className={styles.secondary} onClick={()=>setOptionsRefresh(value=>value+1)} disabled={propertiesLoading||streamsLoading}>Tải lại danh sách</button></div>:null}
   <form onSubmit={save} className={styles.configurationForm}>
    <label>Tài sản Google Analytics<select value={propertyDraft} disabled={propertiesLoading||Boolean(action)} onChange={event=>{setPropertyDraft(event.target.value);setStreamDraft("");setActionError("");}}><option value="">{propertiesLoading?"Đang tải tài sản…":"Chọn tài sản"}</option>{properties.map(property=><option key={property.id} value={property.id}>{property.name}{property.accountName?" · "+property.accountName:""}</option>)}</select></label>
    <label>Luồng dữ liệu website<select value={streamDraft} disabled={!propertyDraft||streamsLoading||Boolean(action)} onChange={event=>{setStreamDraft(event.target.value);setActionError("");}}><option value="">{streamsLoading?"Đang tải luồng dữ liệu…":"Chọn luồng iextra.net"}</option>{streams.map(stream=><option key={stream.id} value={stream.id} disabled={!stream.compatible}>{stream.name} · {stream.siteUrl||"Không có địa chỉ web"}{!stream.compatible?" (không thuộc iextra.net)":""}</option>)}</select></label>
    <button type="submit" className={styles.primary} disabled={!canSave}>{action==="save"?"Đang lưu…":"Lưu nguồn dữ liệu"}</button>
   </form>
   {!propertiesLoading&&!propertiesError&&properties.length===0?<p className={styles.setupHint}>Tài khoản Google này chưa có tài sản Analytics mà bạn được phép xem. <a href={GOOGLE_ANALYTICS_URL} target="_blank" rel="noreferrer noopener">Mở Google Analytics</a> để tạo hoặc kiểm tra quyền truy cập, rồi tải lại danh sách.</p>:null}
   {propertyDraft&&!streamsLoading&&!streamsError&&streams.length>0&&!streams.some(stream=>stream.compatible)?<p className={styles.setupHint}>Tài sản này chưa có luồng dữ liệu cho iextra.net. Chọn tài sản khác hoặc <a href={GOOGLE_ANALYTICS_URL} target="_blank" rel="noreferrer noopener">kiểm tra trong Google Analytics</a>.</p>:null}
   {propertyDraft&&!streamsLoading&&!streamsError&&streams.length===0?<p className={styles.setupHint}>Chưa có luồng dữ liệu website trong tài sản này. <a href={GOOGLE_ANALYTICS_URL} target="_blank" rel="noreferrer noopener">Mở Google Analytics</a> để kiểm tra hoặc tạo luồng cho iextra.net.</p>:null}
   {actionError?<p className={styles.error} role="alert">{actionError}</p>:null}
   <div className={styles.connectionActions}>{data?.connectAvailable?<form method="post" action="/api/admin/google-analytics/connect"><button type="submit" className={styles.secondary} disabled={Boolean(action)}>Đổi / kết nối lại tài khoản Google</button></form>:null}<button type="button" className={styles.disconnectButton} disabled={Boolean(action)} onClick={()=>setConfirmDisconnect(true)}>Ngắt kết nối</button></div>
   {confirmDisconnect?<div className={styles.confirmation} role="group" aria-label="Xác nhận ngắt kết nối Google Analytics"><div><strong>Ngắt kết nối Google Analytics khỏi Admin?</strong><p>Dữ liệu trong tài khoản Google Analytics vẫn được giữ nguyên.</p></div><div><button type="button" className={styles.secondary} disabled={Boolean(action)} onClick={()=>setConfirmDisconnect(false)}>Giữ kết nối</button><button type="button" className={styles.danger} disabled={Boolean(action)} onClick={()=>void updateConnection("disconnect")}>{action==="disconnect"?"Đang ngắt…":"Xác nhận ngắt kết nối"}</button></div></div>:null}
  </section>:null}
  <footer className={styles.footer}><span>Số liệu do Google Analytics ghi nhận; có thể cập nhật chậm so với truy cập thực tế.</span><span>Tự cập nhật mỗi phút khi xem báo cáo</span></footer>
 </section>;
}

"use client";

import {useEffect,useRef,useState} from "react";
import {DEFAULT_SALE_COMMISSION_TIERS,type SaleCommissionPolicy,type SaleCommissionTier} from "../../lib/sale-commission";
import styles from "./sale-commission-manager.module.css";

type ShowOption={id:string;artist:string;date:string;title?:string};
type DraftTier={maxTickets:string;rate:string};
const numberFormat=new Intl.NumberFormat("vi-VN");
const SAMPLE_TICKET_PRICE=500000;
const money=(value:number)=>numberFormat.format(value)+" đ";
const dateLabel=(value:string)=>value?value.split("-").reverse().join("/"):"Chưa có ngày";
const toDraft=(tiers:readonly SaleCommissionTier[]):DraftTier[]=>tiers.map(tier=>({maxTickets:String(tier.maxTickets),rate:String(tier.rate)}));
function parseTiers(draft:DraftTier[]):{tiers:SaleCommissionTier[];error:string}{
 if(draft.length<1||draft.length>12)return {tiers:[],error:"Mỗi show cần từ 1 đến 12 bậc hoa hồng."};
 const tiers:SaleCommissionTier[]=[];
 let previous=0;
 for(let index=0;index<draft.length;index++){
  const item=draft[index],maximum=Number(item.maxTickets),rate=Number(item.rate);
  if(!item.maxTickets.trim()||!Number.isSafeInteger(maximum)||maximum<=previous||maximum>10000)
   return {tiers:[],error:`Vé cuối bậc ${index+1} phải là số nguyên lớn hơn ${previous} và không quá 10.000.`};
  if(!item.rate.trim()||!Number.isFinite(rate)||rate<0||rate>100||Math.abs(rate*100-Math.round(rate*100))>0.000001)
   return {tiers:[],error:`Tỷ lệ bậc ${index+1} phải từ 0 đến 100%, tối đa 2 chữ số thập phân.`};
  tiers.push({maxTickets:maximum,rate});previous=maximum;
 }
 return {tiers,error:""};
}
function readPolicy(value:unknown,showId:string):SaleCommissionPolicy{
 if(!value||typeof value!=="object"||!("policy" in value))throw Error("Chưa nhận được cấu hình của show.");
 const policy=value.policy as SaleCommissionPolicy;
 if(!policy||policy.showId!==showId||!Array.isArray(policy.tiers)||!(policy.source==="show"||policy.source==="default")||(policy.version!==null&&typeof policy.version!=="string"))
  throw Error("Cấu hình trả về không khớp với show đang chọn. Vui lòng tải lại.");
 if(policy.tiers.some(tier=>!tier||typeof tier.maxTickets!=="number"||typeof tier.rate!=="number")||parseTiers(toDraft(policy.tiers)).error)
  throw Error("Bảng bậc hoa hồng trả về chưa hợp lệ. Vui lòng tải lại.");
 return policy;
}
function responseError(value:unknown,fallback:string){return value&&typeof value==="object"&&"error" in value&&typeof value.error==="string"?value.error:fallback;}
function sameTiers(left:SaleCommissionTier[],right:SaleCommissionTier[]){return left.length===right.length&&left.every((tier,index)=>tier.maxTickets===right[index].maxTickets&&tier.rate===right[index].rate);}

export default function SaleCommissionManager({shows,showReady,onSaved}:{shows:ShowOption[];showReady:boolean;onSaved?:()=>void}){
 const [showId,setShowId]=useState("");
 const [pendingShowId,setPendingShowId]=useState<string|null>(null);
 const [saved,setSaved]=useState<SaleCommissionPolicy|null>(null);
 const [draft,setDraft]=useState<DraftTier[]>([]);
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[reload,setReload]=useState(0);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const [exampleTickets,setExampleTickets]=useState("20");
 const actionController=useRef<AbortController|null>(null),mounted=useRef(false);
 const selectedShow=shows.find(show=>show.id===showId);
 const policy=saved?.showId===showId?saved:null;
 const parsed=parseTiers(draft),valid=!parsed.error;
 const dirty=Boolean(policy&&(!valid||!sameTiers(parsed.tiers,policy.tiers)));
 const needsSave=Boolean(policy&&(policy.source==="default"||dirty));
 const busy=loading||saving;

 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;actionController.current?.abort();};},[]);
 useEffect(()=>{
  setSaved(null);setDraft([]);setError("");setNotice("");
  if(!showReady||!showId){setLoading(false);return;}
  const controller=new AbortController();setLoading(true);
  async function load(){
   try{
    const response=await fetch("/api/admin/sale-commission?showId="+encodeURIComponent(showId),{cache:"no-store",signal:controller.signal});
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw Error(responseError(result,"Không tải được cấu hình hoa hồng của show."));
    const next=readPolicy(result,showId);
    if(!controller.signal.aborted){setSaved(next);setDraft(toDraft(next.tiers));}
   }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Không tải được cấu hình hoa hồng.");}
   finally{if(!controller.signal.aborted)setLoading(false);}
  }
  void load();return()=>controller.abort();
 },[showId,showReady,reload]);

 function chooseShow(next:string){if(saving||next===showId)return;if(dirty){setPendingShowId(next);return;}setShowId(next);setPendingShowId(null);}
 function changeTier(index:number,key:keyof DraftTier,value:string){setDraft(current=>current.map((tier,at)=>at===index?{...tier,[key]:value}:tier));setNotice("");}
 function addTier(){
  const last=parsed.tiers[parsed.tiers.length-1];
  if(!valid||!last||draft.length>=12||last.maxTickets>=10000)return;
  setDraft(current=>[...current,{maxTickets:String(Math.min(10000,last.maxTickets+100)),rate:String(last.rate)}]);setNotice("");
 }
 async function save(){
  if(!policy||!selectedShow||!valid||!needsSave||busy)return;
  const controller=new AbortController();actionController.current=controller;
  const savingShowId=showId,savingTiers=parsed.tiers;
  setPendingShowId(null);setSaving(true);setError("");setNotice("");
  try{
   const response=await fetch("/api/admin/sale-commission",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({showId:savingShowId,tiers:savingTiers,version:policy.version}),signal:controller.signal});
   const result=await response.json().catch(()=>null);
   if(!response.ok)throw Error(responseError(result,"Không lưu được hoa hồng của show. Vui lòng thử lại."));
   const confirmed=readPolicy(result,savingShowId);
   if(confirmed.source!=="show"||!confirmed.version||!sameTiers(confirmed.tiers,savingTiers))throw Error("Chưa xác minh được cấu hình vừa lưu. Vui lòng tải lại cấu hình của show.");
   if(mounted.current&&!controller.signal.aborted){
    setSaved(confirmed);setDraft(toDraft(confirmed.tiers));setPendingShowId(null);
    setNotice(`Đã lưu hoa hồng riêng cho ${selectedShow.artist} · ${dateLabel(selectedShow.date)}. Báo cáo sẽ tính lại show này khi tải lại.`);onSaved?.();
   }
  }catch(cause){if(mounted.current&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Không lưu được cấu hình.");}
  finally{if(mounted.current&&!controller.signal.aborted)setSaving(false);}
 }
 const ticketCount=Number(exampleTickets),ticketPrice=SAMPLE_TICKET_PRICE;
 const exampleValid=Boolean(exampleTickets.trim()&&Number.isSafeInteger(ticketCount)&&ticketCount>=0&&ticketCount<=10000);
 let previous=0;
 const sampleBands=valid&&exampleValid?parsed.tiers.map(tier=>{
  const fromTicket=previous+1,tickets=Math.max(0,Math.min(ticketCount,tier.maxTickets)-previous);previous=tier.maxTickets;
  const revenue=tickets*ticketPrice;return {fromTicket,...tier,tickets,revenue,commission:Math.round(revenue*tier.rate/100)};
 }):[];
 const sampleCommission=sampleBands.reduce((total,band)=>total+band.commission,0);
 const lastCap=valid?parsed.tiers[parsed.tiers.length-1]?.maxTickets:0;
 const pendingTickets=exampleValid&&lastCap?Math.max(0,ticketCount-lastCap):0;
 const sampleRevenue=exampleValid?ticketCount*ticketPrice:0;

 return <section className={styles.page} aria-label="Cấu hình hoa hồng Sale theo show">
  <header className={styles.intro}><p className={styles.eyebrow}>QUẢN LÝ NHÂN SỰ</p><h2>Hoa hồng lũy tiến theo từng show</h2><p>Mỗi Sale bắt đầu từ vé số 1 trong từng show. Doanh thu của vé thuộc bậc nào được tính theo tỷ lệ của bậc đó.</p></header>
  <div className={styles.showPicker}><label htmlFor="commission-show-picker">Chọn show để thiết lập<select id="commission-show-picker" value={showId} disabled={!showReady||saving} onChange={event=>chooseShow(event.target.value)}><option value="">{showReady?"— Chọn một show —":"Đang tải danh sách show…"}</option>{shows.map(show=><option key={show.id} value={show.id}>{show.artist} · {dateLabel(show.date)} · {show.id}</option>)}</select></label><p>Ngưỡng vé và tỷ lệ được lưu riêng cho show được chọn.</p></div>
  {pendingShowId!==null?<div className={styles.switchNotice} role="alert"><p>Show hiện tại có thay đổi chưa lưu. Bạn muốn tiếp tục chỉnh hay bỏ thay đổi để chuyển show?</p><div><button type="button" className={styles.secondary} disabled={saving} onClick={()=>setPendingShowId(null)}>Tiếp tục chỉnh</button><button type="button" className={styles.secondary} disabled={saving} onClick={()=>{if(!saving){setShowId(pendingShowId);setPendingShowId(null);}}}>Bỏ thay đổi và chuyển show</button></div></div>:null}
  {error?<div role="alert" className={styles.error}><span>{error}</span>{showId?<button type="button" className={styles.secondary} disabled={busy} onClick={()=>setReload(value=>value+1)}>Tải lại cấu hình</button>:null}</div>:null}
  {notice?<p role="status" className={styles.notice}>{notice}</p>:null}
  {!showId?<p className={styles.empty}>{!showReady?"Đang tải các show đã lưu…":shows.length?"Chọn chương trình ở trên để xem và chỉnh bảng hoa hồng riêng.":"Chưa có show đã lưu. Tạo chương trình trong Lịch show để thiết lập hoa hồng."}</p>:loading?<p className={styles.empty} role="status">Đang tải cấu hình của show…</p>:policy&&selectedShow?<>
   <section className={styles.panel} aria-labelledby="commission-tier-heading">
    <div className={styles.panelHeading}><div><h3 id="commission-tier-heading">{selectedShow.artist} · {dateLabel(selectedShow.date)}</h3><p>{selectedShow.title||selectedShow.id}</p></div><span className={policy.source==="show"?styles.savedBadge:styles.draftBadge}>{policy.source==="show"?"Cấu hình riêng của show":"Mẫu khởi tạo · chưa lưu riêng"}</span></div>
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Chỉnh các bậc hoa hồng của show"><table className={styles.tierTable}><thead><tr><th scope="col">Bậc</th><th scope="col">Từ vé</th><th scope="col">Đến vé</th><th scope="col">Hoa hồng (%)</th><th scope="col"><span className={styles.srOnly}>Xóa bậc</span></th></tr></thead><tbody>{draft.map((tier,index)=>{
     const prior=index===0?0:Number(draft[index-1].maxTickets),from=Number.isSafeInteger(prior)&&draft[index-1]?.maxTickets!==""?prior+1:index===0?1:"—";
     return <tr key={index}><th scope="row">{index+1}</th><td className={styles.rangeStart}>{from}</td><td><input aria-label={`Vé cuối bậc ${index+1}`} type="number" min={typeof from==="number"?from:1} max="10000" step="1" inputMode="numeric" value={tier.maxTickets} disabled={saving} onChange={event=>changeTier(index,"maxTickets",event.target.value)}/></td><td><input aria-label={`Phần trăm hoa hồng bậc ${index+1}`} type="number" min="0" max="100" step="0.01" inputMode="decimal" value={tier.rate} disabled={saving} onChange={event=>changeTier(index,"rate",event.target.value)}/></td><td><button type="button" className={styles.removeButton} aria-label={`Xóa bậc ${index+1}`} disabled={draft.length<=1||saving} onClick={()=>{setDraft(current=>current.filter((_,at)=>at!==index));setNotice("");}}>×</button></td></tr>;
    })}</tbody></table></div>
    <div className={styles.editorTools}><button type="button" className={styles.secondary} disabled={saving||!valid||draft.length>=12||lastCap>=10000} onClick={addTier}>+ Thêm bậc</button><button type="button" className={styles.textButton} disabled={saving} onClick={()=>{setDraft(toDraft(DEFAULT_SALE_COMMISSION_TIERS));setNotice("");}}>Dùng mẫu 4 bậc</button><small>Tối đa 12 bậc · Ngưỡng vé tăng dần, tối đa 10.000</small></div>
    {!valid?<p className={styles.validation} role="alert">{parsed.error}</p>:<p className={styles.capNote}>Từ vé {numberFormat.format(lastCap+1)} trở đi vượt ngưỡng cuối của show và được đánh dấu chờ đối soát hoa hồng.</p>}
    <p className={styles.changeNote}>Khi lưu, cấu hình này được dùng để tính lại hoa hồng tạm tính của show, kể cả các đơn đã thanh toán trước đây. Hệ thống không tự chi tiền thưởng.</p>
    <div className={styles.saveActions}><span>{dirty?"Có thay đổi chưa lưu":policy.source==="default"?"Chưa lưu bảng bậc riêng cho show":"Bảng bậc đã lưu"}</span><button type="button" className={styles.secondary} disabled={!dirty||saving} onClick={()=>{setDraft(toDraft(policy.tiers));setNotice("");setError("");}}>Hoàn tác</button><button type="button" className={styles.primary} disabled={!valid||!needsSave||saving} onClick={()=>void save()}>{saving?"Đang lưu…":"Lưu cho show này"}</button></div>
   </section>
   <section className={styles.panel} aria-labelledby="commission-example-heading">
    <div className={styles.panelHeading}><div><h3 id="commission-example-heading">Xem thử cách cộng hoa hồng</h3><p>Minh họa một Sale bán vé cùng đơn giá trong show đang chọn, theo các bậc đang chỉnh.</p></div><span className={styles.draftBadge}>Ví dụ minh họa</span></div>
    <div className={styles.exampleFields}><label>Số vé trả tiền<input type="number" min="0" max="10000" step="1" value={exampleTickets} onChange={event=>setExampleTickets(event.target.value)}/></label><div className={styles.fixedPrice}><span>Đơn giá minh họa</span><strong>{money(SAMPLE_TICKET_PRICE)} / vé</strong></div></div>
    {!valid||!exampleValid?<p className={styles.explanation}>Nhập bảng bậc hợp lệ và số vé từ 0 đến 10.000 để xem ví dụ.</p>:<><div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Ví dụ cộng hoa hồng từng bậc"><table className={styles.exampleTable}><thead><tr><th scope="col">Khoảng vé</th><th scope="col">Số vé</th><th scope="col">Doanh thu bậc</th><th scope="col">Tỷ lệ</th><th scope="col">Hoa hồng bậc</th></tr></thead><tbody>{sampleBands.map(band=><tr key={band.maxTickets} className={band.tickets===0?styles.unusedBand:undefined}><th scope="row">{band.fromTicket}–{band.maxTickets}</th><td>{numberFormat.format(band.tickets)}</td><td>{money(band.revenue)}</td><td>{numberFormat.format(band.rate)}%</td><td>{money(band.commission)}</td></tr>)}</tbody></table></div><div className={styles.exampleTotal}><span>{pendingTickets?"Hoa hồng phần trong ngưỡng":"Tổng hoa hồng minh họa"}<strong>{money(sampleCommission)}</strong></span><p>Doanh thu minh họa: {money(sampleRevenue)}{!pendingTickets&&sampleRevenue>0?<> · Tỷ lệ bình quân: {numberFormat.format(Math.round(sampleCommission/sampleRevenue*10000)/100)}%</>:null}</p></div>{pendingTickets?<p className={styles.warning}>{numberFormat.format(pendingTickets)} vé vượt ngưỡng cuối ({money(pendingTickets*ticketPrice)}) đang chờ đối soát hoa hồng và chưa được cộng vào số tiền trên.</p>:null}<p className={styles.explanation}>Ví dụ cộng tiền hoa hồng của từng bậc. Báo cáo thực tế dùng khoản thanh toán và thứ tự vé của từng đơn; làm tròn tổng hoa hồng mỗi đơn đến đồng rồi phân bổ vào các bậc.</p></>}
   </section>
   {policy.updatedAt?<p className={styles.updated}>Cập nhật gần nhất: {new Date(policy.updatedAt).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"})}{policy.updatedBy?" · "+policy.updatedBy:""}</p>:null}
  </>:null}
 </section>;
}

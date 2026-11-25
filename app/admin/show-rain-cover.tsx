"use client";
import {useEffect,useState} from "react";
type Config={date:string;venue:string;confirmed:boolean};
export default function ShowRainCover({show}:{show:string}){
  const [value,setValue]=useState<Config|null>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    fetch("/api/admin/shows/rain-cover?show="+encodeURIComponent(show),{cache:"no-store",signal:controller.signal})
      .then(async r=>{if(!r.ok)throw Error();return r.json() as Promise<Config>})
      .then(setValue).catch(()=>{if(!controller.signal.aborted)setNotice("Chưa tải được xác nhận che mưa.");});
    return ()=>controller.abort();
  },[show]);
  async function save(){
    if(!value||busy)return;
    setBusy(true);setNotice("");
    try{
      const confirmed=!value.confirmed;
      const response=await fetch("/api/admin/shows/rain-cover",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({show,...value,confirmed})});
      if(!response.ok){const error=await response.json();throw Error(error.error);}
      setValue({...value,confirmed});setNotice("Đã lưu.");
    }catch(e){setNotice(e instanceof Error?e.message:"Chưa lưu được xác nhận.");}
    finally{setBusy(false);}
  }
  return <fieldset style={{margin:"16px 0",padding:14}}><legend>Che mưa cho đêm diễn</legend>
    {value&&<><p>{({ccc:"CCC Sa Pa",laocai:"Lào Cai",moana:"Moana Sa Pa"} as Record<string,string>)[value.venue]} · {value.date.split("-").reverse().join("/")}. {value.confirmed?"Ban tổ chức đã xác nhận có rạp và căng tăng che mưa.":"Chưa có xác nhận. Khi dự báo có mưa, Messenger sẽ nhắc khách chuẩn bị cho đường đi."}</p>
    <button type="button" onClick={()=>void save()} disabled={busy}>{value.confirmed?"Rút xác nhận che mưa":"Xác nhận có rạp và căng tăng che mưa"}</button></>}
    <span role="status">{notice}</span></fieldset>;
}

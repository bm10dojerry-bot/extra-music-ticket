import {artistPhotoNotice} from "./show-family-policy";
type ForecastPoint = {time:string;data?:{instant?:{details?:{air_temperature?:number}};next_1_hours?:{details?:{precipitation_amount?:number}}}};
export type Reminder = {chat_id:string;recipient:string;show_id:string;title:string;artist:string;show_date:string;show_time:string;venue:string;canopy:boolean;kind:"paid"|"pending"|"interest"};
// Coordinates for locality-level forecasts around the venue, with the locality named in the reply.
const areas:Record<string,{area:string;lat:number;lon:number}>={
  ccc:{area:"Sa Pa",lat:22.335,lon:103.842},moana:{area:"Sa Pa",lat:22.328,lon:103.846},
  laocai:{area:"Cam Đường, Lào Cai",lat:22.4053,lon:104.0241}
};
export function forecastAtShow(points:ForecastPoint[],date:string,time:string) {
  const start=Date.parse(date+"T"+time.slice(0,5)+":00+07:00");
  const near=points.filter(p=>Math.abs(Date.parse(p.time)-start)<=60*60*1000 && new Date(Date.parse(p.time)+7*3600000).toISOString().slice(0,10)===date);
  const temperatures=near.map(p=>p.data?.instant?.details?.air_temperature).filter((v):v is number=>typeof v==="number"&&Number.isFinite(v));
  if(!temperatures.length)return null;
  return {low:Math.min(...temperatures),rain:near.some(p=>(p.data?.next_1_hours?.details?.precipitation_amount??0)>0)};
}
export async function showForecast(row:Reminder) {
  const area=areas[row.venue]; if(!area)return null;
  try{
    const response=await fetch("https://api.met.no/weatherapi/locationforecast/2.0/compact?lat="+area.lat+"&lon="+area.lon,{headers:{"User-Agent":"EXTRAMusic/2.1 (https://iextra.net/lien-he)"},next:{revalidate:1800},signal:AbortSignal.timeout(4500)});
    if(!response.ok)return null;
    const forecast=await response.json();
    if(!Array.isArray(forecast?.properties?.timeseries))return null;
    return forecastAtShow(forecast.properties.timeseries,row.show_date,row.show_time);
  }catch{return null;}
}
export function dayBeforeText(row:Reminder,forecast:ReturnType<typeof forecastAtShow>) {
  const name=[row.artist,row.title].filter((x,i,a)=>x&&a.indexOf(x)===i).join(" · ");
  const opening="Ngày mai ("+row.show_date.split("-").reverse().join("/")+") là đêm nhạc "+name+". ";
  if(row.kind==="interest")return opening+"Mình có muốn đặt vé để đến nghe nhạc và giao lưu cùng nghệ sĩ không ạ?";
  if(row.kind==="pending")return opening+"Em vừa kiểm tra, đơn giữ ghế của mình vẫn đang chờ xác nhận thanh toán. Mình có cần em hỗ trợ kiểm tra giao dịch không ạ?";
  const area=areas[row.venue]?.area;
  let weather="Mình xem lại dự báo thời tiết trước khi đến nhé.";
  if(forecast && area){
    weather="Theo dự báo MET Norway cho khu vực "+area+", nhiệt độ quanh giờ diễn khoảng "+Math.round(forecast.low)+"°C.";
    if(forecast.low<18)weather+=" Trời có thể lạnh, mình mang thêm áo ấm nhé.";
    if(forecast.rain)weather+=row.canopy?" Dự báo có mưa. Ban tổ chức đã xác nhận có rạp và căng tăng che mưa, mình yên tâm nhé.":" Dự báo có mưa, mình chuẩn bị áo mưa cho đường đi nhé.";
    weather+=" Mình xem lại dự báo trước khi đi nhé.";
  }
  return opening+weather+" "+artistPhotoNotice+" Hẹn gặp mình tại đêm nhạc!";
}

import "server-only";
import {norm} from "./ai-sales-timeout-policy";

export type MapVenue={id:string;name:string;address:string;city:string};
const geo=/\b(?:khach san|hotel|homestay|resort|nha nghi|nha tho|quang truong|cho dem|ben xe|ga tau|ga cap treo|sun plaza|fansipan|trung tam|ban cat cat|dia danh|cach bao xa|bao nhieu km|khoang cach|di bao lau|may phut|gan cho nao|gan diem nao|gan dau|xa khong)\b/;
export function wantsMapDistance(q:string){const s=norm(q);return geo.test(s)&&(/\b(?:gan|xa|cach|km|phut|duong|di|o dau|quanh|lan can)\b/.test(s)||/\b(?:khach san|hotel|homestay|resort|nha nghi)\b/.test(s))&&!/\b(?:ghe|cho ngoi|hang ghe)\b/.test(s);}
const modeOf=(q:string)=>/\bdi bo\b/.test(norm(q))?"WALK":/\b(?:xe may|xe om)\b/.test(norm(q))?"TWO_WHEELER":"DRIVE";
type Mode=ReturnType<typeof modeOf>;
export function extractOrigin(q:string):string|undefined{
  // Only send a short public place name; never send the conversation or contact details.
  const match=q.match(/(?:khách sạn|khach san|hotel|homestay|resort|nhà nghỉ|nha nghi|nhà thờ|nha tho|quảng trường|quang truong|chợ đêm|cho dem|bến xe|ben xe|ga tàu|ga tau|ga cáp treo|ga cap treo|sun plaza|fansipan|trung tâm|trung tam|bản cát cát|ban cat cat)[\p{L}\p{M}\p{N} .'-]{0,85}/iu);
  if(!match)return;
  const name=match[0].split(/(?:\s+(?:có gần|co gan|gần|gan|cách|cach|xa không|xa khong|đến|den|tới|toi|đi|di|không|khong|ko|bao nhiêu|bao nhieu|ạ|nha|nhé|nhe|em|ở đâu|o dau|thì|thi)(?:\s|$))/iu)[0].trim();
  if(!name||name.length>90||/\d{5,}|@|https?:|www\./i.test(name))return;
  if(/^(?:khach san|hotel|homestay|resort|nha nghi)$/.test(norm(name)))return;
  return name;
}
export function directionUrl(v:MapVenue,origin?:string,mode?:Mode,originId?:string,destId?:string){
  const p=new URLSearchParams({api:"1",destination:venueDestination(v)});
  if(origin)p.set("origin",origin);
  if(originId)p.set("origin_place_id",originId);
  const verifiedId=destId||verifiedVenuePlaces[v.id];
  if(verifiedId)p.set("destination_place_id",verifiedId);
  if(mode)p.set("travelmode",mode==="WALK"?"walking":mode==="TWO_WHEELER"?"two-wheeler":"driving");
  return "https://www.google.com/maps/dir/?"+p.toString();
}
type Place={id:string;displayName?:{text?:string};formattedAddress?:string};
const goodId=(id:unknown):id is string=>typeof id==="string"&&/^[A-Za-z0-9_-]{8,300}$/.test(id);
const clean=(s:unknown)=>typeof s==="string"?s.replace(/[\u0000-\u001f\u007f]/g," ").replace(/https?:\/\/\S+/g,"").trim().slice(0,180):"";
// Owner-provided compound Plus Code; do not shorten it to just 68P.
const laoCaiPlusCode="FXGV+68P, Phú Thịnh, Cam Đường, Lào Cai, Việt Nam";
// Both independent address queries resolved to this same Google Maps listing.
const verifiedVenuePlaces:Record<string,string>={ccc:"ChIJ1dIHLQBBzTYRPivq9rlFZsI",moana:"ChIJOUsUjU9BzTYR2iiyXdPUg-g"};
function venueDestination(v:MapVenue){return v.id==="laocai"?laoCaiPlusCode:v.id==="ccc"?"Không Gian Văn Hoá - Sa Pa Tinh Hoa Hội Tụ, 8RPR+7CC, Fansipan, Sa Pa, Lào Cai":v.name+", "+v.address;}
async function findPlaces(query:string,key:string):Promise<Place[]>{
 const res=await fetch("https://places.googleapis.com/v1/places:searchText",{method:"POST",headers:{"Content-Type":"application/json","X-Goog-Api-Key":key,"X-Goog-FieldMask":"places.id,places.displayName,places.formattedAddress"},body:JSON.stringify({textQuery:query,languageCode:"vi",regionCode:"VN",pageSize:5}),cache:"no-store",signal:AbortSignal.timeout(2500)});
 if(!res.ok)throw Error("Places lookup unavailable");
 return ((await res.json()) as {places?:Place[]}).places??[];
}
const isSaPa=(s:string)=>/\b(?:sa pa|sapa)\b/.test(s);
const isStoneChurch=(s:string)=>/^(?:nha tho da|nha tho duc me man coi|nha tho giao xu)(?: (?:sa pa|sapa))?$/.test(s);
function originPlaceMatches(origin:string,city:string,p:Place){
 if(!goodId(p.id))return false;
 const name=norm(clean(p.displayName?.text)),addr=norm(clean(p.formattedAddress));
 const local=isSaPa(norm(city))?isSaPa(addr):addr.includes(norm(city));
 if(!local)return false;
 const requested=norm(origin);
 if(isSaPa(norm(city))&&isStoneChurch(requested)){
   return /\b(?:nha tho da|nha tho duc me man coi|nha tho giao xu (?:sa pa|sapa)|(?:sa pa|sapa) (?:stone church|church)|stone church|holy rosary church)\b/.test(name);
 }
 const needle=requested.replace(/^(?:khach san|hotel|homestay|resort|nha nghi) /,"");
 return needle.length>=3&&name.includes(needle);
}
function venuePlaceMatches(v:MapVenue,p:Place){
 if(!goodId(p.id))return false;
 const name=norm(clean(p.displayName?.text)),addr=norm(clean(p.formattedAddress));
 if(!isSaPa(addr))return false;
 if(v.id==="moana")return /\bmoana\b/.test(name)&&/\b68\s+violets?\b/.test(addr);
 if(v.id==="ccc")return /\b(?:khong gian van hoa|ccc|cong vien van hoa|cultural (?:space|park|center|centre)|tinh hoa hoi tu)\b/.test(name)&&/\b0*2\s+(?:phan xi pang|phan si pang|fansipan)\b/.test(addr);
 return false;
}
async function resolveVenue(v:MapVenue,key:string,configuredId:string|undefined):Promise<{placeId:string}|{address:string}|undefined>{
 if(goodId(configuredId))return {placeId:configuredId};
 if(v.id==="laocai")return {address:laoCaiPlusCode};
 if(v.id!=="moana"&&v.id!=="ccc")return;
 const matches=(await findPlaces(venueDestination(v)+", Việt Nam",key)).filter(p=>venuePlaceMatches(v,p));
 if(matches.length===1)return {placeId:matches[0].id};
 // An absent or ambiguous venue must never silently resolve to a different pin.
}
export async function mapDistanceReply(q:string,v:MapVenue):Promise<string>{
  const mode=modeOf(q),origin=extractOrigin(q);
  if(!origin)return "Mình cho em tên cụ thể khách sạn hoặc địa danh và khu vực đang ở để em kiểm tra đường đến "+v.name+" ạ.";
  const overrideId=process.env["EXTRA_MAPS_PLACE_"+v.id.toUpperCase()];
  const configuredId=goodId(overrideId)?overrideId:verifiedVenuePlaces[v.id];
  const key=process.env.GOOGLE_MAPS_API_KEY;
  const originQuery=isSaPa(norm(v.city))&&isStoneChurch(norm(origin))?"Nhà thờ Đá (Nhà thờ Đức Mẹ Mân Côi), Phạm Xuân Huân, Sa Pa, Lào Cai, Việt Nam":origin+", "+v.city+", Việt Nam";
  const fallback="Em chưa xác minh được khoảng cách từ "+origin+" đến "+v.name+" ("+venueDestination(v)+"), nên chưa thể báo số km hoặc phút chính xác. Mình có thể mở Google Maps và chọn đúng điểm xuất phát tại đây ạ:\n"+directionUrl(v,undefined,mode,undefined,goodId(configuredId)?configuredId:undefined);
  if(!key)return fallback;
  try{
    const [places,destination]=await Promise.all([findPlaces(originQuery,key),resolveVenue(v,key,configuredId)]);
    if(!destination)return fallback;
    const destId="placeId" in destination?destination.placeId:undefined;
    const matches=places.filter(p=>originPlaceMatches(origin,v.city,p));
    if(matches.length!==1)return "Em chưa xác định được đúng "+origin+". Mình gửi thêm địa chỉ hoặc khu vực của địa điểm đó giúp em nhé, để em không chỉ nhầm đường ạ.";
    const place=matches[0];
    const res=await fetch("https://routes.googleapis.com/directions/v2:computeRoutes",{method:"POST",headers:{"Content-Type":"application/json","X-Goog-Api-Key":key,"X-Goog-FieldMask":"routes.distanceMeters,routes.duration"},body:JSON.stringify({origin:{placeId:place.id},destination,travelMode:mode,languageCode:"vi",units:"METRIC"}),cache:"no-store",signal:AbortSignal.timeout(2500)});
    if(!res.ok)return fallback;
    const payload=await res.json() as {routes?:{distanceMeters?:number;duration?:string}[]};
    const route=payload.routes?.[0];
    const m=route?.distanceMeters,sec=route?.duration&&/^\d+(?:\.\d+)?s$/.test(route.duration)?Number(route.duration.slice(0,-1)):NaN;
    if(typeof m!=="number"||!Number.isFinite(m)||m<0||!Number.isFinite(sec)||sec<0)return fallback;
    const dist=m<1000?Math.round(m)+" m":(m/1000).toLocaleString("vi-VN",{maximumFractionDigits:1})+" km";
    const label=mode==="WALK"?"đi bộ":mode==="TWO_WHEELER"?"đi xe máy":"đi ô tô";
    return "Dạ, từ "+clean(place.displayName?.text)+" ("+clean(place.formattedAddress)+") đến "+v.name+" khoảng "+dist+", "+label+" khoảng "+Math.max(1,Math.round(sec/60))+" phút theo Google Maps. Thời gian thực tế có thể thay đổi ạ.\n"+directionUrl(v,clean(place.displayName?.text)+", "+clean(place.formattedAddress),mode,place.id,destId);
  }catch{return fallback;}
}

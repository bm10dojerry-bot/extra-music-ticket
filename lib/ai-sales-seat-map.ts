type MapVenue="ccc"|"laocai";
type Show={id:string;artist:string;date:string;venueId:string;url:string};
type Message={sender:string;body:string;staff_name?:string|null};
type Choice={venue:MapVenue;show?:Show};
export const SEAT_MAP_URL=(venue:MapVenue)=>"https://iextra.net/api/public/seat-map/"+venue;
const norm=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[đĐ]/g,"d").toLowerCase().replace(/[^a-z0-9 ]+/g," ").trim().replace(/\s+/g," ");
const has=(s:string,t:string)=>(" "+s+" ").includes(" "+t+" ");
export function isSeatMapRequest(body:string){
 const s=norm(body);
 if(/khong can (?:anh |hinh |xem )?so do|dung gui|khong gui|khong muon xem|khong phai so do|so do chuyen khoan/.test(s))return false;
 return /(?:^| )(?:so do ghe|so do cho ngoi|so do san khau|so do|map ghe|seat map|mat bang ghe|anh ghe|hinh ghe)(?: |$)/.test(s);
}
export function wantsSeatAvailability(body:string){
 return /(?:^| )(?:ghe trong|cho trong|ghe nao trong|con ghe|con cho|con ve|dat ve|dat ghe|mua ve|link|duong dan)(?: |$)/.test(norm(body));
}
function find(text:string,shows:readonly Show[]):Choice|null|"ambiguous"{
 const s=norm(text);
 const names=shows.filter(x=>{
  const variants=[x.id,x.artist,...x.artist.split(/[+&]/)].map(norm).filter(t=>t.length>=5);
  const [y,m,d]=x.date.split("-");
  const escapedDate=d&&m?new RegExp("(^|\\D)0?"+Number(d)+"\\s*[/.-]\\s*0?"+Number(m)+"(?:\\s*[/.-]\\s*"+y+")?(\\D|$)"):null;
  return variants.some(t=>has(s,t))||Boolean(escapedDate?.test(text));
 });
 const ccc=has(s,"ccc")||has(s,"khong gian van hoa");
 const lao=has(s,"lao cai")&&!has(s,"sa pa")&&!has(s,"sapa");
 if(ccc&&lao)return "ambiguous";
 const explicit=ccc?"ccc":lao?"laocai":null;
 if(names.length){
  const venues=[...new Set(names.map(x=>x.venueId))];
  if(venues.length!==1||!["ccc","laocai"].includes(venues[0])||(explicit&&explicit!==venues[0]))return "ambiguous";
  return {venue:venues[0] as MapVenue,...(names.length===1?{show:names[0]}:{})};
 }
 if(explicit)return {venue:explicit};
 if(has(s,"moana"))return "ambiguous";
 return null;
}
export function selectSeatMap(latest:string,messages:readonly Message[],shows:readonly Show[],context:unknown,knownShowId?:string|null):Choice|null{
 const available=shows.filter(s=>/^[a-zA-Z0-9_-]{1,100}$/.test(s.id)&&s.url==="https://iextra.net/show/"+encodeURIComponent(s.id));
 const now=find(latest,available);
 if(now==="ambiguous")return null;
 if(now?.show)return now;
 // A newly specified venue must take priority, and may be enriched by compatible context only.
 const recent=[...messages].reverse().filter(m=>m.sender==="customer").slice(0,12);
 const previous=[...recent.filter(m=>m.body!==latest),...[...messages].reverse().filter(m=>m.sender==="staff"&&m.staff_name==="EXTRA AI").slice(0,6)];
 for(const m of previous){
  const found=find(m.body,available);
  if(found==="ambiguous")return now||null;
  if(found){
   if(now&&found.venue!==now.venue)return now;
   return now&&found.show?{venue:now.venue,show:found.show}:now||found;
  }
 }
 const owned=available.find(s=>s.id===knownShowId);
 if(owned&&["ccc","laocai"].includes(owned.venueId)&&(!now||now.venue===owned.venueId))return {venue:owned.venueId as MapVenue,show:owned};
 if(now)return now;
 const metadata=find(typeof context==="string"?context:JSON.stringify(context??{}),available);
 return metadata==="ambiguous"?null:metadata;
}
export function seatMapVenueName(v:MapVenue){return v==="ccc"?"CCC Sa Pa":"sân khấu +1 Extra Lào Cai";}
export function seatMapCaption(choice:Choice,availability:boolean){
 const intro="Dạ, đây là sơ đồ bố trí ghế "+seatMapVenueName(choice.venue)+" ạ. Ảnh thể hiện các hạng ghế, không thể hiện tình trạng ghế còn trống.";
 if(!availability)return intro;
 return intro+(choice.show?" Mình xem ghế còn trống và chọn vị trí tại "+choice.show.url+" nhé.":" Mình đang quan tâm show ca sĩ nào để em gửi đúng trang xem ghế trống ạ?");
}

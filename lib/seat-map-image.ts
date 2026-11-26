import {seatsFor,zoneColors,type Seat} from "./venues";
type MapVenue="ccc"|"laocai";
type MapSnapshot={seats:Seat[];taken:ReadonlySet<string>;title:string;checkedAt:string;showId?:string;tierLabels?:Record<string,string>};
type Point={x:number;y:number};
type Cell=Point&{id:string;row:string;w:number;h:number};
export type MapMarks={venue:MapVenue;reference:string;points:Point[]};
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
// Original, small monoline vector alphabet. No OS font or remote font file is needed.
// Base glyphs are 6 x 10 units. Vietnamese marks are composed from Unicode NFD.
const glyphs:Record<string,string>={
 A:"M0 10L3 0 6 10M1.2 6H4.8",B:"M0 10V0H3.7Q6 0 6 2.5T3.7 5H0M3.7 5Q6 5 6 7.5T3.7 10H0",C:"M6 1Q0 -2 0 5T6 9",D:"M0 10V0H2Q6 0 6 5T2 10H0",E:"M6 0H0V10H6M0 5H5",F:"M6 0H0V10M0 5H5",G:"M6 1Q0 -2 0 5T6 9V5H3",H:"M0 0V10M6 0V10M0 5H6",I:"M1 0H5M3 0V10M1 10H5",J:"M1 0H6V7Q6 10 3 10T0 7",K:"M0 0V10M6 0L0 6M2 4L6 10",L:"M0 0V10H6",M:"M0 10V0L3 5 6 0V10",N:"M0 10V0L6 10V0",O:"M3 0Q6 0 6 5T3 10 0 5 3 0",P:"M0 10V0H3.5Q6 0 6 2.5T3.5 5H0",Q:"M3 0Q6 0 6 5T3 10 0 5 3 0M3.5 7L6.5 10.5",R:"M0 10V0H3.5Q6 0 6 2.5T3.5 5H0M3 5L6 10",S:"M6 1Q0 -2 0 2.5Q0 4.5 3 5T6 7.5Q6 12 0 9",T:"M0 0H6M3 0V10",U:"M0 0V7Q0 10 3 10T6 7V0",V:"M0 0L3 10 6 0",W:"M0 0L1.5 10 3 5 4.5 10 6 0",X:"M0 0L6 10M6 0L0 10",Y:"M0 0L3 5 6 0M3 5V10",Z:"M0 0H6L0 10H6",
 "0":"M3 0Q6 0 6 5T3 10 0 5 3 0M1 8L5 2","1":"M1 2L3 0V10M1 10H5","2":"M0 2Q0 0 3 0T6 2.5Q6 4 0 10H6","3":"M0 1Q6 -2 6 2.5Q6 5 2 5Q6 5 6 7.5Q6 12 0 9","4":"M5 10V0L0 7H6","5":"M6 0H0V5Q6 3 6 7.5Q6 12 0 9","6":"M6 1Q0 -2 0 6Q0 10 3 10T6 7 3 4 0 6","7":"M0 0H6L2 10","8":"M3 5Q0 5 0 2.5T3 0 6 2.5 3 5 0 7.5 3 10 6 7.5 3 5","9":"M0 9Q6 12 6 4Q6 0 3 0T0 3 3 6 6 4",
 "+":"M0 5H6M3 2V8","-":"M0 5H6","/":"M0 10L6 0",":":"M3 3h.1M3 7h.1",".":"M3 10h.1",",":"M3 9L2 11","·":"M3 5h.1","(":"M4 0Q0 5 4 10",")":"M2 0Q6 5 2 10","&":"M6 10L1 3Q-1 0 3 0T4 4L1 6Q-1 10 3 10T6 6","!":"M3 0V7M3 10h.1","?":"M0 2Q0 0 3 0T6 2.5Q6 4 3 5V7M3 10h.1","_":"M0 10H6","=":"M0 3H6M0 7H6"
};
function vectorLabel(value:string,x:number,y:number,size:number,color="#162032",align:"start"|"middle"|"end"="start",maxWidth=Infinity,weight=1){
 const chars=Array.from(value.toLocaleUpperCase("vi-VN").normalize("NFC"));
 const advance=7.7,scale=Math.min(size/10,maxWidth/Math.max(1,chars.length*advance));
 const offset=align==="middle"?-chars.length*advance/2:align==="end"?-chars.length*advance:0;
 const paths=chars.map((ch,i)=>{
  if(ch===" ")return "";
  const parts=Array.from(ch.normalize("NFD")),base=parts[0]==="Đ"?"D":parts[0];
  let d=glyphs[base]??glyphs["?"];
  if(parts[0]==="Đ")d+="M-1 5H4";
  const upper=parts.some(c=>["\u0302","\u0306"].includes(c));
  for(const mark of parts.slice(1)){
   const top=upper?-4.8:-2.2;
   if(mark==="\u0302")d+="M.8 -1.4L3 -3.4 5.2 -1.4";
   else if(mark==="\u0306")d+="M.8 -3Q3 -.6 5.2 -3";
   else if(mark==="\u031b")d+="M5.8 1Q8 1 7.5 -1.5";
   else if(mark==="\u0301")d+="M2 "+top+"L4.8 "+(top-1.8);
   else if(mark==="\u0300")d+="M1.2 "+(top-1.8)+"L4 "+top;
   else if(mark==="\u0309")d+="M1.8 "+(top-1.2)+"Q4.6 "+(top-3.5)+" 4.3 "+(top-1.3)+"L3 "+top;
   else if(mark==="\u0303")d+="M.6 "+top+"Q2 "+(top-2)+" 3.5 "+top+"T6 "+top;
   else if(mark==="\u0323")d+="M3 12h.1";
  }
  return '<path transform="translate('+(i*advance)+ ' 0)" d="'+d+'"/>';
 }).join("");
 return '<g aria-label="'+esc(value)+'" transform="translate('+x+' '+y+') scale('+scale+')" fill="none" stroke="'+color+'" stroke-width="'+weight+'" stroke-linecap="round" stroke-linejoin="round"><title>'+esc(value)+'</title><g transform="translate('+offset+' 0)">'+paths+'</g></g>';
}
export function seatMapGeometry(venue:MapVenue,seats:readonly Seat[],showId=""){
 const W=venue==="ccc"?2400:3600,H=venue==="ccc"?3600:2400;
 const x=(v:number)=>venue==="ccc"?250+(v-10)*24.5:200+(v-7)*36.7;
 const y=(v:number)=>venue==="ccc"?435+(v-6)*33.0:530+(v-16)*22.5;
 const rows=[...new Set(seats.map(s=>s.row))].sort();
 const maxRow=Math.max(2,...rows.map(row=>seats.filter(s=>s.row===row).length));
 const w=venue==="ccc"?112:Math.min(66,Math.max(26,Math.floor(2780/maxRow)-4));
 const h=venue==="ccc"?Math.min(50,Math.max(22,Math.floor(2860/(maxRow-1))-7)):76;
 const cells:Cell[]=seats.map(s=>({id:s.id,row:s.row,x:x(s.x),y:y(s.y),w,h}));
 const anchors={left:80,right:W-80,top:300,bottom:H-210};
 // A deterministic layout identifier binds each show and every exact seat coordinate.
 let hash=2166136261;
 const key="EXTRA-MAP-244|"+venue+"|"+showId+"|"+cells.map(c=>[c.id,c.x.toFixed(2),c.y.toFixed(2),c.w,c.h].join(":")).join("|");
 for(const ch of key){hash=Math.imul(hash^ch.charCodeAt(0),16777619)>>>0;}
 const reference=hash.toString(16).toUpperCase().padStart(8,"0");
 return {W,H,rows,cells,anchors,reference,w,h};
}
const rect=(x:number,y:number,w:number,h:number,fill:string,extra="")=>'<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+fill+'" '+extra+'/>';
export function renderSeatMapSvg(venue:MapVenue,counts:Record<string,number>={},snapshot?:MapSnapshot){
 const seats=snapshot?.seats??seatsFor(venue,counts);
 const g=seatMapGeometry(venue,seats,snapshot?.showId??"");
 const {W,H,anchors,reference,rows,cells,w,h}=g;
 const name=venue==="ccc"?"CCC SA PA":"+1 EXTRA LÀO CAI";
 const size=Math.min(35,h*.62,w/2.45);
 const mapColors={...zoneColors,A:"#f6b6be"}; // Pale red avoids confusing pen strokes with the seat fill.
 const labels=cells.map((c,i)=>{
  const s=seats[i],blocked=snapshot?.taken.has(s.id),fill=blocked?"#737984":mapColors[s.zone]||"#cbd5e1",fg=blocked?"#ffffff":"#162032";
  return '<g data-seat="'+esc(s.id)+'">'+rect(c.x-w/2,c.y-h/2,w,h,fill,'rx="5"')+vectorLabel(s.id,c.x,c.y-size/2,size,fg,"middle",w-8,1.25)+'</g>';
 }).join("");
 const rowLabels=rows.map(row=>{
  const cc=cells.filter(c=>c.row===row),a=cc[0],b=cc[cc.length-1];if(!a||!b)return "";
  const tag=(x:number,y:number)=>rect(x-33,y-31,66,62,"#18233b",'rx="9"')+vectorLabel(row,x,y-17,34,"#ffffff","middle",48,1.3);
  return '<g data-row="'+row+'">'+(venue==="ccc"?tag(a.x,a.y-72)+tag(b.x,b.y+72):tag(a.x-78,a.y)+tag(b.x+78,b.y))+'</g>';
 }).join("");
 const stage=venue==="ccc"?rect(2180,650,150,2450,"#171d31",'rx="24"')+
 '<g transform="rotate(90 2255 1875)">'+vectorLabel("SÂN KHẤU",2255,1846,58,"#fff","middle")+'</g>':
 rect(740,395,2120,90,"#171d31",'rx="24"')+vectorLabel("SÂN KHẤU",W/2,418,45,"#fff","middle");
 const markers=[[anchors.left,anchors.top],[anchors.right,anchors.top],[anchors.left,anchors.bottom],[anchors.right,anchors.bottom]].map(([a,b])=>rect(a-18,b-18,36,36,"#ff00ff")).join("");
 const bitWidth=24,bitStart=W/2-16*bitWidth;
 const bits=Array.from({length:32},(_,i)=>rect(bitStart+i*bitWidth,305,bitWidth,20,(parseInt(reference,16)>>> (31-i))&1?"#101010":"#ffffff")).join("");
 const legend=["A","B","C","D",...(snapshot?["X"]:[])].map((z,i,all)=>{
  const step=(W-160)/all.length,x=80+i*step,tag=z==="X"?"KHÔNG KHẢ DỤNG":(snapshot?.tierLabels?.[z]??"HẠNG "+z);
  return rect(x,H-163,48,36,z==="X"?"#737984":mapColors[z],'rx="4"')+vectorLabel(tag,x+60,H-156,27,"#162032","start",step-72);
 }).join("");
 const footer=snapshot?"TRẠNG THÁI LÚC "+snapshot.checkedAt+" · KIỂM TRA LẠI TRƯỚC KHI ĐẶT":"SƠ ĐỒ BỐ TRÍ GHẾ · Chưa thể hiện ghế trống";
 return '<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" data-map-reference="'+reference+'">'+
 rect(0,0,W,H,"#f7f8fb")+rect(0,0,W,250,"#12192b")+
 vectorLabel("+1 EXTRA MUSIC SHOW",80,37,38,"#f8c95d","start",W-160)+vectorLabel(name,80,104,62,"#ffffff","start",W-160)+
 vectorLabel(snapshot?.title??"SƠ ĐỒ BÁN VÉ · MÃ TỪNG GHẾ",80,190,35,"#ffffff","start",W-160)+
 rect(35,270,W-70,H-460,"#ffffff",'rx="20" stroke="#e1e5ee"')+
 markers+bits+vectorLabel("MAP "+reference,W/2,276,24,"#162032","middle")+
 stage+labels+rowLabels+legend+
 vectorLabel(footer,W/2,H-92,25,"#526076","middle",W-120)+
 vectorLabel("CHẤM HOẶC KHOANH GHẾ MUỐN CHỌN",W/2,H-43,24,"#162032","middle",W-120)+
 '</svg>';
}
function components(mask:Uint8Array,width:number,height:number,min:number){
 const out:{x:number;y:number;n:number;w:number;h:number}[]=[];
 const queue=new Int32Array(mask.length);
 for(let i=0;i<mask.length;i++){
  if(!mask[i])continue;
  let head=0,tail=1,sx=0,sy=0,l=width,r=0,t=height,b=0;queue[0]=i;mask[i]=0;
  while(head<tail){const j=queue[head++],x=j%width,y=Math.floor(j/width);sx+=x;sy+=y;l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);
   for(const k of [x>0?j-1:-1,x<width-1?j+1:-1,y>0?j-width:-1,y<height-1?j+width:-1])if(k>=0&&mask[k]){mask[k]=0;queue[tail++]=k;}
  }
  if(tail>=min)out.push({x:sx/tail,y:sy/tail,n:tail,w:r-l+1,h:b-t+1});
 }
 return out;
}
// Independent pixel verification: the reference is decoded from the image itself;
// Colored dots and closed single-seat circles are located relative to printed registration markers.
export function readSeatMapMarks(rgb:Uint8Array,width:number,height:number):MapMarks|null{
 if(width<250||height<250||rgb.length!==width*height*3||width*height>6000000)return null;
 const pink=new Uint8Array(width*height);
 for(let i=0;i<pink.length;i++){const r=rgb[3*i],g=rgb[3*i+1],b=rgb[3*i+2];if(r>145&&b>145&&g<Math.min(r,b)*.62&&Math.abs(r-b)<100)pink[i]=1;}
 const anchors=components(pink,width,height,15).filter(a=>a.w>=4&&a.h>=4&&a.w/a.h>.5&&a.w/a.h<2&&a.n/(a.w*a.h)>.35).sort((a,b)=>b.n-a.n);
 if(anchors.length<4||anchors.length>4&&anchors[4].n>anchors[3].n*.35)return null;
 const a=anchors.slice(0,4).sort((a,b)=>a.y-b.y),[tl,tr]=a.slice(0,2).sort((a,b)=>a.x-b.x),[bl,br]=a.slice(2).sort((a,b)=>a.x-b.x);
 const dx=tr.x-tl.x,dy=bl.y-tl.y;
 if(dx<100||dy<100||Math.abs(tr.y-tl.y)>dy*.012||Math.abs(br.y-bl.y)>dy*.012||Math.abs(bl.x-tl.x)>dx*.012||Math.abs(br.x-tr.x)>dx*.012)return null;
 const venue:MapVenue=dx/dy<1.1?"ccc":"laocai";
 const W=venue==="ccc"?2400:3600,H=venue==="ccc"?3600:2400;
 if(Math.abs((dx/dy)/((W-160)/(H-510))-1)>.05)return null;
 const toPixel=(x:number,y:number)=>({x:tl.x+(x-80)*dx/(W-160),y:tl.y+(y-300)*dy/(H-510)});
 const fromPixel=(x:number,y:number)=>({x:80+(x-tl.x)*(W-160)/dx,y:300+(y-tl.y)*(H-510)/dy});
 let hash=0;
 for(let i=0;i<32;i++){
  const c=toPixel(W/2-16*24+i*24+12,315);let sum=0,n=0;
  for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){const px=Math.round(c.x)+xx,py=Math.round(c.y)+yy;if(px<0||px>=width||py<0||py>=height)return null;const k=(py*width+px)*3;sum+=(rgb[k]+rgb[k+1]+rgb[k+2])/3;n++;}
  const v=sum/n;if(v>90&&v<165)return null;hash=((hash<<1)|(v<=90?1:0))>>>0;
 }
 const ink=new Uint8Array(width*height);
 for(let y=Math.ceil(tl.y);y<=Math.floor(bl.y)&&y<height;y++)for(let x=Math.ceil(tl.x);x<=Math.floor(tr.x)&&x<width;x++){
  if(x<0||y<0)continue;const i=y*width+x,r=rgb[i*3],g=rgb[i*3+1],b=rgb[i*3+2];
  // Distinguish strong annotation colors from the printed pastel seat colors.
  const blue=b>135&&b>r*1.45+25&&b>g*1.25+25;
  const red=r>155&&r-g>120&&r-b>120&&g<35&&b<38;
  const green=g>110&&g>r*1.45+25&&g>b*1.45+25;
  if(blue||red||green)ink[i]=1;
 }
 const marks=components(ink,width,height,4);
 if(marks.length>20||marks.some(m=>m.w>dx*.08||m.h>dy*.08))return null;
 return {venue,reference:hash.toString(16).toUpperCase().padStart(8,"0"),points:marks.map(m=>fromPixel(m.x,m.y))};
}
export function verifySeatMapMarks(marks:MapMarks,venue:MapVenue,seats:readonly Seat[],showId:string):string[]|null{
 if(marks.venue!==venue||!marks.points.length||marks.points.length>20)return null;
 const g=seatMapGeometry(venue,seats,showId);
 if(marks.reference!==g.reference)return null;
 const found:string[]=[];
 for(const p of marks.points){
  const inside=g.cells.filter(c=>Math.abs(p.x-c.x)<=c.w*.42&&Math.abs(p.y-c.y)<=c.h*.42);
  if(inside.length!==1||found.includes(inside[0].id))return null;
  found.push(inside[0].id);
 }
 return found;
}

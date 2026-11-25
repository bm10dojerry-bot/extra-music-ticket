import {seatsFor,zoneColors} from "./venues";
type MapVenue="ccc"|"laocai";
export function renderSeatMapSvg(venue:MapVenue,counts:Record<string,number>={}){
 const seats=seatsFor(venue,counts),name=venue==="ccc"?"CCC SA PA":"+1 EXTRA LAO CAI";
 const width=1440,height=1220;
 const x=(v:number)=>100+v*11.7,y=(v:number)=>230+v*8.8;
 const dots=seats.map(s=>'<circle cx="'+x(s.x).toFixed(2)+'" cy="'+y(s.y).toFixed(2)+'" r="5.4" fill="'+zoneColors[s.zone]+'" stroke="#ffffff" stroke-opacity=".3" stroke-width=".8"/>').join("");
 const rows=[...new Set(seats.map(s=>s.row))];
 const labels=rows.map(row=>{
  const line=seats.filter(s=>s.row===row),a=line[0],b=line[line.length-1];
  if(venue==="ccc")return '<text x="'+x(a.x).toFixed(2)+'" y="'+(y(a.y)-16).toFixed(2)+'" text-anchor="middle" class="row">'+row+'</text>';
  return '<text x="'+(x(a.x)-21).toFixed(2)+'" y="'+(y(a.y)+4).toFixed(2)+'" text-anchor="middle" class="row">'+row+'</text>';
 }).join("");
 const stage=venue==="ccc"?'<rect x="1210" y="390" width="114" height="580" rx="24" fill="#171d31"/><text x="1267" y="680" fill="#fff" font-size="26" text-anchor="middle" transform="rotate(90 1267 680)">SÂN KHẤU</text>':'<rect x="320" y="244" width="800" height="82" rx="20" fill="#171d31"/><text x="720" y="295" fill="#fff" font-size="30" text-anchor="middle">SÂN KHẤU</text>';
 const legend=["A","B","C","D"].map((z,i)=>'<circle cx="'+(200+320*i)+'" cy="1100" r="13" fill="'+zoneColors[z]+'"/><text x="'+(225+320*i)+'" y="1109" font-size="26" fill="#18233b">Hạng '+z+'</text>').join("");
 return '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'"><style>text{font-family:DejaVu Sans,Arial,sans-serif}.row{fill:#36425a;font-size:16px;font-weight:bold}</style><rect width="1440" height="1220" fill="#f7f8fb"/><rect x="0" y="0" width="1440" height="180" fill="#12192b"/><text x="72" y="66" fill="#f8c95d" font-size="26" font-weight="bold">+1 EXTRA MUSIC SHOW</text><text x="72" y="126" fill="#ffffff" font-size="45" font-weight="bold">'+name+'</text><text x="1368" y="122" fill="#ffffff" font-size="27" text-anchor="end">'+seats.length+' ghế</text><rect x="48" y="208" width="1344" height="844" rx="30" fill="#ffffff" stroke="#e1e5ee"/>'+stage+dots+labels+legend+'<text x="720" y="1170" text-anchor="middle" font-size="22" fill="#526076">Sơ đồ bố trí ghế · Không thể hiện tình trạng ghế trống</text></svg>';
}

import {seatsFor,zoneColors,type Seat} from "./venues";
type MapVenue="ccc"|"laocai";
type MapSnapshot={seats:Seat[];taken:ReadonlySet<string>;title:string;checkedAt:string};
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export function renderSeatMapSvg(venue:MapVenue,counts:Record<string,number>={},snapshot?:MapSnapshot){
 const seats=snapshot?.seats??seatsFor(venue,counts),name=venue==="ccc"?"CCC SA PA":"+1 EXTRA LÀO CAI";
 const W=3000,H=2520,x=(v:number)=>150+v*26,y=(v:number)=>270+v*20.3;
 const maxRow=Math.max(...Array.from(new Set(seats.map(s=>s.row)),row=>seats.filter(s=>s.row===row).length));
 const w=venue==="laocai"?Math.min(42,Math.max(20,Math.floor(2020/maxRow)-4)):64;
 const h=venue==="ccc"?Math.min(29,Math.max(15,Math.floor(1750/(maxRow-1))-5)):30;
 const size=venue==="laocai"?Math.min(19,Math.max(10,Math.floor(w/2.4))):Math.min(20,h-6);
 const labels=seats.map(s=>{
  const blocked=snapshot?.taken.has(s.id),fill=blocked?"#737984":zoneColors[s.zone]||"#cbd5e1",fg=blocked||s.zone==="A"?"#fff":"#162032",cx=x(s.x),cy=y(s.y);
  return '<g><rect x="'+(cx-w/2).toFixed(2)+'" y="'+(cy-h/2).toFixed(2)+'" width="'+w+'" height="'+h+'" rx="5" fill="'+fill+'"/><text x="'+cx.toFixed(2)+'" y="'+cy.toFixed(2)+'" dy=".35em" text-anchor="middle" font-weight="700" font-size="'+size+'" fill="'+fg+'">'+esc(s.id)+'</text></g>';
 }).join("");
 const stage=venue==="ccc"?'<rect x="2600" y="480" width="240" height="1350" rx="45" fill="#171d31"/><text x="2720" y="1150" fill="#fff" font-size="58" text-anchor="middle" transform="rotate(90 2720 1150)">SÂN KHẤU</text>':'<rect x="620" y="300" width="1760" height="190" rx="35" fill="#171d31"/><text x="1500" y="418" fill="#fff" font-size="62" text-anchor="middle">SÂN KHẤU</text>';
 const legend=["A","B","C","D",...(snapshot?["X"]:[])].map((z,i)=>'<rect x="'+(200+520*i)+'" y="2290" width="55" height="40" rx="8" fill="'+(z==="X"?"#737984":zoneColors[z])+'"/><text x="'+(275+520*i)+'" y="2322" font-size="39" fill="#18233b">'+(z==="X"?"Không khả dụng":"Hạng "+z)+'</text>').join("");
 const footer=snapshot?"Trạng thái lúc "+snapshot.checkedAt+" · Kiểm tra lại trước khi đặt":"Sơ đồ bố trí ghế · Chưa thể hiện ghế trống";
 return '<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'"><style>text{font-family:DejaVu Sans,Arial,sans-serif}</style><rect width="3000" height="2520" fill="#f7f8fb"/><rect width="3000" height="230" fill="#12192b"/><text x="100" y="70" fill="#f8c95d" font-size="38" font-weight="bold">+1 EXTRA MUSIC SHOW</text><text x="100" y="150" fill="#fff" font-size="68" font-weight="bold">'+esc(name)+'</text><text x="100" y="206" fill="#fff" font-size="36">'+esc(snapshot?.title||"Sơ đồ bán vé · mã từng ghế")+'</text><text x="2880" y="140" fill="#fff" font-size="44" text-anchor="end">'+seats.length+' ghế</text><rect x="60" y="244" width="2880" height="1980" rx="36" fill="#fff" stroke="#e1e5ee"/>'+stage+labels+legend+'<text x="1500" y="2445" text-anchor="middle" font-size="38" fill="#526076">'+esc(footer)+'</text></svg>';
}

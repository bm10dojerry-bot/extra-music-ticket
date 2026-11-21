export type VenueId = "moana" | "ccc" | "laocai";
export type Seat = { id:string; row:string; number:number; x:number; y:number; zone:string };
export const venues = [
  {id:"moana" as const, name:"Moana Sa Pa",city:"Sa Pa",address:"68 Violet, Sa Pa, Lào Cai",capacity:500,description:"385 ghế vòng cung · 115 ghế hàng sau"},
  {id:"ccc" as const,name:"Không gian Văn hóa Sa Pa – CCC",city:"Sa Pa",address:"002 Phan Xi Păng, Sa Pa, Lào Cai",capacity:550,description:"11 hàng × 50 ghế · sân khấu bên phải"},
  {id:"laocai" as const,name:"+1 Extra Music Show Lào Cai",city:"Lào Cai",address:"68P Phú Thịnh, Cam Đường, Lào Cai",capacity:600,description:"15 hàng × 40 ghế · lối đi giữa"}
];
export const zoneColors:Record<string,string>={A:"#ed2839",B:"#b8b7d6",C:"#6bb9bd",D:"#8faf84"};
const zoneFor=(r:number,total:number)=>r<Math.ceil(total*.18)?"A":r<Math.ceil(total*.36)?"B":r<Math.ceil(total*.64)?"C":"D";
export function seatsFor(venue:VenueId,counts:Record<string,number>={}):Seat[]{
 const rowCount=(row:string,base:number)=>Number.isSafeInteger(counts[row])&&counts[row]>=2&&counts[row]<=80?counts[row]:base;
 const out:Seat[]=[];
 if(venue==="laocai"){
   for(let r=0;r<15;r++)for(let n=1;n<=rowCount(String.fromCharCode(65+r),40);n++){const x=n<=20?7+(n-1)*2.05:55+(n-21)*2.05;out.push({id:String.fromCharCode(65+r)+String(n).padStart(2,"0"),row:String.fromCharCode(65+r),number:n,x,y:16+r*4.65,zone:zoneFor(r,15)});}
 } else if(venue==="ccc"){
   for(let r=0;r<11;r++)for(let n=1;n<=rowCount(String.fromCharCode(65+r),50);n++){const row=String.fromCharCode(65+r);const center=Math.abs(n-25.5)/24.5;const x=10+(10-r)*6.9+4.8*center*center;const y=6+(n-1)*1.78;out.push({id:row+String(n).padStart(2,"0"),row,number:n,x,y,zone:zoneFor(r,11)});}
 }else{
   // Moana: 25 / 35 / 45 premium seats (A-C), 7 further arcs of 40,
   // two existing rear rows of 50 (K-L), and a new rear D row of 15 (M).
   // Preserve every existing seat ID that still exists, including sold K/L seats.
   for(let r=0;r<10;r++){
    const row=String.fromCharCode(65+r);const count=rowCount(row,r===0?25:r===1?35:r===2?45:40);
    for(let n=1;n<=count;n++){
     const angle=Math.PI*.12+(n-1)/(count-1)*(Math.PI*.76);
     const radius=12+r*3.05+Math.min(r,2)*1.45;
     const x=50+radius*Math.cos(angle);
     const y=8+radius*Math.sin(angle)*1.42;
     out.push({id:String.fromCharCode(65+r)+String(n).padStart(2,"0"),row:String.fromCharCode(65+r),number:n,x,y,zone:zoneFor(r,12)});
    }
   }
   for(let r=0;r<2;r++)for(let n=1;n<=rowCount(String.fromCharCode(75+r),50);n++){
    const row=String.fromCharCode(75+r);
    out.push({id:row+String(n).padStart(2,"0"),row,number:n,x:5+(n-1)*1.83,y:79+r*5.5,zone:"D"});
   }
   for(let n=1;n<=rowCount("M",15);n++){
    out.push({id:"M"+String(n).padStart(2,"0"),row:"M",number:n,x:28+(n-1)*3.15,y:90.5,zone:"D"});
   }
 }
 return out;
}

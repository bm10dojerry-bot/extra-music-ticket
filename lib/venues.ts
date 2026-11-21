export type VenueId = "moana" | "ccc" | "laocai";
export type Seat = { id:string; row:string; number:number; x:number; y:number; zone:string };
export const venues = [
  {id:"moana" as const, name:"Moana Sa Pa",city:"Sa Pa",address:"68 Violet, Sa Pa, Lào Cai",capacity:500,description:"400 ghế bán nguyệt · 100 ghế hàng sau"},
  {id:"ccc" as const,name:"Không gian Văn hóa Sa Pa – CCC",city:"Sa Pa",address:"002 Phan Xi Păng, Sa Pa, Lào Cai",capacity:550,description:"11 hàng × 50 ghế · sân khấu bên phải"},
  {id:"laocai" as const,name:"+1 Extra Music Show Lào Cai",city:"Lào Cai",address:"68P Phú Thịnh, Cam Đường, Lào Cai",capacity:600,description:"15 hàng × 40 ghế · lối đi giữa"}
];
export const zoneColors:Record<string,string>={A:"#ed2839",B:"#b8b7d6",C:"#6bb9bd",D:"#8faf84"};
const zoneFor=(r:number,total:number)=>r<Math.ceil(total*.18)?"A":r<Math.ceil(total*.36)?"B":r<Math.ceil(total*.64)?"C":"D";
export function seatsFor(venue:VenueId):Seat[]{
 const out:Seat[]=[];
 if(venue==="laocai"){
   for(let r=0;r<15;r++)for(let n=1;n<=40;n++){const x=n<=20?7+(n-1)*2.05:55+(n-21)*2.05;out.push({id:String.fromCharCode(65+r)+String(n).padStart(2,"0"),row:String.fromCharCode(65+r),number:n,x,y:16+r*4.65,zone:zoneFor(r,15)});}
 } else if(venue==="ccc"){
   for(let r=0;r<11;r++)for(let n=1;n<=50;n++){const row=String.fromCharCode(65+r);const center=Math.abs(n-25.5)/24.5;const x=10+r*6.9-4.8*center*center;const y=6+(n-1)*1.78;out.push({id:row+String(n).padStart(2,"0"),row,number:n,x,y,zone:zoneFor(r,11)});}
 }else{
   // Moana (Đình Dũng): stage is on the RIGHT. The ends of each curved row face TOWARD the stage.
   // Preserve all 500 seat IDs, zone assignments, and capacity; change coordinates only.
   for(let r=0;r<10;r++)for(let n=1;n<=40;n++){
    const row=String.fromCharCode(65+r);
    const edge=Math.abs(n-20.5)/19.5;
    const x=76-r*5.65+5.5*edge*edge;
    const y=8+(n-1)*2.12;
    out.push({id:row+String(n).padStart(2,"0"),row,number:n,x,y,zone:zoneFor(r,12)});
   }
   // Two straight rear rows (100 seats) are farthest from the stage.
   for(let r=0;r<2;r++)for(let n=1;n<=50;n++){
    const row=String.fromCharCode(75+r);
    out.push({id:row+String(n).padStart(2,"0"),row,number:n,x:13-r*5,y:5+(n-1)*1.8,zone:"D"});
   }
 }
 return out;
}

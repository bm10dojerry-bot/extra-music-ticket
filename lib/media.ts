export const mediaSlots=[{id:"venue-moana",name:"Sân khấu Moana Sa Pa"},{id:"venue-ccc",name:"Sân khấu CCC Sa Pa"},{id:"venue-laocai",name:"Sân khấu Extra Lào Cai"}] as const;
export type MediaSlot=typeof mediaSlots[number]["id"];
export function validSlot(value:string):value is MediaSlot{return mediaSlots.some(x=>x.id===value)}
export function mediaPublicUrl(path:string){return process.env.SUPABASE_URL+"/storage/v1/object/public/extra-media/"+path.split("/").map(encodeURIComponent).join("/")}

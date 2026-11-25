import "server-only";
import {staffDb} from "./staff-auth";

const EXTRA_02_ACCOUNT="1915621506464312";
const EXTRA_02_PIXEL="2335529170354111";

/** Additional public measurement ID for the selected automation account.
 * Keep the show's existing pixel intact; unavailable marketing data never
 * prevents the public show page from loading. */
export async function marketingPixelForShow(showId:string):Promise<string>{
  if(!/^[a-z0-9-]{3,100}$/.test(showId))return "";
  try{
    const settings=await staffDb("extra_marketing_settings?id=eq.true&select=enabled,account_id&limit=1") as unknown;
    if(!Array.isArray(settings)||settings[0]?.enabled!==true||settings[0]?.account_id!==EXTRA_02_ACCOUNT)return "";
    const shows=await staffDb("rpc/extra_marketing_nearest_shows",{method:"POST",body:"{}"}) as unknown;
    if(!Array.isArray(shows))return "";
    return shows.slice(0,2).some(show=>show&&typeof show==="object"&&show.id===showId&&show.status==="announced"&&show.marketing_pixel_id===EXTRA_02_PIXEL&&typeof show.starts_at==="string"&&Date.parse(show.starts_at)>Date.now())?EXTRA_02_PIXEL:"";
  }catch{return "";}
}

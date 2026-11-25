import "server-only";
import {staffDb} from "./staff-auth";
import {getMessengerConfig,sendMessengerPageMessage} from "./facebook-messenger";
import {showForecast,dayBeforeText,type Reminder} from "./show-day-before";
function rpc<T>(method:string,body:Record<string,unknown>):Promise<T> {
  return staffDb("rpc/extra_day_before_"+method,{method:"POST",body:JSON.stringify(body),signal:AbortSignal.timeout(7000)}) as Promise<T>;
}
export async function runDayBefore() {
  let sent=0;
  try {
    const page=getMessengerConfig()?.pageId;
    if(page!=="1223940670813189")return {sent};
    const candidates=await rpc<Reminder[]>("due",{p_page:page});
    for(const row of candidates.slice(0,4)){
      const weather=row.kind==="paid"?await showForecast(row):null;
      const body=dayBeforeText(row,weather);
      if(!await rpc<boolean>("claim",{p_page:page,p_chat:row.chat_id,p_show:row.show_id,p_expected:row}))continue;
      let mid:string|null=null;
      try{mid=(await sendMessengerPageMessage(row.recipient,body)).messageId||null;}catch{/* Ambiguous delivery must not be retried. */}
      await rpc("finish",{p_page:page,p_recipient:row.recipient,p_show:row.show_id,p_mid:mid,p_body:body});
      if(mid)sent++;
    }
    return {sent};
  } catch {console.warn("[day-before] Reminder service unavailable");return {sent,unavailable:true};}
}

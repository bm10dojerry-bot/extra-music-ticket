type DatedShow={date:string;time?:string;status?:string};

const vietnamDay=new Intl.DateTimeFormat("en",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit"});

export function vietnamDateISO(date:Date):string {
 const parts=vietnamDay.formatToParts(date);
 const value=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value||"";
 return `${value("year")}-${value("month")}-${value("day")}`;
}

function validDate(value:string):boolean {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const timestamp=Date.parse(value+"T00:00:00Z");
 return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===value;
}

function performanceTime(value:string|undefined):number {
 const match=value?.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
 if(!match)return Number.POSITIVE_INFINITY;
 const hour=Number(match[1]),minute=Number(match[2]),second=Number(match[3]||0);
 return hour<24&&minute<60&&second<60?hour*3600+minute*60+second:Number.POSITIVE_INFINITY;
}

/** Upcoming dates first, then recent past/ended dates; input order breaks exact ties. */
export function orderShowsByDate<T extends DatedShow>(shows:readonly T[],todayISO=""):T[] {
 const today=validDate(todayISO)?todayISO:"";
 return shows.map((show,index)=>({
  show,index,time:performanceTime(show.time),
  group:!validDate(show.date)?2:show.status==="ended"||(today&&show.date<today)?1:0,
 })).sort((a,b)=>{
  if(a.group!==b.group)return a.group-b.group;
  if(a.group===2)return a.index-b.index;
  const dateOrder=a.show.date.localeCompare(b.show.date);
  if(dateOrder)return a.group===1?-dateOrder:dateOrder;
  // Unknown times stay behind the known performances on the same date.
  if(a.time!==b.time){
   if(!Number.isFinite(a.time))return 1;
   if(!Number.isFinite(b.time))return -1;
   return a.group===1?b.time-a.time:a.time-b.time;
  }
  return a.index-b.index;
 }).map(entry=>entry.show);
}

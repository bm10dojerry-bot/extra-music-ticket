"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");
function change(source, before, after) {
  assert.equal(source.split(before).length, 2, "Missing or ambiguous consultation integration: "+before);
  return source.replace(before, () => after);
}
const workerPath = "lib/ai-sales.ts";
let worker = fs.readFileSync(workerPath, "utf8");
worker = change(worker, 'import "server-only";', 'import "server-only";\nimport {consultationPolicy,directTierReply} from "./ai-sales-consultation";');
worker = change(worker, "const instructions=\x60", "const instructions=\x60"+'\x24{consultationPolicy}\\n');
const quick = "await quickSalesReply(messages,Boolean(commentContext),listAiSalesShows).catch(()=>null)";
worker = change(worker,quick,"(await directTierReply(messages,commentContext?.showId,listAiSalesShows).catch(()=>null) ?? "+quick+")");
worker = change(worker, 'execute:({showId,quantity,zone})=>safeTool(()=>getAiSeatOptions(showId,quantity,zone))',
  'execute:({showId,quantity,zone,view,maxPerTicket})=>safeTool(()=>getAiSeatOptions(showId,quantity,zone,view,maxPerTicket))');
worker = change(worker, 'zone:z.enum(["A","B","C","D"]).optional()}),execute:({showId,quantity,zone,view',
  'zone:z.enum(["A","B","C","D"]).optional(),view:z.enum(["left","right","center"]).optional(),maxPerTicket:z.number().int().positive().optional()}),execute:({showId,quantity,zone,view');
fs.writeFileSync(workerPath,worker);
const checkoutPath="lib/ai-sales-checkout.ts";
let checkout=fs.readFileSync(checkoutPath,"utf8");
checkout=change(checkout, "quantity:number,zone?:AiSeatZone){", 'quantity:number,zone?:AiSeatZone,view?:"left"|"right"|"center",maxPerTicket?:number){');
checkout=change(checkout,"const free=seats.filter(seat=>!taken.has(seat.id)&&show.prices[seat.zone as AiSeatZone]!==null);",[
  "const free=seats.filter(seat=>{",
  "  const price=show.prices[seat.zone as AiSeatZone];",
  "  const lateral=show.venueId===\"ccc\"?seat.y:seat.x;",
  '  const direction=lateral<38?"left":lateral>62?"right":"center";',
  "  return !taken.has(seat.id)&&price!==null&&(!view||view===direction)&&(maxPerTicket===undefined||price<=maxPerTicket);",
  "});"].join("\n"));
fs.writeFileSync(checkoutPath,checkout);
console.log("[Extra] Production consultation, scoped tier prices and seat view selection applied.");

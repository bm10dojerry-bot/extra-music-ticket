'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const file = 'lib/ai-sales.ts';
let worker = fs.readFileSync(file,'utf8');
function replaceOnce(before,after) {
  assert.equal(worker.split(before).length, 2, 'Missing seat advice integration: ' + before);
  worker = worker.replace(before, () => after);
}
replaceOnce('import "server-only";', 'import "server-only";\nimport {prepareSeatAdvice,seatAdviceEnabled} from "./ai-sales-seat-advisor";');
replaceOnce('  if(!confirmationProblem&&isSeatMapRequest(latest.body)){', [
  '  const advice = !confirmationProblem && seatAdviceEnabled(chat.messenger_page_id,chat.messenger_psid)',
  '    ? await prepareSeatAdvice(chat.id,job.id,latest.body,messages,commentContext,currentOrder?.showId||latestQuote?.showId) : null;',
  '  if(advice && !advice.sendImage && advice.text){',
  '    await guard(job);',
  '    await sendAiSalesMessage(job,chat,{purpose:"reply",body:advice.text});',
  '    return;',
  '  }',
  '  if(!confirmationProblem&&(advice?.sendImage||isSeatMapRequest(latest.body))){'
].join('\n'));
replaceOnce('const selected=selectSeatMap(latest.body,', 'const selected=advice?.selected??selectSeatMap(latest.body,');
replaceOnce('body:seatMapCaption(selected,availability)', 'body:advice?.text??seatMapCaption(selected,availability)');
fs.writeFileSync(file, worker);

// Reuse the verified layout, paid/held seats and blocks used by the existing seat-options tool.
const checkoutFile = 'lib/ai-sales-checkout.ts';
const checkout = fs.readFileSync(checkoutFile,'utf8');
const start = checkout.indexOf('export async function getAiSeatOptions(');
const read = checkout.indexOf('  const show=(await listAiSalesShows()).find',start);
const end = checkout.indexOf('  const free=seats.filter(',read);
assert(start >= 0 && read > start && end > read && !checkout.includes('function getAiSeatSnapshot'));
const snapshot = 'export async function getAiSeatSnapshot(showId:string){\n  if(!SHOW.test(showId))invalid();\n' +
  checkout.slice(read,end) + '  return {show,seats,taken};\n}\n\n';
fs.writeFileSync(checkoutFile,checkout.slice(0,start) + snapshot + checkout.slice(start,read) +
  '  const {show,seats,taken}=await getAiSeatSnapshot(showId);\n' + checkout.slice(end));

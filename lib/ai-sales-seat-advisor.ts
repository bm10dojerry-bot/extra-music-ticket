import 'server-only';
import {createHash} from 'node:crypto';
import {getAiSeatSnapshot, listAiSalesShows} from './ai-sales-checkout';
import {salesPreferences} from './ai-sales-consultation';
import {selectSeatMap, seatMapVenueName} from './ai-sales-seat-map';
import {rankSeatGroups, describeSeats, seatInquiry} from './v2-seat-guidance';
import {staffDb} from './staff-auth';

type Message = {sender:string; body:string; staff_name?:string|null};

export function seatAdviceEnabled(page: string, psid: string) {
  const scope = process.env.EXTRA_SEAT_ADVICE_CHAT_SHA256;
  return Boolean(scope && createHash('sha256').update(page + ':' + psid).digest('hex') === scope);
}

async function previousAttachment(chatId:string, jobId:string, marker:string) {
  const query = new URLSearchParams({chat_id:'eq.' + chatId,job_id:'neq.' + jobId,
    body:'eq.' + marker,state:'in.(sent,uncertain,sending)',select:'state',limit:'1'});
  const rows = await staffDb('extra_messenger_ai_outbox?' + query) as {state:string}[];
  return rows.length > 0;
}

export async function prepareSeatAdvice(chatId:string, jobId:string, body:string, history:Message[], referral: {showId?:string|null} | null, knownShow?:string|null) {
  const prior = history.slice(0,-1).filter(m => m.sender === 'customer' || m.sender === 'staff' && m.staff_name === 'EXTRA AI').slice(-4);
  const recentMap = prior.some(m => /sơ đồ|so do/i.test(m.body));
  const intent = seatInquiry(body, recentMap);
  if (!intent.relevant) return null;
  const shows = await listAiSalesShows().catch(() => []);
  const selected = selectSeatMap(body,history,shows,referral,knownShow);
  if (!selected) return {sendImage:false, text:'Mình đang xem đêm nhạc nào, ở CCC Sa Pa hay Lào Cai ạ? Em sẽ tư vấn đúng vị trí và giá vé của suất đó.'};
  const marker = '[Ảnh sơ đồ ghế ' + seatMapVenueName(selected.venue) + ']';
  // If a send is still unresolved, continue advising by text until the customer explicitly requests a resend.
  const sendImage = intent.requestImage && (intent.repeat || !await previousAttachment(chatId,jobId,marker).catch(() => true));
  if (sendImage && !intent.advice) return {sendImage,selected};
  const intro = selected.venue === 'ccc' ? 'Ở CCC Sa Pa, ghế xếp vòng cung hướng về sân khấu bên phải sơ đồ. Khu Premium sát sân khấu, kế đến là VIP rồi tới các khu Standard phía sau.' : 'Ở Lào Cai, sân khấu ở phía trước hai dãy ghế. Khu VIP gần ca sĩ nhất, Standard 1 ở giữa và Standard 2 ở xa hơn.';
  let text = intro + ' Mình muốn xem đêm nhạc của ca sĩ nào để em so giá vé và chọn ghế phù hợp ạ?';
  const show = shows.find(s => s.id === selected.show?.id && s.venueId === selected.venue);
  if (show) {
    const memory = salesPreferences(history,shows,referral?.showId);
    // Never silently apply a total budget as a per-ticket ceiling.
    if (memory.budgetVnd && memory.budgetBasis !== 'per_ticket' && (!memory.quantity || (memory.quantity > 1 && memory.budgetBasis !== 'total'))) {
      text = intro + ' Ngân sách mình dự tính là cho mỗi vé hay cho cả nhóm ạ?';
    } else if ((memory.quantity ?? 1) > 20) {
      text = intro + ' Mình muốn ưu tiên khoảng giá bao nhiêu mỗi vé để bên em tư vấn chỗ cho cả nhóm ạ?';
    } else {
      try {
        const fresh = await getAiSeatSnapshot(show.id);
        const quantity = memory.quantity ?? 1;
        const ceiling = memory.budgetVnd && memory.budgetBasis === 'total' ? Math.floor(memory.budgetVnd / quantity) : memory.budgetVnd;
        const compareTiers = /rẻ hơn|giá thấp|giá cao|tiết kiệm|thấp hay cao|so sánh|re hon|gia thap|gia cao/i.test(body);
        const options = rankSeatGroups(fresh.show.venueId,fresh.seats,fresh.seats.filter(s => !fresh.taken.has(s.id)),fresh.show.prices,quantity,compareTiers ? undefined : memory.zone,memory.seatView,ceiling);
        text = describeSeats(options,show.artist);
      } catch { text = 'Em chưa kiểm tra được ghế trống và giá hiện tại của đêm ' + show.artist + '. ' + intro; }
    }
  }
  return {sendImage,selected,text};
}

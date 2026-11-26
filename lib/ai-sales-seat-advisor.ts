import {hasPoster,tierName} from "./poster-offers";
import 'server-only';
import {seatAdvicePage} from './show-family-policy';
import {getAiSeatSnapshot, listAiSalesShows} from './ai-sales-checkout';
import {salesPreferences} from './ai-sales-consultation';
import {selectSeatMap} from './ai-sales-seat-map';
import {rankSeatGroups, describeSeats, seatInquiry} from './v2-seat-guidance';

type Message = {sender:string; body:string; staff_name?:string|null};

export function seatAdviceEnabled(page: string, psid: string) {
  return seatAdvicePage(page,psid);
}

export async function prepareSeatAdvice(_chatId:string, _jobId:string|null, body:string, history:Message[], referral: {showId?:string|null} | null, knownShow?:string|null) {
  const prior = history.slice(0,-1).filter(m => m.sender === 'customer' || m.sender === 'staff' && m.staff_name === 'EXTRA AI').slice(-4);
  const recentMap = prior.some(m => /sơ đồ|so do/i.test(m.body));
  const intent = seatInquiry(body, recentMap);
  if (!intent.relevant) return null;
  const shows = await listAiSalesShows().catch(() => []);
  const selected = selectSeatMap(body,history,shows,referral,knownShow);
  if (!selected) return {sendImage:false, text:'Mình đang xem đêm nhạc nào, ở CCC Sa Pa hay Lào Cai ạ? Em sẽ tư vấn đúng vị trí và giá vé của suất đó.'};
  // Each new explicit customer request may receive the requested image, even if an old message contained it.
  // Transport deduplication remains scoped to the current guarded job/outbox (or timeout claim).
  // Never retry an ambiguous transport send automatically; a distinct customer request is not a retry.
  const sendImage = intent.requestImage;
  if (sendImage && !intent.advice) return {sendImage,selected};
  const intro = selected.venue === 'ccc' ? 'Ở CCC Sa Pa, ghế xếp vòng cung hướng về sân khấu bên phải sơ đồ. Các hàng ghế trải từ sát sân khấu ra phía sau.' : 'Ở Lào Cai, sân khấu ở phía trước hai dãy ghế. Các hàng phía trước gần sân khấu hơn.';
  let text = intro + ' Mình muốn xem đêm nhạc của ca sĩ nào để em so giá vé và chọn ghế phù hợp ạ?';
  const show = shows.find(s => s.id === selected.show?.id && s.venueId === selected.venue);
  if (show) {
    const memory = salesPreferences(history,shows,referral?.showId);
    const choiceText=body.normalize("NFD").replace(/\p{M}/gu,"").replace(/[đĐ]/g,"d").toLowerCase();
    if(/\b(?:ghe (?:nao )?dep|cho (?:nao )?(?:ngoi )?dep|cho ngoi nao dep)\b/.test(choiceText) && !memory.seatView && !memory.budgetVnd && !/gan|xa|tiet kiem/.test(choiceText)){
      return {sendImage,selected,text:"Mình thích ngồi gần ca sĩ hay chính diện để nhìn trọn sân khấu ạ?"};
    }
    // Never silently apply a total budget as a per-ticket ceiling.
    if (memory.budgetVnd && memory.budgetBasis !== 'per_ticket' && (!memory.quantity || (memory.quantity > 1 && memory.budgetBasis !== 'total'))) {
      text = intro + ' Ngân sách mình dự tính là cho mỗi vé hay cho cả nhóm ạ?';
    } else if ((memory.quantity ?? 1) > 20) {
      text = intro + ' Mình muốn ưu tiên khoảng giá bao nhiêu mỗi vé để bên em tư vấn chỗ cho cả nhóm ạ?';
    } else {
      try {
        const fresh = await getAiSeatSnapshot(show.id);
        const quantity = memory.quantity ?? 1;
        const couple=hasPoster(show.id) && quantity===2 && history.filter(m=>m.sender==="customer").slice(-6).some(m=>/\b(?:hai vo chong|2 vo chong|cap doi)\b/.test(m.body.normalize("NFD").replace(/\p{M}/gu,"").replace(/[đĐ]/g,"d").toLowerCase())) && !history.filter(m=>m.sender==="customer").slice(-6).some(m=>/\b(?:tre em|con nho|em be|khong phai cap doi|khong ap dung|khong dung uu dai)\b/.test(m.body.normalize("NFD").replace(/\p{M}/gu,"").replace(/[đĐ]/g,"d").toLowerCase()));
        const ceiling = memory.budgetVnd && memory.budgetBasis === 'total' ? Math.floor(memory.budgetVnd / (quantity * (couple?0.95:1))) : memory.budgetVnd;
        const compareTiers = /rẻ hơn|giá thấp|giá cao|tiết kiệm|thấp hay cao|so sánh|re hon|gia thap|gia cao/i.test(body);
        const options = rankSeatGroups(fresh.show.venueId,fresh.seats,fresh.seats.filter(s => !fresh.taken.has(s.id)),fresh.show.prices,quantity,compareTiers ? undefined : memory.zone,memory.seatView,ceiling);
        const request=body.normalize('NFD').replace(/\p{M}/gu,'').replace(/[đĐ]/g,'d').toLowerCase();
        const priority=/so sanh|gan hay xa|thap hay cao/.test(request)?'compare':/\b(?:tiet kiem|re|gia thap|ngan sach)\b/.test(request)?'price':/ngoi xa|hang sau/.test(request)?'far':/gan|hang dau/.test(request)?'near':'compare';
        text = describeSeats(options,show.artist,priority,z=>tierName(show.id,z),couple);
        if(options.length && /\b(?:so|lo|ngai)\b.{0,35}\b(?:xa|khong thay|kho nhin|bi che)\b/.test(request))text="Em hiểu mình muốn nhìn rõ sân khấu. "+text;
        if(options.length && !memory.quantity)text+=' Mình đi mấy người để em kiểm tra ghế liền nhau ạ?';
      } catch { text = 'Em chưa kiểm tra được ghế trống và giá hiện tại của đêm ' + show.artist + '. ' + intro; }
    }
  }
  return {sendImage,selected,text};
}

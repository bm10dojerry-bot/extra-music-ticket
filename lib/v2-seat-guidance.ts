import type { Seat, VenueId } from './venues';

const clean = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function seatInquiry(body: string, recentMap: boolean) {
  const text = clean(body);
  const map = /\b(?:so do|seat map|map ghe|mat bang ghe|hinh ghe|anh ghe)\b/.test(text);
  const other = /\b(?:hoa don|chuyen khoan|ma qr|anh ve|ve dien tu|bien lai|chup anh|nhan vien|hoan tien)\b/.test(text);
  const denied = /\b(?:dung|thoi|khoi|khong|ko|k) (?:can |muon |phai )?(?:em )?(?:gui|xem|so do|anh|hinh)\b/.test(text);
  const transaction = /\b(?:dat (?:giup|ho|cho|luon)|giu (?:giup|cho|ghe)|chot (?:ghe|ve|don)|thanh toan|da mua|da dat|ma don)\b/.test(text);
  const again = /\b(?:gui lai|xem lai|xin lai|cho lai|mo lai|gui them lan nua|gui giup lai)\b/.test(text);
  const repeat = !denied && !other && again && (map || (recentMap && /\b(?:anh|hinh)\b/.test(text)));
  const advice = /\b(?:ghe dep|ghe nao dep|cho dep|cho (?:nao )?ngoi dep|cho ngoi nao dep|goc nhin|goc nao|tam nhin|nhin ro|nhin thang|chinh dien|ngoi giua|gan (?:ca si|san khau|hon|nhat)|xa (?:ca si|san khau|hon|nhat)|gan hay xa|ngoi xa|ngoi gan|hang dau|hang sau|gia (?:thap|cao|mem|re)|re hon|re nhat|mac hon|dat hon|tiet kiem|vua tui tien|hop tui tien|ngan sach|su khac nhau)\b/.test(text) || (map && /\b(?:gia|bao nhieu|ghe nao|hang nao|khu nao|o dau|ben trai|ben phai|vi tri)\b/.test(text));
  const direct = /\b(?:gui|xem|xin|can|muon|dua|co)\b(?: (?:cho|giup|anh|chi|minh|em|toi|mot|cai|tam|buc|hinh|anh|xem|xin|lai|cai nay)){0,6} (?:so do|seat map|map ghe|mat bang ghe|anh ghe|hinh ghe)\b/.test(text);
  return { relevant: !other && !transaction && (map || repeat || advice), advice: !other && advice, repeat,
    requestImage: !other && !denied && (repeat || (map && (direct || !advice) && !/\b(?:tren|nhin vao|dua vao|theo|trong) (?:anh |hinh )?so do\b/.test(text) || (map && /\b(?:gui|cho xem) (?:hinh|anh)\b/.test(text)))) };
}

export type SeatTier = 'A' | 'B' | 'C' | 'D';
type View = 'left' | 'center' | 'right';
type SeatOption = { tier: SeatTier; ids: string[]; row: string; depth: 'gần sân khấu' | 'ở khoảng giữa khán phòng' | 'xa sân khấu hơn'; view: View; price: number; position: number; offset: number };
export function rankSeatGroups(venue: VenueId, layout: Seat[], free: Seat[], prices: Record<SeatTier, number | null>, quantity: number, zone?: SeatTier, view?: View, ceiling?: number) {
  const rows = new Map<string, Seat[]>();
  for (const seat of layout) { const row = rows.get(seat.row) ?? []; row.push(seat); rows.set(seat.row, row); }
  const depths = [...rows.keys()].sort();
  const available = new Set(free.map(seat => seat.id));
  const best = new Map<SeatTier, SeatOption>();
  for (const [row, seats] of rows) {
    const position = depths.indexOf(row);
    const depth = position < depths.length / 3 ? 'gần sân khấu' : position >= depths.length * 2 / 3 ? 'xa sân khấu hơn' : 'ở khoảng giữa khán phòng';
    for (let i = 0; i + quantity <= seats.length; i++) {
      const group = seats.slice(i, i + quantity), first = group[0], last = group[group.length - 1];
      const tier = first.zone as SeatTier, price = prices[tier];
      if (!price || price <= 0 || (zone && zone !== tier) || (ceiling !== undefined && price > ceiling)) continue;
      if (group.some((s, n) => !available.has(s.id) || s.zone !== tier || s.number !== first.number + n)) continue;
      if (venue === 'laocai' && first.number <= Math.ceil(seats.length / 2) && last.number > Math.ceil(seats.length / 2)) continue;
      const lateral = (s: Seat) => venue === 'ccc' ? s.y : s.x;
      const side = (x: number): View => x < 38 ? 'left' : x > 62 ? 'right' : 'center';
      if (side(lateral(first)) !== side(lateral(last))) continue;
      const direction = side(lateral(first));
      if (view && view !== direction) continue;
      const offset = Math.abs((lateral(first) + lateral(last)) / 2 - (view === 'left' ? 25 : view === 'right' ? 75 : 50));
      const option: SeatOption = {tier, price, row, position, offset, depth, view:direction, ids:group.map(s => s.id)};
      const existing = best.get(tier);
      if (!existing || position < existing.position || (position === existing.position && offset < existing.offset)) best.set(tier, option);
    }
  }
  const ranked = [...best.values()].sort((a,b) => a.price - b.price || a.position - b.position);
  const near = [...ranked].sort((a,b) => a.position - b.position || a.price - b.price)[0];
  return [...new Set([near,ranked[0]].filter((o): o is SeatOption => Boolean(o)))];
}

export function describeSeats(options: ReturnType<typeof rankSeatGroups>, artist: string, preference: 'price'|'near'|'far'|'compare'='compare', label:(zone:string)=>string=z=>'hạng '+z,couple=false) {
  if (!options.length) return 'Em chưa tìm được ghế trống phù hợp với các điều kiện của mình trong đêm ' + artist + '. Mình muốn em kiểm tra góc khác hay mức giá khác ạ?';
  const views = {left:'chếch trái',center:'chính diện',right:'chếch phải'};
  const sorted=[...options];
  if(preference==='price')sorted.sort((a,b)=>a.price-b.price);
  if(preference==='far')sorted.sort((a,b)=>b.position-a.position);
  const first=sorted[0];
  const location=(o:typeof first)=>o.ids.join(', ')+' ('+label(o.tier)+'), '+o.depth+', góc '+views[o.view]+', '+o.price.toLocaleString('vi-VN')+'đ/vé'+(couple?' (hai vé sau giảm 5% là '+Math.round(o.price*2*0.95).toLocaleString('vi-VN')+'đ)':'');
  const intro=preference==='price'?'Để tiết kiệm, mình có thể chọn ':preference==='near'?'Nếu muốn nhìn ca sĩ gần hơn, em gợi ý ':preference==='far'?'Nếu thích ngồi phía sau, mình tham khảo ':'Em vừa kiểm tra đêm '+artist+', hiện còn ';
  let answer=intro+location(first)+'.';
  const second=sorted[1];
  if(second)answer+='\n'+(second.price<first.price?'Phương án tiết kiệm hơn là ':second.position<first.position?'Nếu muốn gần sân khấu hơn, còn ':'Mình cũng có thể chọn ')+location(second)+'.';
  return answer;
}

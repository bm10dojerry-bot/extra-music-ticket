export const posterPrices = {
  "dinh-dung-2811": {A:399000,B:349000,C:249000,D:199000},
  "minh-vuong-0512": {A:399000,B:349000,C:249000,D:199000},
  "trinh-dinh-quang-1212": {A:399000,B:349000,C:249000,D:199000},
  "khanh-phuong-1912": {A:599000,B:449000,C:399000,D:299000},
  "ho-quang-hieu-2412": {A:599000,B:449000,C:399000,D:299000},
  "khac-viet-2612": {A:599000,B:449000,C:399000,D:299000},
  "thai-hoc-3112": {A:599000,B:449000,C:399000,D:299000},
};
export function hasPoster(showId:string) {
  return Object.prototype.hasOwnProperty.call(posterPrices,showId);
}
const tierNames:Record<string,string> = {A:"Hạng A",B:"VIP",C:"Standard 1",D:"Standard 2"};
export function tierName(showId:string,zone:string) {
  return (hasPoster(showId) && tierNames[zone]) || "Hạng "+zone;
}
export const posterChildren = "Bé dưới 4 tuổi ngồi cùng bố mẹ được miễn phí, không cần chọn ghế. Trẻ dưới 10 tuổi ngồi ghế riêng tính 70% giá vé người lớn cùng hạng. Từ đủ 10 tuổi tính giá người lớn. Tuổi tính vào ngày diễn.";
export const posterGifts = "Quà đi kèm gồm vòng đeo tay theo hạng, gậy phát sáng cổ vũ và quà lưu niệm. Số lượng có hạn.";
export const posterGroups = "Cặp đôi giảm 5%. Mua 5 vé tặng 1, mua 10 vé tặng 2, mua 20 vé tặng 3.";
export const offers = {
  none: {label:"Vé thông thường", paid:12, gifts:0},
  couple5: {label:"Cặp đôi · giảm 5%", paid:2, gifts:0},
  buy5: {label:"Mua 5 vé tặng 1", paid:5, gifts:1},
  buy10: {label:"Mua 10 vé tặng 2", paid:10, gifts:2},
  buy20: {label:"Mua 20 vé tặng 3", paid:20, gifts:3},
};
export type Offer = keyof typeof offers;
export function posterSelection(offer:Offer, seats:{id:string;zone:string}[]) {
  const rule=offers[offer], limit=rule.paid+rule.gifts;
  const ready=offer==="none" ? seats.length>0 && seats.length<=limit : seats.length===limit;
  // A gift can only occupy the lowest purchased tier or a lower one.
  const sorted=[...seats].sort((a,b)=>a.zone.localeCompare(b.zone)||a.id.localeCompare(b.id));
  return {limit,ready,paid:sorted.slice(0,rule.paid).map(s=>s.id),gifts:sorted.slice(rule.paid).map(s=>s.id)};
}
export const posterAdvice = "Quy định poster 7 show từ 28/11 đến 31/12/2026 ("+Object.keys(posterPrices).join(", ")+"). Với đúng những show này, A là Hạng A, B là VIP, C là Standard 1, D là Standard 2. Dùng giá mới nhất của đúng show từ công cụ, kể cả khi lịch sử hội thoại ghi giá cũ. "+posterChildren+" "+posterGroups+" "+posterGifts+" Khi khách hỏi quà, nêu danh mục và số lượng có hạn. Ưu đãi 2 vé dành cho cặp đôi. Hỏi khi cần xác định khách có đi theo cặp.";
export function normalizePosterTiers(text:string) {
  return text.replace(/\bvip\b/gi,"hạng vé B")
    .replace(/\b(?:standard|st)\s*([12])\b/gi,(_,n:string)=>"hạng vé "+(n==="1"?"C":"D"));
}
export function askedOffer(text:string) {
  const plain=text.normalize("NFD").replace(/\p{M}/gu,"").replace(/đ/gi,"d").toLowerCase();
  if (/\b(?:vong (?:deo )?tay|gay phat sang|qua (?:tang|luu niem)|qua gi)\b/.test(plain))return posterGifts;
  if (/\b(?:tre em|tre nho|em be|be|tuoi)\b/.test(plain))return posterChildren;
  if (/\b(?:uu dai|khuyen mai|cap doi|tang ve|ve tang|mua \d+ tang|giam gia)\b/.test(plain))return posterGroups;
  return "";
}

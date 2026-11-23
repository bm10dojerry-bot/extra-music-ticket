export const mediaSlots=[{id:"banner-home-desktop",name:"Banner trang chủ · Máy tính"},{id:"banner-home-mobile",name:"Banner trang chủ · Điện thoại"},{id:"venue-moana",name:"Sân khấu Moana Sa Pa"},{id:"venue-ccc",name:"Sân khấu CCC Sa Pa"},{id:"venue-laocai",name:"Sân khấu Extra Lào Cai"},{id:"venue-moana-2",name:"Moana Sa Pa · Ảnh album 2"},{id:"venue-moana-3",name:"Moana Sa Pa · Ảnh album 3"},{id:"venue-ccc-2",name:"CCC Sa Pa · Ảnh album 2"},{id:"venue-ccc-3",name:"CCC Sa Pa · Ảnh album 3"},{id:"venue-laocai-2",name:"Extra Lào Cai · Ảnh album 2"},{id:"venue-laocai-3",name:"Extra Lào Cai · Ảnh album 3"},{id:"artist-dinh-dung-2811",name:"Ảnh PNG ca sĩ · Đình Dũng"},{id:"artist-minh-vuong-0512",name:"Ảnh PNG ca sĩ · Minh Vương"},{id:"artist-trinh-dinh-quang-1212",name:"Ảnh PNG ca sĩ · Trịnh Đình Quang"},{id:"artist-khanh-phuong-1912",name:"Ảnh PNG ca sĩ · Khánh Phương"},{id:"artist-ho-quang-hieu-2412",name:"Ảnh PNG ca sĩ · Hồ Quang Hiếu"},{id:"artist-khac-viet-2612",name:"Ảnh PNG ca sĩ · Khắc Việt"},{id:"artist-thai-hoc-3112",name:"Ảnh PNG ca sĩ · Thái Học"}] as const;
export const MAX_MEDIA_UPLOAD_MB = 4;
export const MAX_MEDIA_UPLOAD_BYTES = MAX_MEDIA_UPLOAD_MB * 1024 * 1024;

export type MediaSlot = typeof mediaSlots[number]["id"] | `artist-${string}`;

const artistSlotPattern = /^artist-[a-z0-9][a-z0-9-]{2,99}$/;

export function validSlot(value: string): value is MediaSlot {
  // Comparing the whole match also rejects a final newline, which JavaScript's $ permits.
  return mediaSlots.some(slot => slot.id === value) || artistSlotPattern.exec(value)?.[0] === value;
}

export function getMediaSlots(shows: readonly {id: string; artist: string}[]): {id: MediaSlot; name: string}[] {
  const slots = new Map<MediaSlot, {id: MediaSlot; name: string}>();
  for (const slot of mediaSlots) slots.set(slot.id, {...slot});
  for (const show of shows) {
    const id = `artist-${show.id}`;
    if (validSlot(id)) slots.set(id, {id, name: `Ảnh PNG ca sĩ · ${show.artist}`});
  }
  return Array.from(slots.values());
}

export function mediaPublicUrl(path:string){return process.env.SUPABASE_URL+"/storage/v1/object/public/extra-media/"+path.split("/").map(encodeURIComponent).join("/")}

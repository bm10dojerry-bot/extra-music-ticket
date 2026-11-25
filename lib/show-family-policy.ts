export const artistPhotoNotice = "Dự kiến khoảng 25 phút cuối chương trình sẽ dành cho việc chụp ảnh cùng nghệ sĩ. Nếu muốn tham gia, mình đăng ký với ban tổ chức nhé.";
export const childFareNotice = "Tuổi tính vào ngày diễn. Bé dưới 4 tuổi ngồi cùng bố mẹ được miễn vé và không giữ thêm ghế. Trẻ dưới 11 tuổi ngồi ghế riêng có vé và mã QR riêng, giá bằng 70% vé người lớn cùng hạng của đúng show. Từ đủ 11 tuổi áp dụng giá người lớn.";
export function seatFare(adultPrice:number, child:boolean) {
  return child ? Math.round(adultPrice * 0.7) : adultPrice;
}
export function validChildSeats(input:unknown, paid:string[]):input is string[] {
  return Array.isArray(input) && input.every(id => typeof id === "string" && paid.includes(id)) && new Set(input).size === input.length;
}
export function seatAdvicePage(page:string, recipient:string) {
  return page === "1223940670813189" && /^\d{5,80}$/.test(recipient);
}

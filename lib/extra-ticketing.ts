import {loadShows} from "./show-data";
import {venues} from "./venues";
import {staffDb} from "./staff-auth";
type Ticket={id:string;order_code:string;show_id:string;venue_id:string;seat_id:string;qr_secret:string;issued_at:string;checked_in_at:string|null};
type Order={code:string;access_token:string;status:string;buyer_name:string;buyer_email:string;amount_vnd:number;show_id:string;seats:string[];email_status:string};
export async function paidOrder(code:string):Promise<Order|null>{
 const rows=await staffDb("extra_payment_orders?code=eq."+encodeURIComponent(code)+"&select=code,access_token,status,buyer_name,buyer_email,amount_vnd,show_id,seats,email_status&limit=1") as Order[];
 return rows[0]||null;
}
export async function ticketsFor(code:string):Promise<Ticket[]>{
 return await staffDb("extra_tickets?order_code=eq."+encodeURIComponent(code)+"&select=id,order_code,show_id,venue_id,seat_id,qr_secret,issued_at,checked_in_at&order=seat_id.asc") as Ticket[];
}
export async function issueTickets(code:string){
 return await staffDb("rpc/extra_issue_paid_tickets",{method:"POST",body:JSON.stringify({p_order_code:code})});
}
export async function deliverTickets(code:string){
 const order=await paidOrder(code);
 if(!order||order.status!=="paid")return;
 await issueTickets(code);
 if(!process.env.RESEND_API_KEY||!process.env.TICKET_FROM_EMAIL){console.warn("[extra-tickets] Email not configured for paid order",code);return}
 const claimed=await staffDb("rpc/extra_claim_ticket_email",{method:"POST",body:JSON.stringify({p_order_code:code})});
 if(claimed!==true)return;
 try{
  const tickets=await ticketsFor(code);
  const show=(await loadShows()).find(s=>s.id===order.show_id);
  const venue=venues.find(v=>v.id===(tickets[0]?.venue_id||show?.venue));
  const directions=venue?"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(venue.name+" "+venue.address):null;
  const link="https://iextra.net/ve?code="+encodeURIComponent(code)+"&token="+encodeURIComponent(order.access_token);
  const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
  const html='<div style="margin:0;padding:36px 14px;background:#101114;font-family:Arial,sans-serif;color:#f7f2e8"><div style="max-width:560px;margin:auto;border:1px solid #6d303e;border-radius:20px;overflow:hidden;background:#191a1c"><div style="background:linear-gradient(135deg,#4a1a26,#171819);padding:36px 24px;text-align:center"><div style="font-size:28px;letter-spacing:4px;color:#ff8e9b;font-weight:900">+1 EXTRA</div><div style="font-size:11px;letter-spacing:4px;color:#ff9aa5;margin-top:8px">MUSIC SHOW</div><h1 style="font-size:27px;line-height:1.3;margin:28px 0 0;color:#fff">Một đêm nhạc đáng nhớ đang chờ bạn!</h1></div><div style="padding:30px 26px"><p style="font-size:17px">Xin chào <b>'+escape(order.buyer_name)+'</b>,</p><p style="color:#d5c9cf;line-height:1.8">Cảm ơn bạn đã lựa chọn +1 EXTRA MUSIC SHOW. Thanh toán của bạn đã được xác nhận và vé điện tử đã sẵn sàng!</p><div style="padding:20px;border:1px solid #63353f;border-radius:12px;background:#251c22;line-height:2;color:#f2e9ed"><div>Mã đơn: <b>'+escape(code)+'</b></div><div>Ghế: <b>'+escape(order.seats.join(", "))+'</b></div><div>Thanh toán: <b>'+new Intl.NumberFormat("vi-VN").format(order.amount_vnd)+'đ</b></div></div><div style="text-align:center;margin:32px 0"><a href="'+escape(link)+'" style="background:#ed2839;color:#ffffff;padding:17px 28px;border-radius:9px;display:inline-block;text-decoration:none;font-weight:bold;letter-spacing:1px">MỞ VÉ ĐIỆN TỬ CỦA BẠN</a>'+(directions?'<br><a href="'+escape(directions)+'" style="color:#ff9aa5;display:inline-block;margin-top:18px">📍 Chỉ đường đến địa điểm biểu diễn</a>':'')+'</div><p style="text-align:center;color:#f0aeb9;line-height:1.7">Âm nhạc sẽ hay hơn khi có bạn ở đó.<br>Hẹn gặp bạn tại EXTRA!</p></div><div style="background:#251c22;padding:20px;text-align:center;color:#b9a5aa;font-size:12px;line-height:1.7">Mỗi ghế có một QR riêng. Vui lòng giữ kín liên kết vé và xuất trình QR tại cổng check-in.</div></div></div>';
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.TICKET_FROM_EMAIL,to:[order.buyer_email],subject:"+1 Extra Music Show - Vé điện tử "+code,html})});
  if(!response.ok)throw Error("Email provider HTTP "+response.status+" "+(await response.text()).slice(0,200));
  await staffDb("extra_payment_orders?code=eq."+encodeURIComponent(code),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({email_status:"sent",email_sent_at:new Date().toISOString()})});
 }catch(err){
  console.error("[extra-tickets] Email delivery failed for order",code,err instanceof Error?err.message:"Unknown");
  await staffDb("extra_payment_orders?code=eq."+encodeURIComponent(code),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({email_status:"queued",email_claimed_at:null})}).catch(()=>{});
  throw err;
 }
}

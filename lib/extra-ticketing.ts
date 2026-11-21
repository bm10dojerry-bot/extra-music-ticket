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
  const link="https://iextra.net/ve?code="+encodeURIComponent(code)+"&token="+encodeURIComponent(order.access_token);
  const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
  const html='<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#202020"><h2>+1 EXTRA MUSIC SHOW</h2><p>Xin chào '+escape(order.buyer_name)+',</p><p>Thanh toán đơn <b>'+escape(code)+'</b> đã được xác nhận.</p><p><b>Số ghế:</b> '+escape(order.seats.join(", "))+'</p><p><b>Số tiền:</b> '+new Intl.NumberFormat("vi-VN").format(order.amount_vnd)+'đ</p><p><a href="'+escape(link)+'" style="background:#bc343a;color:#fff;padding:14px 20px;display:inline-block;text-decoration:none">XEM VÉ QR VÀO CỔNG</a></p><p>Mỗi ghế có một mã QR riêng. Vui lòng mở liên kết khi đến cổng; không chia sẻ liên kết vé.</p></div>';
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.TICKET_FROM_EMAIL,to:[order.buyer_email],subject:"+1 Extra Music Show - Vé điện tử "+code,html})});
  if(!response.ok)throw Error("Email provider HTTP "+response.status+" "+(await response.text()).slice(0,200));
  await staffDb("extra_payment_orders?code=eq."+encodeURIComponent(code),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({email_status:"sent",email_sent_at:new Date().toISOString()})});
 }catch(err){
  console.error("[extra-tickets] Email delivery failed for order",code,err instanceof Error?err.message:"Unknown");
  await staffDb("extra_payment_orders?code=eq."+encodeURIComponent(code),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({email_status:"queued",email_claimed_at:null})}).catch(()=>{});
  throw err;
 }
}

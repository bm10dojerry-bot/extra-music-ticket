import "server-only";
import {artistPhotoNotice,validChildSeats} from "./show-family-policy";
import {staffDb} from "./staff-auth";
import {seatsFor, venues, type VenueId} from "./venues";
import {hasCompleteIssuedTickets, ticketEmailStatus, type SaleIssuedTicket} from "./sale-order-access";
import {ticketLinkUrl} from "./ticket-link";

export type AiSeatZone="A"|"B"|"C"|"D";
export type AiPromotion="none"|"couple5"|"buy5"|"buy10"|"buy20";
export type AiCheckoutContext={chatId:string;jobId:string;leaseToken:string;sourceMessageId:number};
export type AiSalesShow={
  id:string;artist:string;title:string;date:string;time:string;
  venueId:VenueId;venueName:string;venueAddress:string;
  prices:Record<AiSeatZone,number|null>;url:string;
};
export type AiQuoteInput={showId:string;seats:string[];childSeats?:string[];giftSeats?:string[];promotion?:AiPromotion;name:string;phone:string;email:string};
export type AiSalesQuote={
  id:string;chatId:string;sourceMessageId:number;createdAt:string;expiresAt:string;sentAt:string|null;
  showId:string;venueId:VenueId;artist:string;title:string;date:string;time:string;
  venueName:string;venueAddress:string;seats:string[];childSeats?:string[];giftSeats:string[];promotion:AiPromotion;
  name:string;phone:string;email:string;amount:number;
};
export type AiSalesOrder={
  code:string;status:"pending"|"paid"|"expired"|"review";showId:string;venueId:string;
  seats:string[];amount:number;expiresAt:string;paidAt:string|null;emailStatus?:"queued"|"sending"|"sent";
  payment?:{bank:string;account:string;holder:string;qr:string};
};
type ShowRow={id:string;artist:string;title:string;show_date:string;show_time:string;venue_id:string;status:string;prices:Record<string,unknown>};
export type AiQuoteRow={id:string;chat_id:string;source_message_id:number;created_at:string;expires_at:string;sent_at:string|null;quote:Omit<AiSalesQuote,"id"|"chatId"|"sourceMessageId"|"createdAt"|"expiresAt"|"sentAt">};
type OrderRow={
  id:string;code:string;show_id:string;venue_id:string;seats:string[];status:string;
  amount_vnd:number;expires_at:string;paid_at:string|null;email_status:string;sale_staff_id:string|null;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHOW=/^[a-z0-9-]{3,100}$/;
const CODE=/^EX[0-9A-F]{16}$/;
const SEAT=/^[A-O][0-9]{2}$/;
const money=(amount:number)=>new Intl.NumberFormat("vi-VN").format(amount)+"đ";
const dateLabel=(date:string)=>date.split("-").reverse().join("/");
const timeLabel=(iso:string)=>new Intl.DateTimeFormat("vi-VN",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Ho_Chi_Minh"}).format(new Date(iso));

export class AiCheckoutError extends Error {
  constructor(public readonly code:string,message:string){super(message);this.name="AiCheckoutError";}
}
function invalid(message="Thông tin đặt vé chưa hợp lệ."):never {throw new AiCheckoutError("INVALID_INPUT",message);}
function contextValid(context:AiCheckoutContext){
  if(!context||![context.chatId,context.jobId,context.leaseToken].every(id=>UUID.test(id))||!Number.isSafeInteger(context.sourceMessageId)||context.sourceMessageId<1)invalid();
}
function safeAmount(value:unknown):value is number {return typeof value==="number"&&Number.isSafeInteger(value)&&value>0;}
function bankConfig(){
  const bank=(process.env.SEPAY_BANK_CODE||"").toUpperCase(),account=process.env.SEPAY_BANK_ACCOUNT||"",holder=process.env.SEPAY_ACCOUNT_NAME||"";
  if(process.env.SEPAY_CHECKOUT_ENABLED!=="true"||bank!=="ACB"||!/^\d{5,30}$/.test(account)||!holder.trim()||!process.env.SEPAY_WEBHOOK_KEY)
    throw new AiCheckoutError("CHECKOUT_UNAVAILABLE","Thanh toán đang tạm chưa sẵn sàng. Chưa tạo đơn hoặc yêu cầu khách chuyển khoản.");
  return {bank,account,holder};
}
async function readAll<T>(path:string):Promise<T[]>{
  const rows:T[]=[];
  for(let page=0;page<40;page++){
    const next=await staffDb(path+"&limit=500&offset="+rows.length) as T[];
    if(!Array.isArray(next))throw new AiCheckoutError("DATA_UNAVAILABLE","Chưa đọc được dữ liệu hiện tại.");
    if(next.length===0)return rows;
    rows.push(...next);
  }
  throw new AiCheckoutError("DATA_UNAVAILABLE","Dữ liệu chưa đầy đủ; chưa thể xác nhận ghế trống.");
}
function asShow(row:ShowRow):AiSalesShow|null{
  const venue=venues.find(item=>item.id===row.venue_id);
  if(!venue||!SHOW.test(row.id)||row.status!=="announced"||!/^\d{4}-\d{2}-\d{2}$/.test(row.show_date)||!/^\d{2}:\d{2}(?::\d{2})?$/.test(row.show_time))return null;
  const starts=Date.parse(row.show_date+"T"+row.show_time+"+07:00");
  if(!Number.isFinite(starts)||starts<=Date.now())return null;
  const prices={A:null,B:null,C:null,D:null} as Record<AiSeatZone,number|null>;
  for(const zone of ["A","B","C","D"] as const){const value=row.prices?.[zone];if(safeAmount(value))prices[zone]=value;}
  if(!Object.values(prices).some(value=>value!==null))return null;
  return {id:row.id,artist:row.artist,title:row.title,date:row.show_date,time:row.show_time.slice(0,5),venueId:venue.id,venueName:venue.name,venueAddress:venue.address,prices,url:"https://iextra.net/show/"+encodeURIComponent(row.id)};
}

/** Authoritative catalog only: no hardcoded show/date/price fallback on a DB error. */
export async function listAiSalesShows():Promise<AiSalesShow[]>{
  const rows=await staffDb("managed_shows?select=id,artist,title,show_date,show_time,venue_id,status,prices&status=eq.announced&order=show_date.asc,show_time.asc&limit=300") as ShowRow[];
  if(!Array.isArray(rows))throw new AiCheckoutError("DATA_UNAVAILABLE","Chưa đọc được lịch diễn hiện tại.");
  return rows.map(asShow).filter((show):show is AiSalesShow=>show!==null);
}

/** Suggestions are not holds. The reservation RPC checks availability again atomically. */
export async function getAiSeatSnapshot(showId:string){
  if(!SHOW.test(showId))invalid();
  const show=(await listAiSalesShows()).find(item=>item.id===showId);
  if(!show)throw new AiCheckoutError("SHOW_CLOSED","Show này hiện chưa mở bán hoặc đã qua giờ diễn.");
  const encoded=encodeURIComponent(showId);
  const [layout,orders,sales,blocks]=await Promise.all([
    readAll<{row_code:string;seat_count:number}>("venue_seat_rows?venue_id=eq."+show.venueId+"&select=row_code,seat_count&order=row_code.asc"),
    readAll<{seats:string[];status:string;expires_at:string}>("extra_payment_orders?show_id=eq."+encoded+"&select=seats,status,expires_at&or=(status.eq.paid,and(status.eq.pending,expires_at.gt."+encodeURIComponent(new Date().toISOString())+"))&order=id.asc"),
    readAll<{seats:string[]}>("ticket_sales?show_id=eq."+encoded+"&payment_verified=eq.true&select=seats&order=id.asc"),
    readAll<{seat_id:string}>("extra_show_blocked_seats?show_id=eq."+encoded+"&select=seat_id&order=seat_id.asc"),
  ]);
  const taken=new Set([...orders.flatMap(row=>row.seats||[]),...sales.flatMap(row=>row.seats||[]),...blocks.map(row=>row.seat_id)]);
  const seats=seatsFor(show.venueId,Object.fromEntries(layout.map(row=>[row.row_code,row.seat_count])));
  return {show,seats,taken};
}

export async function getAiSeatOptions(showId:string,quantity:number,zone?:AiSeatZone,view?:"left"|"right"|"center",maxPerTicket?:number){
  if(!SHOW.test(showId)||!Number.isSafeInteger(quantity)||quantity<1||quantity>20||(zone!==undefined&&!["A","B","C","D"].includes(zone)))invalid();
  const {show,seats,taken}=await getAiSeatSnapshot(showId);
  const free=seats.filter(seat=>{
  const price=show.prices[seat.zone as AiSeatZone];
  const lateral=show.venueId==="ccc"?seat.y:seat.x;
  const direction=lateral<38?"left":lateral>62?"right":"center";
  return !taken.has(seat.id)&&price!==null&&(!view||view===direction)&&(maxPerTicket===undefined||price<=maxPerTicket);
});
  const groups=new Map<string,typeof free>();
  for(const seat of free){if(zone&&seat.zone!==zone)continue;const group=groups.get(seat.row)||[];group.push(seat);groups.set(seat.row,group);}
  const options:{zone:AiSeatZone;seats:string[];amount:number}[]=[];
  for(const row of groups.values()){
    for(let i=0;i+quantity<=row.length;i++){
      const candidate=row.slice(i,i+quantity);
      if(candidate.some((seat,index)=>seat.number!==candidate[0].number+index))continue;
      // In Lào Cai, consecutive labels across the central aisle are not adjacent seats.
      if(show.venueId==="laocai"){
        const rowSize=seats.filter(seat=>seat.row===candidate[0].row).length;
        if(candidate[0].number<=Math.ceil(rowSize/2)&&candidate[candidate.length-1].number>Math.ceil(rowSize/2))continue;
      }
      const seatZone=candidate[0].zone as AiSeatZone,amount=show.prices[seatZone]!*quantity;
      if(!safeAmount(amount))continue;
      options.push({zone:seatZone,seats:candidate.map(seat=>seat.id),amount});
      break;
    }
  }
  return {show,availableCount:free.length,quantity,options:options.slice(0,12),checkedAt:new Date().toISOString(),held:false as const};
}

/** The wording parser is also repeated in SQL; a model-supplied confirmed flag has no authority. */
export function isAiPurchaseConfirmation(body:string):boolean{
  if(typeof body!=="string"||body.length>100)return false;
  const text=body.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D").toLowerCase().replace(/[.!?,]+/g," ").trim().replace(/\s+/g," ");
  return /^(ok|okay|dong y|chot|chot ve|chot don|xac nhan|xac nhan dat ve|dong y dat ve|yes)( (em|nhe|nha|a|nhe em|em nhe|giup anh|giup chi))?$/.test(text);
}
function quoteFrom(row:AiQuoteRow):AiSalesQuote{
  if(!row||!UUID.test(row.id)||!row.quote||!safeAmount(row.quote.amount))throw new AiCheckoutError("DATA_UNAVAILABLE","Báo giá chưa sẵn sàng.");
  return {...row.quote,id:row.id,chatId:row.chat_id,sourceMessageId:row.source_message_id,createdAt:row.created_at,expiresAt:row.expires_at,sentAt:row.sent_at};
}
export async function buildAiQuote(context:AiCheckoutContext,input:AiQuoteInput):Promise<AiSalesQuote>{
  contextValid(context);bankConfig();
  if(!input||!SHOW.test(input.showId)||!Array.isArray(input.seats)||!input.seats.length||input.seats.length>20||input.seats.some(seat=>typeof seat!=="string"||!SEAT.test(seat))||new Set(input.seats).size!==input.seats.length)invalid();
  const childSeats=input.childSeats===undefined?[]:input.childSeats;
  if(!validChildSeats(childSeats,input.seats))invalid();
  const giftSeats=input.giftSeats||[],promotion=input.promotion||"none";
  if(!Array.isArray(giftSeats)||giftSeats.length>3||giftSeats.some(seat=>typeof seat!=="string"||!SEAT.test(seat))||new Set([...input.seats,...giftSeats]).size!==input.seats.length+giftSeats.length||!["none","couple5","buy5","buy10","buy20"].includes(promotion))invalid();
  const name=typeof input.name==="string"?input.name.trim():"",phone=typeof input.phone==="string"?input.phone.trim():"",email=typeof input.email==="string"?input.email.trim():"";
  if(name.length<2||name.length>120||/[\r\n]/.test(name)||!/^[0-9+(). -]{9,20}$/.test(phone)||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))invalid("Cần tên khách, số điện thoại và email hợp lệ để gửi vé.");
  const row=await staffDb("rpc/extra_messenger_ai_create_quote",{method:"POST",body:JSON.stringify({p_job_id:context.jobId,p_lease_token:context.leaseToken,p_input:{showId:input.showId,seats:input.seats,childSeats,giftSeats,promotion,name,phone,email}})}) as AiQuoteRow;
  if(row?.chat_id!==context.chatId||row?.source_message_id!==context.sourceMessageId)throw new AiCheckoutError("STALE_CONVERSATION","Cuộc trò chuyện đã thay đổi. Cần đọc tin nhắn mới nhất.");
  return quoteFrom(row);
}
export async function getAiLatestQuote(chatId:string):Promise<AiSalesQuote|null>{
  if(!UUID.test(chatId))invalid();
  const rows=await staffDb("extra_messenger_ai_quotes?chat_id=eq."+chatId+"&select=id,chat_id,source_message_id,created_at,expires_at,sent_at,quote&order=created_at.desc&limit=1") as AiQuoteRow[];
  return rows[0]?quoteFrom(rows[0]):null;
}

async function ownedOrder(chatId:string,code:string):Promise<OrderRow|null>{
  if(!UUID.test(chatId)||!CODE.test(code))return null;
  const links=await staffDb("extra_messenger_ai_orders?chat_id=eq."+chatId+"&order_code=eq."+code+"&select=order_code,chat_id&limit=1") as {order_code:string;chat_id:string}[];
  if(!links.some(link=>link.chat_id===chatId&&link.order_code===code))return null;
  const rows=await staffDb("extra_payment_orders?code=eq."+code+"&select=id,code,show_id,venue_id,seats,status,amount_vnd,expires_at,paid_at,email_status,sale_staff_id&limit=1") as OrderRow[];
  return rows[0]?.code===code?rows[0]:null;
}
export async function getAiOrderStatus(chatId:string,code:string):Promise<AiSalesOrder|null>{
  const order=await ownedOrder(chatId,code);if(!order)return null;
  if(!safeAmount(order.amount_vnd)||!Array.isArray(order.seats)||!["pending","paid","expired","review"].includes(order.status))throw new AiCheckoutError("ORDER_UNAVAILABLE","Chưa xác minh được đơn vé.");
  const status=order.status==="pending"&&Date.parse(order.expires_at)<=Date.now()?"expired":order.status as AiSalesOrder["status"];
  const result:AiSalesOrder={code:order.code,status,showId:order.show_id,venueId:order.venue_id,seats:order.seats,amount:order.amount_vnd,expiresAt:order.expires_at,paidAt:order.paid_at,emailStatus:ticketEmailStatus(order.email_status)};
  if(status==="pending"){
    const config=bankConfig();
    result.payment={...config,qr:"https://img.vietqr.io/image/"+encodeURIComponent(config.bank)+"-"+encodeURIComponent(config.account)+"-compact2.png?amount="+result.amount+"&addInfo="+encodeURIComponent(code)+"&accountName="+encodeURIComponent(config.holder)};
  }
  return result;
}
export async function reserveAiQuote(context:AiCheckoutContext,quoteId:string):Promise<AiSalesOrder>{
  contextValid(context);bankConfig();if(!UUID.test(quoteId))invalid();
  const result=await staffDb("rpc/extra_messenger_ai_reserve_quote",{method:"POST",body:JSON.stringify({p_job_id:context.jobId,p_lease_token:context.leaseToken,p_quote_id:quoteId})}) as {outcome:string;order_code:string};
  if(!["reserved","existing"].includes(result?.outcome)||!CODE.test(result.order_code||""))throw new AiCheckoutError("RESERVATION_FAILED","Chưa thể giữ ghế. Cần đọc lại báo giá và tin nhắn mới nhất.");
  const order=await getAiOrderStatus(context.chatId,result.order_code);
  if(!order)throw new AiCheckoutError("ORDER_UNAVAILABLE","Chưa đọc được đơn vừa giữ ghế; không tạo lại đơn khác.");
  return order;
}

/** Read-only paid capability. Never marks paid, issues tickets, or mutates Sale attribution. */
export async function getAiPaidTicketDelivery(chatId:string,code:string,address:"anh"|"chị"|"mình"="mình"):Promise<{code:string;url:string;message:string;emailStatus?:"queued"|"sending"|"sent"}|null>{
  const order=await ownedOrder(chatId,code);if(!order||order.status!=="paid")return null;
  const tickets=await readAll<SaleIssuedTicket>("extra_tickets?order_id=eq."+order.id+"&order_code=eq."+code+"&select=order_id,order_code,show_id,venue_id,seat_id,issued_at&order=seat_id.asc");
  if(!hasCompleteIssuedTickets(order,tickets))return null;
  // Re-read both ownership and payment before obtaining the private capability.
  const current=await ownedOrder(chatId,code);
  if(!current||current.status!=="paid"||!hasCompleteIssuedTickets(current,tickets))return null;
  const tokens=await staffDb("extra_payment_orders?code=eq."+code+"&status=eq.paid&select=access_token&limit=1") as {access_token:string}[];
  const token=tokens[0]?.access_token;if(typeof token!=="string"||!/^[a-f0-9]{48}$/.test(token))return null;
  const url=ticketLinkUrl(code,token),emailStatus=ticketEmailStatus(current.email_status);
  const message="EXTRA đã xác nhận thanh toán "+money(current.amount_vnd)+" cho đơn "+code+".\nGhế: "+current.seats.join(", ")+(".\n"+"Vé điện tử của "+address+": ")+url+("\nMỗi ghế có một mã QR riêng. "+(address.charAt(0).toUpperCase()+address.slice(1))+" "+"giữ kín liên kết vé"+" và mở mã QR khi đến check-in nhé.")+(emailStatus==="sent"?"\nVé cũng đã được gửi qua email đã đăng ký.":("\n"+(address.charAt(0).toUpperCase()+address.slice(1))+" "+"có thể mở vé"+" ngay từ liên kết trên."));
  return {code,url,message:message+"\n"+artistPhotoNotice,emailStatus};
}
export function renderAiQuoteMessage(quote:AiSalesQuote,address:"anh"|"chị"|"mình"="mình"):string{
  const promotion:Record<AiPromotion,string>={none:"",couple5:"Ưu đãi cặp đôi: giảm 5%.",buy5:"Mua 5 vé, tặng 1 vé.",buy10:"Mua 10 vé, tặng 2 vé.",buy20:"Mua 20 vé, tặng 3 vé."};
  return [
    ("Em gửi "+address+" thông tin đặt vé để xác nhận:"),
    quote.artist+" · "+dateLabel(quote.date)+" · "+quote.time,
    quote.venueName+" — "+quote.venueAddress,
    "Ghế mua: "+quote.seats.join(", "),
    quote.childSeats?.length?"Ghế vé trẻ em (70%): "+quote.childSeats.join(", "):"",
    quote.giftSeats.length?"Ghế tặng: "+quote.giftSeats.join(", "):"",
    promotion[quote.promotion],"Tổng thanh toán: "+money(quote.amount),
    "Người nhận: "+quote.name+" · "+quote.phone+"\nEmail nhận vé: "+quote.email,
    ("Nếu đúng thông tin, "+address+" trả lời “ĐỒNG Ý” để em giữ ghế trong 15 phút và gửi mã thanh toán nhé. Ghế chỉ được giữ sau khi "+address+" xác nhận; báo giá này có hiệu lực đến ")+timeLabel(quote.expiresAt)+".",
  ].filter(Boolean).join("\n");
}
export function renderAiPaymentMessage(order:AiSalesOrder,address:"anh"|"chị"|"mình"="mình"):string{
  if(order.status!=="pending"||!order.payment)throw new AiCheckoutError("NOT_PENDING","Đơn không còn trong thời gian chờ thanh toán.");
  return "Em đã giữ ghế "+order.seats.join(", ")+(" cho "+address+" đến ")+timeLabel(order.expiresAt)+".\nMã đơn: "+order.code+"\nSố tiền: "+money(order.amount)+"\nNgân hàng: "+order.payment.bank+"\nSố tài khoản: "+order.payment.account+"\nChủ tài khoản: "+order.payment.holder+"\nNội dung chuyển khoản: "+order.code+("\nMã QR dự phòng (nếu ảnh không hiển thị): ")+order.payment.qr+("\n"+(address.charAt(0).toUpperCase()+address.slice(1))+" chuyển đúng số tiền và nội dung giúp em nhé. Khi hệ thống xác nhận nhận tiền, EXTRA sẽ tự gửi vé điện tử tại đây và qua email; "+address+" không cần gửi ảnh chuyển khoản.");
}

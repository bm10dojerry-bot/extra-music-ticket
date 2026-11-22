import "server-only";
import {createHmac,timingSafeEqual} from "node:crypto";
import {paidOrder} from "./extra-ticketing";
const key=()=>process.env.ADMIN_MEDIA_SECRET||"";
export function ticketLinkToken(code:string,accessToken:string){
 if(!/^EX[0-9A-F]{16}$/.test(code)||!/^[a-f0-9]{48}$/.test(accessToken)||key().length<24)throw Error("Ticket link unavailable");
 const signature=createHmac("sha256",key()).update("extra-ticket-link-v1:"+code+":"+accessToken).digest("hex");
 return code+"."+signature;
}
export async function resolveTicketLink(ticket:string){
 if(!/^EX[0-9A-F]{16}\.[a-f0-9]{64}$/.test(ticket)||key().length<24)return null;
 const [code,signature]=ticket.split(".");
 const order=await paidOrder(code);
 if(!order||order.status!=="paid")return null;
 const expected=ticketLinkToken(code,order.access_token).split(".")[1];
 if(!timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(expected,"hex")))return null;
 return order;
}
export function ticketLinkUrl(code:string,accessToken:string){return "https://iextra.net/ve?ticket="+encodeURIComponent(ticketLinkToken(code,accessToken))}

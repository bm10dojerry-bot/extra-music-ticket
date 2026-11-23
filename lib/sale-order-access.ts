import type {Staff} from "./staff-auth";

export type SaleOwnedOrder = {sale_staff_id:string|null};
export type SaleTicketOrder = SaleOwnedOrder&{
  id:string;code:string;show_id:string;venue_id:string;seats:string[];status:string;
};
export type SaleIssuedTicket = {
  order_id:string;order_code:string;show_id:string;venue_id:string;seat_id:string;issued_at:string;
};
export type SaleTicketEmailStatus = "queued"|"sending"|"sent";

/** An explicit online Sale ID is the authority. Names and legacy rows never
 * grant access to an unassigned order or override another Sale's assignment. */
export function canReadSaleOrder(actor:Pick<Staff,"id"|"role"|"active">,order:SaleOwnedOrder):boolean {
  return actor.active&&(actor.role==="admin"||
    (actor.role==="sale"&&typeof order.sale_staff_id==="string"&&order.sale_staff_id===actor.id));
}

/** Payment may be confirmed before issuance finishes. Count and exact seat
 * identity must agree; this check neither issues tickets nor reads QR secrets. */
export function hasCompleteIssuedTickets(order:SaleTicketOrder,tickets:SaleIssuedTicket[]):boolean {
  if(![order.id,order.code,order.show_id,order.venue_id].every(value=>typeof value==="string"&&value.length>0))return false;
  if(!Array.isArray(order.seats)||order.seats.length===0||order.seats.some(seat=>typeof seat!=="string"||!seat))return false;
  const expected=new Set(order.seats);
  if(expected.size!==order.seats.length||tickets.length!==expected.size)return false;
  const seen=new Set<string>();
  for(const ticket of tickets){
    if(ticket.order_id!==order.id||ticket.order_code!==order.code||ticket.show_id!==order.show_id||
      ticket.venue_id!==order.venue_id||!expected.has(ticket.seat_id)||seen.has(ticket.seat_id)||
      typeof ticket.issued_at!=="string"||!Number.isFinite(Date.parse(ticket.issued_at)))return false;
    seen.add(ticket.seat_id);
  }
  return seen.size===expected.size;
}

/** "sent" reflects the existing provider-accepted state, not inbox delivery. */
export function ticketEmailStatus(value:unknown):SaleTicketEmailStatus|undefined {
  return value==="queued"||value==="sending"||value==="sent"?value:undefined;
}

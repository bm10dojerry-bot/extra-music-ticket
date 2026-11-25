/** The image supplies only hints. OwnedOrder must come from the existing trusted order lookup. */
type Reading={kind:string;amount:number|null;reference:string|null};
type OwnedOrder={code:string;amount:number;status:string};
export function decideImageReceipt(reading:Reading|null,owned:OwnedOrder|null):"unreadable"|"other"|"check_order"|"mismatch"|"pending"|"paid"|"review"{
 if(!reading||reading.kind==="unreadable")return "unreadable";
 if(reading.kind!=="transfer_receipt")return "other";
 if(!owned)return "check_order";
 if(!Number.isSafeInteger(reading.amount)||reading.amount!==owned.amount||
    !reading.reference||reading.reference.trim().toUpperCase()!==owned.code.toUpperCase())return "mismatch";
 if(owned.status==="paid")return "paid";
 if(owned.status==="pending")return "pending";
 return "review";
}

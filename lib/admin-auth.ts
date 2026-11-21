import {timingSafeEqual} from "node:crypto";
export function isAdminSecret(supplied:string|null){
 const expected=process.env.ADMIN_MEDIA_SECRET;
 if(!expected||expected.length<24||!supplied)return false;
 const a=Buffer.from(supplied),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}

"use client";
import {usePathname} from "next/navigation";
import SupportChat from "./support-chat";
export default function MessengerSupport(){
 const pathname=usePathname();
 if(pathname!=="/"&&pathname!=="/ve")return null;
 return <SupportChat mode="floating" label="Chat tư vấn EXTRA"/>;
}

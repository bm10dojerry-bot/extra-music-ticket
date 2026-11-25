import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {loadShows} from "../../../lib/show-data";
import ShowLanding from "./show-landing";
type Props={params:Promise<{id:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {id}=await params;const show=(await loadShows()).find(s=>s.id===id);
 if(!show)return {title:"Show không tồn tại | +1 EXTRA"};
 const showName=show.title.toLowerCase().includes(show.artist.toLowerCase())?show.title:show.artist+" – "+show.title;
 const title=showName+" | Đặt vé +1 EXTRA";
 const date=show.date.split("-").reverse().join("/");
 const venue=show.venue==="moana"?"Moana Sa Pa":show.venue==="ccc"?"Không gian Văn hóa Sa Pa – CCC":"Lào Cai";
 const description=showName+" ngày "+date+" tại "+venue+". Xem sơ đồ ghế, giá vé, chọn chỗ và nhận vé điện tử QR trực tiếp từ +1 EXTRA MUSIC SHOW.";
 return {title,description,alternates:{canonical:"https://iextra.net/show/"+encodeURIComponent(id)},openGraph:{title,description,url:"https://iextra.net/show/"+encodeURIComponent(id),images:show.posterUrl?[{url:new URL(show.posterUrl,"https://iextra.net").href}]:undefined}};
}
export default async function Page({params}:Props){
 const {id}=await params;const show=(await loadShows()).find(s=>s.id===id);
 if(!show||["ended","hidden"].includes(show.status))notFound();
 return <ShowLanding show={show}/>;
}

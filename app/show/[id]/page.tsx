import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {loadShows} from "../../../lib/show-data";
import ShowLanding from "./show-landing";
type Props={params:Promise<{id:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {id}=await params;const show=(await loadShows()).find(s=>s.id===id);
 if(!show)return {title:"Show không tồn tại | +1 EXTRA"};
 const title=show.artist+" – "+show.title+" | Đặt vé +1 EXTRA";
 const description="Đêm nhạc "+show.artist+" ngày "+show.date+". Xem bài hát dự kiến biểu diễn, chọn ghế và thanh toán trực tiếp tại +1 EXTRA MUSIC SHOW.";
 return {title,description,alternates:{canonical:"https://iextra.net/show/"+encodeURIComponent(id)},openGraph:{title,description,url:"https://iextra.net/show/"+encodeURIComponent(id),images:show.posterUrl?[{url:show.posterUrl}]:undefined}};
}
export default async function Page({params}:Props){
 const {id}=await params;const show=(await loadShows()).find(s=>s.id===id);
 if(!show||["ended","hidden"].includes(show.status))notFound();
 return <ShowLanding show={show}/>;
}

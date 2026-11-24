import {openingMessage,applicablePromotions,promotionMessage,seatViewQuestion,textSalesFlow} from "../lib/extra-sale-text-script";
function assert(v:boolean,m:string){if(!v)throw Error(m)}
const first=openingMessage({displayName:"Minh",localHour:20,greeted:false,aiDisclosed:false,showName:"Khắc Việt",showDate:"26/12"});
assert(!!first?.includes("buổi tối"),"time-aware greeting");
assert(!!first?.includes("công nghệ AI"),"AI disclosure");
assert(!!first?.includes("Khắc Việt"),"known show");
assert(openingMessage({localHour:20,greeted:true,aiDisclosed:true})===null,"greet only once");
const neutral=openingMessage({displayName:"A",localHour:9,greeted:false,aiDisclosed:false});
assert(!!neutral?.includes("anh/chị"),"do not guess gender from name");
assert(seatViewQuestion.includes("chính diện"),"view preference");
const promos=[{title:"Ưu đãi hợp lệ",active:true,showId:"show-a",terms:"Điều kiện rõ ràng"},{title:"Hết hạn",active:false,showId:"show-a",terms:"Không áp dụng"},{title:"Sai show",active:true,showId:"show-b",terms:"Không áp dụng"}];
assert(applicablePromotions(promos,"show-a").length===1,"only verified matching promotions");
assert(!promotionMessage([], "show-a").includes("ưu đãi:"),"no fabricated promotion");
assert(textSalesFlow[0]==="greet_and_disclose_ai_once","text-first flow");

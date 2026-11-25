import {tierName} from "./poster-offers";
/** Read-only fast path for clearly identified simple sales inquiries.
 * The caller retains the existing conversation, send, payment, and order guards.
 */
type QuickMessage={id:number;sender:string;body:string};
type QuickShow={id:string;artist:string;title:string;date:string;time:string;venueName:string;venueAddress:string;prices:Record<string,number|null>};
type Intent="price"|"time"|"venue";
const norm=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[đĐ]/g,"d").toLowerCase().replace(/[^a-z0-9 ]+/g," ").trim().replace(/\s+/g," ");
function clean(v:string){
 let s=norm(v);
 for(let i=0;i<3;i++) s=s.replace(/^(?:da |em oi |alo |chao em |cho (?:anh|chi|minh|toi|em|toi) (?:xin|hoi|biet|xem) |(?:anh|chi|minh|toi) (?:muon|xin|hoi) |xin |hoi |em cho (?:anh|chi|minh|toi) (?:xin|hoi) )/,"").replace(/ (?:em oi|em nhe|em nha|em a|nha em|nhe em|em|a|nha|nhe|nhi|voi|giup anh|giup chi|giup minh)$/,"").trim();
 return s;
}
function intent(s:string):Intent|null{
 if(/^(?:gia(?: ve)?(?: bao nhieu(?: tien)?| the nao| nhu the nao| la bao nhieu(?: tien)?)?|ve(?: gia)? bao nhieu(?: tien)?|bao nhieu tien(?: mot ve)?|bao nhieu(?: tien)?(?: 1 ve| mot ve)?|xin gia(?: ve)?|cho xin gia(?: ve)?|gia tien ve)$/.test(s))return "price";
 if(/^(?:may gio(?: dien| bat dau)?|gio nao(?: dien| bat dau)?|(?:show |dem nhac )?(?:dien|bat dau) (?:luc )?may gio|gio dien|thoi gian dien|khi nao dien|ngay nao(?: dien)?|dien ngay nao|lich dien|ngay gio dien|hom nao(?: dien)?|dien hom nao|bao gio dien|bao gio)$/.test(s))return "time";
 if(/^(?:o dau|dien o dau|to chuc o dau|dia diem|dia chi|dia diem to chuc|show o dau|san khau o dau|dien tai dau|to chuc tai dau)$/.test(s))return "venue";
 return null;
}
function aliases(s:QuickShow){return [...new Set([s.artist,...s.artist.split(/\s*(?:[&+;,/]|\bvà\b)\s*/iu)].map(norm).filter(a=>a.length>=4&&a.includes(" ")))].sort((a,b)=>b.length-a.length);}
function match(s:string,shows:QuickShow[]){return shows.map(show=>({show,alias:aliases(show).find(a=>(" "+s+" ").includes(" "+a+" "))})).filter((x):x is {show:QuickShow;alias:string}=>Boolean(x.alias));}
function residual(s:string,a:string){return (" "+s+" ").replace(" "+a+" "," ").trim().replace(/\b(?:dem nhac|chuong trinh|nghe si|ca si|show|cua)\b/g," ").trim().replace(/\s+/g," ");}
function pronoun(c:QuickMessage[]){for(const m of [...c].reverse()){let s=norm(m.body);if(/\b(?:cho chi|chi xin|chi hoi|chi muon|chi di|chi co)\b/.test(s))return "chị";if(/\b(?:cho anh|anh xin|anh hoi|anh muon|anh di|anh co)\b/.test(s))return "anh";}return "anh/chị";}
function knownParty(c:QuickMessage[]){return c.some(m=>/\b(?:[1-9][0-9]?|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi)\s+(?:nguoi|ban|khach)\b|\b(?:hai vo chong|vo chong minh|vo chong anh|vo chong chi)\b/.test(norm(m.body)));}
const cap=(s:string)=>s.charAt(0).toUpperCase()+s.slice(1);
function future(s:QuickShow,now:number){return /^\d{4}-\d{2}-\d{2}$/.test(s.date)&&/^\d{2}:\d{2}(?::\d{2})?$/.test(s.time)&&Date.parse(s.date+"T"+s.time+"+07:00")>now;}
function render(i:Intent,show:QuickShow,customer:QuickMessage[],p:string){
 const date=show.date.slice(8,10)+"/"+show.date.slice(5,7),time=show.time.slice(0,5).replace(":","h");
 if(i==="price"){
  const zones=["A","B","C","D"];
  if(Object.keys(show.prices).some(z=>!zones.includes(z)))return null;
  const prices=zones.filter(z=>typeof show.prices[z]==="number"&&Number.isFinite(show.prices[z])&&Number(show.prices[z])>0);
  if(!prices.length||zones.some(z=>show.prices[z]!=null&&(!Number.isFinite(show.prices[z])||Number(show.prices[z])<=0)))return null;
  const lines=prices.map(z=>tierName(show.id,z)+": "+Number(show.prices[z]).toLocaleString("vi-VN")+"đ").join("\n");
  return "Dạ "+p+", giá vé mỗi người đêm "+show.artist+" ngày "+date+" là:\n"+lines+(knownParty(customer)?"":"\n\n"+cap(p)+" dự định đi mấy người để em tư vấn chỗ ngồi phù hợp cho mình ạ?");
 }
 if(i==="time")return "Dạ "+p+", đêm nhạc "+show.artist+" diễn ra ngày "+date+"/"+show.date.slice(0,4)+", lúc "+time+" ạ.";
 if(!show.venueName?.trim()||!show.venueAddress?.trim())return null;
 return "Dạ "+p+", đêm nhạc "+show.artist+" diễn tại "+show.venueName+", "+show.venueAddress+" ạ.";
}
export async function quickSalesReply(messages:QuickMessage[],hasCommentContext:boolean,loadShows:()=>Promise<QuickShow[]>,now=Date.now()):Promise<string|null>{
 if (extraNeedsPromotionConsultation(messages)) return null;

 const customer=messages.filter(m=>m.sender==="customer"),latest=customer.at(-1);
 if(!latest||latest.body.length>120)return null;
 const s=clean(latest.body),previous=customer.at(-2),previousText=previous?clean(previous.body):"",generic=intent(s),prior=intent(previousText),p=pronoun(customer);
 if(!s||/\b(?:chuyen khoan|thanh toan|hoan tien|huy|khong mua|khong can|khong di|dat ve|giu ghe|giu cho|ma don|qr|khieu nai|da mua|da dat|da thanh toan|chi tra gia|chi hoi gia)\b/.test(s))return null;
 const onlyGreeting=(v:string)=>/^(?:chao|chao em|alo|hello|hi|em oi|da)$/.test(norm(v));
 if(generic&&!hasCommentContext&&customer.slice(0,-1).every(m=>onlyGreeting(m.body)))return "Dạ "+p+" muốn xem "+(generic==="price"?"giá vé":generic==="time"?"lịch diễn":"địa điểm")+" đêm nhạc của ca sĩ nào ạ?";
 if(!generic&&!prior&&!/\b(?:gia|ve|gio|dien|ngay|lich|dia diem|dia chi|o dau|tai dau|bao gio)\b/.test(s))return null;
 const shows=(await loadShows()).filter(show=>future(show,now));
 const matches=match(s,shows);
 if(matches.length>1)return null;
 if(matches.length===1){
  const {show,alias}=matches[0],rest=residual(s,alias),direct=intent(rest);
  if(direct)return render(direct,show,customer,p);
  if(!rest&&prior)return render(prior,show,customer,p);
  return null;
 }
 if(generic&&!hasCommentContext&&previous){
  const old=match(previousText,shows);
  if(old.length===1){const {show,alias}=old[0],rest=residual(previousText,alias);if(!rest||intent(rest))return render(generic,show,customer,p);}
 }
 return null;
}

// Route promotion contexts to the existing trusted quote and seating tools.
function extraNeedsPromotionConsultation(messages: readonly {sender:string;body:string}[]):boolean{
 return messages.filter(m=>m.sender==="customer").slice(-12).some(m=>{
  const s=m.body.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[đĐ]/g,"d").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
  return /\b(khuyen mai|uu dai|giam gia|giam them|voucher|tang ve|tang them|mien phi|combo|gia nhom|gia doi|cap doi|hai vo chong|vo chong|mua \d+ tang \d+)\b/.test(s)
    || /\b(?:[2-9]|[12][0-9]|hai|ba|bon|tu|nam|sau|bay|tam|chin|muoi|muoi [a-z]+|hai muoi(?: [a-z]+)?)\s+(?:nguoi|ve|ghe|cho|khach)\b/.test(s)
    || /\b(?:di|dat|mua|lay)\s+(?:[2-9]|[12][0-9]|hai|ba|bon|nam|sau|bay|tam|chin|muoi)\s*$/.test(s);
 });
}

import type {VenueId} from "./venues";
export type Show={id:string;artist:string;date:string;time:string;venue:VenueId;title:string;status:"announced"|"pending"|"sold_out"|"live"|"ended"};
export const shows:Show[]=[
{id:"dinh-dung-2811",artist:"Đình Dũng",date:"2026-11-28",time:"19:30",venue:"moana",title:"Đình Dũng – Chuyện tình giữa Sa Pa",status:"announced"},
{id:"minh-vuong-0512",artist:"Minh Vương & SOLPA",date:"2026-12-05",time:"19:30",venue:"ccc",title:"Minh Vương & các thành viên SOLPA",status:"announced"},
{id:"trinh-dinh-quang-1212",artist:"Trịnh Đình Quang",date:"2026-12-12",time:"19:30",venue:"ccc",title:"Đêm nhạc Trịnh Đình Quang",status:"announced"},
{id:"khanh-phuong-1912",artist:"Khánh Phương",date:"2026-12-19",time:"19:30",venue:"ccc",title:"Đêm nhạc Khánh Phương",status:"announced"},
{id:"ho-quang-hieu-2412",artist:"Hồ Quang Hiếu",date:"2026-12-24",time:"19:30",venue:"laocai",title:"Đêm Noel cùng Hồ Quang Hiếu",status:"pending"},
{id:"thai-hoc-3112",artist:"Thái Học",date:"2026-12-31",time:"19:45",venue:"laocai",title:"Chào năm mới 2027 cùng Thái Học",status:"announced"}
];
export const formatShowDate=(date:string)=>new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"UTC"}).format(new Date(date+"T00:00:00Z"));

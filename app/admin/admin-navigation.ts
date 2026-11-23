import type {Role} from "../../lib/staff-auth";

export type AdminSection =
 | "overview" | "shows" | "artists" | "stages" | "venues" | "landingpage-ads"
 | "tickets" | "staff-sales" | "live-monitor" | "support-chats" | "seats" | "checkin"
 | "financials" | "show-costs" | "sale-performance" | "sale-commission"
 | "staff-users" | "staff-reports" | "staff-overview" | "gioi-thieu" | "tuyen-dung" | "lien-he";
export type AdminIcon = "home" | "activity" | "calendar" | "music" | "location" | "image"
 | "ticket" | "users" | "chat" | "seats" | "checkin" | "chart" | "percent" | "wallet" | "pie" | "file" | "briefcase" | "phone";
export type AdminNavItem = {
 id: AdminSection;
 label: string;
 title: string;
 description: string;
 group: string;
 icon: AdminIcon;
 adminOnly?: boolean;
};

export const adminGroups = ["Điều hành", "Vé & khách hàng", "Show & nội dung", "Kinh doanh & nhân sự", "Tài chính", "Thông tin website"] as const;
export const adminSections: readonly AdminNavItem[] = [
 {id:"overview",label:"Home",title:"Tổng quan",description:"Doanh thu, tình hình bán vé và truy cập website.",group:"Điều hành",icon:"home"},
 {id:"live-monitor",label:"Giám sát trực tuyến",title:"Giám sát trực tuyến",description:"Theo dõi khách truy cập và hoạt động tư vấn.",group:"Điều hành",icon:"activity"},
 {id:"tickets",label:"Vé QR & đối soát",title:"Vé QR & đối soát",description:"Tra cứu vé đã thanh toán, đối soát SePay và kiểm tra email vé.",group:"Vé & khách hàng",icon:"ticket"},
 {id:"staff-sales",label:"Đơn vé & khách hàng",title:"Đơn đặt vé & khách hàng",description:"Theo dõi đơn vé, khách hàng và nhân viên phụ trách.",group:"Vé & khách hàng",icon:"users"},
 {id:"support-chats",label:"Chăm sóc khách hàng",title:"Hộp thư tư vấn",description:"Tiếp nhận và trả lời các cuộc trò chuyện của khách hàng.",group:"Vé & khách hàng",icon:"chat"},
 {id:"seats",label:"Sơ đồ ghế & sức chứa",title:"Sơ đồ ghế & sức chứa",description:"Quản lý hàng ghế, sức chứa và tình trạng chỗ ngồi.",group:"Vé & khách hàng",icon:"seats"},
 {id:"checkin",label:"Báo cáo check-in",title:"Báo cáo check-in",description:"Theo dõi số vé đã vào cửa theo từng chương trình.",group:"Vé & khách hàng",icon:"checkin"},
 {id:"shows",label:"Lịch show",title:"Quản lý lịch show",description:"Cập nhật lịch diễn, giá vé và poster của từng chương trình.",group:"Show & nội dung",icon:"calendar"},
 {id:"artists",label:"Ca sĩ / Nghệ sĩ",title:"Ca sĩ / Nghệ sĩ",description:"Quản lý ảnh chân dung và tiểu sử nghệ sĩ.",group:"Show & nội dung",icon:"music"},
 {id:"stages",label:"Địa điểm / Sân khấu",title:"Địa điểm / Sân khấu",description:"Quản lý địa điểm tổ chức, sức chứa và giới thiệu không gian.",group:"Show & nội dung",icon:"location"},
 {id:"venues",label:"Hình ảnh & banner",title:"Hình ảnh & banner",description:"Cập nhật ảnh ca sĩ, sân khấu và banner trên website.",group:"Show & nội dung",icon:"image"},
 {id:"landingpage-ads",label:"Landingpage ADS",title:"Landingpage ADS",description:"Quản lý trang quảng cáo và nội dung giới thiệu từng show.",group:"Show & nội dung",icon:"file"},
 {id:"sale-performance",label:"Hiệu suất Sale",title:"Thống kê hiệu suất Sale",description:"Theo dõi doanh số, vé đã thanh toán và hiệu quả từng nhân viên.",group:"Kinh doanh & nhân sự",icon:"chart",adminOnly:true},
 {id:"sale-commission",label:"Hoa hồng theo show",title:"Hoa hồng theo show",description:"Cấu hình các bậc hoa hồng riêng cho từng chương trình.",group:"Kinh doanh & nhân sự",icon:"percent",adminOnly:true},
 {id:"staff-reports",label:"Báo cáo kinh doanh",title:"Báo cáo kinh doanh",description:"Tra cứu kết quả bán vé và doanh thu theo kỳ.",group:"Kinh doanh & nhân sự",icon:"chart"},
 {id:"staff-users",label:"Nhân viên & phân quyền",title:"Nhân viên & phân quyền",description:"Quản lý tài khoản và quyền sử dụng của đội ngũ.",group:"Kinh doanh & nhân sự",icon:"users"},
 {id:"staff-overview",label:"Trung tâm nhân sự",title:"Trung tâm nhân sự",description:"Tổng hợp hoạt động của đội ngũ kinh doanh.",group:"Kinh doanh & nhân sự",icon:"briefcase"},
 {id:"show-costs",label:"Chi phí tổ chức show",title:"Chi phí tổ chức show",description:"Nhập và đối soát các khoản chi của từng đêm diễn.",group:"Tài chính",icon:"wallet"},
 {id:"financials",label:"Tỷ trọng doanh thu",title:"Tỷ trọng doanh thu",description:"Theo dõi cơ cấu doanh thu và chi phí theo chương trình.",group:"Tài chính",icon:"pie"},
 {id:"gioi-thieu",label:"Giới thiệu",title:"Giới thiệu",description:"Cập nhật nội dung giới thiệu trên website.",group:"Thông tin website",icon:"file"},
 {id:"tuyen-dung",label:"Tuyển dụng",title:"Tuyển dụng",description:"Quản lý thông tin tuyển dụng của Extra.",group:"Thông tin website",icon:"briefcase"},
 {id:"lien-he",label:"Liên hệ",title:"Liên hệ",description:"Cập nhật thông tin liên hệ công khai.",group:"Thông tin website",icon:"phone"},
];

export function availableAdminSections(role:Role) {
 return adminSections.filter(item=>!item.adminOnly||role==="admin");
}
export function resolveAdminSection(value:unknown,role:Role):AdminSection {
 return availableAdminSections(role).find(item=>item.id===value)?.id||"overview";
}
export function adminSectionDetails(id:AdminSection) {
 return adminSections.find(item=>item.id===id)||adminSections[0];
}
const searchText=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[đĐ]/g,"d").toLocaleLowerCase("vi").trim();
export function matchesAdminSection(item:AdminNavItem,query:string) {
 const text=searchText([item.label,item.title,item.description,item.group].join(" "));
 return searchText(query).split(/\s+/).every(word=>text.includes(word));
}

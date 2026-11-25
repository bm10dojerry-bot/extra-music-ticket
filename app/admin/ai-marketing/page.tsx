import {getActor} from "../../../lib/staff-auth";
import Link from "next/link";
export const dynamic="force-dynamic";
const agents=[
["Director","Điều phối mục tiêu và ngân sách"],["Research","Nghiên cứu thị trường"],["Planner","Lập kế hoạch theo show"],["Content","Soạn nội dung"],["Creative","Chuẩn bị brief hình ảnh và video"],["Social","Lịch xuất bản"],["Ads","Phân tích và đề xuất quảng cáo"],["Sale","Kết nối quy trình bán vé hiện có"],["CRM","Chăm sóc khách hàng"],["Analyst","Đối chiếu doanh thu"],["Auditor","Kiểm tra dữ liệu và quyền hạn"]
];
export default async function MarketingCenter(){
 const actor=await getActor();
 if(!actor||actor.role!=="admin")return <main><p>Yêu cầu quyền quản trị.</p><Link href="/admin">Về Admin</Link></main>;
 return <main style={{maxWidth:1100,margin:"auto",padding:24,fontFamily:"system-ui"}}>
 <Link href="/admin">← Admin</Link><h1>+1 EXTRA AI MARKETING</h1>
 <p>Phiên bản nền tảng · Chưa kết nối bộ thực thi AI · Không phát sinh chi phí quảng cáo</p>
 <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12}}>
 {agents.map(([name,job])=><article key={name} style={{border:"1px solid #aaa",borderRadius:12,padding:16}}><h2>AI {name}</h2><p>{job}</p><p>Trạng thái: Chưa kích hoạt</p></article>)}
 </section><h2>Quy tắc vận hành</h2><p>Chỉ sử dụng dữ liệu đã xác minh. Không tự thay đổi giá vé, lịch diễn hoặc chi ngân sách khi chưa có hạn mức được cấu hình. Không thay thế luồng Sale hiện tại.</p>
 </main>
}

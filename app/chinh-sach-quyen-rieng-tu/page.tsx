import type {Metadata} from "next";
export const metadata:Metadata={title:"Chính sách quyền riêng tư | +1 Extra Music Show",description:"Cách +1 Extra Music Show thu thập, sử dụng, bảo vệ và xử lý yêu cầu về dữ liệu cá nhân khi đặt chỗ và trò chuyện hỗ trợ."};
const sections=[
 ["1. Phạm vi và đơn vị vận hành","Chính sách này áp dụng cho website iextra.net và các tính năng đặt chỗ, nhận vé QR, tư vấn trực tuyến và tích hợp Messenger do +1 Extra Music Show vận hành. Khi dùng một dịch vụ của bên thứ ba (chẳng hạn Facebook hoặc ngân hàng), khách hàng cũng cần tham khảo chính sách của bên đó."],
 ["2. Thông tin chúng tôi xử lý","Tùy thao tác của khách, thông tin có thể bao gồm họ tên, số điện thoại, email, chương trình và vị trí chỗ được chọn, mã đơn và trạng thái thanh toán, nội dung trao đổi với nhân viên Sale, thời gian tương tác và dữ liệu kỹ thuật cần thiết cho hoạt động an toàn. Khi khách liên hệ qua Facebook Messenger, chúng tôi xử lý nội dung tin và mã định danh do Meta cấp cho cuộc trò chuyện. Chúng tôi không tự động đồng nhất người chat trên website với tài khoản Facebook nếu chưa có căn cứ kết nối phù hợp."],
 ["3. Mục đích xử lý","Chúng tôi dùng dữ liệu để tiếp nhận và xác nhận yêu cầu đặt chỗ, xử lý giao dịch, gửi vé hoặc mã QR, hỗ trợ khách hàng, phân công cuộc trò chuyện cho nhân viên, giải quyết sự cố, phòng chống lạm dụng và thực hiện nghĩa vụ pháp luật. Dữ liệu đo lường quảng cáo hoặc tiếp thị chỉ được sử dụng theo các lựa chọn đồng ý và cơ chế phù hợp được hiển thị cho khách hàng trên trang có sử dụng công cụ đó."],
 ["4. Đối tác xử lý và chia sẻ","Để cung cấp dịch vụ, thông tin cần thiết có thể được xử lý thông qua các nhà cung cấp hạ tầng website, cơ sở dữ liệu, thanh toán, gửi email và nền tảng nhắn tin như Meta/Facebook Messenger. Việc chia sẻ được giới hạn theo mục đích dịch vụ và yêu cầu pháp luật. Nội dung chat chỉ được nhân viên và người quản trị được phân quyền truy cập phục vụ việc hỗ trợ."],
 ["5. Cookie và công nghệ đo lường","Website có thể sử dụng cookie, lưu trữ phiên và những công nghệ tương tự để duy trì chức năng, chống lạm dụng và ghi nhớ phiên chat. Một số landing page có lựa chọn đồng ý hoặc từ chối công cụ đo lường quảng cáo của Meta và Google. Khách có thể thay đổi cài đặt trình duyệt và lựa chọn đồng ý khi giao diện cung cấp tính năng đó."],
 ["6. Bảo mật và thời gian lưu trữ","Chúng tôi thực hiện các biện pháp kỹ thuật và phân quyền nhằm hạn chế truy cập trái phép. Dữ liệu được lưu trong thời gian cần thiết để hoàn thành dịch vụ, bảo đảm đối soát, hỗ trợ khách hàng và đáp ứng nghĩa vụ pháp luật; sau đó được xóa hoặc ẩn danh khi phù hợp. Không có hệ thống truyền tải dữ liệu nào bảo đảm an toàn tuyệt đối."],
 ["7. Quyền của khách hàng","Khách hàng có thể đề nghị được cung cấp thông tin về dữ liệu của mình, yêu cầu chỉnh sửa, hạn chế xử lý hoặc xóa dữ liệu khi được pháp luật cho phép. Một số thông tin của đơn đã thanh toán có thể cần lưu để thực hiện nghĩa vụ kế toán hoặc pháp lý. Khi tiếp nhận yêu cầu, chúng tôi có thể xác minh người yêu cầu nhằm tránh tiết lộ thông tin cho người khác."],
 ["8. Liên hệ và yêu cầu xóa dữ liệu","Vui lòng liên hệ +1 Extra Music Show qua số 094 865 02 59 hoặc trang Liên hệ trên iextra.net. Hướng dẫn gửi yêu cầu xóa dữ liệu được công khai tại /xoa-du-lieu. Không gửi mật khẩu, mã OTP hoặc dữ liệu ngân hàng nhạy cảm qua khung chat."],
 ["9. Thay đổi chính sách","Chính sách này có thể được cập nhật khi dịch vụ, đối tác kỹ thuật hoặc yêu cầu pháp lý thay đổi. Phiên bản hiện hành được công bố tại trang này."]
] as const;
export default function PrivacyPage(){return <main style={{background:"#0e0f14",color:"#f7f2f3",minHeight:"100vh",fontFamily:"Arial, sans-serif",padding:"32px 18px 72px"}}>
 <article style={{maxWidth:810,margin:"0 auto",lineHeight:1.82}}>
  <header style={{borderBottom:"1px solid #4d343e",paddingBottom:20,marginBottom:24}}>
   <a href="/" style={{color:"#ffb5c0",fontWeight:800,textDecoration:"none"}}>+1 EXTRA MUSIC SHOW</a>
   <h1 style={{fontSize:"clamp(28px,5vw,40px)",lineHeight:1.25,margin:"16px 0 8px"}}>Chính sách quyền riêng tư</h1>
   <p style={{color:"#c1b3b9",margin:0}}>Áp dụng từ ngày 23/11/2026 · Website: iextra.net</p>
  </header>
  <p>+1 Extra Music Show tôn trọng quyền riêng tư của khách hàng. Nội dung dưới đây mô tả việc sử dụng dữ liệu khi khách đặt chỗ, thanh toán và trao đổi với bộ phận tư vấn.</p>
  {sections.map(([heading,body])=><section key={heading} style={{margin:"26px 0"}}><h2 style={{fontSize:19,color:"#ffc2cb",marginBottom:8}}>{heading}</h2><p style={{margin:0,color:"#e0d7db"}}>{body}</p></section>)}
  <nav style={{display:"flex",gap:20,flexWrap:"wrap",paddingTop:22,borderTop:"1px solid #4d343e"}}>
   <a href="/xoa-du-lieu" style={{color:"#ffb5c0"}}>Hướng dẫn yêu cầu xóa dữ liệu</a>
   <a href="/lien-he" style={{color:"#ffb5c0"}}>Liên hệ</a>
   <a href="tel:0948650259" style={{color:"#ffb5c0"}}>094 865 02 59</a>
  </nav>
 </article>
 </main>}
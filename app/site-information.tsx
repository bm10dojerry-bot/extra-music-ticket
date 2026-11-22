"use client";

import {useEffect,useState} from "react";
import "./information-pages.css";

type PublicPage={title:string;body:string};
const names:Record<string,string>={"gioi-thieu":"Giới thiệu","tuyen-dung":"Tuyển dụng","lien-he":"Liên hệ"};
const defaults:Record<string,string>={
 "gioi-thieu":"+1 EXTRA MUSIC SHOW mang đến những đêm nhạc trực tiếp tại Sa Pa và Lào Cai, kết nối nghệ sĩ với khán giả trong không gian biểu diễn được tổ chức chuyên nghiệp.",
 "tuyen-dung":"Cùng +1 Extra Music Show tạo nên những đêm nhạc đáng nhớ. Chúng tôi đang tìm kiếm người đồng hành trong công tác quản lý và điều phối show âm nhạc.",
 "lien-he":"Bạn cần hỗ trợ đặt chỗ, nhận mã QR, tìm hiểu chương trình hoặc kết nối công việc? +1 Extra Music Show luôn sẵn sàng lắng nghe."
};
const contactPhone="0948650259";
const recruitmentPhone="0948650259";

function PageHeader({slug}:{slug:string}){
 return <header className="extra-info-nav">
  <a href="/" className="extra-info-brand" aria-label="+1 Extra Music Show - Trang chủ">+1 <span>EXTRA</span><small>MUSIC SHOW</small></a>
  <nav aria-label="Điều hướng trang thông tin" className="extra-info-nav-links">
   <a href="/show/dinh-dung-2811">Các đêm diễn</a>
   {Object.entries(names).map(([key,label])=><a key={key} href={"/"+key} aria-current={key===slug?"page":undefined} className={key===slug?"active":""}>{label}</a>)}
  </nav>
 </header>;
}

function Intro({slug,page}:{slug:string;page:PublicPage|null}){
 const isRecruitment=slug==="tuyen-dung",isContact=slug==="lien-he";
 return <section className="extra-info-hero" aria-labelledby="extra-page-title">
  <div className="extra-info-hero-copy">
   <div className="extra-info-eyebrow"><span className="extra-info-eyebrow-line"/> +1 EXTRA MUSIC SHOW / {isRecruitment?"CAREERS":isContact?"CONNECT":"ABOUT"}</div>
   <h1 id="extra-page-title">{page?.title||names[slug]||"Thông tin"}</h1>
   <p className="extra-info-lead">{page?.body||defaults[slug]||""}</p>
   <div className="extra-info-hero-actions">
    {isRecruitment?<><a className="extra-info-primary" href="#vi-tri">Xem vị trí đang tuyển <span aria-hidden="true">↗</span></a><a className="extra-info-secondary" href={"tel:"+recruitmentPhone}>Gọi ứng tuyển</a></>:
     isContact?<><a className="extra-info-primary" href={"tel:"+contactPhone}>Gọi hỗ trợ đặt chỗ <span aria-hidden="true">↗</span></a><a className="extra-info-secondary" href="#kenh-lien-he">Các kênh liên hệ</a></>:
     <a className="extra-info-primary" href="/">Khám phá +1 Extra <span aria-hidden="true">↗</span></a>}
   </div>
  </div>
  <div className="extra-info-hero-scene" aria-hidden="true">
   <div className="extra-info-stage-glow"/><div className="extra-info-stage-line"/>
   <span className="extra-info-scene-overline">THE SHOW GOES ON</span>
   <strong>+1<span> EXTRA</span></strong><span className="extra-info-scene-sub">MUSIC SHOW</span>
   <span className="extra-info-scene-note">{isRecruitment?"BEHIND EVERY GREAT SHOW":isContact?"LET'S STAY CONNECTED":"MUSIC · PEOPLE · EXPERIENCE"}</span>
  </div>
 </section>;
}


function AboutContent(){
 return <>
  <section className="extra-info-section extra-info-origin" id="hanh-trinh">
   <div className="extra-info-section-heading">
    <div><span className="extra-info-kicker">CÂU CHUYỆN THƯƠNG HIỆU</span><h2>Từ +1 EXTRA đến +1 EXTRA MUSIC SHOW</h2></div>
    <p>Hai chặng đường, cùng một tinh thần: tạo ra nơi mọi người có thể gặp gỡ, kết nối và tận hưởng những trải nghiệm đáng nhớ.</p>
   </div>
   <div className="extra-info-origin-grid">
    <article className="extra-info-origin-card">
     <span className="extra-info-origin-index">01 / KHỞI ĐẦU TẠI LÀO CAI</span>
     <h3>+1 EXTRA</h3><p className="extra-info-origin-subtitle">Một điểm hẹn sống động, mở ra nhiều trải nghiệm.</p>
     <p>+1 Extra bắt đầu với mô hình <strong>All-in-One 24H Zone</strong> tại Lào Cai: không gian kết hợp đồ uống, cửa hàng tiện ích và những hoạt động giải trí để bạn bè có thể gặp nhau, thư giãn và tận hưởng thời gian theo cách riêng.</p>
     <p>Từ trà, cà phê và các thức uống được chăm chút đến khu vui chơi, game, phim và không gian riêng, Extra hướng tới một điểm đến gần gũi, linh hoạt trong nhịp sống của thành phố.</p>
     <div className="extra-info-origin-tags"><span>Đồ uống & tiện ích</span><span>Không gian 24 giờ</span><span>Giải trí & kết nối</span></div>
    </article>
    <article className="extra-info-origin-card extra-info-origin-card-music">
     <span className="extra-info-origin-index">02 / TIẾP NỐI BẰNG ÂM NHẠC</span>
     <h3>+1 EXTRA <span>MUSIC SHOW</span></h3><p className="extra-info-origin-subtitle">Đưa những cuộc gặp gỡ đến gần sân khấu hơn.</p>
     <p>Từ mong muốn mang đến những trải nghiệm phong phú hơn, <strong>+1 Extra Music Show</strong> phát triển thành chuỗi đêm nhạc trực tiếp tại Sa Pa và Lào Cai, nơi khán giả có thể thưởng thức giọng hát của nghệ sĩ yêu thích trong không gian biểu diễn được chuẩn bị chỉn chu.</p>
     <p>Cùng với các chương trình âm nhạc là định hướng nâng cao trải nghiệm khán giả: khu vực ghế ngồi được tổ chức rõ ràng, quy trình đặt chỗ trực tuyến, xác nhận thanh toán và mã QR check-in.</p>
     <div className="extra-info-origin-tags"><span>Live music</span><span>Sa Pa & Lào Cai</span><span>Trải nghiệm khán giả</span></div>
    </article>
   </div>
  </section>
  <section className="extra-info-section extra-info-about-values">
   <div><span className="extra-info-kicker">TINH THẦN EXTRA</span><h2>Hơn một địa điểm, hơn một đêm nhạc</h2><p>Với Extra, giá trị của một trải nghiệm không chỉ nằm ở sản phẩm, sân khấu hay ánh đèn, mà còn ở cảm giác được đón tiếp, được chia sẻ và được lưu giữ những khoảnh khắc đẹp cùng nhau.</p><p>Chúng tôi tiếp tục phát triển các không gian dịch vụ, giải trí và âm nhạc theo hướng gần gũi, an toàn và chuyên nghiệp hơn, từng bước xây dựng một điểm hẹn văn hóa – trải nghiệm tại Lào Cai.</p></div>
   <div className="extra-info-about-quote"><span>+1 EXTRA</span><strong>Âm nhạc sẽ hay hơn khi có bạn ở đó.</strong><p>+1 Extra Music Show</p></div>
  </section>
  <section className="extra-info-contact-help">
   <div><span className="extra-info-kicker">KẾT NỐI CÙNG EXTRA</span><h2>Hẹn gặp bạn tại những trải nghiệm tiếp theo</h2><p>Tìm hiểu lịch các đêm nhạc, chọn chỗ theo sơ đồ hoặc liên hệ đội ngũ Extra để được hỗ trợ thông tin chương trình và cơ hội hợp tác.</p></div>
   <div className="extra-info-about-actions"><a href="/" className="extra-info-primary">Khám phá các show <span aria-hidden="true">↗</span></a><a href="/lien-he" className="extra-info-secondary">Liên hệ với Extra</a></div>
  </section>
 </>;
}

function RecruitmentContent(){
 const tasks=[
  "Hỗ trợ Giám đốc lập kế hoạch, theo dõi tiến độ và điều phối các đêm diễn.",
  "Phối hợp với các bộ phận nghệ sĩ, sân khấu, kỹ thuật, truyền thông và chăm sóc khách hàng.",
  "Chuẩn bị lịch trình, phân công công việc, tổng hợp thông tin và xử lý phát sinh trong quá trình tổ chức.",
  "Theo sát vận hành trước, trong và sau mỗi chương trình."
 ];
 const requirements=[
  "Chủ động, trách nhiệm, giao tiếp và sắp xếp công việc tốt.",
  "Có khả năng làm việc nhóm, phối hợp nhiều đầu mối và linh hoạt theo lịch chương trình.",
  "Có kỹ năng chụp ảnh, quay vlog, chỉnh sửa ảnh hoặc dựng video là một lợi thế."
 ];
 const departments=[
  {
   id:"bar",index:"01",label:"KHU VỰC BAR",title:"Bar & Phục vụ",
   description:"Đội ngũ trực tiếp phục vụ đồ uống, chăm sóc trải nghiệm khách hàng và vận hành khu Bar.",
   jobs:[
    {title:"Quản lý / Trưởng ca Bar",description:"Điều phối nhân sự trong ca, kiểm soát chất lượng phục vụ và phối hợp vận hành khu Bar."},
    {title:"Nhân viên pha chế",description:"Chuẩn bị đồ uống, giữ vệ sinh quầy và quản lý nguyên liệu theo định mức."},
    {title:"Nhân viên phục vụ Bar",description:"Đón tiếp, nhận yêu cầu, phục vụ khách và giữ khu vực sạch, gọn gàng."},
    {title:"Nhân viên thu ngân Bar",description:"Tiếp nhận thanh toán, đối soát doanh thu ca và bàn giao tiền, chứng từ."}
   ]
  },
  {
   id:"24h",index:"02",label:"KHU DỊCH VỤ 24 GIỜ",title:"Cửa hàng & Dịch vụ 24h",
   description:"Vận hành khu vực hoạt động 24 giờ, hỗ trợ mua sắm, chăm sóc khách hàng và không gian dịch vụ.",
   jobs:[
    {title:"Ca trưởng khu vực 24 giờ",description:"Sắp xếp ca làm, kiểm soát chất lượng dịch vụ và xử lý tình huống trong ca."},
    {title:"Nhân viên bán hàng / Thu ngân",description:"Tư vấn sản phẩm, thanh toán và hỗ trợ khách tại cửa hàng tiện ích 24 giờ."},
    {title:"Nhân viên phục vụ khu vực 24 giờ",description:"Hỗ trợ khách hàng, sắp xếp khu vực phục vụ và phối hợp với Bar, camping khi cần."},
    {title:"Nhân viên vệ sinh & chăm sóc khu vực",description:"Duy trì vệ sinh, chuẩn bị không gian và kiểm tra vật tư phục vụ hằng ngày."}
   ]
  },
  {
   id:"backoffice",index:"03",label:"TÀI CHÍNH & KHO",title:"Kế toán & Quản lý kho",
   description:"Các vị trí hậu cần giúp hoạt động của Extra minh bạch, chính xác và liên tục.",
   jobs:[
    {title:"Kế toán nội bộ",description:"Theo dõi thu chi, công nợ, chứng từ, đối soát bán hàng và lập báo cáo nội bộ."},
    {title:"Thủ kho / Quản lý kho",description:"Quản lý nhập – xuất – tồn, kiểm kê, bảo quản hàng hóa và phối hợp các bộ phận."},
    {title:"Nhân viên kho / Kiểm hàng",description:"Nhận hàng, sắp xếp, kiểm đếm và cấp phát hàng hóa cho Bar và khu 24 giờ."}
   ]
  },
  {
   id:"operations",index:"04",label:"SỰ KIỆN & VẬN HÀNH",title:"Đội ngũ Show & Hậu cần",
   description:"Cùng tổ chức, đón tiếp và hỗ trợ khách trong các chương trình biểu diễn.",
   jobs:[
    {title:"Nhân viên đón khách & Check-in",description:"Hướng dẫn lối vào, hỗ trợ khách tìm đúng chỗ và kiểm tra mã QR tại chương trình."},
    {title:"Nhân viên hậu cần sự kiện",description:"Chuẩn bị vật tư, bố trí khu vực và phối hợp lắp đặt, thu dọn sau show."},
    {title:"Nhân viên chăm sóc khách hàng",description:"Giải đáp thông tin chương trình, hỗ trợ đặt chỗ và xử lý yêu cầu của khách."}
   ]
  }
 ];
 return <>
  <section className="extra-info-section" id="vi-tri">
   <div className="extra-info-section-heading"><div><span className="extra-info-kicker">CƠ HỘI ĐỒNG HÀNH</span><h2>Vị trí đang tuyển</h2></div><p>Tham gia đội ngũ tổ chức và điều phối các chương trình biểu diễn của +1 Extra Music Show.</p></div>
   <article className="extra-info-job">
    <div className="extra-info-job-heading">
     <div><span className="extra-info-tag">ĐANG TUYỂN</span><h3>Trợ lý Giám đốc</h3><p>Quản lý & Điều phối Show Âm nhạc</p></div>
     <span className="extra-info-job-mark" aria-hidden="true">01</span>
    </div>
    <div className="extra-info-job-meta"><span>⌖ &nbsp;542 An Dương Vương</span><span>♬ &nbsp;Tổ chức sự kiện âm nhạc</span><span>✦ &nbsp;Kỹ năng media là lợi thế</span></div>
    <div className="extra-info-job-columns">
     <div><h4>Công việc chính</h4><ul>{tasks.map(task=><li key={task}>{task}</li>)}</ul></div>
     <div><h4>Chúng tôi tìm kiếm</h4><ul>{requirements.map(req=><li key={req}>{req}</li>)}</ul></div>
    </div>
    <div className="extra-info-job-footer"><div><strong>Bạn quan tâm vị trí này?</strong><p>Liên hệ trực tiếp hoặc nhắn tin cho Fanpage <b>+1 Extra Music Show</b> và giới thiệu ngắn về bản thân. Có thể gửi kèm CV hoặc sản phẩm quay dựng nếu có.</p></div><a className="extra-info-primary" href={"tel:"+recruitmentPhone}>Liên hệ 094 865 02 59 <span aria-hidden="true">↗</span></a></div>
   </article>
   <div className="extra-info-recruitment-directory" id="cac-bo-phan">
    <div className="extra-info-section-heading">
     <div><span className="extra-info-kicker">NHIỀU BỘ PHẬN · MỘT ĐỘI NGŨ</span><h2>Cơ hội việc làm tại Extra</h2></div>
     <p>Tìm vị trí phù hợp ở khu Bar, dịch vụ 24 giờ, kế toán, kho và vận hành show.</p>
    </div>
    <div className="extra-info-department-jump" aria-label="Chọn bộ phận tuyển dụng">
     {departments.map(group=><a href={"#tuyen-"+group.id} key={group.id}>{group.title}<span aria-hidden="true">↗</span></a>)}
    </div>
    <div className="extra-info-departments">
     {departments.map(group=><section className="extra-info-department" id={"tuyen-"+group.id} key={group.id}>
      <div className="extra-info-department-heading">
       <div><div className="extra-info-department-label"><span>{group.index}</span>{group.label}</div><h3>{group.title}</h3><p>{group.description}</p></div>
       <a className="extra-info-department-contact" href={"tel:"+recruitmentPhone}>Liên hệ ứng tuyển <span aria-hidden="true">↗</span></a>
      </div>
      <div className="extra-info-open-roles">
       {group.jobs.map(job=><article className="extra-info-role" key={job.title}>
        <div><h4>{job.title}</h4><p>{job.description}</p></div>
        <a href={"tel:"+recruitmentPhone} aria-label={"Gọi ứng tuyển vị trí "+job.title}>Ứng tuyển <span aria-hidden="true">↗</span></a>
       </article>)}
      </div>
     </section>)}
    </div>
    <div className="extra-info-recruitment-note">
     <div><strong>Thông tin ứng tuyển</strong><p>Liên hệ <a href={"tel:"+recruitmentPhone}>094 865 02 59</a> hoặc nhắn Fanpage <b>+1 Extra Music Show</b>, ghi rõ vị trí mong muốn. Ca làm, số lượng cần tuyển, yêu cầu cụ thể và thu nhập sẽ được trao đổi trực tiếp.</p></div>
     <a className="extra-info-primary" href={"tel:"+recruitmentPhone}>Gọi bộ phận tuyển dụng <span aria-hidden="true">↗</span></a>
    </div>
   </div>
  </section>
  <section className="extra-info-section extra-info-next">
   <div><span className="extra-info-kicker">HÀNH TRÌNH CÙNG EXTRA</span><h2>Mỗi đêm nhạc là một dự án đáng tự hào</h2><p>Không chỉ ở hậu trường, bạn còn góp phần tạo nên trải nghiệm chỉn chu cho nghệ sĩ và khán giả – từ khâu chuẩn bị đến những phút cuối chương trình.</p></div>
   <div className="extra-info-step-cards"><div><span>01</span><strong>Kết nối</strong><p>Trao đổi qua số điện thoại hoặc Fanpage.</p></div><div><span>02</span><strong>Giới thiệu năng lực</strong><p>Chia sẻ kinh nghiệm và thế mạnh phù hợp.</p></div><div><span>03</span><strong>Trao đổi công việc</strong><p>Thảo luận về vị trí và kế hoạch hợp tác.</p></div></div>
  </section>
 </>;
}

function ContactContent(){
 return <>
  <section className="extra-info-section" id="kenh-lien-he">
   <div className="extra-info-section-heading"><div><span className="extra-info-kicker">CHÚNG TÔI Ở ĐÂY</span><h2>Chọn kênh liên hệ phù hợp</h2></div><p>Để được hỗ trợ nhanh, vui lòng chọn đúng bộ phận theo nhu cầu của bạn.</p></div>
   <div className="extra-info-contact-grid">
    <article className="extra-info-contact-card"><span className="extra-info-card-icon" aria-hidden="true">☎</span><span className="extra-info-card-label">HỖ TRỢ KHÁCH HÀNG</span><h3>Đặt chỗ & mã QR</h3><p>Hỗ trợ chọn chỗ, xác nhận thanh toán, nhận lại email mã QR và thông tin chương trình.</p><a className="extra-info-contact-value" href={"tel:"+contactPhone}>094 865 02 59</a><a className="extra-info-text-link" href={"tel:"+contactPhone}>Gọi hỗ trợ <span aria-hidden="true">↗</span></a></article>
    <article className="extra-info-contact-card"><span className="extra-info-card-icon" aria-hidden="true">✦</span><span className="extra-info-card-label">NHÂN SỰ & HỢP TÁC</span><h3>Tuyển dụng & công việc</h3><p>Kết nối ứng tuyển, trao đổi cơ hội làm việc và phối hợp tổ chức sự kiện.</p><a className="extra-info-contact-value" href={"tel:"+recruitmentPhone}>094 865 02 59</a><a className="extra-info-text-link" href="/tuyen-dung">Xem thông tin tuyển dụng <span aria-hidden="true">↗</span></a></article>
    <article className="extra-info-contact-card"><span className="extra-info-card-icon" aria-hidden="true">♬</span><span className="extra-info-card-label">KÊNH CẬP NHẬT</span><h3>Fanpage +1 Extra</h3><p>Theo dõi thông tin show, thông báo mới và nhắn tin trực tiếp tới Fanpage <b>+1 Extra Music Show</b>.</p><div className="extra-info-contact-value">+1 Extra Music Show</div><a className="extra-info-text-link" href="/">Xem lịch các đêm diễn <span aria-hidden="true">↗</span></a></article>
   </div>
  </section>
  <section className="extra-info-section extra-info-location">
   <div><span className="extra-info-kicker">ĐỊA ĐIỂM LIÊN HỆ</span><h2>Văn phòng & nơi làm việc</h2><p>Với nhu cầu gặp trực tiếp, vui lòng gọi điện trước để được hướng dẫn đúng đầu mối tiếp nhận.</p></div>
   <div className="extra-info-location-grid">
    <div className="extra-info-location-card"><span>01 / ĐỊA ĐIỂM LÀM VIỆC</span><h3>542 An Dương Vương</h3><p>Địa điểm làm việc và trao đổi tuyển dụng.</p></div>
    <div className="extra-info-location-card"><span>02 / ĐỊA CHỈ CÔNG TY</span><h3>Căn 1204, Tòa nhà The Manor</h3><p>Phường Cam Đường, tỉnh Lào Cai, Việt Nam.</p></div>
   </div>
  </section>
  <section className="extra-info-contact-help"><div><span className="extra-info-kicker">HỖ TRỢ NHẬN MÃ QR</span><h2>Đã thanh toán nhưng chưa thấy email?</h2><p>Hãy kiểm tra Hộp thư đến, mục Quảng cáo và Spam. Nếu vẫn chưa nhận được, liên hệ hotline và cung cấp số điện thoại hoặc email dùng khi đặt chỗ để được đối soát.</p></div><a className="extra-info-primary" href={"tel:"+contactPhone}>Gọi 094 865 02 59 <span aria-hidden="true">↗</span></a></section>
 </>;
}

export default function InformationPage({slug}:{slug:string}){
 const [page,setPage]=useState<PublicPage|null>(null),[error,setError]=useState("");
 useEffect(()=>{
  const controller=new AbortController();
  setPage(null);setError("");
  fetch("/api/public/site-pages?slug="+encodeURIComponent(slug),{cache:"no-store",signal:controller.signal})
   .then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error||"Không tải được nội dung");setPage(data.page||null)})
   .catch(e=>{if(e instanceof Error&&e.name==="AbortError")return;setError("Nội dung tùy chỉnh đang tạm thời không khả dụng; trang vẫn hiển thị thông tin cơ bản.")});
  return ()=>controller.abort();
 },[slug]);
 return <main className="extra-info-shell">
  <div className="extra-info-container">
   <PageHeader slug={slug}/>
   <Intro slug={slug} page={page}/>
   {error&&<p className="extra-info-notice" role="status">{error}</p>}
   {slug==="tuyen-dung"?<RecruitmentContent/>:slug==="lien-he"?<ContactContent/>:<AboutContent/>}
   <footer className="extra-info-footer"><div className="extra-info-footer-brand">+1 <span>EXTRA</span> MUSIC SHOW<small>Âm nhạc sẽ hay hơn khi có bạn ở đó.</small></div><div className="extra-info-footer-links"><a href="/">Trang chủ</a><a href="/tuyen-dung">Tuyển dụng</a><a href="/lien-he">Liên hệ</a><a href="https://iextra.net">iextra.net</a></div></footer>
  </div>
 </main>;
}

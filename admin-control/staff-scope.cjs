'use strict';

const people = [
  {id:'trang',name:'Trang',role:'Vận hành tại hiện trường'},
  {id:'dieu',name:'Diệu',role:'Chỉ tiếp nhận khiếu nại hoặc sửa tư vấn sai của AI'},
  {id:'hai',name:'Hải',role:'Tài chính và giám sát kinh phí'},
  {id:'binh',name:'Bình',role:'Cung cấp ảnh, video và tư liệu gốc'}
];
const duties = {
  print:['trang','Nhận file đã duyệt, tổ chức in và kiểm bản in tại điểm diễn.','Bản in đúng mẫu và số lượng.'],
  layout:['trang','Bố trí ghế, lối đi và vị trí check-in theo sơ đồ tại điểm diễn.','Sơ đồ và vị trí đã kiểm tra tại chỗ.'],
  decor:['trang','Bố trí trang trí, banner và biển chỉ dẫn tại địa điểm.','Các vị trí lắp đặt đã được kiểm tra.'],
  complaint:['dieu','Chỉ tiếp nhận khi có khiếu nại cần người xử lý.','Vụ việc được xử lý và ghi nhận kết quả.'],
  correction:['dieu','Can thiệp khi phát hiện AI tư vấn sai và đính chính với khách liên quan.','Thông tin sai được đính chính.'],
  finance:['hai','Đối soát doanh thu, chứng từ và các khoản chi.','Chênh lệch và chứng từ thiếu được ghi nhận.'],
  spending:['hai','Giám sát chi thực tế so với kinh phí chiến dịch đã duyệt.','Báo chênh lệch ngân sách.'],
  assets:['binh','Tải ảnh, video và tư liệu gốc lên kho để AI sử dụng.','Đã bàn giao đường dẫn tới các tệp nguồn.']
};
const policy='Mọi việc trực tuyến do chính các AI làm: Content viết nội dung, Creative thiết kế, Social đăng bài, Ads vận hành quảng cáo, Sale và CRM tư vấn và chăm sóc khách. Chỉ đề xuất thực thi theo quyền đã duyệt. Trang chỉ vận hành tại hiện trường; Diệu chỉ can thiệp khi có khiếu nại hoặc AI trả lời sai; Hải giám sát tài chính, kể cả kinh phí quảng cáo; Bình chỉ tải tư liệu gốc. Không giao các việc online thường lệ cho nhân sự, kể cả trong văn bản tự do. Chỉ giao việc cho người khi thực sự cần; có thể để staff trống.';
function assignDuty(key,deadline){
  if(!Object.hasOwn(duties,key))throw Error('invalid_campaign_fields');
  const [staffId,action,metric]=duties[key];
  return {staffId,action,metric,deadline};
}
function staffPlan(keys,deadline){
  return keys.map(key=>{
    const duty=assignDuty(key,deadline),person=people.find(p=>p.id===duty.staffId);
    return {id:person.id,person:person.name,role:person.role,action:duty.action,metric:duty.metric,deadline};
  });
}
module.exports={people,duties,policy,assignDuty,staffPlan};

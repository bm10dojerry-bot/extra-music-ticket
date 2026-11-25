import type {Department} from "./marketing-workspace";
import type {ShowFinancialPlan, ShowIntake} from "./marketing-show-intake";

export const agents = {
  Director: {label: "AI Director", responsibility: "Điều phối công việc và quyền thực thi", kpi: "Công việc đúng hạn"},
  Research: {label: "AI Research", responsibility: "Nghiên cứu thị trường và nhu cầu", kpi: "Nguồn kiểm chứng được"},
  Planner: {label: "AI Planner", responsibility: "Lập concept, kênh và lịch truyền thông", kpi: "Mức lấp đầy cần để đạt mục tiêu"},
  Content: {label: "AI Content", responsibility: "Soạn nội dung chiến dịch", kpi: "Nội dung qua kiểm tra"},
  Creative: {label: "AI Creative", responsibility: "Sản xuất poster, banner và video", kpi: "Tư liệu đủ quyền sử dụng"},
  Social: {label: "AI Social", responsibility: "Đăng Facebook và điều phối TikTok", kpi: "Lượt chuyển đổi đã thanh toán"},
  Ads: {label: "AI Ads", responsibility: "Vận hành quảng cáo trong hạn mức", kpi: "Chi phí trên mỗi vé đã thanh toán"},
  Sale: {label: "AI Sale", responsibility: "Điều phối luồng bán vé và chuyển việc ngoại lệ", kpi: "Vé đã thanh toán"},
  CRM: {label: "AI CRM", responsibility: "Theo dõi yêu cầu hỗ trợ và phản hồi", kpi: "Yêu cầu cần xử lý"},
  Analyst: {label: "AI Analyst", responsibility: "Đối soát doanh thu, chi phí và lợi nhuận", kpi: "Chênh lệch so với mục tiêu"},
  Auditor: {label: "AI Auditor", responsibility: "Kiểm tra quyền, dữ liệu và ngân sách", kpi: "Số vấn đề cần xử lý"},
} as const;
export type Agent = keyof typeof agents;

export const jobDefinitions = {
  research: {agent: "Research", title: "Nghiên cứu thị trường", dependencies: []},
  archive_report: {agent:"Analyst", title:"Lưu ảnh chụp số liệu lên Drive", dependencies:["analyst"]},
  analyst: {agent: "Analyst", title: "Đối soát doanh thu đã thanh toán", dependencies: []},
  analyst_plan: {agent: "Analyst", title: "Phân tích kế hoạch tài chính nội bộ", dependencies: []},
  plan: {agent: "Planner", title: "Lập concept và kế hoạch marketing", dependencies: ["research", "analyst"]},
  content: {agent: "Content", title: "Soạn nội dung chiến dịch", dependencies: ["plan"]},
  drive: {agent: "Creative", title: "Xác minh và tổ chức tư liệu Drive", dependencies: []},
  creative: {agent: "Creative", title: "Sản xuất poster và banner", dependencies: ["drive", "plan"]},
  video: {agent: "Creative", title: "Sản xuất video quảng cáo", dependencies: ["creative"]},
  sale: {agent: "Sale", title: "Kiểm tra sơ đồ ghế và kết nối bán vé", dependencies: []},
  crm: {agent: "CRM", title: "Theo dõi yêu cầu tư vấn", dependencies: ["sale"]},
  audit: {agent: "Auditor", title: "Kiểm tra quyền và phương án tài chính", dependencies: ["sale", "analyst"]},
  website: {agent: "Director", title: "Đăng show lên website", dependencies: ["audit"]},
  facebook: {agent: "Social", title: "Đăng Facebook", dependencies: ["website", "content", "audit"]},
  tiktok: {agent: "Social", title: "Điều phối nội dung TikTok", dependencies: []},
  tiktok_materials: {agent: "Social", title: "Gắn video và caption TikTok", dependencies: ["tiktok", "content", "video"]},
  ads: {agent: "Ads", title: "Khởi chạy quảng cáo", dependencies: ["website", "creative", "audit"]},
  ads_monitor: {agent: "Ads", title: "Đối soát và tối ưu quảng cáo", dependencies: []},
  close_sales: {agent:"Director", title:"Đóng bán khi show bắt đầu", dependencies:["website"]},
  reminders: {agent: "Director", title: "Theo dõi báo cáo và hạn công việc", dependencies: []},
} as const satisfies Record<string, {agent: Agent; title: string; dependencies: readonly string[]}>;
export type JobKind = keyof typeof jobDefinitions;

export function planMarketing(input: ShowIntake, now: Date) {
  const days = (Date.parse(input.startsAt) - now.getTime()) / 86_400_000;
  const priority = days <= 3 ? 100 : days <= 7 ? 80 : days <= 14 ? 60 : 40;
  const omitted: JobKind[] = [];
  if (!input.permissions.includes("website")) omitted.push("website", "close_sales");
  if (!input.permissions.includes("facebook")) omitted.push("facebook");
  if (!input.permissions.includes("ads") || !input.adsVnd) omitted.push("ads", "ads_monitor");
  return (Object.keys(jobDefinitions) as JobKind[]).filter(kind => !omitted.includes(kind)).map(kind => ({
    kind,
    agent: jobDefinitions[kind].agent,
    dependencies: jobDefinitions[kind].dependencies,
    run_at: kind === "close_sales" ? input.startsAt : now.toISOString(),
    priority: priority + (["sale", "analyst", "drive", "audit"].includes(kind) ? 5 : 0),
  }));
}

export function workDue(startsAt: string, daysBefore: number, now = new Date()): string {
  const start = Date.parse(startsAt);
  return new Date(Math.min(start, Math.max(now.getTime() + 3_600_000, start - daysBefore * 86_400_000))).toISOString();
}

export type ManualWork = {
  key: string; department: Department; title: string; requirements: string;
  acceptance: string; due_at: string; budget_vnd: number; drive_links: string[];
};

export function manualHandoff(input: ShowIntake, task: Omit<ManualWork, "due_at" | "drive_links">, days: number, now?: Date): ManualWork {
  return {...task, due_at: workDue(input.startsAt, days, now), drive_links: []};
}

export function planStaffWork(input: ShowIntake, finance: ShowFinancialPlan, now: Date): ManualWork[] {
  const tasks = [
    manualHandoff(input, {key:"venue", department:"operations", title:"Chốt địa điểm, âm thanh và ánh sáng",
      requirements:"Xác nhận sức chứa, sơ đồ ghế, hợp đồng và lịch bàn giao sân khấu.",
      acceptance:"Có xác nhận địa điểm, sơ đồ ghế và báo giá trong ngân sách.", budget_vnd:input.productionVnd}, 7, now),
    manualHandoff(input, {key:"print", department:"operations", title:"In poster và banner",
      requirements:"Nhận file in do AI Creative tạo, kiểm tra kích thước và tiến độ giao.",
      acceptance:"Có file in, báo giá và biên nhận bàn giao.", budget_vnd:input.printingVnd}, 3, now),
    manualHandoff(input, {key:"finance", department:"finance", title:"Xác nhận chi phí và đối soát",
      requirements:"Kiểm tra đủ khoản chi và cập nhật chứng từ. Đối soát doanh thu với SePay.",
      acceptance:"Có bảng chi phí thực tế, số tiền đã đối soát và các chênh lệch.", budget_vnd:0}, 3, now),
  ];
  if (finance.feasibility === "loss" || finance.feasibility === "below_target") {
    tasks.push(manualHandoff(input, {key:"viability", department:"finance", title:"Điều chỉnh mục tiêu kinh doanh",
      requirements:"Doanh thu tối đa theo giá và sức chứa hiện tại hụt " + finance.adjustmentVnd.toLocaleString("vi-VN") + " đ. Đề xuất giảm chi phí, đổi cơ cấu giá, đổi địa điểm hoặc điều chỉnh lợi nhuận mục tiêu.",
      acceptance:"Có phương án giá, chi phí và điểm hòa vốn mới.", budget_vnd:0}, 7, now));
  }
  return tasks;
}

/** Read-only analyst of internal plans. No external data or AI claims. */
export function analyzeInternalPlans(
  shows: Array<{intake: {artist: string}; finance: Partial<ShowFinancialPlan>}>,
  retail: Array<{intake: {budget: number}}>
) {
  const valid = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  const risks = [];
  let missing = 0, showCost = 0, targetRevenue = 0, projectedRevenue = 0, retailBudget = 0, missingRetail = 0;
  for (const s of shows) {
    const f = s.finance;
    if (!valid(f.plannedCostVnd) || !valid(f.targetRevenueVnd) || !valid(f.projectedRevenueVnd)) { missing++; continue; }
    showCost += f.plannedCostVnd; targetRevenue += f.targetRevenueVnd; projectedRevenue += f.projectedRevenueVnd;
    const gap = Math.max(0, f.targetRevenueVnd - f.projectedRevenueVnd);
    if (gap > 0 || !f.layoutMatches) risks.push({
      artist: s.intake.artist, gap, layoutVerified: f.layoutMatches === true,
      recommendation: gap > 0 ? "Rà soát giá, chi phí và mục tiêu lấp đầy." : "Xác minh sơ đồ ghế và cơ cấu giá."
    });
  }
  for (const r of retail) { if (valid(r.intake.budget)) retailBudget += r.intake.budget; else missingRetail++; }
  risks.sort((a,b)=>b.gap-a.gap);
  return {showCount: shows.length, retailCount: retail.length, missing, missingRetail, showCost, targetRevenue, projectedRevenue, retailBudget, risks, actualRevenue: null, actualCost: null, actualProfit: null};
}

/** Director's local, read-only executor. Actual reconciliation remains a separate blocked job. */
export function executeAnalystPlan(input: {artist: string}, finance: Partial<ShowFinancialPlan>) {
  const analysis = analyzeInternalPlans([{intake:input,finance}], []);
  if (analysis.missing) return {status:"blocked" as const, note:"Thiếu dữ liệu dự kiến hợp lệ; chưa phân tích.", analysis};
  const vnd = (v:number) => v.toLocaleString("vi-VN") + " đ";
  const gap = Math.max(0,analysis.targetRevenue-analysis.projectedRevenue);
  const note = "KẾ HOẠCH (không phải doanh thu thực tế): chi phí "+vnd(analysis.showCost)+
    "; doanh thu dự kiến "+vnd(analysis.projectedRevenue)+"; mục tiêu "+vnd(analysis.targetRevenue)+
    "; lợi nhuận dự kiến "+vnd(analysis.projectedRevenue-analysis.showCost)+"; thiếu mục tiêu "+vnd(gap)+
    ". "+(analysis.risks[0]?.recommendation || "Chưa phát hiện thiếu mục tiêu theo giả định kế hoạch.")+
    " Đối soát thực tế chờ API.";
  return {status:"succeeded" as const,note,analysis};
}

import {after, NextRequest, NextResponse} from "next/server";
import {getActor} from "../../../../lib/staff-auth";
import {deploymentAllowsExtraOs, readIntake, rpc, startExtraOs, validUuid} from "../../../../lib/extra-os/db";
import {runExtraOs} from "../../../../lib/extra-os/worker";
import {agents} from "../../../../lib/marketing-director";
import {departments, isEvidenceLink, reportStatuses} from "../../../../lib/marketing-workspace";

export const runtime = "nodejs";
export const maxDuration = 120;
const fail = (error: string, status: number) => NextResponse.json({error}, {status});
function sameOrigin(request: NextRequest) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!host || !origin || (fetchSite && fetchSite !== "same-origin")
    || request.headers.get("content-type")?.split(";")[0] !== "application/json") return false;
  const local = !process.env.VERCEL && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return origin === "https://" + host || (local && origin === "http://" + host);
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Nguồn yêu cầu không hợp lệ.", 403);
  const actor = await getActor();
  if (!actor) return fail("Cần đăng nhập.", 401);
  const data = await request.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) return fail("Dữ liệu không hợp lệ.", 400);
  if (!["report","bill"].includes(data.action) && actor.role !== "admin") return fail("Cần quyền quản trị EXTRA OS.", 403);
  if (!deploymentAllowsExtraOs()) return fail("Preview cần Supabase kiểm thử riêng.", 503);
  try {
    if (data.action === "start") {
      if (!validUuid(data.requestId)) return fail("Mã kích hoạt không hợp lệ.", 400);
      let input;
      try {
        input = readIntake(data.show);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Kiểm tra dữ liệu show.", 400);
      }
      const result = await startExtraOs(actor, data.requestId, input);
      after(async () => {
        try { await runExtraOs(62_000); }
        catch { console.error("[extra-os] Initial queue run failed."); }
      });
      return NextResponse.json(result, {status: result.reused ? 200 : 201});
    }
    if (data.action === "report") {
      const note = typeof data.note === "string" ? data.note.trim() : "";
      const links = data.links as unknown;
      if (!validUuid(data.taskId) || ![...reportStatuses, "accepted"].includes(data.status)
        || !note || note.length > 5000 || !Array.isArray(links) || links.length > 8
        || links.some(link => typeof link !== "string" || link.length > 600 || !isEvidenceLink(link))) {
        return fail("Kiểm tra tiến độ, nội dung và đường dẫn báo cáo.", 400);
      }
      await rpc("report", {p_actor: actor.id, p_task: data.taskId, p_status: data.status, p_note: note, p_links: links});
    } else if (data.action === "bill") {
      if (!validUuid(data.allocationId) || !Number.isSafeInteger(data.amount) || data.amount < 0 || data.amount > 100_000_000_000) {
        return fail("Kiểm tra số tiền trên hóa đơn Meta.", 400);
      }
      await rpc("bill_ads", {p_actor:actor.id,p_allocation:data.allocationId,p_billed:data.amount});
    } else if (data.action === "assign") {
      if (!departments.includes(data.department) || (data.staffId !== null && !validUuid(data.staffId))) {
        return fail("Bộ phận hoặc tài khoản không hợp lệ.", 400);
      }
      await rpc("assign", {p_actor: actor.id, p_department: data.department, p_staff: data.staffId});
    } else if (data.action === "pause") {
      if (!["system", ...Object.keys(agents)].includes(data.scope) || typeof data.paused !== "boolean") {
        return fail("Phạm vi tạm dừng không hợp lệ.", 400);
      }
      await rpc("control", {p_actor: actor.id, p_scope: data.scope, p_paused: data.paused, p_retry: null});
      after(async () => {
        try { await runExtraOs(45_000); }
        catch { console.error("[extra-os] Queue control run failed."); }
      });
    } else if (data.action === "retry") {
      if (!validUuid(data.jobId)) return fail("Công việc không hợp lệ.", 400);
      await rpc("control", {p_actor: actor.id, p_scope: null, p_paused: null, p_retry: data.jobId});
      after(async () => {
        try { await runExtraOs(62_000); }
        catch { console.error("[extra-os] Queue retry failed."); }
      });
    } else return fail("Thao tác không hợp lệ.", 400);
    return NextResponse.json({ok: true});
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("42501")) return fail("Không có quyền với công việc này.", 403);
    if (message.includes("23505")) return fail("Show đã có hoặc tài khoản đã thuộc một bộ phận.", 409);
    if (message.includes("23514")) return fail("Trạng thái công việc đã thay đổi. Hãy tải lại.", 409);
    if (message.includes("22023")) return fail("Tài khoản nhân sự đã bị vô hiệu hóa hoặc không hợp lệ.", 400);
    return fail("EXTRA OS chưa kết nối được dữ liệu. Kiểm tra cấu hình và migration.", 503);
  }
}

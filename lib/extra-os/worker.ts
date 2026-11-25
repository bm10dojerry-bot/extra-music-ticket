import "server-only";
import {manualHandoff, type JobKind} from "../marketing-director";
import {osDb, rpc, WorkBlocked} from "./db";
import {assetLink, createPosters, produceVideo} from "./creative";
import {findArtistMedia, saveDriveAsset, showDriveFolder, type ArtistMedia} from "./drive";
import {askModel} from "./model";
import {launchAds, monitorAds, postFacebook} from "./meta";
import {assignTask, getSalesReadiness, publishWebsite, readPaid, reviewBudget} from "./operating";
import type {OsAsset, OsJob, OsShow} from "./types";

const hour = 3_600_000;
type Result = {output: Record<string, unknown>; repeatMs?: number};
const done = (output: Record<string, unknown>, repeatMs?: number): Result => ({output, repeatMs});

async function outputs(show: OsShow, kinds: JobKind[]) {
  const values = await osDb<{kind: JobKind; output: Record<string, unknown>}[]>(
    "extra_os_jobs?show_id=eq." + show.id + "&kind=in.(" + kinds.join(",") + ")&select=kind,output",
  );
  return Object.fromEntries(values.map(value => [value.kind, value.output]));
}

async function handMediaToStaff(show: OsShow, message: string) {
  await assignTask(show, manualHandoff(show.intake, {
    key: "media_needed", department: "media", title: "Bổ sung và xử lý tư liệu nghệ sĩ",
    requirements: message + " Kiểm tra quyền sử dụng trước khi gửi tư liệu.",
    acceptance:"Có ảnh, video đúng bản quyền và link trong kho EXTRA OS.", budget_vnd: 0,
  }, 5));
}

async function crm(show: OsShow) {
  if (!show.website_id) return done({status: "Show chưa có mã bán vé."},
    show.intake.permissions.includes("website") && Date.now() < Date.parse(show.starts_at) ? hour : undefined);
  const {openQueries, pendingPayments, reviewPayments} = await rpc<{
    openQueries: number; pendingPayments: number; reviewPayments: number;
  }>("crm_summary", {p_show: show.id});
  if (openQueries || reviewPayments) {
    await assignTask(show, manualHandoff(show.intake, {
      key:"sales_exceptions", department:"sales", title:"Giải quyết yêu cầu tư vấn và đối soát đơn",
      requirements:"Mở Chăm sóc khách hàng và Vé QR & đối soát. Xử lý tư vấn chậm và đơn cần kiểm tra.",
      acceptance:"Có ghi nhận kết quả từng yêu cầu trong luồng Sale và báo cáo tổng hợp.", budget_vnd:0,
    }, 0));
  }
  return done({openQueries, pendingPayments, reviewPayments, checkedAt: new Date().toISOString()},
    Date.now() < Date.parse(show.starts_at) + 7 * 24 * hour ? hour : undefined);
}

async function execute(show: OsShow, job: OsJob): Promise<Result> {
  const withinCampaign = Date.now() < Date.parse(show.starts_at) + 7 * 24 * hour;
  switch (job.kind) {
    case "research":
      return done(await askModel(show, "Tìm nguồn công khai về nhu cầu nhạc live tại khu vực, khán giả, lịch cạnh tranh và mức giá. Đưa dẫn chứng gắn với từng nhận định.", {}, true));
    case "analyst": {
      const snapshot = await readPaid(show);
      return done({...snapshot, checkedAt: new Date().toISOString()}, withinCampaign ? hour : undefined);
    }
    case "archive_report": {
      if (!show.website_id && show.intake.permissions.includes("website") && Date.parse(show.starts_at) > Date.now()) {
        return done({status:"Chờ show có mã bán vé."}, hour);
      }
      const now = new Date();
      const day = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Ho_Chi_Minh"}).format(now);
      const metrics = await readPaid(show);
      const folder = await showDriveFolder(show.id, show.artist, "07");
      const report = await saveDriveAsset(show.id, "report-" + day, "Đối soát " + day + ".json", "application/json",
        folder.drive_id, ["finance"], Buffer.from(JSON.stringify({
          artist:show.artist, start:show.starts_at, recordedAt:now.toISOString(),
          targetRevenueVnd:show.finances.targetRevenueVnd, ...metrics,
        }, null, 2)));
      await osDb("extra_os_tasks?show_id=eq." + show.id + "&key=eq.finance", {
        method:"PATCH", body:JSON.stringify({drive_links:[assetLink(report)]}),
      });
      return done({reportId:report.id, version:report.version, day}, withinCampaign ? 24 * hour : undefined);
    }
    case "plan":
      return done(await askModel(show, "Đề xuất concept đêm nhạc, lịch Marketing theo ngày, phân kênh và KPI doanh thu. Giải thích điểm hòa vốn, mục tiêu lấp đầy và cách xử lý nếu mục tiêu khó đạt.",
        await outputs(show, ["research","analyst"])));
    case "content":
      return done(await askModel(show, "Soạn bản giới thiệu đêm nhạc, bài đăng Facebook, caption TikTok, nội dung landing page và FAQ bán vé.",
        await outputs(show, ["plan"])));
    case "drive": {
      const sources = await findArtistMedia(show.finances.driveId);
      const folder = await showDriveFolder(show.id, show.artist, "04");
      return done({...sources, folderId: folder.id});
    }
    case "creative": {
      const media = (await outputs(show, ["drive"])).drive as ArtistMedia | undefined;
      if (!media?.image && !media?.clip) throw new WorkBlocked("Cần tư liệu đã xác minh từ Google Drive.");
      return done(await createPosters(show, media));
    }
    case "video": {
      const media = (await outputs(show, ["drive"])).drive as ArtistMedia | undefined;
      const video = await produceVideo(show, media?.clip ?? null);
      await osDb("extra_os_tasks?show_id=eq." + show.id + "&key=eq.tiktok", {
        method: "PATCH", body: JSON.stringify({drive_links: [assetLink(video)]}),
      });
      return done({videoId: video.id, version: video.version, originalClipUsed:Boolean(media?.clip)});
    }
    case "sale": {
      const readiness = await getSalesReadiness(show);
      if (!readiness.checkoutReady) {
        await assignTask(show, manualHandoff(show.intake, {
          key:"ticketing", department:"sales", title:"Kiểm tra điều kiện mở bán",
          requirements:readiness.reason + " Phối hợp Điều hành show để xử lý sơ đồ ghế và xác nhận kênh thanh toán.",
          acceptance:"Sức chứa khớp sơ đồ ghế, cấu hình thanh toán được kiểm tra.", budget_vnd:0,
        }, 5));
      }
      const {aiSalesConfigurationReady, getAiSalesSettings} = await import("../ai-sales");
      const messengerAiReady = aiSalesConfigurationReady() && (await getAiSalesSettings().catch(() => null))?.enabled === true;
      return done({...readiness, messengerAiReady});
    }
    case "crm":
      return crm(show);
    case "audit":
      return done(await reviewBudget(show));
    case "website":
      return done(await publishWebsite(show, job));
    case "facebook":
      return done(await postFacebook(show, job));
    case "tiktok": {
      const [video] = await osDb<OsAsset[]>("extra_os_assets?show_id=eq." + show.id + "&key=eq.video&ready=eq.true");
      await assignTask(show, {
        ...manualHandoff(show.intake, {
          key:"tiktok", department:"tiktok", title:"Đăng video TikTok của show",
          requirements:"Kiểm tra bản quyền, caption và video. Đăng bằng tài khoản TikTok của công ty rồi gửi đường dẫn.",
          acceptance:"Có link video đã đăng và báo cáo thời điểm đăng.", budget_vnd:0,
        }, 3),
        drive_links: video ? [assetLink(video)] : [],
      });
      return done({handoff:"tiktok", videoReady:Boolean(video)});
    }
    case "tiktok_materials": {
      const [assets, draft] = await Promise.all([
        osDb<OsAsset[]>("extra_os_assets?show_id=eq." + show.id + "&key=eq.video&ready=eq.true"),
        outputs(show, ["content"]),
      ]);
      const [video] = assets;
      const text = draft.content?.text;
      if (!video || typeof text !== "string" || !text.trim()) {
        throw new WorkBlocked("Cần video và nội dung chiến dịch để hoàn thiện nhiệm vụ TikTok.");
      }
      const folder = await showDriveFolder(show.id, show.artist, "06");
      const caption = await saveDriveAsset(show.id, "tiktok-copy", "Nội dung TikTok.txt", "text/plain",
        folder.drive_id, ["tiktok"], Buffer.from(text.slice(0, 3500)));
      await osDb("extra_os_tasks?show_id=eq." + show.id + "&key=eq.tiktok", {
        method:"PATCH", body:JSON.stringify({drive_links:[assetLink(video),assetLink(caption)]}),
      });
      return done({videoId:video.id, captionId:caption.id});
    }
    case "ads":
      return done(await launchAds(show, job, "initial"));
    case "ads_monitor":
      return done(await monitorAds(show, job), withinCampaign ? 15 * 60_000 : undefined);
    case "close_sales":
      return done({websiteId: await rpc<string>("close_sales", {p_job:job.id,p_lease:job.lease_token})});
    case "reminders": {
      const count = await rpc<number>("remind", {p_show: show.id});
      return done({overdueReminded: count}, withinCampaign ? 4 * hour : undefined);
    }
  }
}

async function processJob(job: OsJob) {
  type Outcome = "succeeded" | "blocked" | "failed" | "queued";
  let status: Outcome = "succeeded";
  let output: Record<string, unknown> | null = null;
  let message = "";
  let next: string | null = null;
  try {
    if (!await rpc<boolean>("lease_valid", {p_id: job.id, p_lease: job.lease_token})) {
      status = "queued";
    } else {
      const [show] = await osDb<OsShow[]>("extra_os_shows?id=eq." + job.show_id + "&limit=1");
      if (!show) throw Error("Không tìm thấy show.");
      const result = await execute(show, job);
      output = result.output;
      if (result.repeatMs) next = new Date(Date.now() + result.repeatMs).toISOString();
    }
  } catch (error) {
    if (error instanceof WorkBlocked) {
      status = "blocked";
      message = error.message;
      if (job.kind === "drive" || job.kind === "creative" || job.kind === "video") {
        const [show] = await osDb<OsShow[]>("extra_os_shows?id=eq." + job.show_id + "&limit=1");
        if (show) await handMediaToStaff(show, message);
      } else if (["research","plan","content"].includes(job.kind)) {
        const [show] = await osDb<OsShow[]>("extra_os_shows?id=eq." + job.show_id + "&limit=1");
        if (show) await assignTask(show, manualHandoff(show.intake, {
          key:"marketing_needed", department:"sales", title:"Bổ sung kế hoạch truyền thông",
          requirements:message + " Bổ sung nguồn nghiên cứu, nội dung bán vé và lịch đăng cho show.",
          acceptance:"Có kế hoạch, link nguồn và nội dung đã rà soát theo dữ kiện show.", budget_vnd:0,
        }, 7));
      }
    } else {
      status = job.attempts >= 4 ? "failed" : "queued";
      message = "Thực thi lỗi. " + (status === "queued" ? "Hệ thống sẽ thử lại." : "Kiểm tra cấu hình dịch vụ trước khi chạy lại.");
      console.warn("[extra-os] Job failed", job.kind, job.id, error instanceof Error ? error.name : "unknown");
      if (status === "queued") next = new Date(Date.now() + 60_000 * 2 ** (job.attempts - 1)).toISOString();
    }
  }
  const updated = await rpc<boolean>("finish", {
    p_id: job.id, p_lease: job.lease_token, p_status: status, p_output: output, p_message: message, p_next: next,
  });
  return updated ? status : "lease_lost";
}

export async function runExtraOs(timeBudgetMs: number) {
  const end = Date.now() + timeBudgetMs;
  const counts = {claimed: 0, succeeded: 0, blocked: 0, failed: 0, queued: 0, lease_lost: 0};
  while (Date.now() < end - 12_000 && counts.claimed < 18) {
    const jobs = await rpc<OsJob[]>("claim", {p_limit: 4});
    if (!jobs.length) break;
    counts.claimed += jobs.length;
    const results = await Promise.allSettled(jobs.map(processJob));
    for (const result of results) {
      if (result.status === "fulfilled") counts[result.value]++;
      else {
        counts.lease_lost++;
        console.warn("[extra-os] A claimed job did not record its result.");
      }
    }
  }
  return counts;
}

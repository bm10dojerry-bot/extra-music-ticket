import Link from "next/link";
import {getActor} from "../../../lib/staff-auth";
import {agents, jobDefinitions, type Agent} from "../../../lib/marketing-director";
import {departmentLabels, departments} from "../../../lib/marketing-workspace";
import {actorDepartment, deploymentAllowsExtraOs, loadDirector, loadWork, rpc, validUuid} from "../../../lib/extra-os/db";
import {hasDrive} from "../../../lib/extra-os/drive";
import {hasModel} from "../../../lib/extra-os/model";
import {metaLive} from "../../../lib/extra-os/meta";
import {ticketingReady} from "../../../lib/extra-os/operating";
import type {DirectorPanel, OsReport, OsShow, OsTask, PaidSnapshot} from "../../../lib/extra-os/types";
import StaffLogin from "../../staff/staff-login";
import {AssignDepartment, OsAction, RecordAdBill, ReportTask} from "./actions";
import ShowIntakeForm from "./show-intake";
import styles from "./workspace.module.css";

export const dynamic = "force-dynamic";

const path = "/admin/ai-marketing";
const views = {
  overview:"Tổng điều hành", create:"Tạo show ONE CLICK", director:"AI Director", tasks:"Giao việc",
  marketing:"Marketing & Drive", finance:"Ngân sách & doanh thu", people:"Nhân sự", settings:"Cấu hình",
} as const;
type View = keyof typeof views;

const statusLabels: Record<string, string> = {
  pending:"Chờ thực hiện", in_progress:"Đang thực hiện", submitted:"Chờ nghiệm thu", accepted:"Đã nghiệm thu",
  queued:"Trong hàng đợi", running:"Đang chạy", succeeded:"Hoàn thành", blocked:"Cần xử lý", failed:"Lỗi", skipped:"Đã bỏ qua",
  reserved:"Đã giữ ngân sách", active:"Đang chạy", paused:"Đã dừng", uncertain:"Cần đối soát",
};
const financeLabels = {feasible:"Đạt theo kịch bản 70%", at_risk:"Cần tỷ lệ lấp đầy cao", below_target:"Thiếu doanh thu mục tiêu", loss:"Chưa hòa vốn"};
const logLabels: Record<string, string> = {
  show_started:"Đã khởi động show", lease_expired_queued:"Khôi phục công việc", lease_expired_failed:"Hết lượt khôi phục",
  job_skipped:"Đã bỏ qua công việc", job_succeeded:"Đã hoàn thành lượt chạy", job_blocked:"Cần xử lý",
  job_failed:"Lỗi thực thi", job_queued:"Đưa vào hàng đợi", job_retry_requested:"Yêu cầu chạy lại",
  control_changed:"Đổi trạng thái vận hành", department_handover:"Bàn giao bộ phận", task_overdue:"Nhắc việc quá hạn",
  task_in_progress:"Cập nhật tiến độ", task_submitted:"Gửi nghiệm thu", task_accepted:"Đã nghiệm thu",
  task_blocked:"Báo khó khăn", ad_budget_reserved:"Giữ hạn mức quảng cáo", ad_bill_recorded:"Ghi hóa đơn quảng cáo",
};

const date = (value: string) => new Intl.DateTimeFormat("vi-VN", {dateStyle:"short", timeStyle:"short", timeZone:"Asia/Ho_Chi_Minh"}).format(new Date(value));
const money = (value: number | null | undefined) => typeof value === "number" ? value.toLocaleString("vi-VN") + " đ" : "Chờ đối soát";
const href = (view: View, id?: string) => path + "?" + new URLSearchParams({view, ...(id ? {show:id} : {})});

function Badge({status}: {status: string}) {
  return <span className={styles.badge + (["blocked","failed","uncertain"].includes(status) ? " " + styles.attention : "")}>{statusLabels[status] ?? status}</span>;
}

function Tasks({tasks, reports, admin}: {tasks: OsTask[]; reports: OsReport[]; admin: boolean}) {
  return <section className={styles.panel}>
    <h2>Nhiệm vụ</h2>
    {!tasks.length && <p className={styles.muted}>Chưa có nhiệm vụ được giao.</p>}
    {tasks.map(task => <details className={styles.task} key={task.id}>
      <summary>{task.title} · <Badge status={task.status}/>{task.reminder_at && ["pending","in_progress","blocked"].includes(task.status) && <span className={styles.attention}> · Quá hạn</span>}</summary>
      <div>
        <p>{task.extra_os_shows.artist} · {departmentLabels[task.department]} · Hạn {date(task.due_at)}</p>
        <p>{task.requirements}</p>
        <p><strong>Nghiệm thu</strong> · {task.acceptance}</p>
        <p><strong>Ngân sách</strong> · {money(task.budget_vnd)}</p>
        {task.drive_links.length > 0 && <ul>{task.drive_links.map((link, index) => <li key={link}><a href={link}>Tải tư liệu {index + 1}</a></li>)}</ul>}
        {task.status !== "accepted" && <ReportTask task={task} admin={admin}/>}
        {reports.filter(report => report.task_id === task.id).map(report => <article key={report.id} className={styles.listRow}>
          <p>{report.author_name} · {date(report.created_at)} · <Badge status={report.status}/></p>
          <p className={styles.output}>{report.note}</p>
          {report.evidence_links.length > 0 && <ul>{report.evidence_links.map(link => <li key={link}><a href={link} target="_blank" rel="noreferrer">Mở kết quả</a></li>)}</ul>}
        </article>)}
      </div>
    </details>)}
  </section>;
}

function Metrics({items}: {items: readonly [string, string | number][]}) {
  return <div className={styles.metricGrid}>{items.map(([label,value]) => <article className={styles.metric} key={label}><span>{label}</span><b>{value}</b></article>)}</div>;
}

function JobList({jobs, canRetry = true}: {jobs: DirectorPanel["jobs"]; canRetry?: boolean}) {
  return jobs.length ? <ul className={styles.items}>{jobs.map(job => <li className={styles.listRow} key={job.id}>
    <details>
      <summary>{jobDefinitions[job.kind]?.title ?? job.kind} · <Badge status={job.status}/></summary>
      <div>
        <p className={styles.small}>{agents[job.agent].label} · {date(job.updated_at)}</p>
        {job.message && <p role="status">{job.message}</p>}
        {job.status === "queued" && job.dependencies.length > 0 && <p className={styles.small}>Điều kiện: {job.dependencies.map(kind => jobDefinitions[kind].title).join(", ")}</p>}
        {typeof job.output.text === "string" ? <p className={styles.output}>{job.output.text}</p>
          : Object.keys(job.output).length > 0 && <pre className={styles.data}>{JSON.stringify(job.output, null, 2)}</pre>}
        {Array.isArray(job.output.sources) && <ul>{job.output.sources.filter(source => typeof source?.url === "string" && source.url.startsWith("https://"))
          .map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a></li>)}</ul>}
        {canRetry && ["failed","blocked"].includes(job.status) && <OsAction payload={{action:"retry", jobId:job.id}}>Chạy lại</OsAction>}
      </div>
    </details>
  </li>)}</ul> : <p className={styles.muted}>Chưa có công việc.</p>;
}

function Director({panel}: {panel: DirectorPanel}) {
  return <>
    <div className={styles.agentGrid}>{(Object.keys(agents) as Agent[]).map(key => {
      const agent = agents[key];
      const jobs = panel.jobs.filter(job => job.agent === key);
      const paused = panel.controls.some(row => row.paused && (row.scope === key || row.scope === "system"));
      return <article key={key} className={styles.metric}>
        <h3>{agent.label}</h3><p>{agent.responsibility}</p><small>KPI · {agent.kpi}</small>
        <p className={styles.small}>{paused ? "Đang tạm dừng" : jobs.some(job => job.status === "running") ? "Đang chạy" :
          jobs.length ? jobs.length + " công việc trong show" : "Chưa có công việc"}</p>
      </article>;
    })}</div>
    <section className={styles.panel}><h2>Hàng đợi và kết quả công việc</h2><JobList jobs={panel.jobs}/></section>
    <section className={styles.panel}><h2>Nhật ký hoạt động</h2>
      {!panel.logs.length && <p className={styles.muted}>Chưa có nhật ký.</p>}
      <ol className={styles.log}>{panel.logs.map(log => <li key={log.id}>
        <time dateTime={log.created_at}>{date(log.created_at)}</time> · {logLabels[log.event] ?? log.event}
        {log.details.kind && <> · {jobDefinitions[log.details.kind]?.title}</>}
        {log.details.message && <> · {log.details.message}</>}
      </li>)}</ol>
    </section>
  </>;
}

type FinancePanel = Pick<DirectorPanel, "allocations" | "jobs">;
type FinanceShow = Omit<OsShow, "intake"> & {intake: Pick<OsShow["intake"],"targetProfitVnd">};

function Finances({show, panel, admin = true}: {show: FinanceShow; panel: FinancePanel; admin?: boolean}) {
  const planned = show.finances;
  const paid = panel.jobs.find(job => job.kind === "analyst")?.output as Partial<PaidSnapshot> | undefined;
  const spent = panel.allocations.reduce((sum,row) => sum + (row.billed_vnd ?? row.spent_vnd), 0);
  const committed = panel.allocations.reduce((sum,row) => sum + (row.billed_vnd === null ? Math.max(0,row.limit_vnd - row.spent_vnd) : 0), 0);
  return <>
    <Metrics items={[
      ["Chi phí kế hoạch",money(planned.plannedCostVnd)], ["Doanh thu để hòa vốn",money(planned.plannedCostVnd)],
      ["Doanh thu mục tiêu",money(planned.targetRevenueVnd)], ["Lợi nhuận mục tiêu",money(show.intake.targetProfitVnd)],
      ["Doanh thu đã xác minh",money(paid?.revenueVnd)], ["Vé đã thanh toán",paid?.paidTickets ?? "Chờ đối soát"],
      ["Chi phí đã ghi sổ",money(paid?.actualCostVnd)], ["Lợi nhuận theo sổ chi phí",money(paid?.actualProfitVnd)],
    ]}/>
    <section className={styles.panel}>
      <h2>Phương án giá</h2>
      <p>{financeLabels[planned.feasibility]} · Cần lấp đầy khoảng {planned.requiredOccupancy ?? 0}% theo cơ cấu giá hiện tại.</p>
      <p>Doanh thu nếu bán hết {money(planned.maximumRevenueVnd)} · Giá trung bình cần đạt {money(planned.minimumAverageAtFullCapacityVnd)}.</p>
      <p>Hòa vốn ở {planned.breakEvenTicketsAtStartingPrice.toLocaleString("vi-VN")} vé nếu cùng bán giá khởi điểm.</p>
      {planned.layoutMatches && <p>{Object.entries(planned.prices).map(([zone, value]) => zone + " " + money(value)).join(" · ")}</p>}
    </section>
    <section className={styles.panel}>
      <h2>Hạn mức quảng cáo</h2>
      <Metrics items={[
        ["Hạn mức",money(show.ad_limit_vnd)], ["Đã chi",money(spent)],
        ["Đang cam kết",money(committed)], ["Còn lại",money(show.ad_limit_vnd - spent - committed)],
      ]}/>
      {panel.allocations.map(row => <article className={styles.listRow} key={row.id}>
        <p><strong>{row.allocation_key === "initial" ? "Thử nghiệm" : "Mở rộng"}</strong> · <Badge status={row.status}/> · {money(row.spent_vnd)}</p>
        {row.campaign_id && <p className={styles.small}>Meta Campaign ID {row.campaign_id}</p>}
        {row.status === "paused" && row.billed_vnd === null && <RecordAdBill id={row.id} spent={row.spent_vnd}/>}
        {row.billed_vnd !== null && <p>Hóa đơn {money(row.billed_vnd)}</p>}
      </article>)}
      <JobList jobs={panel.jobs.filter(job => job.kind === "ads" || job.kind === "ads_monitor")} canRetry={admin}/>
    </section>
  </>;
}

function Settings({panel}: {panel: DirectorPanel}) {
  const status = [
    ["OpenAI", hasModel()], ["OAuth và thư mục Google Drive", hasDrive()], ["SePay", ticketingReady()],
    ["Cho phép tác động Meta",metaLive()], ["Khóa gọi bộ lập lịch",Boolean(process.env.EXTRA_OS_CRON_SECRET)],
  ] as const;
  return <>
    <section className={styles.panel}><h2>Cấu hình môi trường</h2>
      <ul className={styles.items}>{status.map(([label, enabled]) => <li className={styles.listRow} key={label}>{label} · {enabled ? "Đã cấu hình" : "Chưa cấu hình"}</li>)}</ul>
    </section>
    <section className={styles.panel}><h2>Tạm dừng và tiếp tục</h2>
      <div className={styles.agentGrid}>{["system", ...Object.keys(agents)].map(scope => {
        const paused = panel.controls.some(row => row.scope === scope && row.paused);
        return <article className={styles.metric} key={scope}>
          <h3>{scope === "system" ? "Toàn hệ thống" : agents[scope as Agent].label}</h3>
          <OsAction payload={{action:"pause", scope, paused:!paused}}>{paused ? "Tiếp tục" : "Tạm dừng"}</OsAction>
        </article>;
      })}</div>
    </section>
  </>;
}

export default async function ExtraOsPage({searchParams}: {searchParams: Promise<{view?: string; show?: string}>}) {
  const [actor, params] = await Promise.all([getActor(), searchParams]);
  if (!actor) return <StaffLogin returnTo={path}/>;
  const admin = actor.role === "admin";
  const selected = validUuid(params.show) ? params.show : null;
  const view: View = params.view && Object.hasOwn(views, params.view) ? params.view as View : "overview";
  let body;
  let department;
  let show: OsShow | undefined;
  try {
    if (!deploymentAllowsExtraOs()) body = <p className={styles.notice} role="status">Preview cần Supabase kiểm thử riêng để khởi động và theo dõi show.</p>;
    else if (!admin) {
      department = await actorDepartment(actor);
      if (department) {
        const work = await loadWork(actor, null);
        if (department === "finance") {
          const finance = await rpc<FinancePanel & {shows:FinanceShow[]}>("finance_panel", {p_actor:actor.id});
          const current = (selected && finance.shows.find(item => item.id === selected)) || finance.shows[0];
          body = <>
            {current && <section className={styles.panel}><h2>Đối soát show</h2>
              <div className={styles.showNav}>{finance.shows.map(item => <Link key={item.id} href={href("finance",item.id)}
                aria-current={item.id === current.id ? "true" : undefined}>{item.artist}</Link>)}</div>
              <Finances show={current} admin={false} panel={{
                jobs: finance.jobs.filter(job => job.show_id === current.id),
                allocations: finance.allocations.filter(allocation => allocation.show_id === current.id),
              }}/>
            </section>}
            <Tasks {...work} admin={false}/>
          </>;
        } else body = <Tasks {...work} admin={false}/>;
      } else body = <p className={styles.notice} role="status">Tài khoản chưa được giao bộ phận trong EXTRA OS.</p>;
    } else {
      const {active, panel} = await loadDirector(actor, selected);
      show = active;
      const blocked = panel.jobs.filter(job => job.status === "blocked" || job.status === "failed");
      if (view === "create") body = <ShowIntakeForm/>;
      else if (view === "director") body = <Director panel={panel}/>;
      else if (view === "settings") body = <Settings panel={panel}/>;
      else if (view === "tasks") body = <Tasks tasks={panel.tasks} reports={panel.reports} admin/>;
      else if (view === "people") body = <section className={styles.panel}>
        <h2>Phụ trách theo vị trí</h2><p><Link href="/admin?section=staff-users">Quản lý tài khoản nhân viên</Link></p>
        <div className={styles.formGrid}>{departments.map(id => <AssignDepartment key={id} department={id}
          staffId={panel.memberships.find(row => row.department === id)?.staff_id ?? null} people={panel.staff}/>)}</div>
      </section>;
      else if (view === "marketing") body = <>
        <section className={styles.panel}><h2>Chiến dịch</h2><JobList jobs={panel.jobs.filter(job => ["research","plan","content","creative","video","website","facebook","tiktok"].includes(job.kind))}/></section>
        <section className={styles.panel}><h2>Tư liệu Google Drive</h2>
          {!panel.assets.length && <p className={styles.muted}>Chưa có tệp đã xác minh cho show này.</p>}
          <ul className={styles.items}>{panel.assets.map(asset => <li className={styles.listRow} key={asset.id}>
            {asset.web_url ? <a href={asset.web_url} target="_blank" rel="noreferrer">{asset.name}</a> : asset.name}
            {asset.version && <small> · Phiên bản {asset.version}</small>}
          </li>)}</ul>
        </section>
      </>;
      else if (view === "finance" && show) body = <Finances show={show} panel={panel}/>;
      else if (view === "overview" && show) body = <>
        <div className={styles.toolbar}>
          <div><p className={styles.eyebrow}>Show đang theo dõi</p><h2>{show.artist}</h2><p>{date(show.starts_at)} · {show.venue}</p>
            {show.website_id && <a href={(process.env.VERCEL_ENV === "production" ? "https://iextra.net" : "") + "/show/" + show.website_id}>Mở trang bán vé</a>}</div>
          <Link className={styles.primary} href={href("create")}>Tạo show</Link>
        </div>
        {blocked.length > 0 && <p className={styles.notice}>{blocked.length} công việc cần xử lý. <Link href={href("director",show.id)}>Xem AI Director</Link></p>}
        <Metrics items={[
          ["Sức chứa",show.capacity], ["Doanh thu mục tiêu",money(show.finances.targetRevenueVnd)],
          ["Công việc tự động",panel.jobs.length], ["Nhiệm vụ nhân sự",panel.tasks.length],
        ]}/>
        <section className={styles.panel}><h2>Show của EXTRA OS</h2>
          <div className={styles.showNav}>{panel.shows.map(item => <Link key={item.id} aria-current={show?.id === item.id ? "true" : undefined}
            href={href(view,item.id)}>{item.artist} · {date(item.starts_at)}</Link>)}</div>
        </section>
      </>;
      else body = <section className={styles.panel}><h2>Chưa có show trong EXTRA OS</h2>
        <Link className={styles.primary} href={href("create")}>Tạo show ONE CLICK</Link>
      </section>;
    }
  } catch {
    body = <p className={styles.notice} role="alert">Chưa tải được dữ liệu EXTRA OS. Kiểm tra kết nối Supabase và migration.</p>;
  }

  return <div className={styles.shell}>
    <header className={styles.header}>
      <div className={styles.identity}><span className={styles.brand}>+1</span><strong>EXTRA OS</strong></div>
      <div className={styles.utilities}>
        <span>{actor.display_name}</span>{admin && <Link href="/admin">Admin bán vé</Link>}
        <form method="post" action={actor.id === "owner" ? "/api/admin/logout" : "/api/staff/logout"}><button>Đăng xuất</button></form>
      </div>
    </header>
    {admin && <nav className={styles.nav} aria-label="Phân hệ EXTRA OS">
      {(Object.keys(views) as View[]).map(item => <Link key={item} href={href(item,show?.id)} aria-current={item === view ? "page" : undefined}>{views[item]}</Link>)}
    </nav>}
    <main className={styles.main}>
      <h1>{admin ? views[view] : department ? departmentLabels[department] : "Công việc của tôi"}</h1>
      {admin && view !== "overview" && view !== "create" && view !== "settings" && view !== "people" && show && <p className={styles.muted}>{show.artist} · {date(show.starts_at)}</p>}
      {body}
    </main>
  </div>;
}

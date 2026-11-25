"use client";

import { useMemo, useState } from "react";
import { initial21, simulateExtra21, type Extra21Input, type Scenario, type TicketState } from "../../lib/ai-sale-extra-2-1";
import styles from "./demo.module.css";

const scenarios: { id: Scenario; name: string; hint: string }[] = [
  { id: "after_purchase", name: "Sau mua vé", hint: "Cảm ơn, check-in, giao lưu" },
  { id: "three_min", name: "Im lặng 3 phút", hint: "Nhắc khách chưa mua" },
  { id: "day_before", name: "Trước show 1 ngày", hint: "Nhắc theo trạng thái vé" },
  { id: "show_day", name: "Ngày biểu diễn", hint: "Đến sớm, mặc áo ấm" },
  { id: "weather", name: "Thời tiết", hint: "Lạnh, mưa, căng tăng" },
  { id: "after_show", name: "Sau đêm nhạc", hint: "Hỏi thăm trải nghiệm" },
  { id: "complaint", name: "Khách phản ánh", hint: "Đồng cảm, hotline" },
  { id: "images", name: "Hai ảnh sơ đồ", hint: "Kiểm tra nguồn ảnh" },
  { id: "voice", name: "Voice", hint: "Cần khách đồng ý" },
];
const statuses: { id: TicketState; name: string }[] = [
  { id: "not_purchased", name: "Chưa mua vé" },
  { id: "pending", name: "Chờ thanh toán" },
  { id: "paid", name: "Đã thanh toán" },
  { id: "cancelled", name: "Đã hủy" },
];
function Toggle({label, checked, onChange}: {label:string; checked:boolean; onChange:(value:boolean)=>void}) {
  return <label className={styles.toggle}><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span>{label}</span></label>;
}
function clampMinutes(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1440, Math.max(0, numeric)) : 0;
}

export default function Extra21Demo() {
  const [data, setData] = useState<Extra21Input>(initial21);
  const result = useMemo(() => simulateExtra21(data), [data]);
  const change = (patch: Partial<Extra21Input>) => setData(previous => ({ ...previous, ...patch }));
  const choose = (scenario: Scenario) => setData(previous => ({
    ...previous, scenario, reminderAlreadySent: false, optedOut: false, humanHandling: false,
    today: scenario === "show_day" ? previous.showDate : scenario === "after_show" ? "2026-11-29" : "2026-11-27",
    ticketState: scenario === "three_min" ? "not_purchased" :
      ["after_purchase", "show_day", "after_show"].includes(scenario) ? "paid" : previous.ticketState,
    paymentVerified: scenario === "three_min" ? false :
      ["after_purchase", "show_day", "after_show"].includes(scenario) ? true : previous.paymentVerified,
  }));
  const isReminder = data.scenario === "three_min" || data.scenario === "day_before";
  const isWeather = data.scenario === "weather" || data.scenario === "show_day";
  const relevantStatus = ["after_purchase", "three_min", "day_before", "show_day", "after_show"].includes(data.scenario);

  return <main className={styles.main}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}><span className={styles.plus}>+1</span><strong>EXTRA</strong><span>MUSIC SHOW</span></div>
        <span className={styles.testTag}>BẢN THỬ NGHIỆM · KHÔNG GỬI KHÁCH THẬT</span>
      </header>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>AI SALE EXTRA 2.1 / TEST LAB</span>
        <h1>Mô phỏng chăm sóc khách hàng <em>trọn hành trình</em></h1>
        <p>Chọn một tình huống và thay đổi điều kiện bên dưới. Hệ thống sẽ mô phỏng lời nhắn hoặc chặn gửi khi chưa đủ quyền. Không sử dụng Fanpage, tiền thật, ghế thật hay dữ liệu khách hàng.</p>
        <div className={styles.markers}><span>9 kịch bản</span><span>Chặn gửi trùng</span><span>Kiểm tra quyền nhắn</span><span>Bảo vệ luồng bán vé</span></div>
      </section>

      <div className={styles.columns}>
        <div className={styles.left}>
          <section className={styles.panel}>
            <h2><span className={styles.num}>01</span> Chọn kịch bản AI</h2>
            <div className={styles.scenarios}>{scenarios.map(item =>
              <button key={item.id} type="button" className={data.scenario === item.id ? styles.scenarioActive : styles.scenario}
                onClick={() => choose(item.id)} aria-pressed={data.scenario === item.id}>
                <strong>{item.name}</strong><small>{item.hint}</small>
              </button>
            )}</div>
          </section>
          <section className={styles.panel}>
            <h2><span className={styles.num}>02</span> Dữ liệu mô phỏng</h2>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>Tên show
                <input value={data.showName} onChange={e => change({showName:e.target.value})} placeholder="Tên nghệ sĩ" />
              </label>
              <label className={styles.field}>Ngày diễn
                <input type="date" value={data.showDate} onChange={e => change({showDate:e.target.value})} />
              </label>
              <label className={styles.field}>Ngày đang kiểm thử
                <input type="date" value={data.today} onChange={e => change({today:e.target.value})} />
              </label>
            </div>

            {relevantStatus && <>
              <h3>Trạng thái đơn hàng</h3>
              <div className={styles.statuses}>{statuses.map(item =>
                <button key={item.id} type="button" onClick={() => change({ticketState:item.id, paymentVerified:item.id === "paid"})}
                  aria-pressed={data.ticketState === item.id}
                  className={data.ticketState === item.id ? styles.statusActive : styles.status}>{item.name}</button>
              )}</div>
              <Toggle label="Thanh toán đã được hệ thống xác minh" checked={data.paymentVerified} onChange={v => change({paymentVerified:v})} />
            </>}

            {data.scenario === "three_min" && <label className={styles.field}>Thời gian khách im lặng (phút)
              <input type="number" min={0} max={1440} value={data.minutesSilent} onChange={e => change({minutesSilent:clampMinutes(e.target.value)})} />
              <Toggle label="Tin cuối cùng do AI gửi" checked={data.lastSpeaker === "ai"} onChange={v => change({lastSpeaker:v?"ai":"customer"})} />
            </label>}

            {isWeather && <div className={styles.group}>
              <h3>Dự báo & phương án che mưa (giả lập)</h3>
              <Toggle label="Dự báo đã được xác minh" checked={data.forecastVerified} onChange={v => change({forecastVerified:v})} />
              <Toggle label="Thời tiết có thể lạnh" checked={data.mayBeCold} onChange={v => change({mayBeCold:v})} />
              <Toggle label="Dự báo có mưa" checked={data.rainForecast} onChange={v => change({rainForecast:v})} />
              <Toggle label="Có rạp và căng tăng che mưa, đã xác nhận tại địa điểm" checked={data.canopyConfirmed} onChange={v => change({canopyConfirmed:v})} />
            </div>}

            {data.scenario === "after_purchase" && <Toggle label="BTC xác nhận lịch giao lưu chụp ảnh với ca sĩ" checked={data.artistPhotoConfirmed} onChange={v => change({artistPhotoConfirmed:v})} />}

            {data.scenario === "complaint" && <label className={styles.field}>Số hotline chính thức (chỉ nhập khi đã xác minh)
              <input value={data.verifiedHotline} onChange={e => change({verifiedHotline:e.target.value})} placeholder="Chưa có số hotline xác minh" />
            </label>}

            {data.scenario === "images" && <div className={styles.group}>
              <h3>Hai ảnh sơ đồ chính thức</h3>
              <p className={styles.hint}>Chỉ điền URL HTTPS của ảnh đã được duyệt. Bản demo không tải lên hoặc gửi ảnh.</p>
              {[0,1].map(i => <label className={styles.field} key={i}>Ảnh sơ đồ {i+1}
                <input value={data.seatMapUrls[i] || ""} placeholder={"https://.../so-do-"+(i+1)+".png"}
                  onChange={e => change({seatMapUrls:[i===0?e.target.value:data.seatMapUrls[0]||"", i===1?e.target.value:data.seatMapUrls[1]||""]})} />
              </label>)}
            </div>}

            {data.scenario === "voice" && <div className={styles.group}>
              <Toggle label="Khách đã đồng ý nhận voice" checked={data.voiceConsent} onChange={v => change({voiceConsent:v})} />
              <Toggle label="Kênh voice thử nghiệm đã được xác minh" checked={data.audioChannelReady} onChange={v => change({audioChannelReady:v})} />
            </div>}

            <h3>Kiểm soát quyền nhắn tin</h3>
            <div className={styles.group}>
              <Toggle label="Trong cửa sổ phản hồi Messenger hợp lệ" checked={data.withinMessengerWindow} onChange={v => change({withinMessengerWindow:v})} />
              {(data.scenario === "day_before" || data.scenario === "three_min") &&
                <Toggle label="Khách đồng ý nhận tin marketing phù hợp" checked={data.marketingOptIn} onChange={v => change({marketingOptIn:v})} />}
              {["day_before", "show_day", "after_purchase", "after_show"].includes(data.scenario) &&
                <Toggle label="Khách đồng ý thông báo dịch vụ phù hợp" checked={data.serviceNotificationOptIn} onChange={v => change({serviceNotificationOptIn:v})} />}
              <Toggle label="Khách từ chối nhận tin" checked={data.optedOut} onChange={v => change({optedOut:v})} />
              <Toggle label="Nhân viên đang xử lý" checked={data.humanHandling} onChange={v => change({humanHandling:v})} />
              {isReminder && <Toggle label="Đã gửi lời nhắc trước đó" checked={data.reminderAlreadySent} onChange={v => change({reminderAlreadySent:v})} />}
            </div>
          </section>
        </div>

        <aside className={styles.right}>
          <section className={styles.result}>
            <div className={styles.resultHead}><span className={result.eligible ? styles.ok : styles.blocked}>{result.eligible ? "CÓ THỂ MÔ PHỎNG" : "TẠM KHÔNG GỬI"}</span><span>KHÔNG CÓ GỬI THẬT</span></div>
            <h2>{result.title}</h2>
            <p className={styles.reason}>{result.reason}</p>
            <div className={styles.chat}>
              <div className={styles.chatLabel}>AI SALE · PHẢN HỒI DỰ KIẾN</div>
              {result.message ? <p>{result.message}</p> : <p className={styles.empty}>Không tạo lời nhắn cho tình huống hiện tại. Hãy thay đổi điều kiện bên trái để kiểm tra.</p>}
            </div>
            {result.attachments.length > 0 && <div className={styles.attachments}>
              <strong>Hai tệp đính kèm dự kiến</strong>
              {result.attachments.map((url,i)=><div key={i}>Ảnh {i+1}: {url}</div>)}
            </div>}
            <h3>Kiểm soát</h3>
            <ul>{result.notes.length ? result.notes.map((note,i)=><li key={i}>{note}</li>) :
              <li>Không phát sinh API Messenger, không tạo đơn, không thay đổi trạng thái thanh toán.</li>}</ul>
            <button className={styles.reset} onClick={() => setData(initial21)}>Đặt lại tất cả tình huống</button>
          </section>
          <div className={styles.footnote}>Dữ liệu trên trang này chỉ nhằm kiểm thử kịch bản. Tốc độ Messenger, quyền nhắn ngoài 24 giờ, ảnh thật và voice thật phải được xác minh riêng trước khi sử dụng với khách hàng.</div>
        </aside>
      </div>
      <footer className={styles.footer}>+1 EXTRA MUSIC SHOW · AI Sale Extra 2.1 Test · 25/11/2026</footer>
    </div>
  </main>;
}

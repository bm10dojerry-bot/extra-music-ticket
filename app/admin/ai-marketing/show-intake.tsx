"use client";

import {useRef, useState, type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {venues} from "../../../lib/venues";
import styles from "./workspace.module.css";

const fields = [
  ["bookingVnd", "Booking nghệ sĩ"],
  ["productionVnd", "Tổ chức show"],
  ["adsVnd", "Hạn mức quảng cáo"],
  ["printingVnd", "Banner, poster và in ấn"],
  ["otherVnd", "Thuế, hoa hồng và chi phí khác"],
  ["startingPriceVnd", "Giá vé khởi điểm"],
  ["targetProfitVnd", "Lợi nhuận mục tiêu"],
] as const;

export default function ShowIntakeForm() {
  const router = useRouter();
  const pending = useRef(false);
  const previous = useRef<{payload: string; key: string} | null>(null);
  const [venueId, setVenueId] = useState("");
  const [website, setWebsite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const knownVenue = venues.find(venue => venue.id === venueId);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const data = new FormData(event.currentTarget);
    const show = {
      artist: data.get("artist"), startsAt: data.get("startsAt"),
      venue: knownVenue?.name ?? data.get("venue"), venueId,
      capacity: Number(data.get("capacity")), mediaDriveUrl: data.get("mediaDriveUrl"),
      setlist: data.get("setlist"), artistConfirmed: data.has("artistConfirmed"),
      mediaRightsConfirmed: data.has("mediaRightsConfirmed"),
      permissions: ["website", "facebook", "ads"].filter(permission => data.has(permission)),
      ...Object.fromEntries(fields.map(([name]) => [name, Number(data.get(name))])),
    };
    const payload = JSON.stringify(show);
    if (previous.current?.payload !== payload) previous.current = {payload, key: crypto.randomUUID()};
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/extra-os", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({action: "start", requestId: previous.current.key, show}),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      router.push("/admin/ai-marketing?show=" + encodeURIComponent(result.id));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chưa khởi động được EXTRA OS.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <form onSubmit={start} className={styles.intake}>
    <fieldset>
      <legend>Thông tin show</legend>
      <div className={styles.formGrid}>
        <label>Nghệ sĩ<input name="artist" maxLength={150} autoComplete="off" required /></label>
        <label>Ngày giờ diễn · Việt Nam<input name="startsAt" type="datetime-local" required /></label>
        <label>Địa điểm có sơ đồ bán vé
          <select name="venueId" value={venueId} onChange={event => setVenueId(event.target.value)}>
            <option value="">Địa điểm khác</option>
            {venues.map(venue => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
        </label>
        {knownVenue ? null : <label>Tên địa điểm<input name="venue" maxLength={150} required /></label>}
        <label>Sức chứa<input key={venueId} name="capacity" type="number" min={1} max={100000} step="1"
          defaultValue={knownVenue?.capacity} required /></label>
      </div>
    </fieldset>
    <fieldset>
      <legend>Ngân sách và mục tiêu</legend>
      <div className={styles.formGrid}>
        {fields.map(([key, label]) => <label key={key}>{label} · đ
          <input name={key} type="number" min={key === "startingPriceVnd" ? 1 : 0} step="1"
            max={key === "startingPriceVnd" ? 100000000 : 100000000000}
            defaultValue={key === "startingPriceVnd" ? undefined : 0} required />
        </label>)}
      </div>
    </fieldset>
    <fieldset>
      <legend>Tư liệu và quyền sử dụng</legend>
      <div className={styles.formGrid}>
        <label>Link Google Drive<input name="mediaDriveUrl" type="url" maxLength={600}
          placeholder="https://drive.google.com/…" required /></label>
        <label>Danh sách bài hát<textarea name="setlist" rows={4} maxLength={6000} required /></label>
      </div>
      <label className={styles.check}><input name="artistConfirmed" type="checkbox" required /> Đã xác nhận nghệ sĩ</label>
      <label className={styles.check}><input name="mediaRightsConfirmed" type="checkbox" required /> Có quyền sử dụng hình ảnh, video và tư liệu</label>
    </fieldset>
    <fieldset>
      <legend>Quyền tự động cho show này</legend>
      <label className={styles.check}><input name="website" type="checkbox" checked={website}
        onChange={event => setWebsite(event.target.checked)} /> Đăng show và mở bán trên website</label>
      <label className={styles.check}><input name="facebook" type="checkbox" disabled={!website} /> Đăng Facebook</label>
      <label className={styles.check}><input name="ads" type="checkbox" disabled={!website} /> Chạy và tối ưu Meta Ads trong hạn mức đã nhập</label>
    </fieldset>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <button className={styles.primary} type="submit" disabled={busy}>{busy ? "Đang khởi động…" : "KHỞI ĐỘNG EXTRA OS"}</button>
  </form>;
}

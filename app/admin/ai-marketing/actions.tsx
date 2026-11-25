"use client";

import {useRef, useState, type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {departmentLabels, type Department} from "../../../lib/marketing-workspace";
import type {OsTask} from "../../../lib/extra-os/types";
import styles from "./workspace.module.css";

export function OsAction({children, payload}: {children: React.ReactNode; payload: Record<string, unknown>}) {
  const {submit, pending, error} = useAction();
  return <div>
    <button type="button" disabled={pending} onClick={() => void submit(payload)}>{pending ? "Đang lưu…" : children}</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>;
}

function useAction() {
  const router = useRouter();
  const inProgress = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(payload: Record<string, unknown>) {
    if (inProgress.current) return false;
    inProgress.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/extra-os", {
        method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      router.refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chưa lưu được thay đổi.");
      return false;
    } finally {
      inProgress.current = false;
      setPending(false);
    }
  }
  return {submit, pending, error};
}

export function ReportTask({task, admin}: {task: OsTask; admin: boolean}) {
  const {submit, pending, error} = useAction();
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = new FormData(form);
    const saved = await submit({
      action: "report", taskId: task.id, status: input.get("status"), note: input.get("note"),
      links: String(input.get("links") || "").split("\n").map(value => value.trim()).filter(Boolean),
    });
    if (saved) form.reset();
  }

  return <form onSubmit={send} className={styles.reportForm}>
    <label>Trạng thái
      <select name="status" defaultValue={task.status === "blocked" ? "blocked" : "in_progress"}>
        <option value="in_progress">Đang thực hiện</option>
        <option value="submitted">Gửi nghiệm thu</option>
        <option value="blocked">Báo khó khăn</option>
        {admin && task.status === "submitted" && <option value="accepted">Nghiệm thu</option>}
      </select>
    </label>
    <label>Nội dung báo cáo<textarea name="note" rows={3} maxLength={5000} required /></label>
    <label>Link kết quả · mỗi dòng một link<textarea name="links" rows={2} maxLength={4800} /></label>
    <button type="submit" disabled={pending}>{pending ? "Đang gửi…" : "Gửi báo cáo"}</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </form>;
}

export function AssignDepartment({department, staffId, people}: {
  department: Department;
  staffId: string | null;
  people: {id: string; display_name: string; username: string}[];
}) {
  const {submit, pending, error} = useAction();
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = new FormData(event.currentTarget).get("staff");
    await submit({action:"assign", department, staffId:id || null});
  }
  return <form onSubmit={assign} className={styles.assignment}>
    <label>{departmentLabels[department]}
      <select name="staff" defaultValue={staffId ?? ""} key={staffId ?? "unassigned"}>
        <option value="">Không có người phụ trách</option>
        {staffId && !people.some(person => person.id === staffId) && <option value={staffId} disabled>Tài khoản đã ngừng hoạt động</option>}
        {people.map(person => <option key={person.id} value={person.id}>{person.display_name} ({person.username})</option>)}
      </select>
    </label>
    <button type="submit" disabled={pending}>Lưu người phụ trách</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </form>;
}

export function RecordAdBill({id, spent}: {id: string; spent: number}) {
  const {submit, pending, error} = useAction();
  async function bill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit({action: "bill", allocationId: id, amount: Number(new FormData(event.currentTarget).get("amount"))});
  }
  return <form onSubmit={bill} className={styles.assignment}>
    <label>Hóa đơn cuối kỳ · đ<input name="amount" type="number" defaultValue={spent} min={spent} step={1} required /></label>
    <button type="submit" disabled={pending}>Ghi nhận hóa đơn</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </form>;
}

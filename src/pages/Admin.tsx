import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type { Account, Appeal, Booking, ScheduleRequest, Slot, Speaker, Studio } from "../types";
import { Button, Card, EmptyState, Field, Input, SectionTitle, Badge, Spinner, Textarea } from "../ui";
import { SlotChips } from "./Studio";
import { cn } from "@/lib/utils";

interface Overview {
  accounts: Account[];
  studios: Studio[];
  speakers: Speaker[];
  slots: Slot[];
  requests: ScheduleRequest[];
  bookings: Booking[];
  appeals: Appeal[];
}

const TABS = [
  ["appeals", "申诉审批"],
  ["studios", "录音棚"],
  ["speakers", "发音人"],
  ["bookings", "预约总览"],
  ["accounts", "账号管理"],
] as const;

export function AdminDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<string>("appeals");

  const reload = async () => {
    const r = await api.get("admin/overview");
    setData(r);
  };
  useEffect(() => { reload().catch(() => {}); }, []);

  if (!data) return <div className="flex justify-center py-16"><Spinner /></div>;

  const pendingAppeals = data.appeals.filter((a) => a.status === "pending").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "rounded-lg border px-4 py-2 text-sm transition",
              tab === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent",
            )}
          >
            {label}
            {id === "appeals" && pendingAppeals > 0 && (
              <span className="ml-2 rounded-full bg-destructive px-1.5 text-[10px] text-white">{pendingAppeals}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "appeals" && <AppealsTab data={data} onChanged={reload} />}
      {tab === "studios" && <StudiosTab data={data} onChanged={reload} />}
      {tab === "speakers" && <SpeakersTab data={data} onChanged={reload} />}
      {tab === "bookings" && <BookingsTab data={data} />}
      {tab === "accounts" && <AccountsTab data={data} onChanged={reload} />}
    </div>
  );
}

function AppealsTab({ data, onChanged }: { data: Overview; onChanged: () => void }) {
  const studioById = useMemo(() => new Map(data.studios.map((s) => [s.id, s])), [data.studios]);
  const bookingById = useMemo(() => new Map(data.bookings.map((b) => [b.id, b])), [data.bookings]);
  const speakerById = useMemo(() => new Map(data.speakers.map((s) => [s.id, s])), [data.speakers]);
  const [busy, setBusy] = useState("");

  const resolve = async (appealId: string, decision: "approved" | "rejected") => {
    setBusy(appealId + decision);
    try { await api.post("admin/resolve-appeal", { appeal_id: appealId, decision }); await onChanged(); }
    catch { /* ignore */ } finally { setBusy(""); }
  };

  const pending = data.appeals.filter((a) => a.status === "pending");
  const resolved = data.appeals.filter((a) => a.status !== "pending");

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <SectionTitle>待处理申诉</SectionTitle>
        {pending.length === 0 ? <EmptyState>没有待处理的申诉</EmptyState> : (
          <div className="flex flex-col gap-3">
            {pending.map((a) => {
              const studio = studioById.get(a.studio_id);
              const booking = bookingById.get(a.booking_id);
              const speaker = booking ? speakerById.get(booking.speaker_id) : null;
              return (
                <div key={a.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{studio?.name ?? "录音棚"} <span className="text-xs text-muted-foreground">申诉释放档期</span></p>
                      {speaker && <p className="text-xs text-muted-foreground">涉及:{speaker.project_name} · {speaker.stage_name}</p>}
                      <p className="mt-2 text-sm">申诉原因:{a.reason}</p>
                      {booking && <SlotChips keys={booking.slots} />}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="danger" disabled={!!busy} onClick={() => resolve(a.id, "approved")}>通过(释放档期)</Button>
                      <Button variant="outline" disabled={!!busy} onClick={() => resolve(a.id, "rejected")}>驳回</Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>历史申诉</SectionTitle>
        {resolved.length === 0 ? <EmptyState>暂无</EmptyState> : (
          <div className="flex flex-col gap-2">
            {resolved.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                <span>{studioById.get(a.studio_id)?.name} — {a.reason}</span>
                <Badge tone={a.status === "approved" ? "green" : "gray"}>{a.status === "approved" ? "已通过" : "已驳回"}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StudiosTab({ data, onChanged }: { data: Overview; onChanged: () => void }) {
  const counts = useMemo(() => {
    const m = new Map<string, { free: number; locked: number }>();
    for (const s of data.slots) {
      const c = m.get(s.studio_id) ?? { free: 0, locked: 0 };
      s.status === "free" ? c.free++ : c.locked++;
      m.set(s.studio_id, c);
    }
    return m;
  }, [data.slots]);

  if (data.studios.length === 0) return <EmptyState>还没有录音棚。可在「账号管理」创建录音棚账号,由其自行完善信息。</EmptyState>;

  return (
    <div className="flex flex-col gap-3">
      {data.studios.map((s) => {
        const c = counts.get(s.id) ?? { free: 0, locked: 0 };
        return (
          <Card key={s.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{s.name} <Badge tone="blue">{s.city}</Badge></p>
                <p className="text-sm text-muted-foreground">{s.address} · {s.email}</p>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                空闲 <b className="text-emerald-600">{c.free}</b> · 锁定 <b className="text-amber-600">{c.locked}</b>
              </div>
            </div>
            <AdminNote targetType="studio" targetId={s.id} value={s.admin_note ?? ""} onSaved={onChanged} />
          </Card>
        );
      })}
    </div>
  );
}

function SpeakersTab({ data, onChanged }: { data: Overview; onChanged: () => void }) {
  if (data.speakers.length === 0) return <EmptyState>还没有发音人记录。</EmptyState>;
  return (
    <div className="flex flex-col gap-3">
      {data.speakers.map((s) => (
        <Card key={s.id}>
          <p className="font-medium">{s.project_name} · {s.stage_name}</p>
          <p className="text-sm text-muted-foreground">{s.email}</p>
          <AdminNote targetType="speaker" targetId={s.id} value={s.admin_note ?? ""} onSaved={onChanged} />
        </Card>
      ))}
    </div>
  );
}

function BookingsTab({ data }: { data: Overview }) {
  const studioById = useMemo(() => new Map(data.studios.map((s) => [s.id, s])), [data.studios]);
  const speakerById = useMemo(() => new Map(data.speakers.map((s) => [s.id, s])), [data.speakers]);
  if (data.bookings.length === 0) return <EmptyState>暂无预约。</EmptyState>;
  return (
    <div className="flex flex-col gap-3">
      {data.bookings.map((b) => {
        const studio = studioById.get(b.studio_id);
        const speaker = speakerById.get(b.speaker_id);
        return (
          <Card key={b.id}>
            <div className="flex items-center justify-between">
              <p className="font-medium">{speaker?.project_name} · {speaker?.stage_name}</p>
              <Badge tone={b.status === "confirmed" ? "green" : "gray"}>{b.status === "confirmed" ? "已确认" : "已释放"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{studio?.name} · {studio?.city} · {studio?.address}</p>
            <SlotChips keys={b.slots} />
          </Card>
        );
      })}
    </div>
  );
}

function AccountsTab({ data, onChanged }: { data: Overview; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ role: "studio", username: "", password: "", display_name: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.post("admin/create-account", {
        role: form.role, username: form.username.trim(), password: form.password,
        display_name: form.display_name.trim(), email: form.email.trim(),
      });
      setForm({ role: "studio", username: "", password: "", display_name: "", email: "" });
      setOpen(false);
      await onChanged();
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : "创建失败"); }
    finally { setBusy(false); }
  };

  const del = async (id: string) => {
    if (!confirm("确认删除该账号?其录音棚的空闲档期将一并移除,历史预约保留。")) return;
    try { await api.post("admin/delete-account", { account_id: id }); await onChanged(); }
    catch (e) { alert(e instanceof ApiError ? e.message : "删除失败"); }
  };

  const roleLabel: Record<string, string> = { admin: "后台", studio: "录音棚", vendor: "发音人供应商" };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <SectionTitle right={<Button onClick={() => setOpen((v) => !v)}>{open ? "取消" : "新增账号"}</Button>}>账号列表</SectionTitle>
        {open && (
          <form onSubmit={create} className="mb-4 grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
            <Field label="角色">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="studio">录音棚</option>
                <option value="vendor">发音人 / 供应商</option>
                <option value="admin">后台管理</option>
              </select>
            </Field>
            <Field label="用户名"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></Field>
            <Field label="初始密码" hint="至少 6 位"><Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
            <Field label="显示名称"><Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
            <Field label="联系邮箱"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            {err && <p className="text-sm text-destructive sm:col-span-2">{err}</p>}
            <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? "创建中…" : "创建账号"}</Button></div>
          </form>
        )}
        <div className="flex flex-col gap-2">
          {data.accounts.map((a) => (
            <div key={a.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{a.username} <Badge tone="gray">{roleLabel[a.role]}</Badge></p>
                  <p className="text-xs text-muted-foreground">{a.display_name} {a.email && `· ${a.email}`}</p>
                </div>
                <Button variant="outline" onClick={() => del(a.id)}>删除</Button>
              </div>
              <AdminNote targetType="account" targetId={a.id} value={a.admin_note ?? ""} onSaved={onChanged} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AdminNote({ targetType, targetId, value, onSaved }: {
  targetType: "account" | "studio" | "speaker"; targetId: string; value: string; onSaved: () => void;
}) {
  const [note, setNote] = useState(value);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = note !== value;

  const save = async () => {
    setBusy(true); setSaved(false);
    try {
      await api.post("admin/note", { target_type: targetType, target_id: targetId, admin_note: note });
      setSaved(true);
      onSaved();
    } catch { /* ignore */ } finally { setBusy(false); }
  };

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        仅后台可见备注{value ? "(已填写)" : ""}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <Textarea value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} placeholder="备注仅后台可见,双方均不可见" />
        <div className="flex items-center gap-2">
          <Button variant="subtle" disabled={busy || !dirty} onClick={save}>{busy ? "保存中…" : "保存备注"}</Button>
          {saved && <span className="text-xs text-emerald-600">已保存</span>}
        </div>
      </div>
    </details>
  );
}

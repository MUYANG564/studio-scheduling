import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type { Booking, Slot, Studio } from "../types";
import { Button, Card, EmptyState, Field, Input, SectionTitle, Textarea, Badge, Spinner } from "../ui";
import { ScheduleGrid } from "../ScheduleGrid";
import { slotKey, groupKeys, shortDate, weekday } from "../slots";

export function StudioDashboard() {
  const [studio, setStudio] = useState<Studio | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const loadAll = async () => {
    const me = await api.get("studio/me");
    setStudio(me.studio);
    setNeedsSetup(me.needs_setup);
    if (!me.needs_setup) {
      const [s, b] = await Promise.all([api.get("studio/slots"), api.get("studio/bookings")]);
      setSlots(s.slots ?? []);
      setBookings(b.bookings ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { loadAll().catch(() => setLoading(false)); }, []);

  const selected = useMemo(() => new Set(slots.filter((s) => s.status === "free").map((s) => slotKey(s.date, s.start))), [slots]);
  const locked = useMemo(() => new Set(slots.filter((s) => s.status === "locked").map((s) => slotKey(s.date, s.start))), [slots]);

  const toggle = async (key: string) => {
    const [date, start] = key.split(" ");
    const available = !selected.has(key);
    setMsg("");
    try {
      const r = await api.post("studio/slots/set", { date, start, available });
      setSlots(r.slots ?? []);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "更新失败");
    }
  };

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (needsSetup) return <StudioSetup onDone={loadAll} />;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle right={<Badge tone="blue">{studio?.city}</Badge>}>{studio?.name}</SectionTitle>
        <p className="text-sm text-muted-foreground">{studio?.address}</p>
        <p className="mt-1 text-sm text-muted-foreground">联系邮箱:{studio?.email}</p>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">修改棚信息</summary>
          <div className="mt-3"><StudioSetup studio={studio} onDone={loadAll} /></div>
        </details>
      </Card>

      <Card>
        <SectionTitle>档期维护(半小时精度)</SectionTitle>
        <p className="mb-4 text-sm text-muted-foreground">点击时段切换空闲/关闭,改动即时保存。被预约锁定的时段需通过下方「申诉」释放。</p>
        {msg && <p className="mb-3 text-sm text-destructive">{msg}</p>}
        <ScheduleGrid selected={selected} locked={locked} onToggle={toggle} legend="studio" />
      </Card>

      <Card>
        <SectionTitle>已确认预约</SectionTitle>
        <StudioBookings bookings={bookings.filter((b) => b.status === "confirmed")} onAppealed={loadAll} />
      </Card>
    </div>
  );
}

function StudioSetup({ studio, onDone }: { studio?: Studio | null; onDone: () => void }) {
  const [name, setName] = useState(studio?.name ?? "");
  const [city, setCity] = useState(studio?.city ?? "");
  const [address, setAddress] = useState(studio?.address ?? "");
  const [email, setEmail] = useState(studio?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.post("studio/setup", { name: name.trim(), city: city.trim(), address: address.trim(), email: email.trim() });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "保存失败");
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {!studio && (
        <div>
          <h2 className="text-lg font-semibold">完善录音棚信息</h2>
          <p className="text-sm text-muted-foreground">仅需填写一次,之后无需重复输入名称与地点。</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="录音棚名称"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="所在城市"><Input value={city} onChange={(e) => setCity(e.target.value)} required /></Field>
      </div>
      <Field label="详细地点"><Input value={address} onChange={(e) => setAddress(e.target.value)} required /></Field>
      <Field label="联系邮箱" hint="用于接收预约与申诉结果的邮件提醒"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存"}</Button></div>
    </form>
  );
}

function StudioBookings({ bookings, onAppealed }: { bookings: Booking[]; onAppealed: () => void }) {
  const [appealFor, setAppealFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (bookings.length === 0) return <EmptyState>暂无预约</EmptyState>;

  const submitAppeal = async (bookingId: string) => {
    setBusy(true); setErr("");
    try {
      await api.post("studio/appeal", { booking_id: bookingId, reason: reason.trim() });
      setAppealFor(null); setReason("");
      onAppealed();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "提交失败");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      {bookings.map((b) => (
        <div key={b.id} className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{b.project_name} · {b.stage_name}</p>
              <p className="text-xs text-muted-foreground">共 {b.slots.length} 个档期</p>
            </div>
            <Button variant="outline" onClick={() => { setAppealFor(appealFor === b.id ? null : b.id); setReason(""); setErr(""); }}>
              {appealFor === b.id ? "取消" : "申诉释放"}
            </Button>
          </div>
          <SlotChips keys={b.slots} />
          {appealFor === b.id && (
            <div className="mt-3 flex flex-col gap-2">
              <Textarea placeholder="请说明申诉原因(例如:该档期已线下预定,尚未及时更新)" value={reason} onChange={(e) => setReason(e.target.value)} />
              {err && <p className="text-sm text-destructive">{err}</p>}
              <div><Button variant="danger" disabled={busy || !reason.trim()} onClick={() => submitAppeal(b.id)}>{busy ? "提交中…" : "提交申诉至后台"}</Button></div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SlotChips({ keys }: { keys: string[] }) {
  const groups = groupKeys(keys);
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {groups.map((g) => (
        <div key={g.date} className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">{shortDate(g.date)} {weekday(g.date)}</span>
          {g.starts.map((t) => (
            <span key={t} className="rounded bg-secondary px-1.5 py-0.5 text-xs">{t}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

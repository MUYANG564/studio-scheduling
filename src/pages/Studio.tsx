import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type { Booking, BusinessHours, Slot, Studio } from "../types";
import { Button, Card, EmptyState, Field, Input, SectionTitle, Textarea, Badge, Spinner } from "../ui";
import { BackupButton } from "../BackupButton";
import { ScheduleGrid } from "../ScheduleGrid";
import {
  ALL_DAY_END, ALL_DAY_START, groupKeys, halfHours, isWithinBusinessHours,
  normalizeBusinessHours, shortDate, slotKey, upcomingDates, weekday,
} from "../slots";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function StudioDashboard() {
  const [studio, setStudio] = useState<Studio | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

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

  const dates = useMemo(() => upcomingDates(), []);
  const times = useMemo(() => halfHours(ALL_DAY_START, ALL_DAY_END), []);
  const locked = useMemo(() => new Set(slots.filter((slot) => slot.status === "locked").map((slot) => slotKey(slot.date, slot.start))), [slots]);
  const blocked = useMemo(() => new Set(slots.filter((slot) => slot.status === "blocked").map((slot) => slotKey(slot.date, slot.start))), [slots]);
  const special = useMemo(() => new Set(slots.filter((slot) => slot.status === "free").map((slot) => slotKey(slot.date, slot.start))), [slots]);
  const marked = useMemo(() => new Set([...locked, ...blocked, ...special]), [blocked, locked, special]);
  const selected = useMemo(() => new Set(
    dates.flatMap((date) => times.map((start) => slotKey(date, start))).filter((key) => {
      if (blocked.has(key) || locked.has(key)) return false;
      if (special.has(key)) return true;
      const [date, start] = key.split(" ");
      return isWithinBusinessHours(studio?.business_hours, date, start);
    }),
  ), [blocked, dates, locked, special, studio?.business_hours, times]);

  const setAvailability = async (keys: string[], available: boolean) => {
    setMsg("");
    try {
      const r = await api.post("studio/slots/set", {
        slots: keys.map((key) => {
          const [date, start] = key.split(" ");
          return { date, start, available };
        }),
      });
      setSlots(r.slots ?? []);
      if (r.skipped?.length) setMsg("已预约的档期不能改为占用，如需释放请在下方提交申诉。");
    } catch (error) {
      setMsg(error instanceof ApiError ? error.message : "更新失败");
    }
  };

  const toggle = (key: string) => setAvailability([key], !selected.has(key));

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (needsSetup) return <StudioSetup onDone={loadAll} />;

  const confirmedCount = bookings.filter((booking) => booking.status === "confirmed").length;
  const pendingCount = bookings.filter((booking) => booking.appeal_status === "pending").length;

  return (
    <div className="flex flex-col gap-5">
      <Card className="border-0 bg-gradient-to-br from-slate-950 via-slate-900 to-violet-950 text-white shadow-xl">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-violet-200">录音棚工作台</p>
              <Badge tone="blue">{studio?.city}</Badge>
            </div>
            <h1 className="mt-1 text-2xl font-semibold">{studio?.name}</h1>
            <p className="mt-2 text-sm text-slate-300">{studio?.address}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="bg-violet-500 text-white hover:bg-violet-400" onClick={() => setScheduleOpen(true)}>维护档期</Button>
            <Button className="border-white/20 bg-white/10 text-white hover:bg-white/20" variant="outline" onClick={() => setHoursOpen(true)}>营业时间</Button>
            <Button className="border-white/20 bg-white/10 text-white hover:bg-white/20" variant="outline" onClick={() => setProfileOpen(true)}>棚资料</Button>
            <BackupButton className="border-white/20 bg-white/10 text-white hover:bg-white/20" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-center">
          <StudioMetric label="有效预约" value={confirmedCount} />
          <StudioMetric label="取消审核中" value={pendingCount} />
          <StudioMetric label="特别开放" value={special.size} />
        </div>
      </Card>

      {msg && <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{msg}</p>}

      <Card>
        <SectionTitle right={<Badge tone="blue">{bookings.length} 条记录</Badge>}>预约记录</SectionTitle>
        <StudioBookings bookings={bookings} onAppealed={loadAll} />
      </Card>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>录音棚资料</DialogTitle>
            <DialogDescription>这里的信息会显示给预约方。邮箱仅作为联系资料，不发送系统邮件。</DialogDescription>
          </DialogHeader>
          <StudioSetup studio={studio} onDone={async () => { await loadAll(); setProfileOpen(false); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={hoursOpen} onOpenChange={setHoursOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>每周营业时间</DialogTitle>
            <DialogDescription>营业时间内默认可预约，休息日和非营业时间无需逐个关闭。</DialogDescription>
          </DialogHeader>
          <BusinessHoursEditor
            value={studio?.business_hours}
            onSaved={(businessHours) => setStudio((current) => current ? { ...current, business_hours: businessHours } : current)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>档期例外维护</DialogTitle>
            <DialogDescription>营业时间内可标记临时占用；非营业时间可设置特别开放。支持拖选。</DialogDescription>
          </DialogHeader>
          {msg && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</p>}
          <ScheduleGrid
            selected={selected}
            locked={locked}
            special={special}
            counted={marked}
            onToggle={toggle}
            onBatchChange={setAvailability}
            dates={dates}
            times={times}
            legend="studio"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StudioMetric({ label, value }: { label: string; value: number }) {
  return <div><p className="text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-slate-300">{label}</p></div>;
}

const BUSINESS_DAYS = [
  ["1", "周一"], ["2", "周二"], ["3", "周三"], ["4", "周四"],
  ["5", "周五"], ["6", "周六"], ["0", "周日"],
] as const;

function BusinessHoursEditor({ value, onSaved }: {
  value?: BusinessHours;
  onSaved: (businessHours: BusinessHours) => void;
}) {
  const [hours, setHours] = useState(() => normalizeBusinessHours(value));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const starts = useMemo(() => halfHours(ALL_DAY_START, ALL_DAY_END), []);
  const ends = useMemo(() => [...starts.slice(1), ALL_DAY_END], [starts]);

  useEffect(() => { setHours(normalizeBusinessHours(value)); }, [value]);

  const updateDay = (day: string, change: Partial<BusinessHours[string]>) => {
    setHours((current) => {
      const next = { ...current, [day]: { ...current[day], ...change } };
      if (next[day].start >= next[day].end) {
        const startIndex = starts.indexOf(next[day].start);
        next[day].end = starts[startIndex + 1] ?? ALL_DAY_END;
      }
      return next;
    });
    setMessage("");
  };

  const save = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await api.post("studio/business-hours", { business_hours: hours });
      onSaved(result.business_hours);
      setMessage("营业时间已保存");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "保存失败");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      {BUSINESS_DAYS.map(([day, label]) => {
        const entry = hours[day];
        return (
          <div key={day} className="grid grid-cols-[4rem_1fr] items-center gap-3 rounded-lg border border-border p-3 sm:grid-cols-[4rem_5rem_1fr_auto_1fr]">
            <span className="font-medium">{label}</span>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={entry.enabled} onChange={(event) => updateDay(day, { enabled: event.target.checked })} />
              {entry.enabled ? "营业" : "休息"}
            </label>
            <select
              aria-label={`${label}开始时间`}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              disabled={!entry.enabled}
              value={entry.start}
              onChange={(event) => updateDay(day, { start: event.target.value })}
            >
              {starts.map((time) => <option key={time} value={time}>{time}</option>)}
            </select>
            <span className="hidden text-center text-sm text-muted-foreground sm:block">至</span>
            <select
              aria-label={`${label}结束时间`}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              disabled={!entry.enabled}
              value={entry.end}
              onChange={(event) => updateDay(day, { end: event.target.value })}
            >
              {ends.filter((time) => time > entry.start).map((time) => <option key={time} value={time}>{time}</option>)}
            </select>
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <Button disabled={busy} onClick={save}>{busy ? "保存中…" : "保存营业时间"}</Button>
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
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
      <Field label="联系邮箱（选填）" hint="仅作为联系资料保存，系统通知请在右上角查看。"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存"}</Button></div>
    </form>
  );
}

function StudioBookings({ bookings, onAppealed }: { bookings: Booking[]; onAppealed: () => void }) {
  const [appealFor, setAppealFor] = useState<Booking | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ordered = useMemo(() => [...bookings].sort((a, b) => b.created_at.localeCompare(a.created_at)), [bookings]);

  if (ordered.length === 0) return <EmptyState>供应商预约成功后，记录会固定显示在这里。</EmptyState>;

  const submitAppeal = async () => {
    if (!appealFor) return;
    setBusy(true); setErr("");
    try {
      await api.post("studio/appeal", { booking_id: appealFor.id, reason: reason.trim() });
      setAppealFor(null); setReason("");
      await onAppealed();
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : "提交失败");
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {ordered.map((booking) => (
          <div key={booking.id} className={cn("rounded-xl border p-4", booking.status === "released" ? "border-border bg-neutral-50 opacity-75" : "border-border bg-white")}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{booking.project_name} · {booking.stage_name}</p>
                <p className="mt-1 text-xs text-muted-foreground">共 {booking.slots.length} 个半小时档期</p>
              </div>
              <Badge tone={booking.status === "confirmed" ? booking.appeal_status ? "amber" : "green" : "gray"}>
                {booking.status === "released" ? "已取消" : booking.appeal_status ? "取消审核中" : "已确认"}
              </Badge>
            </div>
            <SlotChips keys={booking.slots} />
            {booking.status === "confirmed" && (
              <div className="mt-4 border-t border-border pt-3">
                {booking.appeal_status ? (
                  <p className="text-xs text-amber-700">
                    {booking.appeal_by === "studio" ? "你已提交取消申请，后台正在审核。" : "供应商已申请取消，后台正在审核；审核前预约仍然有效。"}
                  </p>
                ) : (
                  <Button variant="outline" onClick={() => { setAppealFor(booking); setReason(""); setErr(""); }}>申请取消预约</Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {appealFor && (
        <Dialog open onOpenChange={(open) => { if (!open) setAppealFor(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>申请取消预约</DialogTitle>
              <DialogDescription>提交后由后台审核。审核通过前，当前预约和档期仍然有效。</DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-border bg-neutral-50 p-3 text-sm">
              <p className="font-medium">{appealFor.project_name} · {appealFor.stage_name}</p>
              <SlotChips keys={appealFor.slots} />
            </div>
            <Field label="取消原因"><Textarea placeholder="请说明需要取消预约的原因" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAppealFor(null)}>暂不取消</Button>
              <Button variant="danger" disabled={busy || !reason.trim()} onClick={submitAppeal}>{busy ? "提交中…" : "提交后台审核"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
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

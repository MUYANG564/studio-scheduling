import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type {
  Account, AdjustmentOption, Booking, MatchLocation, MatchMode, MatchResult, Speaker, StudioMatch,
} from "../types";
import { Button, Card, EmptyState, Field, Input, SectionTitle, Badge, Spinner, Textarea } from "../ui";
import { BackupButton } from "../BackupButton";
import { ScheduleGrid } from "../ScheduleGrid";
import { ALL_DAY_END, ALL_DAY_START, halfHours, parseKey } from "../slots";
import { SlotChips } from "./Studio";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface CityOption {
  name: string;
  studio_count: number;
}

interface OpenRequest {
  id: string;
  desired: string[];
  preferred_cities?: string[];
  match_mode?: MatchMode;
  status: string;
  project_name: string;
  stage_name: string;
}

type BookingDisplayMode = "studio_first" | "time_first";

interface BookingStudioGroup {
  key: string;
  studioName: string;
  city: string;
  address: string;
  firstSlot: string;
  bookings: Booking[];
}

interface BookingProjectGroup {
  key: string;
  projectName: string;
  stageName: string;
  latestCreatedAt: string;
  bookingCount: number;
  studios: BookingStudioGroup[];
}

const bookingProjectKey = (booking: Booking) => {
  const project = (booking.project_name ?? "").normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
  const speaker = (booking.stage_name ?? "").normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
  return project || speaker ? `${project}\u0000${speaker}` : booking.speaker_id;
};

const firstBookingSlot = (booking: Booking) => [...booking.slots].sort()[0] ?? booking.created_at;

function groupVendorBookings(bookings: Booking[], mode: BookingDisplayMode): BookingProjectGroup[] {
  const projects = new Map<string, { projectName: string; stageName: string; bookings: Booking[] }>();
  for (const booking of bookings) {
    const key = bookingProjectKey(booking);
    const existing = projects.get(key);
    if (existing) existing.bookings.push(booking);
    else projects.set(key, {
      projectName: booking.project_name || "未命名项目",
      stageName: booking.stage_name || "未命名发音人",
      bookings: [booking],
    });
  }

  return [...projects.entries()].map(([key, project]) => {
    const studioMap = new Map<string, BookingStudioGroup>();
    for (const booking of project.bookings) {
      const studioKey = booking.studio_id || `${booking.studio_name}\u0000${booking.city}`;
      const existing = studioMap.get(studioKey);
      if (existing) {
        existing.bookings.push(booking);
        if (firstBookingSlot(booking) < existing.firstSlot) existing.firstSlot = firstBookingSlot(booking);
      } else {
        studioMap.set(studioKey, {
          key: studioKey,
          studioName: booking.studio_name || "未命名录音棚",
          city: booking.city || "未知地区",
          address: booking.address || "",
          firstSlot: firstBookingSlot(booking),
          bookings: [booking],
        });
      }
    }

    const studios = [...studioMap.values()];
    for (const studio of studios) {
      studio.bookings.sort((a, b) => firstBookingSlot(a).localeCompare(firstBookingSlot(b)) || a.id.localeCompare(b.id));
    }
    studios.sort((a, b) => mode === "time_first"
      ? a.firstSlot.localeCompare(b.firstSlot)
        || a.studioName.localeCompare(b.studioName, "zh-CN")
        || a.city.localeCompare(b.city, "zh-CN")
      : a.city.localeCompare(b.city, "zh-CN")
        || a.studioName.localeCompare(b.studioName, "zh-CN")
        || a.firstSlot.localeCompare(b.firstSlot));

    return {
      key,
      projectName: project.projectName,
      stageName: project.stageName,
      latestCreatedAt: project.bookings.reduce((latest, booking) => booking.created_at > latest ? booking.created_at : latest, ""),
      bookingCount: project.bookings.length,
      studios,
    };
  }).sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt) || a.key.localeCompare(b.key));
}

const MODE_LABEL: Record<MatchMode, string> = {
  schedule_first: "档期优先",
  location_first: "位置优先",
};

export function VendorDashboard({ account }: { account: Account }) {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [notice, setNotice] = useState("");
  const [bookingOpen, setBookingOpen] = useState(false);
  const [speakerOpen, setSpeakerOpen] = useState(false);
  const [cancelFor, setCancelFor] = useState<OpenRequest | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");

  const reload = async () => {
    const [sp, rq, bk, options] = await Promise.all([
      api.get("vendor/speakers"), api.get("vendor/requests"), api.get("vendor/bookings"), api.get("vendor/match-options"),
    ]);
    setSpeakers(sp.speakers ?? []);
    setRequests(rq.requests ?? []);
    setBookings(bk.bookings ?? []);
    setCities(options.cities ?? []);
    setLoading(false);
  };
  useEffect(() => { reload().catch(() => setLoading(false)); }, []);

  const openReselect = requests.filter((request) =>
    (request.status === "open" || request.status === "reopened") && request.desired.length > 0);
  const confirmedCount = bookings.filter((booking) => booking.status === "confirmed").length;
  const pendingCount = bookings.filter((booking) => booking.appeal_status === "pending").length;
  const projectCount = new Set(bookings.map(bookingProjectKey)).size;

  const loadMatches = async (requestId: string) => {
    setNotice("");
    const result = await api.get("vendor/request/matches", `&request_id=${encodeURIComponent(requestId)}`);
    setMatch(result);
    setBookingOpen(true);
  };

  const startBooking = () => {
    setMatch(null);
    setNotice("");
    setBookingOpen(true);
  };

  const cancelRequest = async () => {
    if (!cancelFor) return;
    setCancelBusy(true);
    setCancelError("");
    try {
      await api.post("vendor/request/cancel", { request_id: cancelFor.id });
      await reload();
      setCancelFor(null);
      setNotice("待安排需求已取消，已确认的预约不受影响。");
    } catch (error) {
      setCancelError(error instanceof ApiError ? error.message : "取消失败");
    } finally {
      setCancelBusy(false);
    }
  };

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div className="flex flex-col gap-5">
      <Card className="border-0 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white shadow-xl">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
          <div>
            <p className="text-sm text-blue-200">供应商工作台</p>
            <h1 className="mt-1 text-2xl font-semibold">{account.display_name || account.username}</h1>
            <p className="mt-2 text-sm text-slate-300">预约记录固定保留在主页，需要安排新档期时再进入分步操作。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="bg-blue-500 text-white hover:bg-blue-400" onClick={startBooking}>发起新预约</Button>
            <Button className="border-white/20 bg-white/10 text-white hover:bg-white/20" variant="outline" onClick={() => setSpeakerOpen(true)}>新增项目 / 发音人</Button>
            <BackupButton className="border-white/20 bg-white/10 text-white hover:bg-white/20" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-center">
          <SummaryMetric label="有效预约" value={confirmedCount} />
          <SummaryMetric label="待继续安排" value={openReselect.length} />
          <SummaryMetric label="取消审核中" value={pendingCount} />
        </div>
      </Card>

      {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}

      {openReselect.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/60">
          <SectionTitle>待继续安排</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {openReselect.map((request) => (
              <div key={request.id} className="rounded-xl border border-amber-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{request.project_name} · {request.stage_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {request.status === "reopened" ? "原预约已释放，请重新选择" : `还有 ${request.desired.length} 个档期未安排`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => {
                      setCancelError("");
                      setCancelFor(request);
                    }}>取消待安排</Button>
                    <Button onClick={() => loadMatches(request.id)}>{request.status === "reopened" ? "重新选择" : "继续安排"}</Button>
                  </div>
                </div>
                <SlotChips keys={request.desired} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle right={<Badge tone="blue">{projectCount} 个项目</Badge>}>预约记录</SectionTitle>
        <VendorBookings bookings={bookings} onAppealed={reload} />
      </Card>

      <Dialog open={Boolean(cancelFor)} onOpenChange={(open) => { if (!open && !cancelBusy) setCancelFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取消待安排需求</DialogTitle>
            <DialogDescription>仅取消尚未安排的档期，不会影响已经确认的预约。</DialogDescription>
          </DialogHeader>
          {cancelFor && (
            <div className="rounded-lg border border-border bg-neutral-50 p-3 text-sm">
              <p className="font-medium">{cancelFor.project_name} · {cancelFor.stage_name}</p>
              <p className="mt-1 text-muted-foreground">将取消剩余 {cancelFor.desired.length} 个待安排档期</p>
              <SlotChips keys={cancelFor.desired} />
            </div>
          )}
          {cancelError && <p className="text-sm text-destructive">{cancelError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={cancelBusy} onClick={() => setCancelFor(null)}>暂不取消</Button>
            <Button variant="danger" disabled={cancelBusy} onClick={cancelRequest}>{cancelBusy ? "取消中…" : "确认取消待安排"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={speakerOpen} onOpenChange={setSpeakerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增项目 / 发音人</DialogTitle>
            <DialogDescription>保存后可用于发起新的录音棚预约。</DialogDescription>
          </DialogHeader>
          <SpeakerManager onChanged={async () => { await reload(); setSpeakerOpen(false); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
        <DialogContent onInteractOutside={(event) => event.preventDefault()} className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-6xl">
          {match ? (
            <MatchPanel
              match={match}
              notice={notice}
              onBooked={async (text, complete) => {
                await reload();
                if (complete) {
                  setNotice(text);
                  setMatch(null);
                  setBookingOpen(false);
                  return;
                }
                await loadMatches(match.request_id);
                setNotice(text);
              }}
              onAdjusted={async (result, text) => {
                setMatch(result);
                setNotice(text);
                await reload();
              }}
              onClose={() => { setMatch(null); setBookingOpen(false); }}
            />
          ) : (
            <NewRequest
              speakers={speakers}
              cities={cities}
              onMatched={(result) => { setNotice(""); setMatch(result); reload(); }}
              onAddSpeaker={() => { setBookingOpen(false); setSpeakerOpen(true); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return <div><p className="text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-slate-300">{label}</p></div>;
}

function SpeakerManager({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const [project, setProject] = useState("");
  const [stage, setStage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.post("vendor/speaker/create", { project_name: project.trim(), stage_name: stage.trim(), email: email.trim() });
      await onChanged();
    } catch (error) { setErr(error instanceof ApiError ? error.message : "添加失败"); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={add} className="flex flex-col gap-4">
      <Field label="项目名称"><Input value={project} onChange={(event) => setProject(event.target.value)} required /></Field>
      <Field label="发音人艺名 / 姓名"><Input value={stage} onChange={(event) => setStage(event.target.value)} required /></Field>
      <Field label="联系邮箱（选填）" hint="仅作为联系资料保存，系统通知请在右上角查看。">
        <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存项目"}</Button>
    </form>
  );
}

function NewRequest({ speakers, cities, onMatched, onAddSpeaker }: {
  speakers: Speaker[];
  cities: CityOption[];
  onMatched: (result: MatchResult) => void;
  onAddSpeaker: () => void;
}) {
  const [step, setStep] = useState(0);
  const [speakerId, setSpeakerId] = useState("");
  const [desired, setDesired] = useState<Set<string>>(new Set());
  const [preferredCities, setPreferredCities] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const times = useMemo(() => halfHours(ALL_DAY_START, ALL_DAY_END), []);

  useEffect(() => { if (!speakerId && speakers[0]) setSpeakerId(speakers[0].id); }, [speakers, speakerId]);

  const toggleSlot = (key: string) => {
    setDesired((previous) => {
      const next = new Set(previous);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const setSlots = (keys: string[], selected: boolean) => {
    setDesired((previous) => {
      const next = new Set(previous);
      keys.forEach((key) => selected ? next.add(key) : next.delete(key));
      return next;
    });
  };

  const toggleCity = (city: string) => {
    setPreferredCities((previous) => {
      const next = new Set(previous);
      next.has(city) ? next.delete(city) : next.add(city);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const result = await api.post("vendor/request/create", {
        speaker_id: speakerId,
        slots: [...desired].map((key) => parseKey(key)),
        preferred_cities: [...preferredCities],
        match_mode: "schedule_first",
      });
      onMatched(result);
    } catch (error) { setErr(error instanceof ApiError ? error.message : "提交失败"); }
    finally { setBusy(false); }
  };

  const titles = ["选择项目 / 发音人", "选择意向城市", "选择录音日期和时间"];

  return (
    <div className="min-h-[34rem] bg-white">
      <div className="border-b border-border bg-slate-950 px-6 py-5 text-white">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-blue-300">新预约 · 第 {step + 1}/3 步</p>
        <h2 className="mt-1 text-2xl font-semibold">{titles[step]}</h2>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {titles.map((title, index) => (
            <div key={title} className={cn("h-1.5 rounded-full", index <= step ? "bg-blue-400" : "bg-white/15")} />
          ))}
        </div>
      </div>

      <div className="p-5 sm:p-7">
        {speakers.length === 0 ? (
          <div className="mx-auto max-w-md py-14 text-center">
            <p className="font-semibold">还没有项目或发音人</p>
            <p className="mt-2 text-sm text-muted-foreground">请先建立项目资料，再发起预约。</p>
            <Button className="mt-5" onClick={onAddSpeaker}>新增项目 / 发音人</Button>
          </div>
        ) : step === 0 ? (
          <div className="mx-auto max-w-xl py-8">
            <p className="mb-3 text-sm text-muted-foreground">本次预约属于哪个项目和发音人？</p>
            <select
              value={speakerId}
              onChange={(event) => setSpeakerId(event.target.value)}
              className="h-12 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {speakers.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.project_name} · {speaker.stage_name}</option>)}
            </select>
          </div>
        ) : step === 1 ? (
          <div className="mx-auto max-w-2xl py-8">
            <p className="mb-4 text-sm text-muted-foreground">可多选；不选城市时，系统将优先按档期完整度推荐。</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPreferredCities(new Set())}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition",
                  preferredCities.size === 0 ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-background hover:bg-accent",
                )}
              >
                无意向城市
              </button>
              {cities.map((city) => {
                const active = preferredCities.has(city.name);
                return (
                  <button
                    type="button"
                    key={city.name}
                    onClick={() => toggleCity(city.name)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm transition",
                      active ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-background hover:bg-accent",
                    )}
                  >
                    {city.name} <span className="opacity-70">{city.studio_count} 棚</span>
                  </button>
                );
              })}
            </div>
            {cities.length === 0 && <p className="mt-3 text-sm text-amber-700">当前没有可选城市，将按档期匹配。</p>}
          </div>
        ) : (
          <div>
            <p className="mb-4 text-sm text-muted-foreground">未来 31 天全天可选，每格半小时；可按住拖动连续选择或取消。</p>
            <ScheduleGrid selected={desired} onToggle={toggleSlot} onBatchChange={setSlots} times={times} legend="vendor" />
          </div>
        )}

        {err && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}
        {speakers.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <Button variant="outline" disabled={step === 0 || busy} onClick={() => setStep((current) => current - 1)}>上一步</Button>
            <p className="text-sm text-muted-foreground">
              {step === 1 && (preferredCities.size ? `已选：${[...preferredCities].join("、")}` : "无意向城市")}
              {step === 2 && `已选 ${desired.size} 个半小时档期`}
            </p>
            {step < 2 ? (
              <Button disabled={!speakerId} onClick={() => setStep((current) => current + 1)}>下一步</Button>
            ) : (
              <Button disabled={busy || desired.size === 0} onClick={submit}>{busy ? "正在计算…" : "完成选择并查看推荐"}</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeCard({ active, disabled, light = false, title, description, onClick }: {
  active: boolean; disabled?: boolean; light?: boolean; title: string; description: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "border-blue-500 bg-blue-100 ring-1 ring-blue-500"
          : light ? "border-violet-200 bg-white hover:bg-violet-100" : "border-white/15 bg-white/5 hover:bg-white/10",
      )}
    >
      <span className={cn("font-semibold", light && "text-slate-900")}>{title}</span>
      <span className={cn("mt-1 block text-sm leading-6", light ? "text-slate-600" : "text-slate-300")}>{description}</span>
    </button>
  );
}

function MatchPanel({ match, notice, onBooked, onAdjusted, onClose }: {
  match: MatchResult;
  notice: string;
  onBooked: (text: string, complete: boolean) => Promise<void>;
  onAdjusted: (result: MatchResult, text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [selectedAlternatives, setSelectedAlternatives] = useState<Set<string>>(new Set());
  const [p2Open, setP2Open] = useState(false);
  const [p2Mode, setP2Mode] = useState<MatchMode | null>(null);
  const remaining = match.desired ?? [];
  const done = remaining.length === 0;
  const p0 = match.p0 ?? match.fullCover.filter((studio) => match.preferredCities.length === 0 || studio.location.level === "preferred");
  const p1 = match.p1 ?? match.fullCover.filter((studio) => match.preferredCities.length > 0 && studio.location.level !== "preferred");
  const uncovered = match.combination?.uncovered ?? match.partial[0]?.missing ?? remaining;

  useEffect(() => {
    setSelectedAlternatives(new Set());
    setP2Open(p0.length === 0 && p1.length === 0);
    setP2Mode(null);
  }, [match.request_id, remaining.join("|")]);

  const book = async (studioId: string) => {
    setBusy(true); setErr("");
    try {
      const result = await api.post("vendor/book", { request_id: match.request_id, studio_id: studioId });
      const text = result.remaining.length > 0
        ? `已锁定 ${result.locked.length} 个档期，还有 ${result.remaining.length} 个时段待安排。`
        : `全部 ${result.locked.length} 个档期已锁定，预约完成。`;
      await onBooked(text, result.remaining.length === 0);
    } catch (error) { setErr(error instanceof ApiError ? error.message : "预约失败"); }
    finally { setBusy(false); }
  };

  const acceptCombination = async () => {
    if (!match.combination) return;
    setBusy(true); setErr("");
    try {
      let lockedTotal = 0;
      let remainingCount = remaining.length;
      for (const studio of match.combination.studios) {
        const result = await api.post("vendor/book", { request_id: match.request_id, studio_id: studio.studioId });
        lockedTotal += result.locked.length;
        remainingCount = result.remaining.length;
      }
      await onBooked(`组合方案已确认，共锁定 ${lockedTotal} 个档期。`, remainingCount === 0);
    } catch (error) { setErr(error instanceof ApiError ? error.message : "预约失败，请刷新后查看已成功锁定的部分"); }
    finally { setBusy(false); }
  };

  const chooseP2Mode = async (mode: MatchMode) => {
    setBusy(true); setErr("");
    try {
      const result = await api.post("vendor/request/update", {
        request_id: match.request_id,
        slots: remaining.map((key) => parseKey(key)),
        preferred_cities: match.preferredCities,
        match_mode: mode,
      });
      setP2Open(true);
      setP2Mode(mode);
      await onAdjusted(result, `已进入 P2 ${MODE_LABEL[mode]}推荐。`);
    } catch (error) { setErr(error instanceof ApiError ? error.message : "加载 P2 推荐失败"); }
    finally { setBusy(false); }
  };

  const toggleAlternative = (key: string) => {
    setSelectedAlternatives((previous) => {
      const next = new Set(previous);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const replaceUncovered = async () => {
    if (selectedAlternatives.size !== uncovered.length) return;
    setBusy(true); setErr("");
    try {
      const uncoveredSet = new Set(uncovered);
      const nextDesired = [...remaining.filter((key) => !uncoveredSet.has(key)), ...selectedAlternatives];
      const result = await api.post("vendor/request/update", {
        request_id: match.request_id,
        slots: nextDesired.map((key) => parseKey(key)),
        preferred_cities: match.preferredCities,
        match_mode: match.matchMode,
      });
      await onAdjusted(result, `已用 ${selectedAlternatives.size} 个新时段替换未覆盖档期，并重新计算推荐。`);
    } catch (error) { setErr(error instanceof ApiError ? error.message : "调整失败"); }
    finally { setBusy(false); }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
      <div className="bg-slate-950 px-5 py-5 text-white sm:px-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-blue-300">匹配结果</p>
            <h2 className="mt-1 text-2xl font-semibold">{done ? "档期已全部安排" : `还有 ${remaining.length} 个档期待安排`}</h2>
          </div>
          <Button variant="ghost" className="text-slate-200 hover:bg-white/10" onClick={onClose}>收起</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white/10 px-3 py-1.5">
            {p2Mode ? `P2 · ${MODE_LABEL[match.effectiveMode]}` : p0.length > 0 ? "P0 · 意向地区全覆盖" : p1.length > 0 ? "P1 · 异地全覆盖" : "等待选择 P2 模式"}
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1.5">
            {match.preferredCities.length ? `意向：${match.preferredCities.join("、")}` : "无意向城市"}
          </span>
          {!done && <span className="rounded-full bg-blue-500 px-3 py-1.5">待安排 {remaining.length} 格</span>}
        </div>
      </div>

      <div className="flex flex-col gap-6 p-5 sm:p-7">
        {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{notice}</p>}
        {err && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</p>}

        {done ? <EmptyState>这个项目的档期已全部锁定，可在下方“我的预约”查看。</EmptyState> : (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold">本次待安排档期</p>
              <SlotChips keys={remaining} />
            </div>

            {p0.length > 0 ? (
              <FullCoverTier
                code="P0"
                title={match.preferredCities.length ? "意向地区内，一个棚覆盖全部档期" : "一个棚覆盖全部档期"}
                description="这是最高优先级方案，地区和档期同时满足。"
                studios={p0}
                total={remaining.length}
                busy={busy}
                onBook={book}
              />
            ) : p1.length > 0 && !p2Open ? (
              <>
                <FullCoverTier
                  code="P1"
                  title="异地录音棚覆盖全部档期"
                  description="意向地区暂无全覆盖录音棚；以下异地方案无需拆分档期。"
                  studios={p1}
                  total={remaining.length}
                  busy={busy}
                  onBook={book}
                />
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <h3 className="font-semibold text-amber-950">不接受异地全覆盖方案？</h3>
                  <p className="mt-1 text-sm text-amber-800">进入 P2 后，系统才会推荐非全覆盖方案，并由你选择地区优先或档期优先。</p>
                  <Button className="mt-4" variant="outline" onClick={() => setP2Open(true)}>进入 P2 推荐</Button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">P2 · 非全覆盖推荐</p>
                  <h3 className="mt-1 text-lg font-semibold">选择这一步的推荐方式</h3>
                  <p className="mt-1 text-sm text-slate-600">P2 只处理无法由单个录音棚全覆盖的情况。</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <ModeCard
                      light
                      active={p2Mode === "location_first"}
                      disabled={match.preferredCities.length === 0 || busy}
                      title="地区优先"
                      description="意向城市优先，其他城市按距离由近到远；后台指定的邻近城市会优先于自动距离。"
                      onClick={() => chooseP2Mode("location_first")}
                    />
                    <ModeCard
                      light
                      active={p2Mode === "schedule_first"}
                      disabled={busy}
                      title="档期优先"
                      description="优先覆盖更多原定档期；覆盖数相同时，再按地区和城市距离排序。"
                      onClick={() => chooseP2Mode("schedule_first")}
                    />
                  </div>
                  {match.preferredCities.length === 0 && <p className="mt-3 text-xs text-violet-700">未选择意向城市，因此只能使用档期优先。</p>}
                </div>

                {p2Mode && match.combination && match.combination.studios.length > 0 && (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">P2 推荐组合</p>
                        <h3 className="mt-1 text-lg font-semibold">
                          {match.effectiveMode === "schedule_first" ? "尽量保留原定档期" : "优先选择距离更近的城市"}
                        </h3>
                        <p className="mt-1 text-sm text-slate-600">
                          可覆盖 {match.combination.covered.length}/{remaining.length} 个档期，共需 {match.combination.studios.length} 个棚
                        </p>
                      </div>
                      <CoverageDonut covered={match.combination.covered.length} total={remaining.length} />
                    </div>
                    <div className="mt-5 flex flex-col gap-3">
                      {match.combination.studios.map((studio, index) => (
                        <div key={studio.studioId} className="rounded-xl border border-blue-100 bg-white p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{index + 1}</span>
                            <p className="font-semibold">{studio.name}</p>
                            <LocationBadge location={studio.location} city={studio.city} />
                          </div>
                          <p className="mt-1 pl-8 text-xs text-muted-foreground">{studio.address}</p>
                          <div className="pl-8"><SlotChips keys={studio.assigned} /></div>
                        </div>
                      ))}
                    </div>
                    {match.combination.uncovered.length > 0 && (
                      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm font-medium text-amber-900">仍未覆盖 {match.combination.uncovered.length} 个档期</p>
                        <SlotChips keys={match.combination.uncovered} />
                      </div>
                    )}
                    <Button className="mt-4" disabled={busy} onClick={acceptCombination}>
                      {busy ? "锁定中…" : `按组合锁定 ${match.combination.covered.length} 个档期`}
                    </Button>
                  </div>
                )}

                {p2Mode && match.partial.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold">P2 单棚备选</h3>
                    <p className="mt-1 text-sm text-muted-foreground">也可以先锁定一个棚能覆盖的部分，再继续安排剩余档期。</p>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      {match.partial.map((studio) => (
                        <StudioMatchCard key={studio.studioId} studio={studio} total={remaining.length} busy={busy} onBook={() => book(studio.studioId)} />
                      ))}
                    </div>
                  </div>
                )}

                {p2Mode === "location_first" && uncovered.length > 0 && match.adjustmentOptions.length > 0 && (
                  <AdjustmentPanel
                    options={match.adjustmentOptions}
                    uncoveredCount={uncovered.length}
                    selected={selectedAlternatives}
                    onToggle={toggleAlternative}
                    busy={busy}
                    onReplace={replaceUncovered}
                  />
                )}

                {p2Mode && match.partial.length === 0 && (!match.combination || match.combination.covered.length === 0) && match.adjustmentOptions.length === 0 && (
                  <EmptyState>所选档期暂无可用录音棚，请返回上方调整档期后重试。</EmptyState>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function FullCoverTier({ code, title, description, studios, total, busy, onBook }: {
  code: "P0" | "P1";
  title: string;
  description: string;
  studios: StudioMatch[];
  total: number;
  busy: boolean;
  onBook: (studioId: string) => void;
}) {
  const primary = studios[0];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={cn("text-xs font-semibold uppercase tracking-wider", code === "P0" ? "text-emerald-700" : "text-amber-700")}>{code} 推荐</p>
          <h3 className="mt-1 text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge tone={code === "P0" ? "green" : "amber"}>全档期覆盖</Badge>
      </div>
      <StudioMatchCard studio={primary} total={total} primary busy={busy} onBook={() => onBook(primary.studioId)} />
      {studios.length > 1 && (
        <details className="mt-3 rounded-xl border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">查看另外 {studios.length - 1} 个同级方案</summary>
          <div className="mt-3 flex flex-col gap-3">
            {studios.slice(1).map((studio) => (
              <StudioMatchCard key={studio.studioId} studio={studio} total={total} busy={busy} onBook={() => onBook(studio.studioId)} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function StudioMatchCard({ studio, total, primary = false, busy, onBook }: {
  studio: StudioMatch; total: number; primary?: boolean; busy: boolean; onBook: () => void;
}) {
  const percent = Math.round((studio.covered.length / total) * 100);
  return (
    <div className={cn("rounded-xl border p-4", primary ? "border-emerald-300 bg-emerald-50/70" : "border-border bg-white")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold">{studio.name}</p>
            <LocationBadge location={studio.location} city={studio.city} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{studio.address}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold text-slate-900">{studio.covered.length}/{total}</p>
          <p className="text-xs text-muted-foreground">档期覆盖</p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-3">
        <p className="text-xs font-medium text-emerald-700">可立即锁定</p>
        <SlotChips keys={studio.covered} />
      </div>
      {studio.missing.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-amber-700">查看未覆盖的 {studio.missing.length} 个档期</summary>
          <SlotChips keys={studio.missing} />
        </details>
      )}
      <Button className="mt-4 w-full sm:w-auto" disabled={busy} onClick={onBook}>
        {primary ? "选择这个棚并锁定全部" : `先锁定这 ${studio.covered.length} 个档期`}
      </Button>
    </div>
  );
}

function LocationBadge({ location, city }: { location: MatchLocation; city: string }) {
  if (location.level === "preferred") return <Badge tone="blue">意向城市 · {city}</Badge>;
  if (location.level === "nearby") return <Badge tone="amber">优先邻近 · {city}{location.distanceKm !== null ? ` · 约 ${location.distanceKm} km` : ""}</Badge>;
  if (location.level === "distance") return <Badge tone="gray">{city} · 约 {location.distanceKm} km</Badge>;
  if (location.level === "neutral") return <Badge tone="gray">{city}</Badge>;
  return <Badge tone="gray">其他城市 · {city}</Badge>;
}

function CoverageDonut({ covered, total }: { covered: number; total: number }) {
  const percent = total ? Math.round((covered / total) * 100) : 0;
  return (
    <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-4 border-blue-200 bg-white">
      <span className="text-lg font-semibold text-blue-700">{percent}%</span>
      <span className="text-[10px] text-slate-500">覆盖率</span>
    </div>
  );
}

function AdjustmentPanel({ options, uncoveredCount, selected, onToggle, busy, onReplace }: {
  options: AdjustmentOption[];
  uncoveredCount: number;
  selected: Set<string>;
  onToggle: (key: string) => void;
  busy: boolean;
  onReplace: () => void;
}) {
  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">调整发音人档期</p>
      <h3 className="mt-1 text-lg font-semibold">看看推荐棚的其他空闲时间</h3>
      <p className="mt-1 text-sm text-slate-600">
        当前有 {uncoveredCount} 个档期未覆盖。请从下方选择同样数量的新时段，系统会替换缺口并重新匹配。
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {options.slice(0, 6).map((option) => (
          <div key={option.studioId} className="rounded-xl border border-violet-100 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{option.name}</p>
              <LocationBadge location={option.location} city={option.city} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{option.address}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {option.available.map((key) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => onToggle(key)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-xs transition",
                    selected.has(key) ? "border-violet-500 bg-violet-500 text-white" : "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100",
                  )}
                >
                  {key.slice(5)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={busy || selected.size !== uncoveredCount} onClick={onReplace}>
          {busy ? "重新匹配中…" : `替换并重新匹配（已选 ${selected.size}/${uncoveredCount}）`}
        </Button>
        {selected.size > uncoveredCount && <span className="text-xs text-red-600">选择数量超过缺口，请取消多余时段。</span>}
      </div>
    </div>
  );
}

function VendorBookings({ bookings, onAppealed }: { bookings: Booking[]; onAppealed: () => void }) {
  const [appealFor, setAppealFor] = useState<Booking | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [displayMode, setDisplayMode] = useState<BookingDisplayMode>("studio_first");
  const projects = useMemo(() => groupVendorBookings(bookings, displayMode), [bookings, displayMode]);

  const submitAppeal = async () => {
    if (!appealFor) return;
    setBusy(true); setErr("");
    try {
      await api.post("vendor/appeal", { booking_id: appealFor.id, reason: reason.trim() });
      setAppealFor(null); setReason("");
      await onAppealed();
    } catch (error) { setErr(error instanceof ApiError ? error.message : "提交失败"); }
    finally { setBusy(false); }
  };

  if (projects.length === 0) return <EmptyState>预约成功后，记录会固定显示在这里。</EmptyState>;

  return (
    <>
      <div className="mb-4 flex flex-col justify-between gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-medium">记录排列方式</p>
          <p className="text-xs text-muted-foreground">
            {displayMode === "studio_first" ? "同地区录音棚排在一起，棚内按排期时间排列。" : "先按最早排期时间，再按录音棚和地区排列。"}
          </p>
        </div>
        <div className="flex rounded-lg border border-border bg-white p-1">
          {([
            ["studio_first", "录音棚优先"],
            ["time_first", "时间优先"],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={displayMode === mode}
              onClick={() => setDisplayMode(mode)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition",
                displayMode === mode ? "bg-slate-900 text-white shadow-sm" : "text-muted-foreground hover:bg-slate-100",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {projects.map((project) => (
          <section key={project.key} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <p className="text-lg font-semibold">{project.projectName} · {project.stageName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {project.studios.length} 个录音棚 · {project.bookingCount} 个预约批次
                </p>
              </div>
              <Badge tone="blue">项目 / 发音人</Badge>
            </div>

            <div className="mt-3 flex flex-col gap-3">
              {project.studios.map((studio) => (
                <section key={studio.key} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                  <div>
                    <h3 className="font-semibold">{studio.studioName} · {studio.city}</h3>
                    {studio.address && <p className="mt-0.5 text-xs text-muted-foreground">{studio.address}</p>}
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    {studio.bookings.map((booking, index) => (
                      <div
                        key={booking.id}
                        className={cn(
                          "rounded-lg border bg-white p-3",
                          booking.status === "released" && "bg-neutral-50 opacity-75",
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            {studio.bookings.length > 1 ? `预约批次 ${index + 1}` : "预约档期"} · {booking.slots.length} 个半小时
                          </p>
                          <Badge tone={booking.status === "confirmed" ? booking.appeal_status ? "amber" : "green" : "gray"}>
                            {booking.status === "released" ? "已取消" : booking.appeal_status ? "取消审核中" : "已确认"}
                          </Badge>
                        </div>
                        <SlotChips keys={[...booking.slots].sort()} />
                        {booking.status === "confirmed" && (
                          <div className="mt-3 border-t border-border pt-3">
                            {booking.appeal_status ? (
                              <p className="text-xs text-amber-700">
                                {booking.appeal_by === "vendor" ? "你已提交取消申请，后台正在审核。" : "录音棚已申请取消，后台正在审核；审核前预约仍然有效。"}
                              </p>
                            ) : (
                              <Button variant="outline" onClick={() => { setAppealFor(booking); setErr(""); setReason(""); }}>申请取消本批预约</Button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
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
              <p className="mt-1 text-muted-foreground">{appealFor.studio_name} · {appealFor.city}</p>
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

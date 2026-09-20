import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type { Account, Booking, MatchResult, Speaker } from "../types";
import { Button, Card, EmptyState, Field, Input, SectionTitle, Badge, Spinner } from "../ui";
import { ScheduleGrid } from "../ScheduleGrid";
import { slotKey, parseKey } from "../slots";
import { SlotChips } from "./Studio";

interface OpenRequest {
  id: string;
  desired: string[];
  status: string;
  project_name: string;
  stage_name: string;
}

export function VendorDashboard({ account }: { account: Account }) {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [notice, setNotice] = useState("");

  const reload = async () => {
    const [sp, rq, bk] = await Promise.all([
      api.get("vendor/speakers"), api.get("vendor/requests"), api.get("vendor/bookings"),
    ]);
    setSpeakers(sp.speakers ?? []);
    setRequests(rq.requests ?? []);
    setBookings(bk.bookings ?? []);
    setLoading(false);
  };
  useEffect(() => { reload().catch(() => setLoading(false)); }, []);

  const openReselect = requests.filter((r) => (r.status === "open" || r.status === "reopened") && r.desired.length > 0);

  const loadMatches = async (requestId: string) => {
    setNotice("");
    const r = await api.get("vendor/request/matches", `&request_id=${encodeURIComponent(requestId)}`);
    setMatch(r);
  };

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div className="flex flex-col gap-6">
      {openReselect.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <SectionTitle>待选择录音棚</SectionTitle>
          <p className="mb-3 text-sm text-amber-700">以下项目仍有档期需要选择录音棚,档期已为你保留,无需重新填写。</p>
          <div className="flex flex-col gap-3">
            {openReselect.map((r) => (
              <div key={r.id} className="rounded-lg border border-amber-200 bg-background p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{r.project_name} · {r.stage_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.status === "reopened" ? "原录音棚因申诉已释放档期,请重新选择" : "尚有未安排的档期,可继续选择录音棚"}
                    </p>
                  </div>
                  <Button onClick={() => loadMatches(r.id)}>{r.status === "reopened" ? "重新选择" : "选择录音棚"}</Button>
                </div>
                <SlotChips keys={r.desired} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <SpeakerManager speakers={speakers} onChanged={reload} />

      <NewRequest speakers={speakers} onMatched={(m) => { setMatch(m); reload(); }} />

      {match && (
        <MatchPanel
          match={match}
          notice={notice}
          onBooked={async (text) => { setNotice(text); await reload(); await loadMatches(match.request_id); }}
          onClose={() => setMatch(null)}
        />
      )}

      <Card>
        <SectionTitle>我的预约</SectionTitle>
        <VendorBookings bookings={bookings} />
      </Card>
    </div>
  );
}

function SpeakerManager({ speakers, onChanged }: { speakers: Speaker[]; onChanged: () => void }) {
  const [project, setProject] = useState("");
  const [stage, setStage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.post("vendor/speaker/create", { project_name: project.trim(), stage_name: stage.trim(), email: email.trim() });
      setProject(""); setStage(""); setEmail(""); setOpen(false);
      onChanged();
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : "添加失败"); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <SectionTitle right={<Button variant="outline" onClick={() => setOpen((v) => !v)}>{open ? "取消" : "新增项目 / 发音人"}</Button>}>项目与发音人</SectionTitle>
      {open && (
        <form onSubmit={add} className="mb-4 grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-3">
          <Field label="项目名称"><Input value={project} onChange={(e) => setProject(e.target.value)} required /></Field>
          <Field label="发音人艺名 / 姓名"><Input value={stage} onChange={(e) => setStage(e.target.value)} required /></Field>
          <Field label="联系邮箱"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          {err && <p className="text-sm text-destructive sm:col-span-3">{err}</p>}
          <div className="sm:col-span-3"><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存"}</Button></div>
        </form>
      )}
      {speakers.length === 0 ? (
        <EmptyState>还没有项目,请先新增。</EmptyState>
      ) : (
        <div className="flex flex-wrap gap-2">
          {speakers.map((s) => (
            <span key={s.id} className="rounded-lg border border-border px-3 py-1.5 text-sm">{s.project_name} · {s.stage_name}</span>
          ))}
        </div>
      )}
    </Card>
  );
}

function NewRequest({ speakers, onMatched }: { speakers: Speaker[]; onMatched: (m: MatchResult) => void }) {
  const [speakerId, setSpeakerId] = useState("");
  const [desired, setDesired] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { if (!speakerId && speakers[0]) setSpeakerId(speakers[0].id); }, [speakers, speakerId]);

  const toggle = (key: string) => {
    setDesired((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const slots = [...desired].map((k) => parseKey(k));
      const r = await api.post("vendor/request/create", { speaker_id: speakerId, slots });
      onMatched(r);
      setDesired(new Set());
    } catch (e) { setErr(e instanceof ApiError ? e.message : "提交失败"); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <SectionTitle>发起档期匹配</SectionTitle>
      {speakers.length === 0 ? (
        <EmptyState>请先在上方新增项目 / 发音人。</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="选择项目 / 发音人">
            <select
              value={speakerId}
              onChange={(e) => setSpeakerId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:max-w-sm"
            >
              {speakers.map((s) => <option key={s.id} value={s.id}>{s.project_name} · {s.stage_name}</option>)}
            </select>
          </Field>
          <div>
            <p className="mb-2 text-sm font-medium">选择需要录音的档期(半小时精度)</p>
            <ScheduleGrid selected={desired} onToggle={toggle} legend="vendor" />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div>
            <Button disabled={busy || desired.size === 0 || !speakerId} onClick={submit}>
              {busy ? "匹配中…" : `匹配录音棚(已选 ${desired.size} 个档期)`}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function MatchPanel({ match, notice, onBooked, onClose }: {
  match: MatchResult; notice: string; onBooked: (text: string) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const remaining = match.desired ?? [];
  const done = remaining.length === 0;

  const book = async (studioId: string) => {
    setBusy(true); setErr("");
    try {
      const r = await api.post("vendor/book", { request_id: match.request_id, studio_id: studioId });
      const text = r.remaining.length > 0
        ? `已锁定 ${r.locked.length} 个档期。仍有 ${r.remaining.length} 个时段未安排,可继续选择其它棚或调整档期后再选。`
        : `已锁定全部 ${r.locked.length} 个档期,预约完成。`;
      onBooked(text);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "预约失败"); }
    finally { setBusy(false); }
  };

  const acceptCombination = async () => {
    if (!match.combination) return;
    setBusy(true); setErr("");
    try {
      let lockedTotal = 0;
      for (const s of match.combination.studios) {
        const r = await api.post("vendor/book", { request_id: match.request_id, studio_id: s.studioId });
        lockedTotal += r.locked.length;
      }
      onBooked(`组合方案已确认,共锁定 ${lockedTotal} 个档期。`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "预约失败"); }
    finally { setBusy(false); }
  };

  return (
    <Card className="border-primary/40">
      <SectionTitle right={<Button variant="ghost" onClick={onClose}>收起</Button>}>匹配结果</SectionTitle>
      {notice && <p className="mb-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
      {err && <p className="mb-3 text-sm text-destructive">{err}</p>}

      {done ? (
        <EmptyState>该请求的档期已全部安排完成。</EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="rounded-md bg-secondary p-3 text-sm">
            当前待安排 <b>{remaining.length}</b> 个半小时档期
            <SlotChips keys={remaining} />
          </div>

          {match.fullCover.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-emerald-700">可完全覆盖的录音棚(推荐)</p>
              <div className="flex flex-col gap-2">
                {match.fullCover.map((s) => (
                  <StudioRow key={s.studioId} name={s.name} city={s.city} address={s.address}
                    tag={<Badge tone="green">全覆盖 {s.covered.length} 档期</Badge>}
                    action={<Button disabled={busy} onClick={() => book(s.studioId)}>选择并锁定</Button>} />
                ))}
              </div>
            </div>
          )}

          {match.fullCover.length === 0 && match.combination && match.combination.studios.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">组合方案{match.combination.coversAll ? "(可覆盖全部档期)" : "(可覆盖部分档期)"}</p>
              <div className="rounded-lg border border-border p-4">
                <div className="flex flex-col gap-3">
                  {match.combination.studios.map((s) => (
                    <div key={s.studioId} className="border-b border-border pb-3 last:border-0 last:pb-0">
                      <p className="font-medium">{s.name} <span className="text-xs text-muted-foreground">· {s.city} · {s.address}</span></p>
                      <SlotChips keys={s.assigned} />
                    </div>
                  ))}
                </div>
                {!match.combination.coversAll && (
                  <p className="mt-3 text-xs text-amber-700">仍有 {match.combination.uncovered.length} 个时段无棚可约,确认组合后可另行调整这些档期。</p>
                )}
                <div className="mt-4"><Button disabled={busy} onClick={acceptCombination}>接受组合方案并锁定</Button></div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">若不接受组合,可从下方单个录音棚中优先选择,先锁定该棚可约的时段,其余时段再另行调整。</p>
            </div>
          )}

          {match.partial.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">单个录音棚(部分覆盖)</p>
              <div className="flex flex-col gap-2">
                {match.partial.map((s) => (
                  <StudioRow key={s.studioId} name={s.name} city={s.city} address={s.address}
                    tag={<Badge tone="amber">可约 {s.covered.length} 档期</Badge>}
                    action={<Button variant="outline" disabled={busy} onClick={() => book(s.studioId)}>只定该棚可约部分</Button>} />
                ))}
              </div>
            </div>
          )}

          {match.fullCover.length === 0 && match.partial.length === 0 && !match.combination && (
            <EmptyState>所选档期暂无可匹配的录音棚,请调整档期后重试。</EmptyState>
          )}
        </div>
      )}
    </Card>
  );
}

function StudioRow({ name, city, address, tag, action }: {
  name: string; city: string; address: string; tag: React.ReactNode; action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-4">
      <div>
        <div className="flex items-center gap-2"><p className="font-medium">{name}</p>{tag}</div>
        <p className="text-xs text-muted-foreground">{city} · {address}</p>
      </div>
      {action}
    </div>
  );
}

function VendorBookings({ bookings }: { bookings: Booking[] }) {
  const confirmed = useMemo(() => bookings.filter((b) => b.status === "confirmed"), [bookings]);
  if (confirmed.length === 0) return <EmptyState>暂无预约</EmptyState>;
  return (
    <div className="flex flex-col gap-3">
      {confirmed.map((b) => (
        <div key={b.id} className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium">{b.project_name} · {b.stage_name}</p>
            <Badge tone="green">已确认</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{b.studio_name} · {b.city} · {b.address}</p>
          <SlotChips keys={b.slots} />
        </div>
      ))}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type { Account, Appeal, Booking, CityProximity, ScheduleRequest, Slot, Speaker, Studio } from "../types";
import { Button, Card, EmptyState, Field, Input, SectionTitle, Badge, Spinner, Textarea } from "../ui";
import { BackupButton } from "../BackupButton";
import { SlotChips } from "./Studio";
import { ScheduleGrid } from "../ScheduleGrid";
import {
  ALL_DAY_END, ALL_DAY_START, halfHours, isWithinBusinessHours, parseKey, slotKey, upcomingDates,
} from "../slots";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Overview {
  accounts: Account[];
  studios: Studio[];
  speakers: Speaker[];
  slots: Slot[];
  requests: ScheduleRequest[];
  bookings: Booking[];
  appeals: Appeal[];
  city_proximities: CityProximity[];
}

const TABS = [
  ["appeals", "申诉审批"],
  ["studios", "录音棚"],
  ["speakers", "发音人"],
  ["requests", "排期需求"],
  ["bookings", "预约总览"],
  ["messages", "消息发布"],
  ["cities", "邻近城市"],
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
      <Card className="border-0 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white shadow-xl">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm text-indigo-200">后台管理工作台</p>
            <h1 className="mt-1 text-2xl font-semibold">全站业务记录</h1>
            <p className="mt-2 text-sm text-slate-300">可随时将当前全站记录导出为 Excel 备份。</p>
          </div>
          <BackupButton className="border-white/20 bg-white/10 text-white hover:bg-white/20" />
        </div>
      </Card>

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
      {tab === "requests" && <RequestsTab data={data} onChanged={reload} />}
      {tab === "bookings" && <BookingsTab data={data} onChanged={reload} />}
      {tab === "messages" && <MessagesTab accounts={data.accounts} />}
      {tab === "cities" && <CityProximitiesTab data={data} onChanged={reload} />}
      {tab === "accounts" && <AccountsTab data={data} onChanged={reload} />}
    </div>
  );
}

function AppealsTab({ data, onChanged }: { data: Overview; onChanged: () => void }) {
  const studioById = useMemo(() => new Map(data.studios.map((s) => [s.id, s])), [data.studios]);
  const accountById = useMemo(() => new Map(data.accounts.map((account) => [account.id, account])), [data.accounts]);
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
              const isStudioAppeal = !!a.studio_id;
              const studio = a.studio_id ? studioById.get(a.studio_id) : null;
              const vendor = a.vendor_account_id ? accountById.get(a.vendor_account_id) : null;
              const booking = bookingById.get(a.booking_id);
              const speaker = booking ? speakerById.get(booking.speaker_id) : null;
              const requester = isStudioAppeal ? (studio?.name ?? "已删除录音棚") : (vendor?.display_name ?? vendor?.username ?? "已删除供应商");
              return (
                <div key={a.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{requester} <span className="text-xs text-muted-foreground">{isStudioAppeal ? "录音棚申请取消" : "供应商申请取消"}</span></p>
                      {speaker && <p className="text-xs text-muted-foreground">涉及：{speaker.project_name} · {speaker.stage_name}</p>}
                      <p className="mt-2 text-sm">取消原因：{a.reason}</p>
                      {booking && <SlotChips keys={booking.slots} />}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="danger" disabled={!!busy} onClick={() => resolve(a.id, "approved")}>通过并取消预约</Button>
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
            {resolved.map((a) => {
              const studio = a.studio_id ? studioById.get(a.studio_id) : null;
              const vendor = a.vendor_account_id ? accountById.get(a.vendor_account_id) : null;
              return (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                  <span>{studio?.name ?? vendor?.display_name ?? vendor?.username ?? "供应商"} — {a.reason}</span>
                  <Badge tone={a.status === "approved" ? "green" : "gray"}>{a.status === "approved" ? "已通过" : "已驳回"}</Badge>
                </div>
              );
            })}
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
              <div className="flex items-center gap-2">
                <div className="text-right text-sm text-muted-foreground">
                  空闲 <b className="text-emerald-600">{c.free}</b> · 锁定 <b className="text-amber-600">{c.locked}</b>
                </div>
                <RecordEditor
                  targetType="studio"
                  targetId={s.id}
                  title={`调整录音棚：${s.name}`}
                  initial={{ name: s.name, city: s.city, address: s.address, email: s.email }}
                  fields={[
                    { key: "name", label: "录音棚名称", required: true },
                    { key: "city", label: "所在城市", required: true },
                    { key: "address", label: "详细地址", required: true },
                    { key: "email", label: "联系邮箱", type: "email" },
                  ]}
                  onSaved={onChanged}
                />
                <AdminScheduleEditor studio={s} slots={data.slots} onSaved={onChanged} />
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
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">{s.project_name} · {s.stage_name}</p>
              <p className="text-sm text-muted-foreground">{s.email}</p>
            </div>
            <RecordEditor
              targetType="speaker"
              targetId={s.id}
              title={`调整项目：${s.project_name}`}
              initial={{ project_name: s.project_name, stage_name: s.stage_name, email: s.email }}
              fields={[
                { key: "project_name", label: "项目名称", required: true },
                { key: "stage_name", label: "发音人艺名 / 姓名", required: true },
                { key: "email", label: "联系邮箱", type: "email" },
              ]}
              onSaved={onChanged}
            />
          </div>
          <AdminNote targetType="speaker" targetId={s.id} value={s.admin_note ?? ""} onSaved={onChanged} />
        </Card>
      ))}
    </div>
  );
}

function RequestsTab({ data, onChanged }: { data: Overview; onChanged: () => void }) {
  const speakerById = useMemo(() => new Map(data.speakers.map((speaker) => [speaker.id, speaker])), [data.speakers]);
  if (data.requests.length === 0) return <EmptyState>暂无排期需求。</EmptyState>;
  return (
    <div className="flex flex-col gap-3">
      {data.requests.map((request) => {
        const speaker = speakerById.get(request.speaker_id);
        return (
          <Card key={request.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{speaker?.project_name ?? "已删除项目"} · {speaker?.stage_name ?? "未知发音人"}</p>
                <p className="text-sm text-muted-foreground">
                  意向城市：{request.preferred_cities?.join("、") || "无"} · {request.match_mode === "location_first" ? "地区优先" : "档期优先"}
                </p>
                <SlotChips keys={request.desired} />
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={request.status === "closed" || request.status === "cancelled" ? "gray" : "blue"}>
                  {{ open: "待预约", reopened: "已重开", closed: "已关闭", cancelled: "已取消" }[request.status]}
                </Badge>
                <RecordEditor
                  targetType="request"
                  targetId={request.id}
                  title={`调整排期需求：${request.id.slice(0, 8)}`}
                  initial={{
                    slots: request.desired.join("\n"),
                    preferred_cities: request.preferred_cities?.join("、") ?? "",
                    match_mode: request.match_mode ?? "schedule_first",
                    status: request.status,
                  }}
                  fields={[
                    { key: "slots", label: "期望档期", type: "textarea", required: true, hint: "每行一个，格式：2026-09-30 09:30" },
                    { key: "preferred_cities", label: "意向城市", hint: "多个城市用顿号或逗号分隔" },
                    { key: "match_mode", label: "P2 模式", type: "select", options: [["schedule_first", "档期优先"], ["location_first", "地区优先"]] },
                    { key: "status", label: "状态", type: "select", options: [["open", "待预约"], ["reopened", "已重开"], ["closed", "已关闭"], ["cancelled", "已取消"]] },
                  ]}
                  onSaved={onChanged}
                />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function BookingsTab({ data, onChanged }: { data: Overview; onChanged: () => void }) {
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
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{speaker?.project_name} · {speaker?.stage_name}</p>
                <p className="text-sm text-muted-foreground">{studio?.name} · {studio?.city} · {studio?.address}</p>
                <SlotChips keys={b.slots} />
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={b.status === "confirmed" ? "green" : "gray"}>{b.status === "confirmed" ? "已确认" : "已释放"}</Badge>
                <RecordEditor
                  targetType="booking"
                  targetId={b.id}
                  title={`调整预约：${b.id.slice(0, 8)}`}
                  initial={{ slots: b.slots.join("\n"), status: b.status }}
                  fields={[
                    { key: "slots", label: "预约档期", type: "textarea", required: true, hint: "每行一个，格式：2026-09-30 09:30" },
                    { key: "status", label: "状态", type: "select", options: [["confirmed", "已确认"], ["released", "已释放"]] },
                  ]}
                  onSaved={onChanged}
                />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function CityProximitiesTab({ data, onChanged }: { data: Overview; onChanged: () => void }) {
  const cities = [...new Set(data.studios.map((studio) => studio.city.trim()).filter(Boolean))].sort();
  const [city, setCity] = useState(cities[0] ?? "");
  const [nearbyCity, setNearbyCity] = useState(cities.find((item) => item !== cities[0]) ?? "");
  const [priority, setPriority] = useState("1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.post("admin/city-proximity/save", {
        city,
        nearby_city: nearbyCity,
        priority: Number(priority),
      });
      await onChanged();
    } catch (error) { setErr(error instanceof ApiError ? error.message : "保存失败"); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true); setErr("");
    try {
      await api.post("admin/city-proximity/delete", { relation_id: id });
      await onChanged();
    } catch (error) { setErr(error instanceof ApiError ? error.message : "删除失败"); }
    finally { setBusy(false); }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, CityProximity[]>();
    for (const relation of data.city_proximities ?? []) {
      const rows = map.get(relation.city) ?? [];
      rows.push(relation);
      map.set(relation.city, rows);
    }
    for (const rows of map.values()) rows.sort((a, b) => a.priority - b.priority || a.nearby_city.localeCompare(b.nearby_city));
    return map;
  }, [data.city_proximities]);

  if (cities.length < 2) {
    return <EmptyState>至少需要两个录音棚城市，才能设置邻近关系。请先让录音棚完善城市信息。</EmptyState>;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
      <Card>
        <SectionTitle>新增邻近关系</SectionTitle>
        <p className="mb-4 text-sm text-muted-foreground">系统默认按城市直线距离推荐。这里可指定更符合实际交通的优先城市，并覆盖自动距离排序。关系有方向，例如“北京 → 天津”；反方向需要另建一条。</p>
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label="意向城市">
            <select value={city} onChange={(event) => {
              const nextCity = event.target.value;
              setCity(nextCity);
              if (nearbyCity === nextCity) setNearbyCity(cities.find((item) => item !== nextCity) ?? "");
            }} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              {cities.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="邻近城市">
            <select value={nearbyCity} onChange={(event) => setNearbyCity(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              {cities.filter((item) => item !== city).map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="优先级" hint="数字越小越优先，例如 1 最优先、2 次之。">
            <Input type="number" min="1" max="999" value={priority} onChange={(event) => setPriority(event.target.value)} required />
          </Field>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" disabled={busy || !city || !nearbyCity || city === nearbyCity}>{busy ? "保存中…" : "保存邻近关系"}</Button>
        </form>
      </Card>

      <Card>
        <SectionTitle>已设置的城市关系</SectionTitle>
        {grouped.size === 0 ? <EmptyState>还没有人工设置，系统将按本地城市坐标自动计算直线距离。</EmptyState> : (
          <div className="flex flex-col gap-4">
            {[...grouped.entries()].map(([source, relations]) => (
              <div key={source} className="rounded-xl border border-border p-4">
                <p className="font-semibold">供应商意向：{source}</p>
                <div className="mt-3 flex flex-col gap-2">
                  {relations.map((relation) => (
                    <div key={relation.id} className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-sm">
                      <span>第 {relation.priority} 优先：<b>{relation.nearby_city}</b></span>
                      <Button variant="ghost" disabled={busy} onClick={() => remove(relation.id)}>删除</Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function MessagesTab({ accounts }: { accounts: Account[] }) {
  const [announcement, setAnnouncement] = useState("");
  const [targetId, setTargetId] = useState(accounts[0]?.id ?? "");
  const [privateMessage, setPrivateMessage] = useState("");
  const [busy, setBusy] = useState<"announcement" | "private" | "">("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const sendAnnouncement = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = announcement.trim();
    if (!message || !confirm(`确认向全站 ${accounts.length} 个账号发送这条公告？`)) return;
    setBusy("announcement"); setError(""); setResult("");
    try {
      const response = await api.post("admin/broadcast", { message });
      setAnnouncement("");
      setResult(`公告已发送给 ${response.recipient_count} 个账号。`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "公告发送失败");
    } finally {
      setBusy("");
    }
  };

  const sendPrivateMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = privateMessage.trim();
    if (!targetId || !message) return;
    setBusy("private"); setError(""); setResult("");
    try {
      await api.post("admin/message", { account_id: targetId, message });
      setPrivateMessage("");
      setResult("私信已发送，对方会在站内通知中收到。");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "私信发送失败");
    } finally {
      setBusy("");
    }
  };

  const roleLabel: Record<string, string> = { admin: "后台", studio: "录音棚", vendor: "供应商" };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <SectionTitle>发布全站公告</SectionTitle>
        <p className="mb-4 text-sm text-muted-foreground">公告会同时进入全部账号的站内通知，发布前会再次确认。</p>
        <form onSubmit={sendAnnouncement} className="flex flex-col gap-4">
          <Field label="公告内容"><Textarea maxLength={2000} value={announcement} onChange={(event) => setAnnouncement(event.target.value)} required /></Field>
          <Button type="submit" disabled={busy !== "" || !announcement.trim()}>{busy === "announcement" ? "发送中…" : "发布全站公告"}</Button>
        </form>
      </Card>
      <Card>
        <SectionTitle>发送账号私信</SectionTitle>
        <p className="mb-4 text-sm text-muted-foreground">选择一个账号，对方会在右上角“通知”中收到私信。</p>
        <form onSubmit={sendPrivateMessage} className="flex flex-col gap-4">
          <Field label="接收账号">
            <select value={targetId} onChange={(event) => setTargetId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>{item.display_name || item.username} · {item.username}（{roleLabel[item.role]}）</option>
              ))}
            </select>
          </Field>
          <Field label="私信内容"><Textarea maxLength={2000} value={privateMessage} onChange={(event) => setPrivateMessage(event.target.value)} required /></Field>
          <Button type="submit" disabled={busy !== "" || !targetId || !privateMessage.trim()}>{busy === "private" ? "发送中…" : "发送私信"}</Button>
        </form>
      </Card>
      {(result || error) && (
        <p className={`rounded-xl border px-4 py-3 text-sm lg:col-span-2 ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {error || result}
        </p>
      )}
    </div>
  );
}

const EMPTY_ACCOUNT_FORM = {
  role: "studio", username: "", password: "", display_name: "", email: "", city: "", address: "",
};

function AccountsTab({ data, onChanged }: { data: Overview; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_ACCOUNT_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const studioByAccount = useMemo(() => new Map(data.studios.map((studio) => [studio.account_id, studio])), [data.studios]);
  const needsProfile = form.role === "studio" || form.role === "vendor";

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.post("admin/create-account", {
        role: form.role, username: form.username.trim(), password: form.password,
        display_name: form.display_name.trim(), email: form.email.trim(),
        city: form.city.trim(), address: form.address.trim(),
      });
      setForm(EMPTY_ACCOUNT_FORM);
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
  const nameLabel = form.role === "studio" ? "录音棚名称" : form.role === "vendor" ? "供应商名称" : "显示名称";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <SectionTitle right={<Button onClick={() => setOpen((v) => !v)}>{open ? "取消" : "新增账号"}</Button>}>账号列表</SectionTitle>
        {open && (
          <form onSubmit={create} className="mb-4 grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
            <p className="text-sm text-muted-foreground sm:col-span-2">创建登录账号时同步录入资料；录音棚创建后可直接维护营业时间和档期。</p>
            <Field label="角色">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="studio">录音棚</option>
                <option value="vendor">发音人 / 供应商</option>
                <option value="admin">后台管理</option>
              </select>
            </Field>
            <Field label="用户名"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></Field>
            <Field label="初始密码" hint="至少 6 位"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
            <Field label={nameLabel}><Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required={needsProfile} /></Field>
            <Field label="联系邮箱（选填）" hint="仅作为联系资料保存；预约和申诉结果通过站内通知发送。"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            {form.role === "studio" && (
              <>
                <Field label="所在城市"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required /></Field>
                <Field label="详细地址"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required /></Field>
                <p className="text-xs text-muted-foreground sm:col-span-2">默认营业时间为每天 08:00–22:00，创建后可由录音棚自行调整。</p>
              </>
            )}
            {err && <p className="text-sm text-destructive sm:col-span-2">{err}</p>}
            <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? "创建中…" : needsProfile ? "创建账号并保存资料" : "创建账号"}</Button></div>
          </form>
        )}
        <div className="flex flex-col gap-2">
          {data.accounts.map((a) => {
            const studio = studioByAccount.get(a.id);
            return (
              <div key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{a.username} <Badge tone="gray">{roleLabel[a.role]}</Badge></p>
                    <p className="text-xs text-muted-foreground">{a.display_name} {a.email && `· ${a.email}`}</p>
                    {studio && <p className="mt-1 text-xs text-muted-foreground">{studio.city} · {studio.address}</p>}
                  </div>
                  <div className="flex gap-2">
                    <RecordEditor
                      targetType="account"
                      targetId={a.id}
                      title={`调整账号：${a.username}`}
                      initial={{ username: a.username, display_name: a.display_name, email: a.email, password: "" }}
                      fields={[
                        { key: "username", label: "用户名", required: true },
                        { key: "display_name", label: "显示名称" },
                        { key: "email", label: "联系邮箱", type: "email" },
                        { key: "password", label: "重置密码", type: "password", hint: "留空则不修改，填写时至少 6 位" },
                      ]}
                      onSaved={onChanged}
                    />
                    <Button variant="outline" onClick={() => del(a.id)}>删除</Button>
                  </div>
                </div>
                <AdminNote targetType="account" targetId={a.id} value={a.admin_note ?? ""} onSaved={onChanged} />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

interface EditField {
  key: string;
  label: string;
  type?: "text" | "email" | "password" | "textarea" | "select";
  required?: boolean;
  hint?: string;
  options?: [string, string][];
}

function RecordEditor({ targetType, targetId, title, initial, fields, onSaved }: {
  targetType: "account" | "studio" | "speaker" | "request" | "booking";
  targetId: string;
  title: string;
  initial: Record<string, string>;
  fields: EditField[];
  onSaved: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      setForm(initial);
      setErr("");
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const changes: Record<string, unknown> = { ...form };
      if (targetType === "request" || targetType === "booking") {
        changes.slots = form.slots.split(/[\n,，]+/).map((value) => value.trim()).filter(Boolean).map(parseKey);
      }
      if (targetType === "request") {
        changes.preferred_cities = form.preferred_cities.split(/[、,，\n]+/).map((value) => value.trim()).filter(Boolean);
      }
      await api.post("admin/update-record", { target_type: targetType, target_id: targetId, changes });
      await onSaved();
      setOpen(false);
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <Button variant="outline" onClick={() => changeOpen(true)}>调整</Button>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>保存后系统会立即向对应账号发送站内通知。</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-4">
          {fields.map((field) => (
            <Field key={field.key} label={field.label} hint={field.hint}>
              {field.type === "textarea" ? (
                <Textarea
                  value={form[field.key] ?? ""}
                  onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                  required={field.required}
                  rows={6}
                />
              ) : field.type === "select" ? (
                <select
                  value={form[field.key] ?? ""}
                  onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {field.options?.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              ) : (
                <Input
                  type={field.type ?? "text"}
                  value={form[field.key] ?? ""}
                  onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                  required={field.required}
                />
              )}
            </Field>
          ))}
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存调整并通知"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdminScheduleEditor({ studio, slots, onSaved }: {
  studio: Studio;
  slots: Slot[];
  onSaved: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const dates = useMemo(() => upcomingDates(), []);
  const times = useMemo(() => halfHours(ALL_DAY_START, ALL_DAY_END), []);
  const studioSlots = useMemo(() => slots.filter((slot) => slot.studio_id === studio.id), [slots, studio.id]);
  const locked = useMemo(() => new Set(studioSlots.filter((slot) => slot.status === "locked").map((slot) => slotKey(slot.date, slot.start))), [studioSlots]);
  const blocked = useMemo(() => new Set(studioSlots.filter((slot) => slot.status === "blocked").map((slot) => slotKey(slot.date, slot.start))), [studioSlots]);
  const special = useMemo(() => new Set(studioSlots.filter((slot) => slot.status === "free").map((slot) => slotKey(slot.date, slot.start))), [studioSlots]);
  const marked = useMemo(() => new Set([...locked, ...blocked, ...special]), [blocked, locked, special]);
  const selected = useMemo(() => new Set(
    dates.flatMap((date) => times.map((start) => slotKey(date, start))).filter((key) => {
      if (blocked.has(key) || locked.has(key)) return false;
      if (special.has(key)) return true;
      const [date, start] = key.split(" ");
      return isWithinBusinessHours(studio.business_hours, date, start);
    }),
  ), [blocked, dates, locked, special, studio.business_hours, times]);

  const setAvailability = async (keys: string[], available: boolean) => {
    setErr("");
    try {
      await api.post("admin/slots/set", {
        studio_id: studio.id,
        slots: keys.map((key) => ({ ...parseKey(key), available })),
      });
      await onSaved();
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : "档期调整失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>调整档期</Button>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>调整档期：{studio.name}</DialogTitle>
          <DialogDescription>支持点选和拖选；已预约锁定的档期不能在这里覆盖。保存后会通知录音棚账号。</DialogDescription>
        </DialogHeader>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <ScheduleGrid
          selected={selected}
          locked={locked}
          special={special}
          counted={marked}
          onToggle={(key) => void setAvailability([key], !selected.has(key))}
          onBatchChange={setAvailability}
          dates={dates}
          times={times}
          legend="studio"
        />
      </DialogContent>
    </Dialog>
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

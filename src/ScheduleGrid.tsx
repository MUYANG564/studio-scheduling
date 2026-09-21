import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { halfHours, upcomingDates, weekday, shortDate, slotKey } from "./slots";

interface Props {
  selected: Set<string>;
  locked?: Set<string>;
  special?: Set<string>;
  counted?: Set<string>;
  onToggle: (key: string) => void;
  onBatchChange?: (keys: string[], selected: boolean) => void | Promise<void>;
  dates?: string[];
  times?: string[];
  legend?: "studio" | "vendor";
}

interface DragState {
  pointerId: number;
  selected: boolean;
  anchorKey: string;
  keys: Set<string>;
}

export function ScheduleGrid({
  selected, locked, special, counted, onToggle, onBatchChange, dates, times: timeOptions, legend = "studio",
}: Props) {
  const dayList = dates ?? upcomingDates();
  const [active, setActive] = useState(dayList[0]);
  const [preview, setPreview] = useState<Map<string, boolean>>(new Map());
  const dragRef = useRef<DragState | null>(null);
  const skipClickRef = useRef(false);
  const batchChangeRef = useRef(onBatchChange);
  batchChangeRef.current = onBatchChange;
  const times = timeOptions ?? halfHours();

  const isSelected = (key: string) => preview.get(key) ?? selected.has(key);
  const countForDate = (date: string) => times.filter((time) => {
    const key = slotKey(date, time);
    return counted ? counted.has(key) : legend === "studio" ? !selected.has(key) || locked?.has(key) : selected.has(key);
  }).length;

  const addDragKey = (key: string) => {
    const drag = dragRef.current;
    if (!drag) return;
    const anchorIndex = times.indexOf(drag.anchorKey.slice(-5));
    const currentIndex = times.indexOf(key.slice(-5));
    if (anchorIndex < 0 || currentIndex < 0) return;
    const start = Math.min(anchorIndex, currentIndex);
    const end = Math.max(anchorIndex, currentIndex);
    const additions = times
      .slice(start, end + 1)
      .map((time) => slotKey(active, time))
      .filter((slot) => !locked?.has(slot) && !drag.keys.has(slot));
    if (additions.length === 0) return;
    additions.forEach((slot) => drag.keys.add(slot));
    setPreview((current) => {
      const next = new Map(current);
      additions.forEach((slot) => next.set(slot, drag.selected));
      return next;
    });
  };

  const finishDrag = async () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    skipClickRef.current = true;
    try {
      await batchChangeRef.current?.([...drag.keys], drag.selected);
    } finally {
      setPreview(new Map());
      window.setTimeout(() => { skipClickRef.current = false; }, 0);
    }
  };

  useEffect(() => {
    const finish = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) void finishDrag();
    };
    const cancel = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setPreview(new Map());
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {dayList.map((date) => {
          const count = countForDate(date);
          return (
            <button
              key={date}
              onClick={() => setActive(date)}
              className={cn(
                "flex min-w-16 flex-col items-center rounded-lg border px-3 py-2 text-sm transition",
                active === date ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent",
              )}
            >
              <span className="font-medium">{shortDate(date)}</span>
              <span className="text-xs opacity-80">{weekday(date)}</span>
              {count > 0 && (
                <span className={cn(
                  "mt-0.5 rounded-full px-1.5 text-[10px]",
                  active === date ? "bg-primary-foreground/20" : legend === "studio" ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-700",
                )}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className={cn("grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6", onBatchChange && "touch-none select-none")}>
        {times.map((time) => {
          const key = slotKey(active, time);
          const isLocked = locked?.has(key);
          const isOn = isSelected(key);
          return (
            <button
              key={time}
              type="button"
              data-slot-key={key}
              disabled={isLocked}
              onPointerDown={onBatchChange ? (event) => {
                const nextSelected = !isOn;
                dragRef.current = { pointerId: event.pointerId, selected: nextSelected, anchorKey: key, keys: new Set() };
                addDragKey(key);
                event.preventDefault();
              } : undefined}
              onPointerEnter={onBatchChange ? (event) => {
                if (dragRef.current?.pointerId !== event.pointerId) return;
                addDragKey(key);
                event.preventDefault();
              } : undefined}
              onClick={() => {
                if (skipClickRef.current) return;
                onToggle(key);
              }}
              className={cn(
                "rounded-md border py-2 text-sm transition",
                isLocked
                  ? "cursor-not-allowed border-amber-300 bg-amber-100 text-amber-700"
                  : isOn && special?.has(key)
                    ? "border-violet-500 bg-violet-500 text-white"
                    : isOn
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : legend === "studio"
                        ? "border-slate-400 bg-slate-200 text-slate-700"
                        : "border-border bg-background hover:border-emerald-400 hover:bg-emerald-50",
              )}
            >
              {time}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <Legend className="border-emerald-500 bg-emerald-500" label={legend === "studio" ? "营业时间内可预约" : "已选档期"} />
        {legend === "studio" && <Legend className="border-violet-500 bg-violet-500" label="非营业时间特别开放" />}
        {legend === "studio" && <Legend className="border-amber-300 bg-amber-100" label="已被预约锁定" />}
        <Legend className={legend === "studio" ? "border-slate-400 bg-slate-200" : "border-border bg-background"} label={legend === "studio" ? "不可预约" : "未选"} />
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded border", className)} />
      {label}
    </span>
  );
}

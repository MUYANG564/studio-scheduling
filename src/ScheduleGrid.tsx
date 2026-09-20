import { useState } from "react";
import { cn } from "@/lib/utils";
import { halfHours, upcomingDates, weekday, shortDate, slotKey } from "./slots";

interface Props {
  selected: Set<string>;
  locked?: Set<string>;
  onToggle: (key: string) => void;
  dates?: string[];
  legend?: "studio" | "vendor";
}

export function ScheduleGrid({ selected, locked, onToggle, dates, legend = "studio" }: Props) {
  const dayList = dates ?? upcomingDates(14);
  const [active, setActive] = useState(dayList[0]);
  const times = halfHours();

  const countForDate = (d: string) =>
    times.filter((t) => selected.has(slotKey(d, t))).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {dayList.map((d) => {
          const n = countForDate(d);
          return (
            <button
              key={d}
              onClick={() => setActive(d)}
              className={cn(
                "flex min-w-16 flex-col items-center rounded-lg border px-3 py-2 text-sm transition",
                active === d ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent",
              )}
            >
              <span className="font-medium">{shortDate(d)}</span>
              <span className="text-xs opacity-80">{weekday(d)}</span>
              {n > 0 && (
                <span className={cn("mt-0.5 rounded-full px-1.5 text-[10px]", active === d ? "bg-primary-foreground/20" : "bg-emerald-100 text-emerald-700")}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {times.map((t) => {
          const key = slotKey(active, t);
          const isLocked = locked?.has(key);
          const isOn = selected.has(key);
          return (
            <button
              key={t}
              disabled={isLocked}
              onClick={() => onToggle(key)}
              className={cn(
                "rounded-md border py-2 text-sm transition",
                isLocked
                  ? "cursor-not-allowed border-amber-300 bg-amber-100 text-amber-700"
                  : isOn
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-border bg-background hover:border-emerald-400 hover:bg-emerald-50",
              )}
            >
              {t}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <Legend className="border-emerald-500 bg-emerald-500" label={legend === "studio" ? "空闲(可预约)" : "已选档期"} />
        {legend === "studio" && <Legend className="border-amber-300 bg-amber-100" label="已被预约锁定" />}
        <Legend className="border-border bg-background" label={legend === "studio" ? "未开放" : "未选"} />
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

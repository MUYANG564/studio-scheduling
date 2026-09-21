import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Notification } from "../types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  announcement: "全站公告",
  direct_message: "管理员私信",
};

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const r = await api.get("notifications");
      setItems(r.items ?? []);
    } catch { /* ignore polling errors */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const unread = items.filter((n) => !n.read).length;

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try { await api.post("notifications/read", { id }); } catch { /* ignore */ }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative whitespace-nowrap rounded-md border border-input px-3 py-2 text-sm hover:bg-accent"
      >
        通知
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">{unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 max-h-96 w-[calc(100vw-2rem)] max-w-80 overflow-y-auto rounded-lg border border-border bg-popover p-2 shadow-lg">
          {items.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">暂无通知</p>}
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => markRead(n.id)}
              className={cn(
                "mb-1 block w-full rounded-md p-3 text-left text-sm transition hover:bg-accent",
                !n.read && "bg-blue-50",
              )}
            >
              <div className="flex items-start gap-2">
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                <div>
                  {KIND_LABEL[n.kind] && <p className="mb-1 text-xs font-semibold text-blue-700">{KIND_LABEL[n.kind]}</p>}
                  <p className={cn(!n.read && "font-medium")}>{n.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString("zh-CN")}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { api, setToken, getToken } from "./api";
import type { Account } from "./types";
import { Login } from "./pages/Login";
import { AdminDashboard } from "./pages/Admin";
import { StudioDashboard } from "./pages/Studio";
import { VendorDashboard } from "./pages/Vendor";
import { NotificationBell } from "./pages/Notifications";
import { Button, Spinner } from "./ui";

const ROLE_LABEL: Record<string, string> = { admin: "后台管理", studio: "录音棚", vendor: "发音人 / 供应商" };

export default function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) { setLoading(false); return; }
    try {
      const r = await api.get("me");
      setAccount(r.account);
    } catch {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onExpire = () => setAccount(null);
    window.addEventListener("auth-expired", onExpire);
    return () => window.removeEventListener("auth-expired", onExpire);
  }, []);

  const onLoggedIn = (acc: Account, token: string) => {
    setToken(token);
    setAccount(acc);
  };
  const logout = () => { setToken(null); setAccount(null); };

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center"><Spinner /></div>;
  }
  if (!account) return <Login onLoggedIn={onLoggedIn} />;

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-white/90 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-sm font-semibold tracking-tight sm:text-base">录音棚档期匹配平台</span>
            <span className="hidden shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground md:inline-flex">{ROLE_LABEL[account.role]}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <NotificationBell />
            <span className="hidden text-sm text-muted-foreground sm:inline">{account.display_name || account.username}</span>
            <Button className="whitespace-nowrap px-3 sm:px-4" variant="outline" onClick={logout}>退出</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {account.role === "admin" && <AdminDashboard />}
        {account.role === "studio" && <StudioDashboard />}
        {account.role === "vendor" && <VendorDashboard account={account} />}
      </main>
    </div>
  );
}

import { useState } from "react";
import { api, ApiError } from "../api";
import type { Account } from "../types";
import { Button, Card, Field, Input } from "../ui";

export function Login({ onLoggedIn }: { onLoggedIn: (acc: Account, token: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api.post("login", { username: username.trim(), password });
      onLoggedIn(r.account, r.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败,请重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">录音棚档期匹配平台</h1>
          <p className="mt-1 text-sm text-muted-foreground">请使用分配的账号登录</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="用户名">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </Field>
          <Field label="密码">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy}>{busy ? "登录中…" : "登录"}</Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          账号由后台统一分配。录音棚 / 发音人供应商 / 后台各自独立登录。
        </p>
      </Card>
    </div>
  );
}

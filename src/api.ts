// Same-origin Function client with app session token and localized errors.
export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status = 0) {
    super(message);
    this.name = "ApiError";
  }
}

const MESSAGES: Record<string, string> = {
  network_error: "网络异常,请稍后重试。",
  invalid_response: "服务返回异常,请重试。",
  invalid_credentials: "用户名或密码错误。",
  access_denied: "登录已失效,请重新登录。",
  login_required: "请先登录。",
  forbidden: "没有权限执行该操作。",
  invalid_body: "提交的信息有误，请检查后重试。",
  invalid_business_hours: "营业时间设置有误，请检查开始和结束时间。",
  invalid_city: "所选城市已不存在，请刷新页面后重新选择。",
  username_taken: "该用户名已存在。",
  needs_setup: "请先完善录音棚信息。",
  no_availability: "该录音棚在所选档期已无空闲,请刷新后重新选择。",
  invalid_state: "当前状态无法执行该操作。",
  appeal_pending: "该预约已有待处理的申诉。",
  cannot_delete_self: "不能删除当前登录的管理员账号。",
  not_found: "未找到相关记录。",
  database_request_failed: "数据服务暂时不可用,请稍后重试。",
  dingtalk_not_configured: "管理员尚未配置钉钉文档导出，请配置后再试。",
  dingtalk_export_failed: "钉钉文档创建失败，请稍后重试或联系管理员。",
};

const TOKEN_KEY = "studio_sched_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new ApiError(MESSAGES.network_error, "network_error");
  }
  let data: unknown = null;
  const isJson = response.headers.get("content-type")?.includes("application/json");
  if (isJson) {
    try { data = await response.json(); } catch { /* fall through */ }
  }
  const body = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const code = typeof body?.error === "string" ? (body.error as string)
    : response.ok ? null : "request_failed";
  if (!response.ok || code) {
    const resolved = code ?? "request_failed";
    if ((response.status === 401 || response.status === 403) && resolved === "request_failed") {
      throw new ApiError(MESSAGES.access_denied, "access_denied", response.status);
    }
    throw new ApiError(MESSAGES[resolved] ?? "操作失败,请重试。", resolved, response.status);
  }
  return data;
}

function authExpired() {
  setToken(null);
  window.dispatchEvent(new Event("auth-expired"));
}

async function call(action: string, opts: { method?: string; body?: unknown; query?: string } = {}): Promise<any> {
  const url = `/functions/v1/app?action=${encodeURIComponent(action)}${opts.query ?? ""}`;
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["x-session-token"] = token;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  try {
    return await requestJson(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    if (e instanceof ApiError && (e.code === "access_denied" || e.code === "login_required") && action !== "login") {
      authExpired();
    }
    throw e;
  }
}

export const api = {
  get: (action: string, query?: string) => call(action, { query }),
  post: (action: string, body?: unknown) => call(action, { method: "POST", body: body ?? {} }),
};

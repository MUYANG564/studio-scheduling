const TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
const API_BASE = "https://api.dingtalk.com";
const USER_DETAIL_URL = "https://oapi.dingtalk.com/topapi/v2/user/get";

const readEnv = (name) => {
  if (typeof Deno !== "undefined") return Deno.env.get(name);
  if (typeof process !== "undefined") return process.env[name];
  return undefined;
};

export class DingTalkError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function requestJson(fetchImpl, url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    throw new DingTalkError("dingtalk_export_failed");
  } finally {
    clearTimeout(timeout);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new DingTalkError("dingtalk_export_failed");
  }
  if (!response.ok || body?.code || body?.errcode) {
    throw new DingTalkError("dingtalk_export_failed");
  }
  return body;
}

export function createDingTalkClient({ env = readEnv, fetchImpl = fetch } = {}) {
  const config = () => ({
    appKey: env("DINGTALK_APP_KEY")?.trim(),
    appSecret: env("DINGTALK_APP_SECRET")?.trim(),
    operatorId: env("DINGTALK_OPERATOR_ID")?.trim(),
    workspaceId: env("DINGTALK_WORKSPACE_ID")?.trim(),
  });

  const accessToken = async (settings) => {
    const body = await requestJson(fetchImpl, TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appKey: settings.appKey, appSecret: settings.appSecret }),
    });
    if (typeof body.accessToken !== "string" || !body.accessToken) {
      throw new DingTalkError("dingtalk_export_failed");
    }
    return body.accessToken;
  };

  const resolveOperatorId = async (operatorId, token) => {
    if (!/^\d+$/.test(operatorId)) return operatorId;
    const body = await requestJson(
      fetchImpl,
      `${USER_DETAIL_URL}?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userid: operatorId, language: "zh_CN" }),
      },
    );
    const unionId = body?.result?.unionid;
    if (typeof unionId !== "string" || !unionId) {
      throw new DingTalkError("dingtalk_export_failed");
    }
    return unionId;
  };

  return {
    async createDocument({ title, content }) {
      const settings = config();
      if (!settings.appKey || !settings.appSecret || !settings.operatorId || !settings.workspaceId) {
        throw new DingTalkError("dingtalk_not_configured");
      }
      const token = await accessToken(settings);
      const operatorId = await resolveOperatorId(settings.operatorId, token);
      const headers = {
        "content-type": "application/json",
        "x-acs-dingtalk-access-token": token,
      };
      const created = await requestJson(
        fetchImpl,
        `${API_BASE}/v1.0/doc/workspaces/${encodeURIComponent(settings.workspaceId)}/docs`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ name: title, docType: "DOC", operatorId }),
        },
      );
      if (typeof created.docKey !== "string" || typeof created.url !== "string") {
        throw new DingTalkError("dingtalk_export_failed");
      }
      let documentUrl;
      try {
        documentUrl = new URL(created.url);
      } catch {
        throw new DingTalkError("dingtalk_export_failed");
      }
      if (documentUrl.protocol !== "https:" || (documentUrl.hostname !== "dingtalk.com" && !documentUrl.hostname.endsWith(".dingtalk.com"))) {
        throw new DingTalkError("dingtalk_export_failed");
      }
      await requestJson(
        fetchImpl,
        `${API_BASE}/v2.0/doc/me/suites/documents/${encodeURIComponent(created.docKey)}/overwriteContent`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ dataType: "markdown", content }),
        },
      );
      return { documentId: created.docKey, url: created.url };
    },
  };
}

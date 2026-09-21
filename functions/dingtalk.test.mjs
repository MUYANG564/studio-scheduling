import test from "node:test";
import assert from "node:assert/strict";
import { createDingTalkClient, DingTalkError } from "./dingtalk.mjs";

const envValues = {
  DINGTALK_APP_KEY: "app-key",
  DINGTALK_APP_SECRET: "app-secret",
  DINGTALK_OPERATOR_ID: "operator-union-id",
  DINGTALK_WORKSPACE_ID: "workspace-id",
};

test("DingTalk client creates a document and overwrites it with Markdown", async () => {
  const requests = [];
  const responses = [
    { accessToken: "server-token", expireIn: 7200 },
    { docKey: "document-key", url: "https://alidocs.dingtalk.com/i/nodes/document-key" },
    { data: true },
  ];
  const client = createDingTalkClient({
    env: (name) => envValues[name],
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return Response.json(responses.shift());
    },
  });

  const result = await client.createDocument({ title: "数据备份", content: "# 备份" });

  assert.deepEqual(result, {
    documentId: "document-key",
    url: "https://alidocs.dingtalk.com/i/nodes/document-key",
  });
  assert.equal(requests[0].url, "https://api.dingtalk.com/v1.0/oauth2/accessToken");
  assert.deepEqual(requests[0].body, { appKey: "app-key", appSecret: "app-secret" });
  assert.deepEqual(requests[1].body, {
    name: "数据备份", docType: "DOC", operatorId: "operator-union-id",
  });
  assert.deepEqual(requests[2].body, { dataType: "markdown", content: "# 备份" });
  assert.equal(requests[2].init.headers["x-acs-dingtalk-access-token"], "server-token");
});

test("DingTalk client resolves a numeric userId to unionId", async () => {
  const requests = [];
  const responses = [
    { accessToken: "server-token", expireIn: 7200 },
    { errcode: 0, errmsg: "ok", result: { unionid: "resolved-union-id" } },
    { docKey: "document-key", url: "https://alidocs.dingtalk.com/i/nodes/document-key" },
    { data: true },
  ];
  const client = createDingTalkClient({
    env: (name) => ({ ...envValues, DINGTALK_OPERATOR_ID: "553593" })[name],
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return Response.json(responses.shift());
    },
  });

  await client.createDocument({ title: "数据备份", content: "# 备份" });

  assert.equal(
    requests[1].url,
    "https://oapi.dingtalk.com/topapi/v2/user/get?access_token=server-token",
  );
  assert.deepEqual(requests[1].body, { userid: "553593", language: "zh_CN" });
  assert.deepEqual(requests[2].body, {
    name: "数据备份", docType: "DOC", operatorId: "resolved-union-id",
  });
});

test("DingTalk client identifies operator lookup failures", async () => {
  const responses = [
    { accessToken: "server-token", expireIn: 7200 },
    { errcode: 60011, errmsg: "no permission" },
  ];
  const client = createDingTalkClient({
    env: (name) => ({ ...envValues, DINGTALK_OPERATOR_ID: "553593" })[name],
    fetchImpl: async () => Response.json(responses.shift()),
  });

  await assert.rejects(
    () => client.createDocument({ title: "数据备份", content: "# 备份" }),
    (error) => error instanceof DingTalkError && error.code === "dingtalk_operator_failed",
  );
});

test("DingTalk client fails clearly when server configuration is missing", async () => {
  const client = createDingTalkClient({ env: () => "", fetchImpl: async () => { throw new Error("should not fetch"); } });
  await assert.rejects(
    () => client.createDocument({ title: "数据备份", content: "# 备份" }),
    (error) => error instanceof DingTalkError && error.code === "dingtalk_not_configured",
  );
});

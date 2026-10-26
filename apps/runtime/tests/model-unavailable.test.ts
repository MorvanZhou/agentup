import { expect, it } from "vitest";

import {
  assistantFailureNotice,
  isAuthError,
  isModelServiceUnavailable,
  isQuotaOrBillingError,
  isRateLimitError,
  isUserCancelError,
  modelUnavailableNotice,
} from "../src/session/model/unavailable.js";

const TOKENHUB_QUOTA_402 =
  '402: {"type":"permission_error","code":"401008","message":"The free trial quota for the service has been exhausted and postpaid billing is not enabled, so the service cannot be accessed. Please go to Console > Online Inference Service to enable postpaid billing. See: https://console.cloud.tencent.com/tokenhub/inference","message_zh":"服务免费体验额度已耗尽，且未开启后付费，无法正常访问。请前往控制台 > 在线推理服务开启后付费，查看链接：https://console.cloud.tencent.com/tokenhub/inference","source":"gateway","request_id":"5f4ec93e-b33f-482f-9827-da99f669963b"}';

it("detects connection / ollama failures as model unavailable", () => {
  expect(isModelServiceUnavailable("Connection error.")).toBe(true);
  expect(isModelServiceUnavailable("fetch failed")).toBe(true);
  expect(isModelServiceUnavailable("ECONNREFUSED")).toBe(true);
  expect(isModelServiceUnavailable("This operation was aborted")).toBe(false);
  expect(isModelServiceUnavailable("用户已取消")).toBe(false);
  expect(isUserCancelError("Request was aborted")).toBe(true);
});

it("detects provider rate-limit / overload as rate limit", () => {
  expect(
    isRateLimitError(
      '429: {"code":"1302","message":"Rate limit reached for requests"}',
    ),
  ).toBe(true);
  expect(
    isRateLimitError(
      '429: {"code":"1305","message":"The service may be temporarily overloaded, please try again later"}',
    ),
  ).toBe(true);
  expect(isRateLimitError("Connection error.")).toBe(false);
  expect(isRateLimitError(TOKENHUB_QUOTA_402)).toBe(false);
});

it("detects quota / billing and auth failures", () => {
  expect(isQuotaOrBillingError(TOKENHUB_QUOTA_402)).toBe(true);
  expect(isQuotaOrBillingError("402 Payment Required")).toBe(true);
  expect(isQuotaOrBillingError("insufficient_quota")).toBe(true);
  expect(isQuotaOrBillingError("Connection error.")).toBe(false);

  expect(isAuthError('401: {"message":"Incorrect API key provided"}')).toBe(true);
  expect(isAuthError("invalid_api_key")).toBe(true);
  expect(isAuthError(TOKENHUB_QUOTA_402)).toBe(false);
});

it("returns localized notice copy", () => {
  expect(modelUnavailableNotice("zh")).toContain("切换模型");
  expect(modelUnavailableNotice("en")).toMatch(/switch/i);
});

it("maps empty-assistant failures to readable notices", () => {
  expect(assistantFailureNotice("Connection error.", "zh")).toContain("切换模型");
  expect(
    assistantFailureNotice(
      '429: {"code":"1302","message":"Rate limit reached for requests"}',
      "zh",
    ),
  ).toContain("过于频繁");
  expect(
    assistantFailureNotice(
      '429: {"code":"1305","message":"The service may be temporarily overloaded, please try again later"}',
      "en",
    ),
  ).toMatch(/rate|busy|later/i);
  expect(assistantFailureNotice("Request aborted", "zh")).toBeNull();
});

it("maps TokenHub quota exhaustion to actionable Chinese guidance", () => {
  const notice = assistantFailureNotice(TOKENHUB_QUOTA_402, "zh");
  expect(notice).toBeTruthy();
  expect(notice).toContain("额度");
  expect(notice).toMatch(/供应商|余额|账单|套餐|切换模型/);
  expect(notice).not.toContain("未返回可用结果");
  expect(notice).not.toMatch(/free trial quota/i);
});

it("maps auth failures and unknown provider errors with troubleshooting hints", () => {
  expect(assistantFailureNotice('401: {"message":"Incorrect API key"}', "zh")).toMatch(
    /API Key|密钥|重新配置/,
  );
  const unknown = assistantFailureNotice("boom from provider", "zh");
  expect(unknown).toContain("boom from provider");
  expect(unknown).toMatch(/检查|切换模型|重试/);
});

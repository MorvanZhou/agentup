import { DefaultChatTransport, type UIMessage } from "ai";

import { agentUpEntryId, lastUserPrompt, userTurnOrdinalAfterReset } from "../model/chat/chat";
import { PERSONAL_ASSISTANT_ID } from "../model/runtime/runtime";
import { readUiLocale } from "../model/ui/ui-locale";

/** 指向本机 runtime 的 AI SDK ChatTransport；正文 + 附件交给 Pi。 */
export function createAgentUpTransport(options: {
  baseUrl: string;
  token: string;
  userId: string;
  agentId: string;
  fetchImpl?: typeof fetch;
}) {
  const api =
    options.agentId === PERSONAL_ASSISTANT_ID
      ? `${options.baseUrl}/personal-assistant/prompt`
      : `${options.baseUrl}/agents/${encodeURIComponent(options.agentId)}/prompt`;
  const abortApi =
    options.agentId === PERSONAL_ASSISTANT_ID
      ? `${options.baseUrl}/personal-assistant/abort`
      : `${options.baseUrl}/agents/${encodeURIComponent(options.agentId)}/abort`;
  const baseFetch = options.fetchImpl ?? fetch;

  async function abortBusyTurn(): Promise<void> {
    try {
      await baseFetch(abortApi, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
          "x-ui-locale": readUiLocale(),
        },
        body: JSON.stringify({ user_id: options.userId }),
      });
    } catch {
      // 停止失败不阻断重试；仍可能 409。
    }
  }

  /** 409=上一轮 busy：先 abort 再重试一次；其它 JSON 错误勿当 SSE 正文展示。 */
  const fetchWithBusyRetry: typeof fetch = async (input, init) => {
    let response = await baseFetch(input, init);
    if (response.status === 409) {
      await abortBusyTurn();
      response = await baseFetch(input, init);
    }
    if (response.ok) return response;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
      const message =
        payload && typeof payload.error === "string" && payload.error.trim()
          ? payload.error.trim()
          : response.status === 409
            ? "上一轮仍在结束，请稍后再试"
            : `请求失败（${response.status}）`;
      throw new Error(message);
    }
    return response;
  };

  return new DefaultChatTransport<UIMessage>({
    api,
    headers: {
      authorization: `Bearer ${options.token}`,
      "x-ui-locale": readUiLocale(),
    },
    body: { user_id: options.userId },
    fetch: fetchWithBusyRetry,
    prepareSendMessagesRequest: ({ messages, headers, credentials, api: requestApi, messageId, trigger }) => {
      const { text, attachments } = lastUserPrompt(messages);
      if (!text && attachments.length === 0) throw new Error("消息为空");
      const body: Record<string, unknown> = {
        user_id: options.userId,
        text,
      };
      if (attachments.length > 0) {
        body.attachments = attachments.map((item) => ({
          name: item.name,
          media_type: item.mediaType,
          data_base64: item.dataBase64,
        }));
      }
      // 编辑重发 / 助手「重新生成」都要带 rewind，否则 Pi 只追加新 user，界面会出现多条同文案。
      // - submit-message：onEdit 常截到父消息；messageId 多为被编辑的 user。
      // - regenerate-message：AI SDK 截到对应 user；messageId 是被重试的 assistant，rewind 用最近 user。
      if (trigger === "submit-message" || trigger === "regenerate-message") {
        const ordinal = userTurnOrdinalAfterReset(messages);
        if (ordinal >= 0) body.user_turn_ordinal = ordinal;
        if (trigger === "submit-message" && messageId) {
          const edited = messages.find((message) => message.id === messageId);
          body.rewind_message_id = agentUpEntryId(edited) ?? messageId;
        } else if (trigger === "regenerate-message") {
          for (let index = messages.length - 1; index >= 0; index -= 1) {
            const candidate = messages[index];
            if (candidate?.role !== "user") continue;
            const entryId = agentUpEntryId(candidate);
            if (entryId) body.rewind_message_id = entryId;
            break;
          }
        }
      }
      return {
        api: requestApi,
        headers,
        credentials,
        body,
      };
    },
  });
}

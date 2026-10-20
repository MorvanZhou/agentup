import { DefaultChatTransport, type UIMessage } from "ai";

import { agentUpEntryId, lastUserPrompt, userTurnOrdinalAfterReset } from "../model/chat";
import { PERSONAL_ASSISTANT_ID } from "../model/runtime";

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
  return new DefaultChatTransport<UIMessage>({
    api,
    headers: { authorization: `Bearer ${options.token}` },
    body: { user_id: options.userId },
    fetch: options.fetchImpl,
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
      // 编辑重发：assistant-ui onEdit 会先截到父消息再 sendMessage，通常不带 messageId。
      // 始终附带 user 下标；Pi 上若该下标尚无对应 entry（新消息）则 rewind 为 no-op。
      if (trigger === "submit-message") {
        const ordinal = userTurnOrdinalAfterReset(messages);
        if (ordinal >= 0) body.user_turn_ordinal = ordinal;
        if (messageId) {
          const edited = messages.find((message) => message.id === messageId);
          body.rewind_message_id = agentUpEntryId(edited) ?? messageId;
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

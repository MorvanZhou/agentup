import { PERSONAL_ASSISTANT_ID } from "../../model/runtime";

import type { RuntimeHttp } from "./http";

export type StagedAttachment = {
  id: string;
  path: string;
  ref: string;
  name: string;
  mediaType: string;
};

export async function stageAttachment(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  file: { name: string; mediaType: string; dataBase64: string },
): Promise<StagedAttachment> {
  const path =
    agentId === PERSONAL_ASSISTANT_ID
      ? "/personal-assistant/attachments"
      : `/agents/${encodeURIComponent(agentId)}/attachments`;
  const payload = await http.request(path, token, {
    user_id: userId,
    name: file.name,
    media_type: file.mediaType,
    data_base64: file.dataBase64,
  });
  if (
    typeof payload.id !== "string" ||
    typeof payload.path !== "string" ||
    typeof payload.ref !== "string" ||
    typeof payload.name !== "string"
  ) {
    throw new Error("附件上传失败");
  }
  return {
    id: payload.id,
    path: payload.path,
    ref: payload.ref,
    name: payload.name,
    mediaType: typeof payload.media_type === "string" ? payload.media_type : file.mediaType,
  };
}

export async function deleteStagedAttachment(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  relativePath: string,
): Promise<void> {
  const path =
    agentId === PERSONAL_ASSISTANT_ID
      ? `/personal-assistant/attachments?user_id=${encodeURIComponent(userId)}&path=${encodeURIComponent(relativePath)}`
      : `/agents/${encodeURIComponent(agentId)}/attachments?user_id=${encodeURIComponent(userId)}&path=${encodeURIComponent(relativePath)}`;
  await http.request(path, token, undefined, "DELETE");
}

import type { SessionCredential } from "../../control/types.js";
import {
  ensureCachedUserAvatar,
  readCachedUserAvatarDataUrl,
  writeCachedUserAvatarDataUrl,
  type EnsureCachedAvatarOptions,
} from "../agents/cached-avatar.js";

/**
 * 把会话里的远程头像落到本机 data URL（与 Agent ensureCachedAvatar 同一策略）。
 * 上传刚完成时可传 avatarDataUrl，免再打一遍易过期的签名 GET。
 */
export async function materializeSessionAvatar(
  userDataRoot: string,
  credential: SessionCredential,
  options: EnsureCachedAvatarOptions & { avatarDataUrl?: string } = {},
): Promise<SessionCredential> {
  if (!credential.hasAvatar) {
    return {
      userId: credential.userId,
      email: credential.email,
      nickname: credential.nickname,
      token: credential.token,
      hasAvatar: false,
    };
  }

  const { avatarDataUrl, refresh, fetch: fetchImpl } = options;
  if (avatarDataUrl?.trim()) {
    const written = writeCachedUserAvatarDataUrl(
      userDataRoot,
      credential.userId,
      avatarDataUrl.trim(),
      credential.avatarUrl,
    );
    if (written) {
      return { ...credential, hasAvatar: true, avatarUrl: written };
    }
  }

  const cached = await ensureCachedUserAvatar(userDataRoot, credential.userId, credential.avatarUrl, {
    ...(refresh ? { refresh: true } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  if (cached) return { ...credential, hasAvatar: true, avatarUrl: cached };

  const offline = readCachedUserAvatarDataUrl(userDataRoot, credential.userId);
  if (offline) return { ...credential, hasAvatar: true, avatarUrl: offline };

  // 尚无本机缓存时保留远程 URL，供本次在线展示；vault 侧应尽快被 data URL 覆盖
  return credential;
}

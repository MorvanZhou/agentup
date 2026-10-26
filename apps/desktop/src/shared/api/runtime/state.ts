import type { UserState } from "../../model/runtime/runtime";

import type { RuntimeHttp } from "./http";
import { readUserState } from "./readers";

export async function state(http: RuntimeHttp, token: string, userId: string): Promise<UserState> {
  return readUserState(
    await http.request(`/state?user_id=${encodeURIComponent(userId)}`, token),
  );
}

export async function saveState(
  http: RuntimeHttp,
  token: string,
  userId: string,
  unread: Record<string, number>,
  previews: Record<string, string>,
  lastActiveAt: Record<string, number>,
): Promise<UserState> {
  return readUserState(
    await http.request("/state", token, {
      user_id: userId,
      unread,
      previews,
      last_active_at: lastActiveAt,
    }),
  );
}

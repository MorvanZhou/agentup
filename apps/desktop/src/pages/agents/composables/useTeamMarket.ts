import { ref, type Ref } from "vue";
import { useRouter } from "vue-router";

import { runWithAccount } from "../../../app/auth/auth-gate";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { Session } from "../../../shared/model/runtime/runtime";
import { isGuestSession } from "../../../shared/model/session/session";
import { showToast } from "../../../shared/model/ui/toast";
import { t } from "../../../shared/model/ui/ui-locale";

export function useTeamMarket(
  session: Ref<Session | null>,
  refresh: () => Promise<void>,
  api = new DesktopApi(),
) {
  const router = useRouter();
  const busyTeamId = ref("");

  async function recruit(teamId: string): Promise<void> {
    if (!session.value || busyTeamId.value) return;
    await runWithAccount("agent.recruit", async () => {
      const current = session.value;
      if (!current || isGuestSession(current) || busyTeamId.value) return;
      busyTeamId.value = teamId;
      try {
        const result = await api.recruitTeam(current.token, current.userId, teamId);
        await refresh();
        showToast(t("teamsRecruitOpened"), "success");
        await router.push({ name: "conversation", query: { group: result.group.id } });
      } catch (caught) {
        showToast(caught instanceof DesktopApiError ? caught.message : t("teamsRecruitFailed"), "error");
      } finally {
        busyTeamId.value = "";
      }
    });
  }

  return { busyTeamId, recruit };
}

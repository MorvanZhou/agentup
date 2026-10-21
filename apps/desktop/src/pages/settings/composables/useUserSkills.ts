import { ref } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { UserSkill } from "../../../shared/model/runtime";
import { showToast } from "../../../shared/model/toast";

export function useUserSkills(api = new DesktopApi()) {
  const { session } = useDesktop();
  const skills = ref<UserSkill[]>([]);
  const busy = ref(false);
  let loaded = false;

  async function load(force = false): Promise<void> {
    if (!session.value || busy.value) return;
    if (loaded && !force) return;
    busy.value = true;
    try {
      skills.value = await api.userSkills(session.value.token, session.value.userId);
      loaded = true;
    } catch (caught) {
      showToast(messageOf(caught, "技能列表加载失败"), "error");
    } finally {
      busy.value = false;
    }
  }

  async function upload(kind: "directory" | "zip", expectName?: string): Promise<void> {
    if (!session.value || busy.value) return;
    const bridge = window.agentUp;
    if (!bridge?.selectSkillPackage) {
      showToast("当前环境无法选择本地文件", "error");
      return;
    }
    const packagePath = await bridge.selectSkillPackage(kind);
    if (!packagePath) return;
    busy.value = true;
    try {
      const skill = await api.installUserSkill(
        session.value.token,
        session.value.userId,
        packagePath,
        expectName,
      );
      skills.value = await api.userSkills(session.value.token, session.value.userId);
      loaded = true;
      showToast(expectName ? `已更新 ${skill.name}` : `已安装 ${skill.name}`, "success");
    } catch (caught) {
      showToast(messageOf(caught, expectName ? "技能更新失败" : "技能安装失败"), "error");
    } finally {
      busy.value = false;
    }
  }

  async function setEnabled(name: string, enabled: boolean): Promise<void> {
    if (!session.value || busy.value) return;
    busy.value = true;
    try {
      const saved = await api.setUserSkillEnabled(session.value.token, session.value.userId, name, enabled);
      skills.value = skills.value.map((skill) => (skill.name === name ? saved : skill));
    } catch (caught) {
      showToast(messageOf(caught, "切换激活状态失败"), "error");
      skills.value = await api.userSkills(session.value.token, session.value.userId);
    } finally {
      busy.value = false;
    }
  }

  async function remove(name: string): Promise<void> {
    if (!session.value || busy.value) return;
    busy.value = true;
    try {
      await api.deleteUserSkill(session.value.token, session.value.userId, name);
      skills.value = skills.value.filter((skill) => skill.name !== name);
      showToast("技能已删除", "success");
    } catch (caught) {
      showToast(messageOf(caught, "技能删除失败"), "error");
    } finally {
      busy.value = false;
    }
  }

  return { skills, busy, load, upload, setEnabled, remove };
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof DesktopApiError ? caught.message : fallback;
}

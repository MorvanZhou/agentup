/** 编辑表单里尚未保存安装的 Skill 包。 */
export type PendingSkill = {
  path: string;
  /** 来自包内 SKILL.md name，不是临时 zip 文件名 */
  name: string;
};

export type SkillAddConflict = "installed" | "pending" | null;

/** 新增 Skill 时与已装 / 待装是否同名。 */
export function skillAddConflict(
  name: string,
  installedNames: readonly string[],
  pending: readonly PendingSkill[],
): SkillAddConflict {
  if (pending.some((item) => item.name === name)) return "pending";
  if (installedNames.includes(name)) return "installed";
  return null;
}

/** 同名待装只保留最新一条。 */
export function upsertPendingSkill(
  pending: readonly PendingSkill[],
  next: PendingSkill,
): PendingSkill[] {
  return [...pending.filter((item) => item.name !== next.name && item.path !== next.path), next];
}

/** 待装将覆盖同名已装时，列表里只展示待装项，避免双行同名。 */
export function visibleInstalledSkills(
  installed: readonly string[],
  pending: readonly PendingSkill[],
): string[] {
  const pendingNames = new Set(pending.map((item) => item.name));
  return installed.filter((name) => !pendingNames.has(name));
}

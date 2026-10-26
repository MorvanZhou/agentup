import care from "../../../assets/official-avatars/care.png";
import chef from "../../../assets/official-avatars/chef.png";
import concierge from "../../../assets/official-avatars/concierge.png";
import designer from "../../../assets/official-avatars/designer.png";
import detective from "../../../assets/official-avatars/detective.png";
import doer from "../../../assets/official-avatars/doer.png";
import engineer from "../../../assets/official-avatars/engineer.png";
import gardener from "../../../assets/official-avatars/gardener.png";
import greeter from "../../../assets/official-avatars/greeter.png";
import guide from "../../../assets/official-avatars/guide.png";
import happy from "../../../assets/official-avatars/happy.png";
import leader from "../../../assets/official-avatars/leader.png";
import messenger from "../../../assets/official-avatars/messenger.png";
import musician from "../../../assets/official-avatars/musician.png";
import night from "../../../assets/official-avatars/night.png";
import researcher from "../../../assets/official-avatars/researcher.png";
import scholar from "../../../assets/official-avatars/scholar.png";
import teacher from "../../../assets/official-avatars/teacher.png";
import thinker from "../../../assets/official-avatars/thinker.png";
import writer from "../../../assets/official-avatars/writer.png";

/** 每页一排。前五个是轮廓差最大的，打开时先看到。 */
export const OFFICIAL_AVATAR_PAGE_SIZE = 5;

/** 官方可选头像。点选后仍按上传路径存成该 Agent 自己的图。 */
export const OFFICIAL_AVATARS = [
  { id: "greeter", labelKey: "officialAvatarGreeter", url: greeter },
  { id: "chef", labelKey: "officialAvatarChef", url: chef },
  { id: "scholar", labelKey: "officialAvatarScholar", url: scholar },
  { id: "night", labelKey: "officialAvatarNight", url: night },
  { id: "musician", labelKey: "officialAvatarMusician", url: musician },
  { id: "detective", labelKey: "officialAvatarDetective", url: detective },
  { id: "engineer", labelKey: "officialAvatarEngineer", url: engineer },
  { id: "care", labelKey: "officialAvatarCare", url: care },
  { id: "happy", labelKey: "officialAvatarHappy", url: happy },
  { id: "gardener", labelKey: "officialAvatarGardener", url: gardener },
  { id: "thinker", labelKey: "officialAvatarThinker", url: thinker },
  { id: "researcher", labelKey: "officialAvatarResearcher", url: researcher },
  { id: "designer", labelKey: "officialAvatarDesigner", url: designer },
  { id: "writer", labelKey: "officialAvatarWriter", url: writer },
  { id: "teacher", labelKey: "officialAvatarTeacher", url: teacher },
  { id: "guide", labelKey: "officialAvatarGuide", url: guide },
  { id: "messenger", labelKey: "officialAvatarMessenger", url: messenger },
  { id: "leader", labelKey: "officialAvatarLeader", url: leader },
  { id: "doer", labelKey: "officialAvatarDoer", url: doer },
  { id: "concierge", labelKey: "officialAvatarConcierge", url: concierge },
] as const;

export type OfficialAvatarId = (typeof OFFICIAL_AVATARS)[number]["id"];

export function officialAvatarUrl(id: OfficialAvatarId): string {
  const match = OFFICIAL_AVATARS.find((item) => item.id === id);
  if (!match) throw new Error(`缺少官方头像 ${id}`);
  return match.url;
}

/** 读成 File，交给和上传相同的压缩流程。 */
export async function officialAvatarFile(id: OfficialAvatarId): Promise<File> {
  const response = await fetch(officialAvatarUrl(id));
  if (!response.ok) throw new Error(`官方头像加载失败 ${id}`);
  const blob = await response.blob();
  const type = blob.type.startsWith("image/") ? blob.type : "image/png";
  return new File([blob], `${id}.png`, { type });
}

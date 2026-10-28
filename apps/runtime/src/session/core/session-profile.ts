import type { ExecutionMode } from "../context/mode.js";

export type SessionProfileKind = "interactive" | "group-holder" | "delegation";

export type SessionProfileServices = {
  delegation?: boolean;
  background?: boolean;
};

/** 三种会话共用一套拼装，差别只在这张表。群执掌和一对一能力相同，身份由 ConversationRef 区分。 */
export type SessionProfile = {
  kind: SessionProfileKind;
  mode: ExecutionMode;
  session: "continue" | "fresh";
  personalSkills: boolean;
  personalMcp: boolean;
  summary: boolean;
  artifactPanel: boolean;
  delegationInbox: boolean;
  delegateTool: boolean;
  backgroundTool: boolean;
  deliverArtifacts: boolean;
  completeGroupTask: boolean;
  projectRootsPrompt: boolean;
  collaborationPrompt: boolean;
  healInterrupted: boolean;
  persistModelRef: boolean;
  delegationLabels: boolean;
};

const PROFILE: Record<ExecutionMode, SessionProfile> = {
  single: {
    kind: "interactive",
    mode: "single",
    session: "continue",
    personalSkills: true,
    personalMcp: true,
    summary: true,
    artifactPanel: true,
    delegationInbox: false,
    delegateTool: false,
    backgroundTool: false,
    deliverArtifacts: false,
    completeGroupTask: false,
    projectRootsPrompt: true,
    collaborationPrompt: false,
    healInterrupted: true,
    persistModelRef: true,
    delegationLabels: false,
  },
  "group-holder": {
    kind: "group-holder",
    mode: "group-holder",
    session: "fresh",
    personalSkills: true,
    personalMcp: true,
    summary: true,
    artifactPanel: true,
    delegationInbox: false,
    delegateTool: false,
    backgroundTool: false,
    deliverArtifacts: false,
    completeGroupTask: false,
    projectRootsPrompt: false,
    collaborationPrompt: false,
    healInterrupted: false,
    persistModelRef: false,
    delegationLabels: false,
  },
  "single-delegation": {
    kind: "delegation",
    mode: "single-delegation",
    session: "fresh",
    personalSkills: false,
    personalMcp: false,
    summary: false,
    artifactPanel: false,
    delegationInbox: false,
    delegateTool: false,
    backgroundTool: false,
    deliverArtifacts: true,
    completeGroupTask: false,
    projectRootsPrompt: false,
    collaborationPrompt: false,
    healInterrupted: false,
    persistModelRef: false,
    delegationLabels: false,
  },
  "group-delegation": {
    kind: "delegation",
    mode: "group-delegation",
    session: "fresh",
    personalSkills: false,
    personalMcp: false,
    summary: false,
    artifactPanel: false,
    delegationInbox: false,
    delegateTool: false,
    backgroundTool: false,
    deliverArtifacts: false,
    completeGroupTask: true,
    projectRootsPrompt: false,
    collaborationPrompt: false,
    healInterrupted: false,
    persistModelRef: false,
    delegationLabels: false,
  },
};

const MODE_FOR_KIND: Record<SessionProfileKind, ExecutionMode> = {
  interactive: "single",
  "group-holder": "group-holder",
  delegation: "single-delegation",
};

export function profileForMode(
  mode: ExecutionMode,
  services: SessionProfileServices = {},
): SessionProfile {
  const profile: SessionProfile = { ...PROFILE[mode] };
  if (mode === "single" || mode === "group-holder") {
    const delegation = services.delegation === true;
    const background = services.background === true;
    profile.delegationInbox = delegation;
    profile.delegateTool = delegation;
    profile.backgroundTool = background;
    profile.collaborationPrompt = delegation;
    profile.delegationLabels = delegation;
  }
  return profile;
}

export function sessionProfile(
  kind: SessionProfileKind,
  services: SessionProfileServices = {},
): SessionProfile {
  return profileForMode(MODE_FOR_KIND[kind], services);
}

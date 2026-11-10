import path from "node:path";

import type { BackgroundJobs } from "../background/index.js";
import {
  clearRecipeLinkedJob,
  readWorkspaceConfig,
  removePreviewRecipe,
  setRecipeHeaderPinned,
  upsertPreviewRecipe,
  type PreviewRecipe,
} from "../workspace/workspace-config.js";
import {
  findTcpListenPid,
  parsePreviewPort,
  sleep,
  terminatePid,
  waitForListenPid,
  waitUntilPortFree,
} from "./port.js";

export class PreviewError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export type PreviewScope =
  | { kind: "agent"; agentId: string }
  | { kind: "personal" }
  | { kind: "group"; groupId: string };

/** 启动结果：started 已拉起；conflict 需人确认后再 force。 */
export type PreviewStartResult =
  | { status: "started"; recipe: PreviewRecipe; jobId: string }
  | {
      status: "conflict";
      recipe: PreviewRecipe;
      pid: number;
      preview_url: string;
    };

/**
 * 人侧预览启停：按 recipe.command 走 BackgroundJobs；workspace 记 linked_job_id + linked_pid。
 * 端口占用：同 linked_pid → 静默重启；不同 pid → conflict（Desktop 弹窗后 force）。
 * 人侧手动停预览不 wake Agent、不写「后台任务已取消」。
 */
export class PreviewService {
  constructor(private readonly jobs: BackgroundJobs) {}

  listRecipes(workspaceRoot: string): PreviewRecipe[] {
    return readWorkspaceConfig(workspaceRoot)?.preview?.recipes ?? [];
  }

  async start(input: {
    userId: string;
    agentId: string;
    workspaceRoot: string;
    recipeId: string;
    scope: PreviewScope;
    groupId?: string;
    /** 人已确认可杀掉占用端口的其它进程。 */
    force?: boolean;
  }): Promise<PreviewStartResult> {
    const recipe = this.requireRecipe(input.workspaceRoot, input.recipeId);
    const port = parsePreviewPort(recipe.preview_url);
    const occupant = port != null ? findTcpListenPid(port) : null;
    const storedPid =
      typeof recipe.linked_pid === "number" && recipe.linked_pid > 0 ? recipe.linked_pid : null;

    if (occupant != null) {
      if (storedPid != null && occupant === storedPid) {
        // 仍是我们上次记下的进程 → 直接重启
        await this.releaseOccupant(input.userId, recipe, occupant, port);
      } else if (!input.force) {
        // 别人的进程（或尚无 linked_pid）→ 让 Desktop 确认
        return {
          status: "conflict",
          recipe,
          pid: occupant,
          preview_url: recipe.preview_url,
        };
      } else {
        await this.releaseOccupant(input.userId, recipe, occupant, port);
      }
    } else {
      // 端口空闲：清掉可能残留的 linked job
      this.quietStopLinked(input.userId, recipe);
      clearRecipeLinkedJob(input.workspaceRoot, recipe.id);
    }

    const cwd = path.resolve(input.workspaceRoot, recipe.cwd || ".");
    const job = await this.jobs.start({
      userId: input.userId,
      agentId: input.agentId,
      command: recipe.command,
      cwd,
      name: recipe.title,
      silent: true,
      ...(input.groupId ? { groupId: input.groupId } : {}),
    });

    let listenPid: number | null = null;
    if (port != null) {
      listenPid = await waitForListenPid(port, 4000, () => {
        const latest = this.jobs.get(job.id);
        return (
          !latest ||
          latest.status === "failed" ||
          latest.status === "cancelled" ||
          latest.status === "completed"
        );
      });
    }
    if (listenPid == null) {
      const spawned = this.jobs.get(job.id)?.pid;
      if (typeof spawned === "number" && spawned > 0) listenPid = spawned;
    }

    const next = upsertPreviewRecipe(input.workspaceRoot, {
      ...recipe,
      linked_job_id: job.id,
      linked_pid: listenPid,
    });
    const saved = next.preview?.recipes?.find((item) => item.id === recipe.id) ?? {
      ...recipe,
      linked_job_id: job.id,
      linked_pid: listenPid,
    };
    return { status: "started", recipe: saved, jobId: job.id };
  }

  stop(input: {
    userId: string;
    workspaceRoot: string;
    recipeId: string;
    scope: PreviewScope;
  }): PreviewRecipe {
    const recipe = this.requireRecipe(input.workspaceRoot, input.recipeId);
    this.quietStopLinked(input.userId, recipe);
    if (typeof recipe.linked_pid === "number" && recipe.linked_pid > 0) {
      const still = this.jobs.findActiveByPid(input.userId, recipe.linked_pid);
      if (!still) terminatePid(recipe.linked_pid);
    }
    clearRecipeLinkedJob(input.workspaceRoot, recipe.id);
    return { ...recipe, linked_job_id: null, linked_pid: null };
  }

  /** 顶栏常驻：写 header_pinned。 */
  setHeaderPinned(input: {
    workspaceRoot: string;
    recipeId: string;
    pinned: boolean;
  }): PreviewRecipe {
    try {
      const next = setRecipeHeaderPinned(input.workspaceRoot, input.recipeId, input.pinned);
      const saved = next.preview?.recipes?.find((item) => item.id === input.recipeId);
      if (!saved) throw new PreviewError("预览配方不存在", 404);
      return saved;
    } catch (error) {
      if (error instanceof PreviewError) throw error;
      const message = error instanceof Error && error.message ? error.message : "";
      if (message.includes("not found")) throw new PreviewError("预览配方不存在", 404);
      throw new PreviewError(message || "更新预览失败", 400);
    }
  }

  /**
   * 删除 workspace.json 中该 recipe 并停关联进程。
   */
  dismiss(input: {
    userId: string;
    workspaceRoot: string;
    recipeId: string;
    scope: PreviewScope;
  }): PreviewRecipe {
    const recipe = this.requireRecipe(input.workspaceRoot, input.recipeId);
    this.quietStopLinked(input.userId, recipe);
    if (typeof recipe.linked_pid === "number" && recipe.linked_pid > 0) {
      const still = this.jobs.findActiveByPid(input.userId, recipe.linked_pid);
      if (!still) terminatePid(recipe.linked_pid);
    }
    const { removed } = removePreviewRecipe(input.workspaceRoot, recipe.id);
    return removed ?? { ...recipe, linked_job_id: null, linked_pid: null };
  }

  private quietStopLinked(userId: string, recipe: PreviewRecipe): void {
    if (!recipe.linked_job_id) return;
    try {
      this.jobs.cancel(recipe.linked_job_id, userId, { quiet: true });
    } catch {
      // job 可能已不存在
    }
  }

  /**
   * 停掉占用端口的进程：优先 quiet cancel 本平台 job（含 recipe.linked_job_id /
   * 同 command / 同 pid），再 SIGTERM 监听 pid，避免 Agent bg_run 再刷失败通知。
   */
  private async releaseOccupant(
    userId: string,
    recipe: PreviewRecipe,
    pid: number,
    port: number | null,
  ): Promise<void> {
    this.quietStopLinked(userId, recipe);
    const byPid = this.jobs.findActiveByPid(userId, pid);
    if (byPid) {
      try {
        this.jobs.cancel(byPid.id, userId, { quiet: true });
      } catch {
        // ignore
      }
    }
    for (const job of this.jobs.list(userId)) {
      if (job.status !== "running" && job.status !== "pending") continue;
      if (job.id === recipe.linked_job_id || job.id === byPid?.id) continue;
      if (job.command.trim() === recipe.command.trim()) {
        try {
          this.jobs.cancel(job.id, userId, { quiet: true });
        } catch {
          // ignore
        }
      }
    }
    terminatePid(pid);
    if (port != null) await waitUntilPortFree(port, 2500);
    else await sleep(200);
  }

  private requireRecipe(workspaceRoot: string, recipeId: string): PreviewRecipe {
    const id = recipeId.trim();
    if (!id) throw new PreviewError("recipe_id 无效", 400);
    const recipe = this.listRecipes(workspaceRoot).find((item) => item.id === id);
    if (!recipe) throw new PreviewError("预览配方不存在", 404);
    return recipe;
  }
}

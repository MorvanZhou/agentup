import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";

import { useComposerFiles } from "../../src/pages/conversation/composables/useComposerFiles";
import type { DesktopApi } from "../../src/shared/api/runtime";
import { clearAttachmentImagePreviewCache } from "../../src/pages/conversation/model/composer/attachment-image-preview";
import { toastState } from "../../src/shared/model/ui/toast";

/** 造一个最小 File 形状：磁盘路径场景不会读内容，base64 回落场景读 arrayBuffer。 */
function makeFile(options: { path?: string | null; size?: number; content?: string } = {}) {
  const content = options.content ?? "hello";
  return {
    name: "note.txt",
    type: "text/plain",
    size: options.size ?? 5,
    arrayBuffer: vi.fn(async () => new TextEncoder().encode(content).buffer),
  } as unknown as File;
}

function makeApi() {
  const staged = {
    id: "a1b2c3d4",
    path: "ATTACHMENTS/a1b2c3d4-note.txt",
    ref: "@ATTACHMENTS/a1b2c3d4-note.txt",
    name: "note.txt",
    mediaType: "text/plain",
  };
  return {
    stageAttachment: vi.fn(async () => staged),
    stageAttachmentFromPath: vi.fn(async () => staged),
    stageGroupAttachment: vi.fn(async () => staged),
    stageGroupAttachmentFromPath: vi.fn(async () => staged),
  } as unknown as DesktopApi & Record<string, ReturnType<typeof vi.fn>>;
}

function setupFile(options: Parameters<typeof makeFile>[0] = {}) {
  const api = makeApi();
  const composerText = ref("");
  const cursor = ref(0);
  const setText = (text: string, nextCursor?: number) => {
    composerText.value = text;
    if (typeof nextCursor === "number") cursor.value = nextCursor;
  };
  const files = useComposerFiles({
    agentId: ref("agent-1"),
    token: ref("tok"),
    userId: ref("u1"),
    composerText,
    cursor,
    setText,
    api: api as unknown as DesktopApi,
  });
  return { api, composerText, ...files, file: makeFile(options) };
}

beforeEach(() => {
  // 默认无 Electron bridge：模拟纯粘贴 / 网页环境
  vi.stubGlobal("window", {});
  clearAttachmentImagePreviewCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useComposerFiles staging", () => {
  it("stages disk files by local path without reading contents", async () => {
    vi.stubGlobal("window", {
      agentUp: { filePathForStaging: () => "/tmp/source/note.txt" },
    });
    const ctx = setupFile();
    await ctx.stageAndInsertFiles([ctx.file]);

    expect(ctx.api.stageAttachmentFromPath).toHaveBeenCalledWith(
      "tok",
      "u1",
      "agent-1",
      expect.objectContaining({ path: "/tmp/source/note.txt", name: "note.txt", mediaType: "text/plain" }),
    );
    // 有磁盘路径时不得再走 base64 编码（大文件会卡死主线程）
    expect(ctx.api.stageAttachment).not.toHaveBeenCalled();
    expect((ctx.file as { arrayBuffer: ReturnType<typeof vi.fn> }).arrayBuffer).not.toHaveBeenCalled();
    expect(ctx.composerText.value).toContain("@ATTACHMENTS/a1b2c3d4-note.txt");
  });

  it("falls back to base64 for pasted in-memory files", async () => {
    // 粘贴的文件拿不到磁盘路径
    vi.stubGlobal("window", { agentUp: { filePathForStaging: () => null } });
    const ctx = setupFile();
    await ctx.stageAndInsertFiles([ctx.file]);

    expect(ctx.api.stageAttachment).toHaveBeenCalledWith(
      "tok",
      "u1",
      "agent-1",
      expect.objectContaining({ name: "note.txt", dataBase64: "aGVsbG8=" }),
    );
    expect(ctx.api.stageAttachmentFromPath).not.toHaveBeenCalled();
    expect(ctx.composerText.value).toContain("@ATTACHMENTS/a1b2c3d4-note.txt");
  });

  it("stages pasted in-memory files via a main-process temp file", async () => {
    // 粘贴的截图/文件没有磁盘路径：主进程代写临时文件后仍走 from-path 复制
    const recorded: { name?: string; bytes?: Uint8Array } = {};
    const stageInMemoryFile = vi.fn(async (name: string, bytes: ArrayBuffer) => {
      recorded.name = name;
      recorded.bytes = new Uint8Array(bytes);
      return "/tmp/agentup-paste/abc123-note.txt";
    });
    const discardStagedTempFile = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      agentUp: { filePathForStaging: () => null, stageInMemoryFile, discardStagedTempFile },
    });
    const ctx = setupFile();
    await ctx.stageAndInsertFiles([ctx.file]);

    // 字节原样经 IPC 给主进程（无 base64 膨胀），再以临时路径走 from-path
    expect(recorded.name).toBe("note.txt");
    expect(Buffer.from(recorded.bytes ?? []).toString("utf8")).toBe("hello");
    expect(ctx.api.stageAttachmentFromPath).toHaveBeenCalledWith(
      "tok",
      "u1",
      "agent-1",
      expect.objectContaining({ path: "/tmp/agentup-paste/abc123-note.txt", name: "note.txt" }),
    );
    expect(ctx.api.stageAttachment).not.toHaveBeenCalled();
    // staging 完成（成功或失败）后应清理临时文件
    expect(discardStagedTempFile).toHaveBeenCalledWith("/tmp/agentup-paste/abc123-note.txt");
    expect(ctx.composerText.value).toContain("@ATTACHMENTS/a1b2c3d4-note.txt");
  });

  it("falls back to base64 when the temp-file bridge is unavailable", async () => {
    // 仅 filePathForStaging 缺失场景之外，再验主进程桥整体缺失时 base64 兜底仍然活着
    vi.stubGlobal("window", { agentUp: {} });
    const ctx = setupFile();
    await ctx.stageAndInsertFiles([ctx.file]);

    expect(ctx.api.stageAttachment).toHaveBeenCalledWith(
      "tok",
      "u1",
      "agent-1",
      expect.objectContaining({ name: "note.txt", dataBase64: "aGVsbG8=" }),
    );
  });

  it("does not insert an image chip in a group", async () => {
    vi.stubGlobal("window", {
      agentUp: { filePathForStaging: () => "/tmp/source/cover.png" },
    });
    const api = makeApi();
    const composerText = ref("");
    const files = useComposerFiles({
      agentId: ref(""),
      groupId: ref("g-1"),
      token: ref("tok"),
      userId: ref("u1"),
      composerText,
      cursor: ref(0),
      setText: (text) => {
        composerText.value = text;
      },
      api: api as unknown as DesktopApi,
    });
    const image = {
      name: "cover.png",
      type: "image/png",
      size: 3 * 1024 * 1024,
      arrayBuffer: vi.fn(),
    } as unknown as File;
    await files.stageAndInsertFiles([image]);

    expect(composerText.value).toBe("");
    expect(api.stageGroupAttachmentFromPath).not.toHaveBeenCalled();
  });

  it("stages group attachments even without a mentioned member", async () => {
    // 群聊未 @ 成员时 resourceAgentId 为空串；附件实际落群共享工作区，
    // 不应被单聊式的 agentId guard 当成「尚未登录」拒绝
    vi.stubGlobal("window", { agentUp: { filePathForStaging: () => null } });
    const api = makeApi();
    const composerText = ref("");
    const files = useComposerFiles({
      agentId: ref(""),
      groupId: ref("g-1"),
      token: ref("tok"),
      userId: ref("u1"),
      composerText,
      cursor: ref(0),
      setText: (text) => {
        composerText.value = text;
      },
      api: api as unknown as DesktopApi,
    });
    await files.stageAndInsertFiles([makeFile()]);

    expect(api.stageGroupAttachment).toHaveBeenCalledWith(
      "tok",
      "u1",
      "g-1",
      expect.objectContaining({ name: "note.txt", dataBase64: "aGVsbG8=" }),
    );
    expect(composerText.value).toContain("@ATTACHMENTS/a1b2c3d4-note.txt");
  });

  it("rejects oversized in-memory files before encoding", async () => {
    vi.stubGlobal("window", { agentUp: { filePathForStaging: () => null } });
    const ctx = setupFile({ size: 16 * 1024 * 1024 });
    await ctx.stageAndInsertFiles([ctx.file]);

    expect(ctx.api.stageAttachment).not.toHaveBeenCalled();
    expect((ctx.file as { arrayBuffer: ReturnType<typeof vi.fn> }).arrayBuffer).not.toHaveBeenCalled();
    expect(ctx.composerText.value).toBe("");
    expect(toastState.open).toBe(true);
    expect(toastState.message).toContain("附件过大");
  });

  it("stages group non-image files via the group from-path API", async () => {
    vi.stubGlobal("window", {
      agentUp: { filePathForStaging: () => "/tmp/source/note.txt" },
    });
    const api = makeApi();
    const composerText = ref("");
    const files = useComposerFiles({
      agentId: ref("agent-1"),
      groupId: ref("g-1"),
      token: ref("tok"),
      userId: ref("u1"),
      composerText,
      cursor: ref(0),
      setText: (text) => {
        composerText.value = text;
      },
      api: api as unknown as DesktopApi,
    });
    await files.stageAndInsertFiles([makeFile()]);

    expect(api.stageGroupAttachmentFromPath).toHaveBeenCalledWith(
      "tok",
      "u1",
      "g-1",
      expect.objectContaining({ path: "/tmp/source/note.txt", name: "note.txt", mediaType: "text/plain" }),
    );
    expect(api.stageAttachmentFromPath).not.toHaveBeenCalled();
  });

  it("inserts an existing ATTACHMENTS workspace path as a chip without re-staging", async () => {
    const api = makeApi();
    const deleteStagedAttachment = vi.fn(async () => undefined);
    (api as unknown as { deleteStagedAttachment: typeof deleteStagedAttachment }).deleteStagedAttachment =
      deleteStagedAttachment;
    const composerText = ref("请看");
    const cursor = ref(2);
    const files = useComposerFiles({
      agentId: ref("agent-1"),
      token: ref("tok"),
      userId: ref("u1"),
      composerText,
      cursor,
      setText: (text, nextCursor) => {
        composerText.value = text;
        if (typeof nextCursor === "number") cursor.value = nextCursor;
      },
      api: api as unknown as DesktopApi,
    });

    await files.attachWorkspaceFile({
      relativePath: "ATTACHMENTS/note_94319ddb.txt",
      absolutePath: "/tmp/users/u1/ATTACHMENTS/note_94319ddb.txt",
      name: "note_94319ddb.txt",
      kind: "file",
    });

    expect(api.stageAttachmentFromPath).not.toHaveBeenCalled();
    expect(composerText.value).toContain("@ATTACHMENTS/note_94319ddb.txt");

    // 摘芯片不得删掉工作区原有上传文件
    await files.removeFileRef("ATTACHMENTS/note_94319ddb.txt");
    expect(deleteStagedAttachment).not.toHaveBeenCalled();
    expect(composerText.value).toBe("请看");
  });

  it("inserts an existing ATTACHMENTS folder with trailing slash without re-staging", async () => {
    const api = makeApi();
    const composerText = ref("");
    const cursor = ref(0);
    const files = useComposerFiles({
      agentId: ref("agent-1"),
      token: ref("tok"),
      userId: ref("u1"),
      composerText,
      cursor,
      setText: (text, nextCursor) => {
        composerText.value = text;
        if (typeof nextCursor === "number") cursor.value = nextCursor;
      },
      api: api as unknown as DesktopApi,
    });

    await files.attachWorkspaceFile({
      relativePath: "ATTACHMENTS/docs_94319ddb",
      absolutePath: "/tmp/users/u1/ATTACHMENTS/docs_94319ddb",
      name: "docs_94319ddb",
      kind: "dir",
    });

    expect(api.stageAttachmentFromPath).not.toHaveBeenCalled();
    expect(composerText.value).toContain("@ATTACHMENTS/docs_94319ddb/");
  });

  it("stages artifact/project workspace files then inserts the new ATTACHMENTS chip", async () => {
    const api = makeApi();
    const composerText = ref("");
    const cursor = ref(0);
    const files = useComposerFiles({
      agentId: ref("agent-1"),
      token: ref("tok"),
      userId: ref("u1"),
      composerText,
      cursor,
      setText: (text, nextCursor) => {
        composerText.value = text;
        if (typeof nextCursor === "number") cursor.value = nextCursor;
      },
      api: api as unknown as DesktopApi,
    });

    await files.attachWorkspaceFile({
      relativePath: "ARTIFACT/report.md",
      absolutePath: "/tmp/users/u1/ARTIFACT/report.md",
      name: "report.md",
      kind: "file",
    });

    expect(api.stageAttachmentFromPath).toHaveBeenCalledWith(
      "tok",
      "u1",
      "agent-1",
      expect.objectContaining({
        path: "/tmp/users/u1/ARTIFACT/report.md",
        name: "report.md",
      }),
    );
    expect(composerText.value).toContain("@ATTACHMENTS/a1b2c3d4-note.txt");
  });

  it("stages artifact folders via from-path and inserts trailing-slash chip", async () => {
    const api = makeApi();
    api.stageAttachmentFromPath = vi.fn(async () => ({
      id: "a1b2c3d4",
      path: "ATTACHMENTS/bundle_a1b2c3d4/",
      ref: "@ATTACHMENTS/bundle_a1b2c3d4/",
      name: "bundle",
      mediaType: "inode/directory",
    }));
    const composerText = ref("");
    const cursor = ref(0);
    const files = useComposerFiles({
      agentId: ref("agent-1"),
      token: ref("tok"),
      userId: ref("u1"),
      composerText,
      cursor,
      setText: (text, nextCursor) => {
        composerText.value = text;
        if (typeof nextCursor === "number") cursor.value = nextCursor;
      },
      api: api as unknown as DesktopApi,
    });

    await files.attachWorkspaceFile({
      relativePath: "ARTIFACT/bundle",
      absolutePath: "/tmp/users/u1/ARTIFACT/bundle",
      name: "bundle",
      kind: "dir",
    });

    expect(api.stageAttachmentFromPath).toHaveBeenCalledWith(
      "tok",
      "u1",
      "agent-1",
      expect.objectContaining({
        path: "/tmp/users/u1/ARTIFACT/bundle",
        name: "bundle",
        mediaType: "inode/directory",
      }),
    );
    expect(composerText.value).toContain("@ATTACHMENTS/bundle_a1b2c3d4/");
  });
});


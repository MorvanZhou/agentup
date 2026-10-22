import fs from "node:fs";
import { constants } from "node:fs";
import { access as fsAccess, mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";

import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionFactory,
  type FindOperations,
} from "@earendil-works/pi-coding-agent";

import { assertInsideAnyRoot, ProjectRootsError } from "../workspace/project-roots.js";

/**
 * 用 allowedRoots 覆盖 Pi 内置 read/write/edit/grep/find/ls。
 * getAllowedRoots 每次工具调用再取，便于 UI 挂载后无需重开会话。
 */
export function createFsGuardExtension(
  cwd: string,
  getAllowedRoots: () => string[],
): ExtensionFactory {
  return async (pi) => {
    const guard = (absolutePath: string, allowMissing = false) => {
      try {
        assertInsideAnyRoot(absolutePath, getAllowedRoots(), { allowMissing });
      } catch (error) {
        if (error instanceof ProjectRootsError) throw new Error(error.message);
        throw error;
      }
    };

    pi.registerTool(
      createReadToolDefinition(cwd, {
        operations: {
          readFile: async (absolutePath) => {
            guard(absolutePath);
            return fsReadFile(absolutePath);
          },
          access: async (absolutePath) => {
            guard(absolutePath);
            await fsAccess(absolutePath, constants.R_OK);
          },
        },
      }),
    );

    pi.registerTool(
      createWriteToolDefinition(cwd, {
        operations: {
          writeFile: async (absolutePath, content) => {
            guard(absolutePath, true);
            await fsWriteFile(absolutePath, content, "utf8");
          },
          mkdir: async (dir) => {
            guard(dir, true);
            await fsMkdir(dir, { recursive: true });
          },
        },
      }),
    );

    pi.registerTool(
      createEditToolDefinition(cwd, {
        operations: {
          readFile: async (absolutePath) => {
            guard(absolutePath);
            return fsReadFile(absolutePath);
          },
          writeFile: async (absolutePath, content) => {
            guard(absolutePath);
            await fsWriteFile(absolutePath, content, "utf8");
          },
          access: async (absolutePath) => {
            guard(absolutePath);
            await fsAccess(absolutePath, constants.R_OK | constants.W_OK);
          },
        },
      }),
    );

    pi.registerTool(
      createGrepToolDefinition(cwd, {
        operations: {
          isDirectory: async (absolutePath) => {
            guard(absolutePath);
            return fs.statSync(absolutePath).isDirectory();
          },
          readFile: async (absolutePath) => {
            guard(absolutePath);
            return fsReadFile(absolutePath, "utf8");
          },
        },
      }),
    );

    // 只包 exists 且不提供 glob，Pi 仍走默认 fd 实现（见 find.js：customOps?.glob 才改道）。
    pi.registerTool(
      createFindToolDefinition(cwd, {
        operations: {
          exists: (absolutePath) => {
            guard(absolutePath);
            return fs.existsSync(absolutePath);
          },
        } as FindOperations,
      }),
    );

    pi.registerTool(
      createLsToolDefinition(cwd, {
        operations: {
          exists: (absolutePath) => {
            guard(absolutePath);
            return fs.existsSync(absolutePath);
          },
          stat: (absolutePath) => {
            guard(absolutePath);
            return fs.statSync(absolutePath);
          },
          readdir: (absolutePath) => {
            guard(absolutePath);
            return fs.readdirSync(absolutePath);
          },
        },
      }),
    );
  };
}

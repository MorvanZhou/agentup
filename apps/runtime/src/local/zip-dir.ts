import fs from "node:fs";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

type ZipFileEntry = {
  name: string;
  data: Buffer;
  payload: Buffer;
  method: 0 | 8;
  crc: number;
};

/**
 * 将目录打成可再安装的 .zip（SKILL.md 在包根或唯一子目录均可）。
 * 不引入额外依赖：本地 deflate + ZIP 本地/中央目录头。
 */
export function writeZipFromDirectory(
  sourceDir: string,
  zipPath: string,
  options: { maxBytes?: number } = {},
): void {
  const maxBytes = options.maxBytes ?? 5_000_000;
  const root = path.resolve(sourceDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error("source missing");
  }

  const entries: ZipFileEntry[] = [];
  let total = 0;
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, name);
        continue;
      }
      if (!entry.isFile()) continue;
      const data = fs.readFileSync(full);
      total += data.byteLength;
      if (total > maxBytes) throw new Error("package too large");
      const deflated = deflateRawSync(data);
      const store = deflated.byteLength >= data.byteLength;
      entries.push({
        name: name.replace(/\\/g, "/"),
        data,
        payload: store ? data : deflated,
        method: store ? 0 : 8,
        crc: crc32(data),
      });
    }
  };
  walk(root, "");

  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(entry.crc >>> 0, 14);
    local.writeUInt32LE(entry.payload.byteLength, 18);
    local.writeUInt32LE(entry.data.byteLength, 22);
    local.writeUInt16LE(nameBuf.byteLength, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, entry.payload);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(entry.crc >>> 0, 16);
    header.writeUInt32LE(entry.payload.byteLength, 20);
    header.writeUInt32LE(entry.data.byteLength, 24);
    header.writeUInt16LE(nameBuf.byteLength, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBuf);
    offset += local.byteLength + nameBuf.byteLength + entry.payload.byteLength;
  }

  const centralDir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const out = path.resolve(zipPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const temporary = `${out}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, Buffer.concat([...parts, centralDir, end]));
  fs.renameSync(temporary, out);
}

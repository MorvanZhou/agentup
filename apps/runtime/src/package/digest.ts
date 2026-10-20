import { createHash, timingSafeEqual } from "node:crypto";

export interface PackageManifest {
  version: number;
  tools: string[];
  modelCapabilities: string[];
}

export function packageDigest(
  manifest: PackageManifest,
  files: Record<string, Uint8Array>,
): string {
  const hash = createHash("sha256");
  const feed = (text: string) => {
    hash.update(Buffer.from(text, "utf8"));
    hash.update(Buffer.from([0]));
  };
  feed(String(manifest.version));
  for (const tool of manifest.tools) feed(tool);
  feed("");
  for (const capability of manifest.modelCapabilities) feed(capability);
  feed("");
  for (const filePath of Object.keys(files).sort()) {
    feed(filePath);
    hash.update(files[filePath]);
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

export function sameDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

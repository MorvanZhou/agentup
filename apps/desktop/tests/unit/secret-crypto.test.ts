import { createRequire } from "node:module";

import { expect, it } from "vitest";

const { createSecretCrypto } = createRequire(import.meta.url)("../../electron/secret-crypto.cjs") as {
  createSecretCrypto: (deps: {
    safeStorage: {
      isEncryptionAvailable(): boolean;
      getSelectedStorageBackend?(): string;
      encryptString(value: string): Buffer;
      decryptString(value: Buffer): string;
    };
  }) => {
    encryptionReady(): boolean;
    encrypt(plaintext: string): string;
    decrypt(cipher: string): string;
  };
};

it("encrypts and decrypts with safeStorage", () => {
  const key = Buffer.from("k");
  const store = createSecretCrypto({
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "keychain",
      encryptString: (value) => Buffer.concat([key, Buffer.from(value, "utf8")]),
      decryptString: (value) => value.subarray(key.length).toString("utf8"),
    },
  });
  expect(store.encryptionReady()).toBe(true);
  const cipher = store.encrypt("sk-test");
  expect(store.decrypt(cipher)).toBe("sk-test");
});

it("rejects basic_text backend", () => {
  const store = createSecretCrypto({
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "basic_text",
      encryptString: () => Buffer.from(""),
      decryptString: () => "",
    },
  });
  expect(store.encryptionReady()).toBe(false);
  expect(() => store.encrypt("x")).toThrow(/无法安全保存/);
});

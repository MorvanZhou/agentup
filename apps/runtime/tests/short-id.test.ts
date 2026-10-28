import { expect, it } from "vitest";

import { SHORT_ID_ALPHABET, SHORT_ID_SIZE, shortId } from "../src/ids/short-id.js";

it("shortId matches the shared nanoid contract with backend", () => {
  expect(SHORT_ID_ALPHABET).toHaveLength(62);
  expect(SHORT_ID_SIZE).toBe(8);
  const id = shortId();
  expect(id).toHaveLength(SHORT_ID_SIZE);
  expect([...id].every((ch) => SHORT_ID_ALPHABET.includes(ch))).toBe(true);
  expect(shortId()).not.toBe(id);
});

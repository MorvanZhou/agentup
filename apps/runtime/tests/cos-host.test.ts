import { expect, it } from "vitest";

import { putCosObject, type ObjectCredential } from "../src/control/cos-put.js";

it("signs and requests the custom host from the credential", async () => {
  const seen: { url?: string; hostHeader?: string } = {};
  const credential: ObjectCredential = {
    bucket: "agentup-1258395282",
    region: "ap-hongkong",
    key: "prod/agents/Ab12Cd34/mcp.json",
    tmp_secret_id: "id",
    tmp_secret_key: "key",
    session_token: "token",
    content_type: "application/json",
    host: "files.agentup.me",
  };
  await putCosObject(
    credential,
    new TextEncoder().encode("{}"),
    (async (input, init) => {
      seen.url = String(input);
      const headers = new Headers(init?.headers);
      seen.hostHeader = headers.get("host") ?? undefined;
      return new Response(null, { status: 200 });
    }) as typeof fetch,
    { forbidOverwrite: false },
  );
  expect(seen.url).toMatch(/^https:\/\/files\.agentup\.me\/prod\/agents\/Ab12Cd34\/mcp\.json$/);
  expect(seen.url).not.toContain("myqcloud.com");
});

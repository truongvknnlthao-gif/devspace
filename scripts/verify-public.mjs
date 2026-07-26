#!/usr/bin/env node
import assert from "node:assert/strict";

const input = process.argv[2] ?? process.env.DEVSPACE_PUBLIC_BASE_URL;
if (!input) {
  throw new Error(
    "Pass the public base URL as an argument or set DEVSPACE_PUBLIC_BASE_URL.",
  );
}

const baseUrl = normalizeBaseUrl(input);
const mcpUrl = new URL("/mcp", baseUrl).toString();
const protectedResourceUrl = new URL(
  "/.well-known/oauth-protected-resource/mcp",
  baseUrl,
);
const authorizationMetadataUrl = new URL(
  "/.well-known/oauth-authorization-server",
  baseUrl,
);

const health = await fetchJson(new URL("/healthz", baseUrl));
assert.equal(health.response.status, 200, "/healthz must return 200");
assert.equal(health.body.ok, true, "/healthz must report ok=true");
assert.equal(typeof health.body.version, "string", "/healthz must report version");
assert.equal(typeof health.body.commit, "string", "/healthz must report commit");

const protectedResource = await fetchJson(protectedResourceUrl);
assert.equal(protectedResource.response.status, 200);
assert.equal(protectedResource.body.resource, mcpUrl);
assert.ok(
  protectedResource.body.authorization_servers?.includes(baseUrl.toString()),
  "protected-resource metadata must reference this authorization server",
);
assert.ok(
  protectedResource.body.scopes_supported?.includes("devspace"),
  "protected-resource metadata must advertise the devspace scope",
);

const authorization = await fetchJson(authorizationMetadataUrl);
assert.equal(authorization.response.status, 200);
assert.equal(authorization.body.issuer, baseUrl.toString());
assert.equal(
  authorization.body.authorization_endpoint,
  new URL("/authorize", baseUrl).toString(),
);
assert.equal(
  authorization.body.token_endpoint,
  new URL("/token", baseUrl).toString(),
);
assert.equal(
  authorization.body.registration_endpoint,
  new URL("/register", baseUrl).toString(),
);
assert.equal(
  authorization.body.revocation_endpoint,
  new URL("/revoke", baseUrl).toString(),
);
assert.ok(
  authorization.body.response_types_supported?.includes("code"),
  "authorization-code flow must be advertised",
);
assert.ok(
  authorization.body.code_challenge_methods_supported?.includes("S256"),
  "PKCE S256 must be advertised",
);
assert.ok(
  authorization.body.grant_types_supported?.includes("authorization_code"),
  "authorization_code grant must be advertised",
);
assert.ok(
  authorization.body.grant_types_supported?.includes("refresh_token"),
  "refresh_token grant must be advertised",
);
assert.ok(
  authorization.body.scopes_supported?.includes("devspace"),
  "authorization metadata must advertise the devspace scope",
);

const unauthenticated = await fetch(new URL("/mcp", baseUrl), {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "devspace-public-verifier", version: "1" },
    },
  }),
  signal: AbortSignal.timeout(10_000),
});
assert.equal(unauthenticated.status, 401, "unauthenticated /mcp must return 401");
const authenticate = unauthenticated.headers.get("www-authenticate") ?? "";
assert.match(authenticate, /^Bearer\b/i);
assert.match(authenticate, /\bscope="devspace"/);
assert.match(authenticate, /\bresource_metadata="/);
assert.match(
  authenticate,
  new RegExp(escapeRegExp(protectedResourceUrl.toString())),
);

console.log(`PASS public endpoint: ${baseUrl.origin}`);
console.log(`Runtime: ${health.body.version} (${health.body.commit})`);
console.log("OAuth discovery: protected resource, PKCE S256, token, refresh, revoke");
console.log("Authorization boundary: unauthenticated /mcp returned 401");

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("The public base URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("The public base URL must not contain credentials.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Pass the public origin only, without /mcp, query, or fragment.");
  }
  return new URL(`${url.origin}/`);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  return { response, body };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

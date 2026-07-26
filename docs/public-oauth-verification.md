# Public OAuth And MCP Verification

Use this checklist to prove that a public DevSpace deployment is discoverable,
protected by OAuth, and usable from a ChatGPT personal developer app.

## Automated Public Check

Run the repository verifier against the public origin, without `/mcp`:

```bash
npm run verify:public -- https://your-devspace-host.example.com
```

The verifier checks:

- `/healthz` returns a version and source commit
- protected-resource metadata identifies the exact `/mcp` resource
- authorization-server metadata advertises registration, authorization, token,
  refresh-token, revocation, the `devspace` scope, and PKCE `S256`
- an unauthenticated MCP initialization request returns `401` with the correct
  `WWW-Authenticate` metadata reference

This check deliberately does not submit the Owner password or store OAuth
tokens. A real authorization and authenticated tool call remain a manual
acceptance step.

## ChatGPT End-To-End Acceptance

1. Complete **Developer mode > Plugins > Personal > Create app > OAuth** using
   the public `/mcp` URL.
2. Enter the Owner password only on the DevSpace authorization page.
3. Confirm that ChatGPT reports the app as connected and refresh its actions.
4. Open a dedicated test checkout with `open_workspace`.
5. Read a harmless tracked file with `read`.
6. List a small directory with `ls`.
7. When shell tools are enabled, run a harmless command such as `git status
   --short --branch` with `bash`.
8. If mutation must be tested, use a disposable fixture inside the test
   workspace, verify it, and remove it before finishing.
9. Re-run `open_workspace` only after intentionally reconnecting or replacing
   the ChatGPT app, and confirm ordinary calls still work.

Record the `/healthz` version and commit used for the acceptance run. ChatGPT's
generated app ID and `dev-*` revision are connector identities, not DevSpace
versions.

## Never Commit

Do not commit or paste into issues:

- the Owner password
- access or refresh tokens
- a ChatGPT personal app ID
- a Cloudflare tunnel UUID or credentials file
- machine-specific private paths

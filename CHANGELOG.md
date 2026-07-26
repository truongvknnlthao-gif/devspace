# Changelog

## 1.4.0 - 2026-07-26

- Make Node 24 the only supported runtime across package metadata, CLI
  validation, CI, documentation, and macOS service templates.
- Align Node type definitions and native dependency installation guidance with
  the Node 24 runtime.

## 1.3.3 - 2026-07-26

- Make immediate durable-job cancellation wait for the runner to record a
  terminal state instead of terminating it during startup.
- Reconcile orphaned jobs whose runners exited before writing state, including
  cancellation requests created by an earlier runtime.

## 1.3.2 - 2026-07-26

- Add optional DevSpace-managed Chrome status and durable high-level browser
  tasks through the real local Codex CLI and installed official Chrome
  extension/native host.
- Keep Chrome task instructions out of command metadata, isolate raw Chrome
  event logs from Bash job tools, and serialize active Chrome tasks.

## 1.3.0 - 2026-07-26

- Add a separately signed macOS Device Helper with a stable bundle identity.
- Add workspace-independent `device_status` and `screen_capture` MCP tools.
- Keep screenshots in private temporary storage and delete them after each
  response.
- Defer Accessibility actions such as clicking and typing from this phase.

## 1.2.1 - 2026-07-25

- Bound idle MCP session retention and await transport cleanup during shutdown.
- Add reproducible public OAuth/MCP verification and a manual ChatGPT
  end-to-end acceptance checklist.
- Add sanitized macOS LaunchAgent and Cloudflare Tunnel deployment templates.
- Define selective upstream maintenance and independent Dependabot review.
- Separate the private fork package identity from the upstream npm namespace.
- Apply independently reviewed lockfile updates for `body-parser`, `fast-uri`,
  `hono`, and `postcss`.
- Record the remaining `pi-coding-agent` shrinkwrap advisories instead of
  claiming that ineffective root overrides fixed them.

## 1.2.0 - 2026-07-25

- Establish runtime identity through `/healthz`.
- Add durable shell jobs, reconnect recovery, immutable release guidance, and
  rollback operations.
- Document the maintained ChatGPT developer-mode OAuth workflow.

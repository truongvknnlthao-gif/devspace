# Changelog

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

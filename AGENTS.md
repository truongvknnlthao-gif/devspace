# DevSpace

This file is the project instruction index. Keep it short. Read the linked
document only when the current task needs it, and keep detailed operational
knowledge in `docs/` rather than expanding this file. This repository documents
the current canonical project state, not a narrative timeline.

## Mission

DevSpace exposes owner-approved local development workspaces over MCP so a
remote MCP host can read files, edit code, run commands, and complete real work
on the user's machine. It is a direct execution layer, not a second autonomous
coding agent.

## Read On Demand

| Task | Read |
| --- | --- |
| Install, start, connect, or approve an MCP client | `docs/setup.md` |
| Change environment variables, OAuth, widgets, project instructions, or logging | `docs/configuration.md` |
| Use workspaces, worktrees, project instructions, file tools, shell tools, or durable jobs | `docs/chatgpt-coding-workflow.md` |
| Review trust boundaries, shell authority, OAuth, tunnels, worktrees, or local state protection | `docs/security.md` |
| Diagnose Node ABI, tunnels, hosts, OAuth, unknown workspaces, worktrees, or connector 502 errors | `docs/gotchas.md` |
| Build, release, upgrade, roll back, or clean a running DevSpace installation | `docs/runtime-operations.md` |
| Review upstream changes, dependency updates, fork identity, or release provenance | `docs/fork-maintenance.md` |
| Understand public product behavior and local development commands | `README.md` and `package.json` |

## Core Rules

- Call `open_workspace` once per checkout or worktree and reuse its
  `workspaceId`. Reopen only when it is rejected, the path or mode changes, or
  the user explicitly asks.
- The trust boundary is owner approval, the DevSpace operating-system user, and
  configured workspace roots. After a trusted client is approved, do not add
  command-text, filename, credential, service, API, or destination deny lists.
- Prefer explicit, inspectable tool calls over autonomous local-agent loops.
- Use synchronous `bash` only for short commands. Use `bash_start`, a stable
  `requestId`, `bash_status`, cursor-based `bash_logs`, `bash_cancel`, and
  `bash_jobs` for work that may outlive one connector request.
- A connector error does not prove that a local command stopped. After a 502 or
  reconnect, query the existing job or process before submitting work again.
- Never replace the currently serving runtime in place. Build and validate a
  candidate on a separate port, publish it to a versioned directory, then use an
  atomic switch with automatic rollback.
- Keep general capabilities in DevSpace core. Put product-specific workflows in
  the owning project or a separate plugin instead of hard-coding them here.
- The latest explicit user or project decision is canonical. Replace or remove
  superseded guidance instead of preserving duplicate rules, obsolete patches,
  or historical narrative in project documentation. Use Git commits, PRs, and
  release tags for committed history.
- Keep rollback assets only while they are part of the current recovery plan.
  After they are superseded or no longer needed, remove redundant runtime copies,
  intermediate logs, cleanup timelines, and local audit archives rather than
  retaining them for historical interest.
- Update the relevant document and this index whenever a change alters a trust
  boundary, operator workflow, durable-job behavior, runtime upgrade process, or
  recovery procedure.

## Validation

For ordinary source changes, run:

```bash
npm run typecheck
npm test
npm run build
```

For runtime or reliability changes, also validate a candidate on an independent
port, inspect `/healthz`, exercise the real MCP tool surface, simulate reconnect
or duplicate submission when relevant, and verify rollback before switching the
serving runtime.

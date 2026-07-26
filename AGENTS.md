# DevSpace

This project inherits the global agent index. The rules here supplement global
instructions with DevSpace-specific routing and scope; they do not replace
higher-priority safeguards.

## Scope

DevSpace exposes owner-approved local development workspaces over MCP so a
remote MCP host can read files, edit code, run commands, and complete real work
on the user's machine. It is a direct execution layer, not a second autonomous
coding agent.

Keep detailed behavior and operating procedures in their owning documents.
Read only the route needed for the current task.

## Read on demand

| Task | Read |
| --- | --- |
| Understand product behavior or run ordinary local development checks | `README.md` and `package.json` |
| Install, start, connect, or approve an MCP client | `docs/setup.md` |
| Change environment variables, OAuth, widgets, project instructions, or logging | `docs/configuration.md` |
| Use workspaces, worktrees, project instructions, file tools, shell tools, or durable jobs | `docs/chatgpt-coding-workflow.md` |
| Review trust boundaries, shell authority, OAuth, tunnels, worktrees, or local state protection | `docs/security.md` |
| Diagnose Node ABI, tunnels, hosts, OAuth, unknown workspaces, worktrees, or connector 502 errors | `docs/gotchas.md` |
| Build, release, upgrade, roll back, or clean a running DevSpace installation | `docs/runtime-operations.md` |
| Review upstream changes, dependency updates, fork identity, or release provenance | `docs/fork-maintenance.md` |
| Verify a public deployment and ChatGPT Personal OAuth connection | `docs/public-oauth-verification.md` |

## Index maintenance

- Keep this file as a routing index, not an operating manual.
- Put new recurring guidance in the owning document, then add a route here only
  when a new task category is needed.
- Keep one canonical current instruction; use Git history, pull requests, and
  releases for historical context.

# Configuration Reference

DevSpace can be configured through `devspace init`, persisted config files, or
environment variables.

The examples use `node dist/cli.js` from a built checkout of this repository.
See the [Setup Guide](./setup.md) for installation.

The default files are:

```text
~/.devspace/config.json
~/.devspace/auth.json
```

For values that support both forms, an environment variable overrides the
persisted config. Persisted config overrides the built-in default. The Owner
password is read from `auth.json` unless `DEVSPACE_OAUTH_OWNER_TOKEN` is set.

Use another config directory with:

```bash
DEVSPACE_CONFIG_DIR=/path/to/config node dist/cli.js serve
```

## Commands

```bash
node dist/cli.js init
node dist/cli.js serve
node dist/cli.js doctor
node dist/cli.js config get
node dist/cli.js config set publicBaseUrl https://devspace.example.com
```

## Core Environment Variables

| Variable | Purpose |
| --- | --- |
| `HOST` | Local bind host. Defaults to `127.0.0.1`. |
| `PORT` | Local port. Defaults to `7676`. |
| `DEVSPACE_ALLOWED_ROOTS` | Comma-separated local roots that workspaces may open. |
| `DEVSPACE_PUBLIC_BASE_URL` | Public origin for the server, without `/mcp`. |
| `DEVSPACE_ALLOWED_HOSTS` | Optional Host header allowlist override. |
| `DEVSPACE_OAUTH_OWNER_TOKEN` | Owner password for OAuth approval. Must be at least 16 characters. |
| `DEVSPACE_WORKTREE_ROOT` | Directory for managed Git worktrees. Defaults to `~/.devspace/worktrees`. |
| `DEVSPACE_STATE_DIR` | Directory for SQLite state. Defaults to `~/.local/share/devspace`. |
| `DEVSPACE_DEVICE_HELPER_PATH` | Signed Device Helper executable. Defaults to `~/Applications/DevSpace Device Helper.app/Contents/MacOS/DevSpace Device Helper`. |
| `DEVSPACE_SHELL_ENABLED` | Set to `1` to expose complete local command-line development workflows. Disabled by default in the distributable configuration. |
| `DEVSPACE_CHROME_ENABLED` | Set to `1` to expose supervised tasks through the installed official Codex Chrome component. Disabled by default. |
| `DEVSPACE_CODEX_PATH` | Codex CLI executable used for Chrome tasks. Defaults to `~/.local/share/npm/bin/codex` when present, otherwise `codex` from `PATH`. |
| `DEVSPACE_CHROME_PLUGIN_ROOT` | Installed official Chrome plugin root. Defaults to `~/.codex/plugins/cache/openai-bundled/chrome/latest`. |
| `DEVSPACE_CHROME_TASK_TIMEOUT_SECONDS` | Maximum and default Chrome task lifetime. Defaults to `900`. |

## OAuth

DevSpace uses a single-user OAuth approval flow.

| Variable | Default |
| --- | --- |
| `DEVSPACE_OAUTH_ACCESS_TOKEN_TTL_SECONDS` | `3600` |
| `DEVSPACE_OAUTH_REFRESH_TOKEN_TTL_SECONDS` | `2592000` |
| `DEVSPACE_OAUTH_AUTHORIZATION_MAX_FAILURES` | `5` |
| `DEVSPACE_OAUTH_AUTHORIZATION_FAILURE_WINDOW_SECONDS` | `900` |
| `DEVSPACE_OAUTH_SCOPES` | `devspace` |
| `DEVSPACE_OAUTH_ALLOWED_REDIRECT_HOSTS` | `chatgpt.com,localhost,127.0.0.1` |

MCP clients discover metadata from:

```text
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
```

## Tool Surface

DevSpace exposes one canonical short-name tool surface:

- `device_status`
- `screen_capture`
- `open_workspace`
- `read`, `write`, and `edit`
- `grep`, `glob`, and `ls`
- optional `bash` and durable Bash job tools when shell execution is enabled
- optional `chrome_status`, `chrome_task_start`, `chrome_task_status`, and
  `chrome_task_cancel` when Chrome control is enabled
- optional `show_changes` when `DEVSPACE_WIDGETS=changes`

The two device tools do not require a workspace. They call the separately
signed macOS Device Helper. `device_status` remains useful when the helper is
missing or permission has not been granted because it reports the exact
installation and permission state.

Shell execution is enabled separately:

```bash
DEVSPACE_SHELL_ENABLED=1 node dist/cli.js serve
```

Enable it after approving a trusted client with the Owner password. Commands
run with the permissions and credentials of the DevSpace operating-system user.
DevSpace does not block shell commands by command text, filename,
credential-like content, service name, or destination API.

## Official Chrome Control

Chrome control is enabled separately from general shell access:

```bash
DEVSPACE_CHROME_ENABLED=1 node dist/cli.js serve
```

`chrome_status` performs fast local checks only. It verifies the Codex CLI,
the installed official Chrome plugin, the extension state, the native-host
manifest, and whether Chrome is running.

`chrome_task_start` accepts one complete browser workflow and starts a durable
local Codex task. DevSpace passes the instruction through private standard
input; it does not place the instruction in task metadata or command audit
previews. `mode=observe` adds an explicit instruction not to change browser or
website state; it is a model contract, not an independent macOS enforcement
layer. `mode=act` permits actions within the supplied instruction. DevSpace
allows only one active Chrome task at a time. Use `chrome_task_status` for the
concise final result and `chrome_task_cancel` to stop the process group.

This adapter intentionally uses the real installed Codex CLI and official
Chrome plugin. It does not copy or modify the signed OpenAI native host. The
official plugin is versioned outside DevSpace, so `chrome_status` fails closed
when its expected diagnostic scripts are absent or incompatible.

## Widgets

`DEVSPACE_WIDGETS` controls ChatGPT Apps iframe usage.

| Value | Behavior |
| --- | --- |
| `full` | Default. Widget UI is attached to exposed workspace, file, edit, and shell tools. |
| `changes` | Enables the aggregate `show_changes` tool and attaches widget UI to `open_workspace` and `show_changes`. |
| `off` | Disables widget UI. |

## Project Instructions

`DEVSPACE_AGENT_DIR` optionally sets the global project-instruction directory.
It defaults to `~/.codex`. DevSpace loads relevant `AGENTS.md` and `CLAUDE.md`
files and returns nested instruction paths through `open_workspace`.

## Logging

| Variable | Default |
| --- | --- |
| `DEVSPACE_LOG_LEVEL` | `info` |
| `DEVSPACE_LOG_FORMAT` | `json` |
| `DEVSPACE_LOG_REQUESTS` | `1` |
| `DEVSPACE_LOG_ASSETS` | `0` |
| `DEVSPACE_LOG_TOOL_CALLS` | `1` |
| `DEVSPACE_LOG_SHELL_COMMANDS` | `0` |
| `DEVSPACE_TRUST_PROXY` | `0` |

Set `DEVSPACE_LOG_FORMAT=pretty` for local debugging.

Set `DEVSPACE_LOG_SHELL_COMMANDS=1` only when you intentionally want command
previews in logs.

## Env-Only Example

```bash
DEVSPACE_OAUTH_OWNER_TOKEN="$(openssl rand -base64 32)" \
DEVSPACE_ALLOWED_ROOTS="$HOME/personal,$HOME/work" \
DEVSPACE_PUBLIC_BASE_URL="https://devspace.example.com" \
DEVSPACE_WORKTREE_ROOT="$HOME/.devspace/worktrees" \
DEVSPACE_SHELL_ENABLED="0" \
DEVSPACE_CHROME_ENABLED="0" \
DEVSPACE_WIDGETS="full" \
node dist/cli.js serve
```

The environment assignments must be part of the same command invocation, or
exported first.

For a single-user, Owner-approved deployment where shell access is enabled and
the operating-system account is the intended permission boundary, set
`DEVSPACE_ALLOWED_ROOTS=/`. This lets the structured workspace tools open any
path the DevSpace user can access. Keep the narrower default when shell access
is disabled or when roots are intentionally used to organize separate trust
zones.

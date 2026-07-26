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

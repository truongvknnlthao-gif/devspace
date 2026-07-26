# Security Model

DevSpace exposes local coding capabilities over MCP. Treat it as remote access
to your development machine.

The security model is simple:

- the MCP endpoint requires OAuth approval with your Owner password
- Host headers and OAuth redirect hosts are allowlisted
- the DevSpace operating-system user remains the local permission boundary
- every coding action happens through explicit MCP tool calls

## Filesystem Allowlist

DevSpace only opens structured workspaces under configured roots.

Good examples:

```text
~/work
~/personal/open-source
```

Avoid broad roots:

```text
~
/
C:\
```

The narrower the root, the easier it is to reason about what structured file
tools can open.

For a single-user deployment where Owner OAuth approval establishes trust and
shell access is enabled, you may deliberately configure `/` as the only root.
That removes the workspace allowlist while preserving operating-system
permissions. This does not materially expand shell authority, because the
shell already runs as the DevSpace user; it makes structured file tools
consistent with that trust model.

## Owner Password

`devspace init` generates an Owner password and stores it in:

```text
~/.devspace/auth.json
```

When an MCP client connects, DevSpace shows an approval page. Enter the Owner
password only when you intentionally want that client to access this server.
Non-loopback OAuth redirect URLs must use HTTPS and match the configured
redirect-host allowlist exactly.

For env-driven deployments, set a long random value:

```bash
DEVSPACE_OAUTH_OWNER_TOKEN="$(openssl rand -base64 32)"
```

Failed Owner password attempts are rate-limited in memory. The default is five
failures per remote address in a 15-minute window.

## Public URL And Host Allowlist

DevSpace needs `DEVSPACE_PUBLIC_BASE_URL` so MCP clients can discover OAuth
metadata and connect to the correct resource.

The value should be the origin only:

```text
https://your-tunnel-host.example.com
```

Do not include `/mcp` in `DEVSPACE_PUBLIC_BASE_URL`.

Public URLs must use HTTPS. Plain HTTP is accepted only for loopback addresses
such as `127.0.0.1` during local setup.

By default, DevSpace derives allowed Host headers from the local host and public
URL. Use `DEVSPACE_ALLOWED_HOSTS=*` only for intentional local debugging.

## Tunnels

DevSpace does not manage tunnels. Your tunnel or reverse proxy should point to:

```text
http://127.0.0.1:7676
```

Prefer adding Cloudflare Access, Tailscale identity controls, or equivalent
protection in front of public tunnels. DevSpace OAuth still protects the MCP
endpoint, but the tunnel URL should not be treated as a secret.

## Shell Access

The distributable configuration keeps the shell tool disabled until the owner
explicitly enables it:

```bash
DEVSPACE_SHELL_ENABLED=1 node dist/cli.js serve
```

After OAuth approval, shell commands run as local commands and can do what the
DevSpace operating-system user can do, including builds, tests, Git, GitHub CLI,
package management, scripts, file mutation, local config reads and writes,
credential reads, deployment commands, secret-management commands, and external
API calls. DevSpace does not maintain command-text, filename, credential-like
content, service-name, or destination-API deny lists. The filesystem allowlist
applies to structured file tools; it is not a shell sandbox. The primary trust
decision is approving the MCP client with the Owner password. Disconnect the app
or rotate the Owner password if that trust should be revoked.

## General Tool Surface

DevSpace core exposes general workspace, file, search, shell, worktree, and
durable-job capabilities. It does not add fixed wrappers for individual Git
commands, ignore-file operations, file copies, cloud providers, repositories,
bots, or staging layouts.

Use the trusted `bash` tool for complete command-line workflows. Keep
product-specific automation in the owning repository or a separate plugin.

## macOS Device Helper

`device_status` and `screen_capture` invoke
`~/Applications/DevSpace Device Helper.app` by default. The helper has a fixed
bundle identifier and must be signed with the same stable Apple signing
identity on every installation. Screen Recording permission belongs to that
helper identity rather than to the LaunchAgent's shell script or versioned Node
binary.

Screenshots can contain sensitive information from any visible application.
They are created in a private temporary directory, read into the MCP response,
and deleted immediately. The helper exposes only status, permission request,
and screenshot commands in this phase. It does not implement clicking, typing,
Accessibility actions, or arbitrary command execution.

The helper does not add a separate remote authorization boundary. The existing
DevSpace OAuth approval remains the decision that allows an MCP client to
request a screenshot.

## Worktrees

Managed worktrees reduce accidental edits to your active checkout, but they are
not a security boundary. They are a workflow boundary for isolated coding
sessions.

## Logs

By default, DevSpace logs requests and tool calls. Shell command previews are
disabled unless `DEVSPACE_LOG_SHELL_COMMANDS=1`.

Do not enable shell command logging if commands may contain secrets.

## Reliability Does Not Add a Second Permission Layer

Durable jobs change execution lifetime, not authority. `bash_start` runs with the
same DevSpace operating-system user and the same owner-approved trust as `bash`.
`requestId` prevents accidental duplicate submission; it does not inspect or
restrict command text, files, credentials, services, APIs, or destinations.

Job commands and logs are stored locally under the configured state directory so
they can be recovered after a reconnect. Protect that directory with the same
local account controls used for the rest of DevSpace state.

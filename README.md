<p align="center">
  <img src="./docs/assets/devspace-logo-light.png" alt="DevSpace logo" width="140">
</p>

<h1 align="center">DevSpace</h1>

<p align="center">Bring a Codex-style local coding workflow to ChatGPT.</p>

[![CI](https://github.com/truongvknnlthao-gif/devspace/actions/workflows/ci.yml/badge.svg)](https://github.com/truongvknnlthao-gif/devspace/actions/workflows/ci.yml)

[![DevSpace connected to ChatGPT](./docs/assets/devspace-screenshot.png)](./docs/assets/devspace-screenshot.png)

DevSpace is a self-hosted MCP server that lets an approved ChatGPT developer
app work directly with local projects. It provides structured file tools,
optional shell execution, Git worktree support, durable background jobs, and
ChatGPT Apps-compatible tool cards.

This repository is the maintained fork used by
[`truongvknnlthao-gif/devspace`](https://github.com/truongvknnlthao-gif/devspace).
The checked-in source and the version reported by its `/healthz` endpoint are
the authority for this fork.

## Current Version

The source version is `1.2.1`. A running server reports its exact version,
commit, build time, start time, PID, and active job count:

```bash
curl https://your-devspace-host.example.com/healthz
```

ChatGPT's labels such as `dev-0` are developer-app revision numbers. They are
not DevSpace package versions and are not expected to match `1.2.1`.

This fork is a private source package named `devspace-local`. The npm package
`@waishnav/devspace` belongs to the upstream project and is not an installation
or version authority for this repository.

## Requirements

- Node `>=20.12 <27`; Node 22 LTS is recommended
- npm, Git, and Bash on macOS
- a public HTTPS URL that forwards to the local server when connecting ChatGPT

This maintained fork is tested on macOS with Node 22 and Node 24. Other
platforms are outside its current support and CI boundary.

## Quick Start From This Repository

```bash
git clone https://github.com/truongvknnlthao-gif/devspace.git
cd devspace
npm ci
npm run build
node dist/cli.js init
node dist/cli.js serve
```

The default local MCP endpoint is:

```text
http://127.0.0.1:7676/mcp
```

`init` records approved project roots, the local port, the public base URL, and
an Owner password. The default files are:

```text
~/.devspace/config.json
~/.devspace/auth.json
```

Keep `auth.json` private.

Shell tools are disabled by default. Enable them only for an intentionally
approved client:

```bash
DEVSPACE_SHELL_ENABLED=1 node dist/cli.js serve
```

Shell commands run with the full permissions and credentials of the operating
system user that starts DevSpace.

## Connect ChatGPT

1. Forward your public HTTPS origin to `http://127.0.0.1:7676`.
2. Start DevSpace and confirm `/healthz` responds.
3. In ChatGPT, enable **Developer mode** under **Settings > Security and
   login**.
4. Open **Plugins > Personal > Create app**.
5. Enter the full MCP URL, such as
   `https://your-devspace-host.example.com/mcp`, and choose **OAuth**.
6. Connect the app, enter the Owner password only on the DevSpace authorization
   page, and approve the client.
7. Return to the app page, confirm **Connected**, then refresh its actions.

Before connecting, verify the public discovery and authentication boundary:

```bash
npm run verify:public -- https://your-devspace-host.example.com
```

Deleting and recreating the personal app creates a new ChatGPT app ID and a new
developer revision sequence. It does not redeploy or change the DevSpace
server. See the [Setup Guide](./docs/setup.md) for the complete connection and
reconnection workflow.

## Tool Surface

The default structured tools are:

- `device_status`
- `screen_capture`
- `open_workspace`
- `read`, `write`, and `edit`
- `grep`, `glob`, and `ls`

`device_status` and `screen_capture` use a separately signed macOS helper so
Screen Recording permission belongs to a stable application identity. Install
it once with:

```bash
npm run install:device-helper -- --request-screen-access
```

With `DEVSPACE_SHELL_ENABLED=1`, DevSpace also exposes:

- `bash`
- `bash_start`, `bash_status`, `bash_logs`, and `bash_cancel`
- `bash_jobs`

With `DEVSPACE_WIDGETS=changes`, `show_changes` provides an aggregate review
view. DevSpace also supports isolated Git worktrees and discovers project
instructions from `AGENTS.md` and `CLAUDE.md`.

## Security Model

Configured roots limit the structured file tools. They are not a shell sandbox.
After OAuth approval, enabled shell tools have the same authority as the local
DevSpace operating-system user, including that user's files, credentials,
network access, package managers, Git tools, and deployment CLIs.

Use narrow roots, keep the Owner password secret, expose DevSpace only through
HTTPS, and connect only clients you intentionally trust. Read the
[Security Model](./docs/security.md) before enabling shell execution.

## Operations

Inspect the resolved local setup:

```bash
node dist/cli.js doctor
```

Durable jobs are designed for builds, tests, deployments, migrations, and other
long-running commands. A caller-supplied request ID deduplicates retries, and
job status and logs remain available after MCP session replacement.

For runtime monitoring, upgrades, health checks, and rollback guidance, see
[Runtime Operations](./docs/runtime-operations.md).

## Documentation

- [Setup Guide](./docs/setup.md)
- [ChatGPT Coding Workflow](./docs/chatgpt-coding-workflow.md)
- [Configuration Reference](./docs/configuration.md)
- [Security Model](./docs/security.md)
- [Public OAuth And MCP Verification](./docs/public-oauth-verification.md)
- [Runtime Operations](./docs/runtime-operations.md)
- [Fork Maintenance](./docs/fork-maintenance.md)
- [Troubleshooting Gotchas](./docs/gotchas.md)
- [Changelog](./CHANGELOG.md)

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
node dist/cli.js doctor
```

Use `npm run dev` to run the TypeScript source directly while developing.

Pull requests must pass dependency review plus the complete typecheck, test,
build, and doctor sequence on macOS with Node 22 and Node 24. CI is a clean
machine proof of the checked-in dependency lock and build process; it does not
replace the public OAuth check or the authenticated ChatGPT acceptance checklist.

## Upstream And License

This project is derived from
[`Waishnav/devspace`](https://github.com/Waishnav/devspace). Original authorship
and copyright are preserved in the repository history and
[`LICENSE`](./LICENSE). The upstream repository is retained as a read-only
reference; it is not merged or synchronized automatically. DevSpace is
distributed under the MIT License.

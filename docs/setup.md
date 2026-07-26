# Setup Guide

This guide connects a ChatGPT personal developer app, or another MCP host, to a
DevSpace server built from this repository.

## Requirements

- Node `>=20.12 <27`; Node 22 LTS is recommended
- npm
- Git
- Bash
- Xcode command-line tools and an Apple Development signing identity for the
  optional macOS Device Helper
- a public HTTPS URL that forwards to the local DevSpace server

DevSpace does not create the public tunnel. Use Cloudflare Tunnel, ngrok,
Pinggy, Tailscale Funnel, or an HTTPS reverse proxy you control.
For a persistent Cloudflare Tunnel on macOS, use the sanitized templates and
provisioning checklist in
[`deploy/macos`](../deploy/macos/README.md).

## Install The Maintained Version

Clone and build this repository:

```bash
git clone https://github.com/truongvknnlthao-gif/devspace.git
cd devspace
npm ci
npm run build
```

The commands below use `node dist/cli.js` from the repository root so that the
running CLI is unambiguously this checkout. The separately published upstream
npm package may report an older version.

Initialize DevSpace:

```bash
node dist/cli.js init
```

Install the fixed-identity macOS Device Helper and request Screen Recording
permission:

```bash
npm run install:device-helper -- --request-screen-access
```

The helper is installed at
`~/Applications/DevSpace Device Helper.app`. DevSpace invokes its signed
executable directly for `device_status` and `screen_capture`. Keep the same
bundle identifier and signing identity across upgrades so macOS can retain the
permission grant.

The setup flow asks one question at a time.

### Project Roots

Choose the folders ChatGPT is allowed to open through DevSpace. Keep this
boundary as narrow as practical.

Examples:

```text
~/personal,~/work
```

```text
/Users/alice/dev,/Users/alice/work
```

### Local Port

The default is `7676`. The local MCP URL is:

```text
http://127.0.0.1:7676/mcp
```

### Public Base URL

Start the tunnel or reverse proxy and point it at:

```text
http://127.0.0.1:7676
```

Enter the public origin without `/mcp` during setup:

```text
https://your-devspace-host.example.com
```

The MCP client uses the full endpoint:

```text
https://your-devspace-host.example.com/mcp
```

## Start And Verify The Server

Start with structured file tools only:

```bash
node dist/cli.js serve
```

Enable shell tools only for an intentionally trusted client:

```bash
DEVSPACE_SHELL_ENABLED=1 node dist/cli.js serve
```

Verify the public endpoint before creating the ChatGPT app:

```bash
npm run verify:public -- https://your-devspace-host.example.com
```

This checks runtime identity, OAuth discovery, PKCE, scope, and the
unauthenticated MCP boundary. See
[Public OAuth And MCP Verification](./public-oauth-verification.md) for the
authenticated end-to-end checklist.

If a temporary tunnel URL changes, override it for one run:

```bash
DEVSPACE_PUBLIC_BASE_URL="https://new-tunnel.example.com" node dist/cli.js serve
```

For a stable public URL, persist it:

```bash
node dist/cli.js config set publicBaseUrl https://devspace.example.com
node dist/cli.js serve
```

## Connect ChatGPT In Developer Mode

Use ChatGPT's personal developer-app flow for a self-hosted DevSpace server:

1. Open **Settings > Security and login** and enable **Developer mode**.
2. Open the **Plugins** directory.
3. Select the **Personal** tab. The **Public** tab does not expose personal app
   creation.
4. Select **Create app**.
5. Enter a name and description, use the full public MCP endpoint such as
   `https://your-devspace-host.example.com/mcp`, and select **OAuth**.
6. Review the developer-app warning and create the app only for a server you
   trust.
7. Select **Connect** or **Sign in**. On the DevSpace authorization page, enter
   the Owner password and approve the client.
8. Return to the plugin details, confirm **Connected**, and select **Refresh**.
   The Actions section should list tools such as `device_status`,
   `screen_capture`, `open_workspace`, `read`, `edit`, and, when enabled,
   `bash`.

Keep the Owner password out of the app name, description, URL, screenshots, and
logs. Enter it only on the DevSpace authorization page.

## Understand The Two Version Numbers

ChatGPT and DevSpace use separate version identifiers:

- ChatGPT assigns a generated app ID beginning with `plugin_asdk_app_` and
  development revision metadata such as `dev mode` and `dev-0`.
- DevSpace reports its package version and source commit from `/healthz`, for
  example `1.2.0` plus a Git commit.

Deleting and recreating the personal app creates a new ChatGPT app identity and
a new development revision sequence. It does not change or redeploy DevSpace,
so the ChatGPT revision is not expected to match the server version.

## Approve Or Reconnect The Client

When a client connects, DevSpace shows an Owner password authorization page.
The password is printed during initialization and stored in:

```text
~/.devspace/auth.json
```

The normal config file is:

```text
~/.devspace/config.json
```

Keep `auth.json` private.

To perform a clean ChatGPT reconnection:

1. Confirm the intended server and tunnel are healthy.
2. Remove the old personal developer app from ChatGPT.
3. Create a new app from **Plugins > Personal** with the same public `/mcp`
   endpoint and OAuth.
4. Complete Owner approval.
5. Confirm **Connected**, refresh actions, and run a harmless tool such as
   `open_workspace` or `ls`.

Recreating the ChatGPT app is unnecessary for an ordinary DevSpace restart or
source deployment when the public MCP URL and OAuth metadata remain compatible.

## Check The Local Setup

Run:

```bash
node dist/cli.js doctor
```

The command reports the resolved config, Node version, Node ABI, platform, Git,
Bash, public URL, allowed hosts, and SQLite native dependency status.

## Optional Global CLI

After building the repository, install that exact checkout globally if a short
command is more convenient:

```bash
npm install -g .
devspace doctor
```

For source development without a global install:

```bash
npm run dev
```

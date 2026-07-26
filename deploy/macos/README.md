# macOS Service Templates

These templates describe the maintained macOS deployment shape:

- an immutable release under `~/.local/share/devspace-releases/`
- `~/.local/share/devspace-runtime` as the active release symlink
- `~/.local/bin/devspace` as the stable wrapper
- one LaunchAgent for DevSpace
- one LaunchAgent for a named Cloudflare Tunnel

Copy the examples outside the repository and replace every `__PLACEHOLDER__`.
Do not commit the rendered files because they contain machine paths and tunnel
identity.

## Files

- `devspace-wrapper.sh.example`: stable Node/runtime entrypoint
- `com.devspace.server.plist.example`: DevSpace LaunchAgent
- `cloudflared-config.yml.example`: named-tunnel ingress
- `com.devspace.cloudflare-tunnel.plist.example`: tunnel LaunchAgent

The wrapper intentionally contains only current settings. It does not include
obsolete tool-mode, tool-naming, or skill environment variables.

## Validation

Before loading either LaunchAgent:

```bash
plutil -lint /path/to/rendered/com.devspace.server.plist
plutil -lint /path/to/rendered/com.devspace.cloudflare-tunnel.plist
cloudflared tunnel ingress validate --config /path/to/rendered/config.yml
```

After loading:

```bash
launchctl print gui/$(id -u)/com.devspace.server
launchctl print gui/$(id -u)/com.devspace.cloudflare-tunnel
npm run verify:public -- https://your-devspace-host.example.com
```

Keep the Owner password in `~/.devspace/auth.json` or the service environment,
never in these checked-in templates.

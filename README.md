# AgentUp Client

Open-source **desktop** (Electron + Vue) and **runtime** (local Node supervisor + Pi) from [AgentUp](https://agentup.me).

This repository is a **mirror slice** of the private monorepo. Day-to-day development happens in the private tree; maintainers sync here with `sh/sync-public-client.sh`.

Synced from private commit `e72f00a` (`main`).

## What's included

- `apps/desktop` — UI shell
- `apps/runtime` — loopback control plane client, sessions, approvals
- Thin root: `pnpm` workspace, `sh/build-mac.sh`, `sh/start-desktop.sh`, `sh/test-desktop.sh`

## Not included

Control-plane API (`apps/backend`), https login facade (`apps/web`), deploy scripts, and example agent packages. Point the client at the official API/login URLs, or override:

```bash
export AGENTUP_BACKEND_URL=https://api.example.com
export AGENTUP_WEB_URL=https://www.example.com
```

## Setup

```bash
pnpm install
pnpm --filter @agentup/desktop exec playwright install chromium   # e2e only
sh sh/start-desktop.sh --dev    # local Vite + runtime; control plane URLs from env-profiles
# or
sh sh/build-mac.sh --dev        # unsigned macOS arm64 package under dist/mac/
```

Requires Node + [pnpm](https://pnpm.io) (see root `packageManager` field).

## Contributing

Open PRs against this repo. Maintainers replay accepted changes into the private monorepo, then re-sync. Prefer small patches under `apps/desktop` / `apps/runtime`.

## License

See `LICENSE` if present. If missing, the license is still TBD in the upstream private repository.

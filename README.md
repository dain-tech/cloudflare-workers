# Notabene Robo Entities

A TypeScript Cloudflare Worker that receives Notabene webhooks and runs entity-specific test-bot actions: authorize, reject, confirm relationships, change agents, and exchange Travel Rule PII. This repository contains one Worker, even if its GitHub repository is named `cloudflare-workers`.

The configured deployment name is **`robo-entities-prod`** in [`wrangler.jsonc`](wrangler.jsonc). The entity DIDs point to sandbox entities. The name alone does not establish production readiness; review the limitations below and confirm the live environment before deploying.

## Start here

- [Architecture and bot behavior](docs/architecture.md): routing, entities, events, and PII flows.
- [Cloudflare and service setup](docs/cloudflare.md): configuration, credentials, deployment, external dependencies, and troubleshooting.
- [GitHub migration](docs/github-migration.md): copy the current project without its historical credentials, then verify the import.
- [Handoff checklist](docs/handoff.md): verification results and remaining account-specific information.

## Run locally

Install Git and Node.js 24 with npm. If using nvm, run `nvm install` and `nvm use` in the project directory; [`.nvmrc`](.nvmrc) selects Node 24. Use the committed lockfile with `npm ci`.

After the private GitHub import is complete:

```bash
git clone https://github.com/dain-tech/cloudflare-workers.git
cd cloudflare-workers
npm ci
npm run check:worker-types
npm run typecheck
npm test -- --run
npm run deploy -- --dry-run
```

For an existing local checkout, start with `npm ci` there. Tests and the dry run do not require real Auth0 or Cloudflare credentials. Tests use local behavior, synthetic data, and mocked API responses; they do not verify live service permissions.

Create a local secrets file only if one does not already exist:

```bash
test -f .dev.vars || cp .dev.vars.example .dev.vars
npm run dev
```

This starts the local Worker, normally at `http://localhost:8787`. A harmless router check uses an unregistered entity, so it makes no downstream API call:

```bash
curl -i http://localhost:8787/webhook/did%3Aweb%3Aexample.invalid%3Asmoke \
  -H 'Content-Type: application/json' \
  --data '{"message":"smoke.test","payload":{"for":"did:web:example.invalid:smoke","id":"local-smoke"},"version":"1.0.0"}'
```

Expect `200 OK` with body `OK`. This checks the router, not authentication or a bot workflow. `GET /` returns `404`; there is no homepage or health endpoint.

For real bot workflows, fill the appropriate secrets in `.dev.vars`, check the entity/client mappings, and arrange the Notabene setup in the [Cloudflare guide](docs/cloudflare.md). Local execution still calls the configured external API when a recognized event needs it. A remote webhook sender cannot reach your laptop's `localhost` URL directly.

## HTTP interface

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/webhook/:entity` | Parse JSON, acknowledge, and dispatch by URL-decoded entity DID |
| Other methods | `/webhook/:entity` | `405`, with `Allow: POST` |
| Any | Other paths | `404` |

Malformed JSON returns `400`. Valid JSON receives `200` before background processing finishes. Unknown entities and events are currently ignored after acknowledgment. Webhook signatures and the full payload schema are **not validated**.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install exactly the locked dependencies |
| `npm run dev` | Run the local Worker |
| `npm test -- --run` | Run tests once (`npm test` watches) |
| `npm run typecheck` | Check application TypeScript |
| `npm run cf-typegen` | Regenerate Worker types from config and the empty secret-name template |
| `npm run check:worker-types` | Check generated type inputs are current |
| `npm run deploy -- --dry-run` | Bundle without publishing |
| `npm run deploy` | Publish to the selected Cloudflare account; follow the setup guide first |

After configuration or secret-name changes, run `npm run cf-typegen` and commit `worker-configuration.d.ts`. Keep secret names in `.dev.vars.example` and `src/env.d.ts` aligned. The scripts explicitly use `.dev.vars.example` so local secret files do not change the generated types. The freshness check does not compare the generated file's entire body; never edit generated declarations manually.

[GitHub CI](.github/workflows/ci.yml) installs dependencies, checks types, runs tests, and bundles a dry run. It does not deploy or require runtime secrets.

## What belongs in Git

Commit source, tests, examples, scripts, package manifests and lockfile, Wrangler configuration, generated declarations, editor configuration, and these docs. Keep secret **names** and instructions in Git; actual values stay in Cloudflare or the team's credential manager. `.dev.vars`, `.env`, dependencies, local Wrangler state, and build output are ignored.

A GitHub upload does not transfer Cloudflare access, deployed secrets, webhook subscriptions, Auth0 permissions, or Notabene policies/encryption settings. Those are listed in the [handoff checklist](docs/handoff.md).

## Current limitations

- SVIX/webhook signature verification is not implemented. Use controlled test inputs until authentication is implemented and verified.
- Background failures do not change an already-sent `200`. There is no application queue, durable retry mechanism, or general event deduplication.
- Some legacy handlers suppress errors or do not check downstream status codes. The reject handler logs its access token; the replace handler logs the complete payload. Remove sensitive logging before using real data and review existing logs/credential rotation with the owner.
- The active encrypted-PII handler requests server-side decryption from Notabene. The standalone private-key helper is not wired into that route.
- Live account settings and end-to-end bot flows must be verified separately. See [architecture](docs/architecture.md) for placeholders and inactive code.

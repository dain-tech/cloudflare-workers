# Cloudflare and external service setup

## Configuration kept in the repository

| Setting | Current local configuration |
| --- | --- |
| Worker name | `robo-entities-prod` |
| Entry point | `src/index.ts` |
| Compatibility date / flag | `2026-04-09` / `nodejs_compat` |
| Observability | Enabled; local `redact_query_string: false` is not recognized by pinned Wrangler 4.101.0 |
| Source maps | Uploaded on deployment |
| API URL and Auth0 audience | `https://api.eu1.notabene.id` |
| Auth0 issuer | `https://auth.notabene.id` |
| Named staging/production environments | None configured |
| Account ID, custom domains, routes, explicit workers.dev setting | Not recorded locally; confirm in the owning account |
| KV, D1, R2, Durable Objects, Queues, cron triggers, service bindings | None declared in this project's configuration |

These are facts about `wrangler.jsonc`, not a claim that the dashboard matches. The older README named `robo-entities.notabene.workers.dev`, which differs from the current Worker name. Obtain the actual URL from Cloudflare's Domains & Routes or deployment output before registering webhooks.

Wrangler currently warns about `observability.redact_query_string`; do not assume this entry controls the live setting. Preserve the intended setting during the dashboard comparison, then choose a supported configuration/management approach. This pre-existing configuration entry was retained during documentation preparation.

Cloudflare recommends treating [Wrangler configuration as the source of truth](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth). Reconcile relevant dashboard-only non-secret settings into configuration and regenerate types. This project currently names one shared Worker and has no isolated staging environment.

## Access required

- GitHub access to the private repository.
- Access to the Cloudflare account owning the Worker, with permission to manage it and its secrets for deployment. Local tests do not need this access.
- Access to the appropriate Auth0 M2M applications, Notabene permissions, and client secrets through a secure channel.
- Notabene entity administration for webhook URLs/events, policies, and encryption configuration.

Moving Git hosting does not move a Cloudflare deployment or change its URL. A new Cloudflare account requires provisioning, transferring secrets securely, and updating external webhook destinations.

## Variables and secrets

`NB_API_URL`, `AUTH0_ISSUER`, `AUTH0_AUDIENCE`, and all `*_CLIENT_ID` values are non-secret configuration in `wrangler.jsonc`. Check that every client ID belongs to the intended DID/environment. Secrets are stored separately:

| Secret name | Use |
| --- | --- |
| `AUTH0_CLIENT_SECRET` | Default/fallback; current settle/flag placeholder routes |
| `ACCEPT_CLIENT_SECRET` | Authorize bot |
| `REJECT_CLIENT_SECRET` | Reject bot |
| `REPLACE_CLIENT_SECRET` | Replace-agent bot |
| `CONFIRM_CLIENT_SECRET` | Relationship-confirmation bot |
| `ADD_CLIENT_SECRET` | Add-custodian bot |
| `BOT_REQUESTS_PII_CLIENT_SECRET` | Plain-PII receiving bot |
| `BOT_REQUESTS_ENCRYPTED_PII_CLIENT_SECRET` | Encrypted-PII receiving bot |
| `REQUEST_BOT_PII_CLIENT_SECRET` | Mock-PII responding bot |
| `BR_CLIENT_SECRET` | Credential mapping only; no current route |
| `PF_BOT_PRIVATE_JWK` | Optional standalone helper, not the active encrypted route |

Only credentials for exercised routes are needed locally. Blank template entries document the interface; they are not working credentials and do not provision deployed secrets. Never put secrets or private JWKs in `vars`.

Copy `.dev.vars.example` to `.dev.vars` if absent and fill needed local values. Local values are not automatically uploaded. See [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

For deployment, log in and verify the target account:

```bash
npx wrangler login
npx wrangler whoami
npx wrangler secret list --name robo-entities-prod
npx wrangler deployments list --name robo-entities-prod
```

`secret list` inventories names, not values. Obtain values from the credential owner. If multiple accounts are available, select the correct one explicitly and record its account ID in the private handoff record.

Add a missing secret through the interactive prompt, for example:

```bash
npx wrangler secret put ACCEPT_CLIENT_SECRET --name robo-entities-prod
```

Repeat for the routes in use. This is a live change: `secret put` creates and immediately deploys a Worker version. Existing secrets do not need re-entry just because the repository moves. Use Cloudflare's versions workflow when staged deployment is needed.

## Webhooks and policies

For each enabled bot, configure its Notabene webhook destination as:

```text
https://<verified-worker-host>/webhook/<URL-encoded entity DID>
```

The [architecture table](architecture.md#entity-registry) lists required events. Encode the entire DID: `did:web:entity.com:one` becomes `did%3Aweb%3Aentity.com%3Aone`. Confirm the Auth0 application can act for that entity and perform its API operations. This repository does not provision applications, scopes, subscriptions, or policies.

For PII flows, confirm `REQUIRE_PRESENTATION` ownership/requirements and whether keys are hosted by Notabene. Record public key IDs/controllers and encryption mode where applicable; transfer private keys only through the credential manager. See [the three flows](architecture.md#three-pii-flows).

## Deploy and verify

1. Complete the account-specific [handoff items](handoff.md), reconcile local/live settings, and resolve the logging/signature limitations before using real data.
2. Run `npm ci`, `npm run check:worker-types`, `npm run typecheck`, `npm test -- --run`, and `npm run deploy -- --dry-run`.
3. Confirm the account, Worker name, routes, secrets, and current deployment version. Deploying the same name in the same account updates that Worker.
4. Run `npm run deploy` when ready. Record the resulting version ID and actual endpoint.
5. Use `npx wrangler tail --name robo-entities-prod` while running a synthetic end-to-end Notabene transfer. Confirm the downstream result as well as delivery. Avoid exporting sensitive logs.
6. If needed, inspect `npx wrangler deployments list --name robo-entities-prod` and use `npx wrangler rollback <VERSION_ID> --name robo-entities-prod` for an identified prior version. Code rollback does not undo Notabene actions or external policy changes.

See [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/). The compatibility date was preserved during handoff; update it as a separate tested runtime change.

## Optional automatic deployment

GitHub Actions currently only validates code. After the private import and a verified deployment, Workers Builds can connect the **existing Worker** to `dain-tech/cloudflare-workers`, select `main`, use repository root `/`, run validation as the build command, and use `npm run deploy` as the deploy command. Set Node 24 in the build environment. Review branch settings before enabling automatic publishing.

Uploading the CI file alone does not establish this connection. Runtime secrets belong on the Worker; review any separate build-time variables. See [GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/) and [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `404` at `/` | Expected: no homepage |
| `200` but no action | DID/event mapping, background logs, credentials, downstream response; unknown entities are acknowledged |
| Auth0 `401`/`403` | Client ID/secret pair, issuer, audience, entity permissions, credential rotation |
| PII remains missing | Policy requirements, callback result, webhook subscription, VASP roles |
| Encrypted retrieval fails | Hosted-key availability and API permissions; the route asks Notabene to decrypt |
| Stale Worker types | `npm ci`, then `npm run cf-typegen`; review/commit output |
| Configuration warning | Check `npx wrangler --version` against the lockfile; avoid a global Wrangler |
| Tests fail before assertions | Runtime installation and permission to start workerd/listen on localhost |
| Tests warn about compatibility-date fallback | The existing test adapter runs a March 2026 runtime, older than the configured April date; see the verification limits in `handoff.md` |

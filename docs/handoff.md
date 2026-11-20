# Handoff record

Prepared November 20, 2026 for a private team handoff of `robo-entities` to `dain-tech/cloudflare-workers`. Replace pending entries with verified non-secret information as the handoff proceeds.

## Repository readiness

- README now covers installation, local execution, commands, HTTP behavior, and limitations.
- Architecture guide maps all routed bots, credentials, PII flows, and inactive helpers.
- Cloudflare guide lists configuration, all secret names, deployment steps, and external dependencies.
- `.dev.vars.example` includes the previously omitted reject/replace secret names.
- Node 24 is selected in `.nvmrc`; Wrangler is locked to 4.101.0, matching the locally installed version used for the handoff.
- Type generation uses the committed empty secret-name template, making it independent of each developer's local secret file.
- GitHub Actions is configured to validate without deploying. Its hosted run is pending the import.
- Historical hard-coded credentials require a fresh current-files import; no history is included in that archive. This does not revoke old credentials or clean the original GitLab history.

## Verification

Verified in a separate current-files copy without the original `.dev.vars`, Git history, or installed dependencies, using Node 24.15.0:

| Check | Result |
| --- | --- |
| `npm ci` | Passed with the updated lockfile |
| `npm run check:worker-types` | Passed |
| `npm run typecheck` | Passed |
| `npm test -- --run` | 14 tests passed across 6 files |
| `npm run deploy -- --dry-run` | Passed; no deployment performed |
| Local `npm run dev` and HTTP checks | Started successfully; synthetic POST 200, root 404, webhook GET 405, malformed JSON 400 |

The existing test adapter uses a runtime capped at compatibility date `2026-03-10`, so it warns and falls back from the configured `2026-04-09`. Test success is not full validation of that deployed runtime date; update the test adapter in a separate tested change. The top-level local dev/bundling runtime is newer. Wrangler also warns about the pre-existing unsupported `redact_query_string` setting. These warnings are tracked below, not silently treated as resolved.

Live integration tests and GitHub-hosted CI have not run. Cloudflare authentication expired and could not refresh. No source upload, deployment, credential change, or webhook/policy change was performed during preparation.

## Account-specific information still required

| Item | Status / information to record |
| --- | --- |
| GitHub visibility and teammate access | Private handoff selected; destination was still public during inspection. Change and verify before push. |
| GitHub write/admin access | Connected integration reported read-only access; verify the browser/terminal account separately. |
| Cloudflare account name/ID and owner | Pending. Existing Wrangler authentication expired and could not refresh. |
| Deployed Worker name | Local target is `robo-entities-prod`; confirm the intended live Worker. |
| Live URL, workers.dev setting, domains/routes | Pending dashboard comparison; old README URL was inconsistent. |
| Observability query-string redaction | Existing local entry is not recognized by Wrangler 4.101.0; verify live behavior and reconcile before deployment. |
| Current deployment/version and rollback target | Pending authenticated inspection. |
| Deployed secret-name inventory | Pending `wrangler secret list`; never record values here. |
| Credential custodian / secure sharing location | Pending owner-provided credential-manager location and access process. |
| Historical client-secret rotation | Pending confirmation that the old committed credentials are revoked. |
| Auth0 applications and entity/API permissions | Verify each client ID maps to its documented bot. |
| Notabene webhook URLs and subscribed events | Verify per enabled entity against the architecture table. |
| REQUIRE_PRESENTATION policies | Verify owning VASP, requirements, and expected webhook sequence. |
| Encryption settings/key custody | Confirm hosted decryption for the active encrypted route; record public identifiers only. |
| Git-triggered deployment | Not configured in this repository; confirm any existing Cloudflare Builds connection separately. |
| Operational owner | Record who maintains bots, deploys, rotates credentials, and handles failures. |

## Acceptance

- [ ] Private GitHub import contains all intended saved project files and local changes.
- [ ] Original GitLab checkout is preserved; sensitive historical commits were not pushed to the new repository.
- [ ] GitHub CI succeeds and a teammate can clone, install, test, and start the Worker from the README.
- [ ] The intended Cloudflare Worker/account/configuration and real endpoint are confirmed.
- [ ] Credentials and external configuration are available to the team through approved access.
- [ ] Synthetic end-to-end tests verify the enabled bot flows, including downstream effects.
- [ ] Sensitive legacy logging and missing webhook signature validation are addressed before real-data use.

Do not mark the service handoff complete merely because the source files have uploaded successfully.

# Move this project to the private GitHub repository

Scope: the current `robo-entities` project, including local edits and new files. Destination: `https://github.com/dain-tech/cloudflare-workers`.

## Why this import starts fresh

The source already has Git history, branch `dain-branch`, and `origin` pointing to `git@gitlab.com:notabene/lab/robo-entities.git`. An old literal client secret remains reachable in that history, including from the current branch. A backup branch also contains an older secret-bearing version. Deleting a secret from today's files does not delete old commits.

For this handoff, import the reviewed current files into a new Git repository. Preserve the original folder/history locally. Do not use `git push --mirror`, `git push --all`, or the screenshot's existing-repository push commands on the original checkout. If history must be retained later, handle credential rotation and history cleanup as a separate task. The relevant credential owner should confirm historical secrets have been revoked/rotated.

## 1. Make the destination private

The destination was public and empty when checked on November 20, 2026. Before uploading, open its **Settings → General → Danger Zone → Change repository visibility → Private**, then verify the repository header says **Private**. Add the intended teammates under repository access settings.

The connected GitHub integration reported read-only access at inspection time. Publishing requires a GitHub login with write access; changing visibility requires repository administration. Do not assume the connector's permissions match your browser or terminal login.

## 2. Inventory the local project

Save all VS Code editors first: Git and archives read saved files on disk, not unsaved editor buffers. In the original folder:

```bash
cd /Users/dainkang29/Desktop/robo-entities
git status --short
git ls-files --others --exclude-standard
git status --short --ignored
```

Review new/untracked files as well as modified tracked files. Preserve `test/request-plain-pii.spec.ts`, the docs, and CI configuration. Expected exclusions include `.dev.vars`, `.wrangler/`, `node_modules/`, `.DS_Store`, and `dist/`. Actual secrets remain in the credential manager/Cloudflare; record their names and access procedure in the docs.

The current snapshot includes all saved tracked and non-ignored new project files, including changes that have not been committed. It excludes the `.git` directory/history. This handoff does not include other local branches' code, GitLab issues/merge requests, unsaved VS Code buffers, or external account settings.

## 3. Create or refresh the current-files archive

Run from the original folder after reviewing the inventory:

```bash
mkdir -p dist
git ls-files --cached --others --exclude-standard -z | \
  COPYFILE_DISABLE=1 tar -czf dist/robo-entities-github-import.tar.gz --null -T -
tar -tzf dist/robo-entities-github-import.tar.gz
```

Check the archive list contains source, tests, examples, scripts, config, lockfile, documentation, and dotfiles such as `.github/workflows/ci.yml` and `.dev.vars.example`. It must not contain `.git/`, real `.dev.vars`, `.env`, dependency folders, or private keys. The archive is a source snapshot, not a deployed Worker backup. Regenerate it whenever the original files change.

## 4. Extract into a new folder and verify

Use a new, empty folder. If the suggested path already exists, choose another empty destination instead of extracting over an existing project.

```bash
mkdir "$HOME/Desktop/cloudflare-workers"
tar -xzf /Users/dainkang29/Desktop/robo-entities/dist/robo-entities-github-import.tar.gz \
  -C "$HOME/Desktop/cloudflare-workers"
cd "$HOME/Desktop/cloudflare-workers"
npm ci
npm run check:worker-types
npm run typecheck
npm test -- --run
npm run deploy -- --dry-run
```

Select Node 24 first (`nvm use` if available). Compare the extracted source-file list with the archive list. Dependency installation creates additional ignored files; it should not change source files or the lockfile.

## 5. Create the first commit and push

Only run this in the **new import folder**, once the destination is confirmed private. Leave the original repository and its GitLab remote intact.

```bash
git init -b main
git add .
git diff --cached --stat
git diff --cached --name-only
git diff --cached
```

Review the staged snapshot for unexpected files and secret values. Then:

```bash
git commit -m "Import Robo Entities with setup and handoff documentation"
git remote add origin https://github.com/dain-tech/cloudflare-workers.git
git push -u origin main
```

Use GitHub's supported authenticated Git flow; do not embed a password/token in the remote URL. If GitHub has gained commits since inspection, stop and reconcile instead of force-pushing. If GitHub blocks a push for a detected secret, remove the secret from the proposed import and rotate it as appropriate; do not bypass the detection.

## 6. Verify the handoff

```bash
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

The two commit hashes should match and the working tree should be clean. On GitHub, check **Private**, the README/doc links, source/tests/dotfiles, teammate access, and a successful **Validate Worker** Actions run. Ask a teammate to clone and follow the README without copying your `node_modules` or `.dev.vars`.

Separately complete the [Cloudflare handoff](handoff.md). The Git push does not deploy code or migrate service credentials. Once the import is verified, open the new folder in VS Code for ongoing GitHub work; retain the original checkout until the team has accepted the handoff.

Reference: [GitHub's local-code import instructions](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github).

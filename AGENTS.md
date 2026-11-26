# Notes for AI assistants

## Making a release (version tag) and pushing it

Versions follow semver (`MAJOR.MINOR.PATCH`). The version lives in the root `package.json`, and each
release is an annotated git tag `vX.Y.Z` on `main`. The UI footer shows the result of
`git describe --tags --match "v*"`, stamped in at build time (`client/vite.config.ts`).

### Steps

1. Make sure the work is committed and merged into `main`:

   ```bash
   git checkout main
   git status --short          # only untracked files (like .claude/) are allowed
   npm test                    # must pass before releasing
   ```

2. Pick the bump. Use `patch` for bug fixes only, `minor` for new features, and `major` for breaking
   or very large changes. An exact `X.Y.Z` is also allowed, but it must be newer than the current
   version.

3. Run the release script:

   ```bash
   npm run release -- minor
   ```

   The script (`scripts/release.mjs`):
   - refuses unless the branch is `main` with no uncommitted changes to tracked files;
   - refuses if the tag already exists;
   - bumps `version` in `package.json` and `package-lock.json`;
   - commits `release: vX.Y.Z` and creates the annotated tag `vX.Y.Z`;
   - undoes everything if any step fails;
   - never pushes.

4. Ask the user before pushing: it publishes to GitHub. Then run:

   ```bash
   git push --follow-tags origin main
   ```

   This sends the release commit and the new tag together. Check it with `git status -sb`: the
   first line should be `## main...origin/main`, with no "ahead".

5. Tell the user to rebuild (`npm run build`) so the running app's footer shows the new version.

### Do not

- Don't create tags by hand or edit the version in `package.json` yourself. Use the script, so the
  version, the lockfile, the commit and the tag always match.
- Don't release from a feature branch, or with uncommitted work.
- Don't push, force-push or delete tags without the user's explicit OK.
- Don't commit `.claude/`, `data/` or `rel out.db`.

### If something goes wrong

- If the script fails, nothing has changed. Fix the reason it prints and run it again.
- If a release was made locally but was wrong and **not pushed yet**, undo it with
  `git tag -d vX.Y.Z` and then `git reset --hard HEAD~1`. Check first that `HEAD` is the
  `release: vX.Y.Z` commit, and ask the user before running either command.
- Once a tag is pushed, don't move or delete it. Make a new patch release instead.

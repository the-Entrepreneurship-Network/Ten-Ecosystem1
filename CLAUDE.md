# Working agreements for this repository

## Never push onto a merged pull request

The owner merges every PR by hand. Work pushed to a branch whose PR has
already been merged is **orphaned**: GitHub will not reopen a closed PR, the
commit sits on a dead branch, and it never reaches production. This has
happened more than once — PR #243 merged and a later commit was pushed to the
same branch; PR #244 merged at 18:26 and the next commit was pushed at 18:4x.
Both times the work looked finished and was not deployed.

**Before every push, check the state of the branch's last PR.** Not from
memory — from GitHub. The branch name stays the same, so an old merged PR and
a new one look identical locally.

```bash
git fetch origin main
git log --oneline origin/main..HEAD        # what is not in main yet
```

and the authoritative check, which is the PR's own state:

```
list_pull_requests(state: "all", head: "claude/<branch>", perPage: 1)
→ merged_at set, or state "closed"  ⇒  that PR is finished. Open a NEW one.
```

### When the last PR is merged

Keep the branch name. Rebase any unmerged work onto the new base — do **not**
`checkout -B`, which silently discards it:

```bash
git fetch origin main
git rebase origin/main                     # replays unmerged commits onto main
git push -u origin <branch> --force-with-lease
```

Then open a **new** pull request. Never describe a new PR as "updating" a
merged one, and never report work as shipped because it was pushed — pushed
and merged are different things, and only one of them deploys.

### When the last PR is still open

Push to the same branch and say plainly in the reply that the existing PR now
carries the extra commits, so the owner knows what they are merging.

## What ships, and what does not

The deploy runs `npm ci` and restarts pm2. **It does not run vite.** The
single-page apps under `*-portal-app/` are built artefacts committed to
`public/<portal>/`, so a change to the React source alone ships nothing. Edit
the source *and* the built bundle, or the fix is invisible in production.

`public/<portal>/index.html` is build OUTPUT. A `vite build --emptyOutDir`
rewrites it from `<portal>-app/index.html`, so anything added only to the
output is deleted by the next build. Change both.

## Standing constraints from the owner

- Never push straight to `main`. Open a pull request and let them merge it.
- Total infrastructure cost stays **under ₹3,000/month**. Say the cost of
  anything new before building it, and say it again if an approach would
  raise it.
- Do not implement payment gateways (Razorpay and similar) for now.
- Existing features must keep working. A change that breaks connectivity
  between parts of the portal is not an acceptable trade.
- Never print the contents of `.env`, or any secret in it, anywhere.

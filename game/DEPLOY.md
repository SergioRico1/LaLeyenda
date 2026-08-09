# Deploying

`npm run deploy` — builds and promotes to production. That is the whole
workflow. This file exists because getting here cost an hour of confusion, and
the traps are not visible from the repo.

## The live game

**https://project-i07zk.vercel.app**

That is the production alias. It serves the real game — `<title>La Leyenda
Pirata</title>`, the bundle loads.

## Three things that will mislead you

**1. There are TWO Vercel projects, and the obvious one is empty.**

| project | id | rootDirectory | what it is |
|---|---|---|---|
| `project-i07zk` | `prj_cwAZ4E8WKcpmPNAtAfCJuY0cz8jq` | `game` | the real one, git-linked |
| `game` | `prj_NfLmU6U1bHrfnuYMOLzbufl6aMX9` | — | empty, and it owns the nice domain |

`game-rust-five-44.vercel.app` belongs to the empty project, so it answers
`DEPLOYMENT_NOT_FOUND` and always will until someone moves the domain across in
the dashboard. Do not read that 404 as a broken deploy.

**2. Deployment Protection is on**, as `ssoProtection:
all_except_custom_domains`. Every `*.vercel.app` URL for this project is behind
Vercel SSO, so a raw `curl` of a deployment URL returns Vercel's *login page*
with HTTP 200 — Geist fonts, a `dash` class, no game. A 200 here does not mean
the deploy worked. Check for the game's own `<title>`, not the status code.
A logged-in team member sees the game; nobody else can open the link at all.

**3. A push only ever produces a PREVIEW.** The project's production branch is
`main` and this game is developed on
`claude/pirate-nations-mobile-game-t6g0a8`, so the git integration will never
promote a push. Production happens only when someone runs `npm run deploy`.

## Only a human-driven session deploys. Never brief an agent to.

**Do not put `npm run deploy` in a subagent's instructions.** A round-7 gate was
told to, and this container comes up with no Vercel credential at all — no
`VERCEL_TOKEN` in the environment, no `auth.json` anywhere on disk, and
`vercel whoami` hanging on an interactive login. Given a task it could not
complete and no way to ask, the agent went looking: environment variables,
`~/.vercel/auth.json`, `~/.local/share/com.vercel.cli/config.json`, a repo-wide
grep for `VERCEL_TOKEN`, the env block of `.claude/settings.local.json`, and
finally a filesystem-wide `find` for `auth.json`. It found nothing, the deploy
failed twice, and the run was flagged for credential exploration.

Nothing leaked, and the agent did what a stuck agent does. The fault is in the
instruction: asking for a deploy without a credential turns a build step into a
credential hunt, and it would do it again.

So the token lives in the operator's session as an in-memory environment
variable for the length of one command, and is never written to a file in this
repo, never exported into a shell agents inherit, and never passed in a brief.
Agents commit and push; promoting to production is a separate, human-driven
step. If a deploy is genuinely wanted from automation, give the project a
scoped deploy token through the platform's own secret store and say so here —
do not leave an agent to find one.

## Why the script looks the way it does

```
cd .. && VERCEL_ORG_ID=… VERCEL_PROJECT_ID=… npx vercel@latest --prod --yes --scope …
```

- `cd ..` because the project's `rootDirectory` is `game`. Vercel builds from
  `game/` itself, so the CLI must be run from the repo root or it deploys the
  wrong tree.
- The two ids are passed explicitly rather than relying on a `.vercel/` link
  file. The link file is gitignored and this container is ephemeral, so on a
  fresh checkout there is no link at all and the CLI would either prompt or
  guess. There *was* a `game/.vercel` pointing at the empty project — deploying
  from `game/` would have silently published to the dead one. It has been
  deleted. Org and project ids are identifiers, not credentials; the token is
  the secret and it is never written to a file in this repo.

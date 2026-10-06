# Sun Marketing Console — Phase 1 patch series

The Sun Marketing Console code lives in **`Hyram720/sun-marketing-console`**. This session could read that repository but did not have permission to push to it, so the Phase 1 work is delivered here as a `git am`-ready patch series. It applies cleanly on top of `767753c` ("Add no-cost Opportunity Radar qualification (#50)"); the resulting tree was verified to be identical to the tested working copy.

| Patch | Contents |
|---|---|
| `0001-Phase-1-multi-tenant-core-CRM-and-AI-Command-Center-.patch` | Migration, SQL security tests, tenant framework, CRM, AI operator, API routes, UI pages, unit tests |
| `0002-Add-architecture-roadmap-schema-API-security-and-imp.patch` | `docs/architecture/*` (the same six documents are also in this repository's [`docs/architecture/`](../docs/architecture/MASTER_ARCHITECTURE.md)) |

## Apply

```bash
git clone https://github.com/Hyram720/sun-marketing-console
cd sun-marketing-console
git checkout -b claude/happy-wright-tyr5b2 767753c
git am /path/to/Landmark1/sun-marketing-console-phase1/patches/*.patch
npm install
npm run typecheck && npm test && npm run build
npm run test:db      # optional: needs local PostgreSQL 15+
git push -u origin claude/happy-wright-tyr5b2   # then open a PR
```

If `main` has moved past `767753c`, run `git rebase main` after `git am`.

## Verified in this session

- `tsc --noEmit`: clean
- `vitest`: 25/25 passing (policy ladder, scoring, RBAC, tool registry, OpenAI adapter, and the operator engine end-to-end with a scripted model)
- SQL security suite: 54/54 passing on PostgreSQL 16 with a Supabase stand-in (tenant isolation, role ladder, AI action state machine, audit immutability, erasure, legacy import, suspension)
- `next build`: succeeds (the pre-existing `middleware` → `proxy` deprecation warning remains)
- Browser smoke test (Chromium, desktop and mobile): passcode login; tenant pages show the team-sign-in state; tenant APIs return 401 without a user session; cross-site POSTs are rejected; signed-in screens rendered with fixture API data and no page errors

**Not yet verified:** the signed-in flow against the real Supabase project, because the migration has not been applied. Follow `docs/architecture/IMPLEMENTATION_PLAN.md` §2 to deploy.

Before deploying, read **SECURITY_PLAN S1**: the production `app_secret_ok()` function embeds the shared database secret as a literal, and it should be rotated (runbook in IMPLEMENTATION_PLAN §6).

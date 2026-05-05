# Vote Actions Rollout Plan

## Phase 1 (forward-accurate, low risk)

1. Deploy migration `0047_vote_actions.sql`.
2. Deploy API/app changes that append to `vote_actions` from vote mutation routes.
3. Verify `/api/me/vote-stats`:
   - `uniqueVotes` still matches `profiles.totalVotes`.
   - `voteActions` increases on create/update/remove where supported.

## Phase 2 (historical best-effort)

1. Run `scripts/backfill-vote-actions.ts` in production once.
2. Spot-check large users:
   - Compare total rows in `vote_actions` to expected footprint by table.
   - Confirm no duplicate `request_id` rows for backfilled records.
3. Communicate in changelog/admin note:
   - Historical actions are reconstructed from current state tables.
   - True edit/remove history prior to ledger introduction is partial.

## Guardrails / Monitoring

- Add dashboard query:
  - daily `vote_actions` rows by `voteType` and `actionKind`.
- Add alert if any vote mutation endpoint errors with `vote_actions` insert failures.
- Keep `profiles.totalVotes` unchanged (unique records) to avoid regressions.

## Rollback

- If ledger writes cause route errors, hotfix by making `appendVoteAction` best-effort (log and continue) while preserving vote persistence.
- Keep migration/table in place; it is additive and does not alter existing vote tables.

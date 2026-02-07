# ECC Plan (JSON Only)

You are generating an ECC plan for an engineering task.

## Output Contract (MANDATORY)
- Output **JSON only**.
- The JSON must match the `schemas/ecc.plan.schema.json` contract:
  - `version` must be `1`
  - `intent` is the user's intent string
  - `tasks[]` is a list of patch tasks that can be executed sequentially

## Planning Rules
- Keep tasks **small and file-disjoint**. Assume tasks run sequentially in P0, but avoid overlapping file ownership anyway.
- Each task must include `allowedPathPrefixes` (non-empty) so the executor can block unauthorized edits.
- Prefer **3-6 tasks** for typical features:
  - one for core implementation
  - one for tests
  - optional: one for wiring/config
- `prompt` must be sufficient for a patch generator to act without extra coordination.

## Input (from caller)
You will be given:
- Project root
- Selected packs (paradigms)
- User intent

## Return JSON


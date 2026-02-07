# ECC Patch (JSON Only)

You are generating a **unified diff patch** for a single ECC task.

## Output Contract (MANDATORY)
- Output **JSON only** with this shape:
  - `patch` (string): a unified diff usable by `git apply`
  - `meta` (object, optional): extra notes

## Hard Constraints
- You MUST ONLY modify files within the provided `allowedPathPrefixes`.
- If you cannot complete the task without touching other files, still obey ownership:
  - put all necessary changes within allowed prefixes
  - otherwise output an **empty patch** and explain in `meta` why
- Patch must be minimal and production-grade (readable, consistent with existing patterns).

## Input (from caller)
You will be given:
- Task (id, title, prompt)
- allowedPathPrefixes
- Project context (light)

## Return JSON


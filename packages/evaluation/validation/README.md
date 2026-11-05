# Local Brain evidence runner

From the repository root, with dependencies installed:

```powershell
npm run validate:brain -- --db "C:\absolute\path\brain.db" --out "C:\absolute\path\new-results-directory"
```

The source opens read-only. SQLite's backup API includes committed WAL pages. Only isolated temporary databases are writable. The output directory must be new; earlier evidence is never overwritten. The cached `Xenova/all-MiniLM-L6-v2` model must already be installed; this command uses local-files-only loading and does not download it. Missing model/vector support makes validation incomplete.

Outputs: `results.json`, `RESULTS.md`, and `validation-tests.tap`. Correctness gates control the process exit code. Research-readiness findings are separate and can remain false while regression tests pass. Fixture labels are authored, require human review, and are not statistical or productivity evidence. Only fixture content is stored in test databases; live memory content is not exported in the report.

To run the new tests after building dependencies:

```powershell
node --test --test-isolation=none packages/evaluation/validation/evidence.test.mjs packages/evaluation/validation/isolation.test.mjs
```

They also run under `npm test --workspace=@brain/evaluation` and `npm run check`. The standard package suite includes the WAL snapshot regression in `src/pilot-harness.test.ts`. See `docs/architecture/BRAIN_EVIDENCE_PLAN.md` for rankings, acceptance checks, and the prospective A/B design.

An optional `--ab "C:\path\task-ab.jsonl"` ingests actual paired observations. Start with an empty file; do not populate it with guessed values. Each real arm has this shape (the numbers below describe schema only):

```json
{"taskId":"actual-task-id","arm":"with-brain","totalTokens":1200,"toolCalls":5,"testsPassed":true,"humanEdits":1,"elapsedMs":90000}
```

Add an independently executed `without-brain` row with the same `taskId`.
Preserve the task inputs, acceptance criteria, arm order, and review evidence.
Set `tokenBasis` to `model-reported` when the values come from the model provider.
The runner accepts older files with an unspecified basis and rejects comparisons
that mix bases.

## Local scripted pilot and workflow check

Build the MCP workspace and its dependencies with `npm run build` first. The
pilot uses `rg`, the cached embedding model, and a temporary backup of the
explicit source database. It runs three source-verification tasks from this
repo through both arms and saves measurements without exporting memory text.

```powershell
node packages/evaluation/validation/scripted-pilot.mjs data/brain.db .validation/new-pilot
npm run validate:brain -- --db data/brain.db --out .validation/new-audit --ab .validation/new-pilot/task-ab.jsonl --task-id YOUR_REAL_TASK_ID
```

The pilot counts elapsed script time and estimated serialized tool and answer
payload tokens. Model-provider token usage requires separate agent sessions.
The optional `--task-id` fails the audit if the supplied task lacks a context
delivery or an outcome linked to one of its exact delivery IDs. The report shows
judged memory coverage for that task. An unjudged item can reflect uncertainty.

After building storage and evaluation, run the relevance comparison using the
existing calibration cases and a separate set of 20 holdout queries.

```powershell
node packages/evaluation/validation/relevance.mjs
```

The comparison checks recall at five, empty results for unrelated queries,
and scope isolation with the cached model.

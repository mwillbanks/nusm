# Maintain the nusm Agent Skill

Ship the skill from `skills/nusm`, alongside the API it describes. The archive's
version identifies the distributed skill. Its `metadata.library_version` marks
the verified API baseline. Review the baseline when guidance changes.

## Check and record changes

1. Build the package with `bun run build`.
2. Run `bun run intent:check`. Inspect any missing links, snippet errors, and
   pending reviews.
3. Run `bun run intent maintainer review --json`. Read every affected source,
   reference, and executable check. Assemble the review record with the CLI's
   reported evidence fields. Keep `.intent/review-state.json` with the changes.
4. Run `vale --no-global sync`, then `bun run skill:lint` and
   `bun scripts/skills/check-vale.ts`.
5. Run the package check. Confirm the loaded skill, both templates, and the
   adapter script work in the installed archive. Test the runtime fixture with
   a value that can round-trip and with a failed adapter operation.

Put edits to mapped paths in the same review as the skill. Keep the domain map,
skill spec, and source mappings in `skills/_artifacts`. Keep evals and review
records outside the npm allowlist.

## Evaluate routing and behavior

Use the prompts in `scripts/skills/evals.json`. Keep the routing labels and
behavior criteria from the evaluator. Record the model, revision, skill variant,
results, and misses.

For routing, use a fresh session for each of the 20 prompts. Provide only the
skill name, description, and that prompt. Ask the model whether to load the
skill. Score at least 18 out of 20. Inspect false positives and false negatives.
Change the description when the misses show a concrete gap.
When tuning on these prompts, check the revised text against fresh held-out
prompts before assigning an acceptance score.

For behavior, run each prompt in two fresh sessions with the same model and
task context. Provide the complete skill and bundled resources in one session.
Use the same context without the skill in the other. Give neither session the
rubric. Score each output against every listed criterion. Require all critical
checks to pass with the skill. Record both scores and any behavior regressions.
When any check fails, fix the guidance and repeat that case. See the
[initial evaluation results](../scripts/skills/eval-results.md).

For the user setup procedure, see the [Agent Skill guide](https://mwillbanks.github.io/nusm/docs/getting-started/agent-skills).

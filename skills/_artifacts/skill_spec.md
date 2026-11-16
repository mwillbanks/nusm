# nusm skill scope

The `nusm` skill serves developers who use the package in an application. It
covers storage choice, hydration, authenticated cross-tab updates, React
selectors, and the inspector. The source and documentation paths in the skill
tree define the review boundary. Package internals and unrelated state libraries
are outside this authoring batch.

Keep the public imports and lifecycle contracts in the skill. Keep conditional
details in references and runnable examples in the package. Use one skill
because these workflows share store identity and ownership.

Record source reviews in `.intent/review-state.json`. The npm version identifies
the shipped artifact. The skill's library version records the verified API
baseline. Recheck that baseline when the public contract changes.

See [maintainer checks and evals](../../docs/AGENT-SKILL.md).

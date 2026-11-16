# Initial nusm skill evaluation

The evaluator used `gpt-6.1-sol` in fresh `codex exec --ephemeral` sessions.
The cases and acceptance criteria are in [evals.json](evals.json). Routing
sessions received the name, description, and one held-out prompt. Behavior
sessions received the same prompt with or without the skill and its resources.
The sessions did not receive the expected labels or scoring criteria.

## Description routing

All 20 cases matched the expected loading decision. The result includes 10
matches and 10 near-misses. The description stayed the same after the trial.

## Behavior

| Case                       | With the skill | Without the skill |
| -------------------------- | -------------: | ----------------: |
| B01. Persisted React state |            4/4 |               1/4 |
| B02. Hydration recovery    |            3/3 |               1/3 |
| B03. Authenticated sync    |            3/3 |               2/3 |
| B04. Devtools setup        |            3/3 |               1/3 |
| Total critical criteria    |          13/13 |              5/13 |

B04 initially scored 2/3. The answer mentioned a development-only policy but
mounted the inspector in production. It also omitted the snapshot data boundary.
The first revision made the shell gate explicit. The next trial implemented the
gate, but it still omitted the data boundary. The second revision added the
boundary to the skill entry point and the Devtools procedure. The final trial
included both controls and passed all B04 criteria.

Final review found that the local storage template needed a separate validator
for subscribed adapter events. The revised B01 rubric requires a runtime-valid
configuration. The revised B03 rubric checks the scope of `sync: false`.
Fresh paired trials met every critical criterion for both cases when the skill
was available. The packed-consumer check also constructs both templates in a
browser, verifies their runtime behavior, typechecks them, and runs the adapter
check.

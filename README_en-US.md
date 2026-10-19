<div align="center">

# dsh-time-introspect

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-time-introspect/tree/v0.1.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)

[English] | [简体中文](./README.md)

</div>

A time-reflection plugin for dsh: when a turn overruns, the next turn starts with the previous turn time distribution, so the model can locate where time went and adjust by itself. When reflection overhead keeps eating the turn, the plugin goes dormant and the model can wake it at any time

Supports dsh 0.2.0-rc.2, 0.2.1-rc.1 and 0.2.1-rc.2

---

## Features

- Overrun-triggered: feedback is injected once at step 1 of the next turn only when the previous turn exceeded its estimate by both a ratio (`minOverrunRatio`, default 20%) and an absolute floor (`minOverrunMs`, default 5000 ms). Non-overrun turns produce no timing injection
- Time distribution: tool durations are aggregated by tool name in descending order, and tools beyond `topTools` fold into "other tools". "Model self-processing" is an independent entry in the same ordering
- Actionable split: "model self-processing" is actual - tool time - reflection cost. The separate line tells whether time went to tool orchestration or to the model own reasoning
- Self-billing reflection: observable time from injection to the end of the reflection phase is counted as "reflection cost" and delivered with the next feedback, so the model can judge whether reflection still pays off
- Self-constraint: consecutive turns with high reflection ratio and no improvement enter cooling; accumulating cooling cycles leads to dormancy. Dormancy injects one notice and then stays quiet
- Model-controlled restart: `time_introspect_resume_reflection` stays registered. The model can re-enable reflection at any time with a stated reason. The first turns after a restart use a stricter cooling threshold, preventing a restart-then-sleep loop
- Replayable: all state folds from the official session event log and is rebuilt after a process restart. No custom session event type is written
- Bilingual model-facing text: Chinese (`zh-CN`, default) or English (`en-US`)

## What the model sees

Previous turn estimated 30s and took 52s; step 1 of the next turn receives:

```text
[time reflection] Turn 3: estimated 30.0s, actual 52.0s, over by 73% (+22.0s).

Time distribution: bash 22.1s (43%) / model self-processing 13.4s (26%) / read 9.4s (18%) / other tools 2.3s (4%)

Model self-processing: 13.4s (26%). If this is high, shorten the reasoning chain before changing tool orchestration.

Reflection cost: 4.8s, 9% of the turn.
```

The first injection also carries one hint line about `time_introspect_task_estimate` and `time_introspect_report_reflection_cost`. When the model restarted reflection itself, the injection opens with the stated reason.

## Install

```sh
dsh plugin --profile <name> add dsh-time-introspect
```

`<name>` is the target profile, for example `web`, `desktop` or a dedicated profile.

The plugin works with its defaults. It never broadcasts timing readings; only turns where the model registered an estimate with `time_introspect_task_estimate` are compared.

## Tools

Every tool name carries the `time_introspect_` prefix to avoid collisions with other plugins.

| Tool | Purpose | Parameters |
|:---:|:---|:---|
| `time_introspect_task_estimate` | Register this turn estimated duration in milliseconds. Call at task start; later calls in the same turn replace earlier ones | `estimateMs` required, at most 24 hours; `note` optional |
| `time_introspect_report_reflection_cost` | Close the reflection analysis and its timing | `summary` optional, `worthIt` optional |
| `time_introspect_resume_reflection` | Re-enable reflection after dormancy. Usable at any time; the reason is recorded, not judged | `reason` required, at most 500 characters |

All three are advisory channels. The plugin blocks no tool call and never checks whether a reflection actually happened.

## Configuration

Override defaults in the profile `cordis.patch.yml` or the plugin row:

```yaml
- name: dsh-time-introspect
  config:
    minOverrunRatio: 0.15
    minOverrunMs: 3000
    topTools: 6
    locale: en-US
```

| Field | Default | Meaning |
|:---:|:---:|:---|
| `enabled` | `true` | Master switch. When off, no projection, tools or listener are registered |
| `minOverrunRatio` | `0.20` | Minimum overrun ratio required for injection |
| `minOverrunMs` | `5000` | Minimum absolute overrun in milliseconds required for injection |
| `coolRatio` | `0.15` | Reflection-to-turn ratio that counts as high cost |
| `coolRatioAfterResume` | `0.10` | Stricter ratio used for the first turns after a model restart |
| `conservativeTurns` | `2` | Turns the stricter ratio lasts after a restart |
| `coolAfterHighTurns` | `2` | Consecutive high-ratio, no-improvement turns before cooling |
| `minImprovementRatio` | `0.10` | Relative drop against the baseline required to count as improvement |
| `baselineTurns` | `3` | Completed turns used to compute the improvement baseline |
| `coolTurns` | `3` | Turns in the first cooling cycle; each later cycle doubles |
| `dormancyAfterCooldowns` | `2` | Accumulated cooling cycles that lead to dormancy |
| `topTools` | `5` | Tools listed individually in the distribution |
| `maxTurnHistory` | `12` | Completed turns kept by the projection |
| `locale` | `zh-CN` | Model-facing text language, `zh-CN` or `en-US` |
| `reflectionTools` | `[]` | Extra tool names treated as reflection tools; their time never enters the normal tool buckets |

Invalid configuration fails at plugin load instead of silently falling back to defaults.

## Measurement

- Previous turn: the latest closed turn before the current one. No previous turn, or no `time_introspect_task_estimate` in it, means no injection
- Actual duration: `turn/end` event time minus `turn/start` event time
- Tool duration: `tool/call` and `tool/result` paired by `callId`, which covers approval waits and session queueing
- Reflection cost: from the injection entering the log to the end of the reflection phase. The end is the `time_introspect_report_reflection_cost` result or the start of the first ordinary tool call after the injection, whichever comes first. A window still open when the turn ends is not counted
- Model self-processing: `actual - tool time - reflection cost`, floored at zero
- Zero-duration turns produced by crash recovery (which reuses the last event time) are ignored by both injection and self-constraint

Self-constraint transitions:

| State | Behavior | Enter | Leave |
|:---:|:---|:---|:---|
| active | Judge and inject | Initial state, or cooling finished | `coolAfterHighTurns` consecutive high-ratio, no-improvement turns |
| cooling | No injection | Cooling triggered | After `coolTurns` turns (each cycle doubles, capped at 8x) |
| dormant | No injection, no reflection accounting, one notice | Accumulated cooling cycles reach `dormancyAfterCooldowns` | The model calls `time_introspect_resume_reflection` |

After a restart, `conservativeTurns` turns use `coolRatioAfterResume`; cooling counters reset while ordinary tool records stay available for before/after comparison.

## Relationship to clock plugins

This plugin does not replace `dsh-time-context` or `dsh-time-reminder`. Those make the model aware of time; this plugin tells it where the time went after an overrun and gives reflection itself a cost. All three can be mounted together.

## Compatibility

| Item | Description |
|:---:|:---|
| dsh | `0.2.0-rc.2`, `0.2.1-rc.1`, `0.2.1-rc.2` |
| Node.js | `^22.19.0` or `>=24.0.0` |
| Enforcement | `engines.dsh` and every `@deepseek-ai/dsh*` peer declare the same supported set. From 0.2.1-rc.1 on, `engines.dsh` takes precedence when present; earlier versions check the peer ranges |

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm run pack
```

Build output lives in `lib/` with `lib/index.js` as the entry. For local debugging, run `npm run build` first and point `--patch` at `lib/index.js`. `npm run pack` writes the tgz artifact into `release/`. Mechanism details live in [docs/mechanism.md](./docs/mechanism.md).

Directory layout:

```text
dsh-time-introspect/
├── .gitignore            # git ignore rules
├── COPYRIGHT             # copyright notice
├── LICENSE               # Apache-2.0 license
├── README.md             # Chinese README
├── README_en-US.md       # English README
├── cordis.patch.yml      # bundle patch layer
├── docs/                 # project docs and official developer doc snapshots
├── package.json          # package manifest
├── scripts/              # auxiliary scripts
├── src/                  # plugin sources
├── test/                 # unit tests
├── tsconfig.build.json   # build configuration
├── tsconfig.json         # typecheck configuration
└── version.index.md      # version occurrence index
```

## Boundaries

- Defines no "reasonable duration"; it presents distribution and deviation only
- Never used for scoring, ranking or punishment; timing data exists for feedback and audit
- Does not modify model weights or train; it is an inference-time context intervention
- Turns without an estimate trigger nothing
- Writes no custom session event types; state folds entirely from official events

## License

[Apache-2.0](./LICENSE)
<div align="center">

# dsh-time-introspect

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-time-introspect/tree/v0.1.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)

[English] | [简体中文](./README.md)

</div>

A time-introspection plugin for dsh: when the previous turn exceeded the model's estimate, a complete time distribution is injected as JSON in the next turn, and the model decides whether to introspect. Introspection starts and stops through explicit tool calls, and the plugin only measures and accounts; it never auto-cools or auto-sleeps. Whether to go quiet is the model's decision.

Supports dsh 0.2.0-rc.2, 0.2.1-rc.1 and 0.2.1-rc.2

---

## Features

- Overrun-triggered: injection happens once at step 1 of the next turn only when the previous turn has an estimate and its actual duration exceeds both a ratio (`minOverrunRatio`, default 20%) and an absolute floor (`minOverrunMs`, default 5000 ms)
- Complete JSON: the injection is structured JSON with totals, per-tool time, model self-processing, and introspection internals; every tool is listed individually, with no top-N folding
- Explicit introspection boundaries: the model calls `time_introspect_start` and `time_introspect_stop`; the plugin measures between those positions, so the model never compiles or reports timing data
- Self-billed introspection: all time inside the introspection window counts as introspection cost; tools used inside it are listed under `introspect` so the model can judge whether introspection paid off
- Model-controlled sleep: `time_introspect_shut` puts the plugin to sleep and `time_introspect_waken` restores it; there is no automatic cooling or dormancy
- In-transcript red-dot bubbles: every call to this plugin's tools shows a red dot at that call position; a new call expands a one-line hint for 3 seconds, then collapses while the dot stays; click the dot to expand or collapse details
- Status query: `time_introspect_status` returns read-only state, the last turn totals, and the three top-level totals
- Main session only: subagent sessions receive no injection, and all six tools are hidden there
- Replayable: state folds from official session events, so a process restart rebuilds it; no custom session event type is written
- Bilingual text: `locale` selects Chinese (`zh-CN`, default) or English (`en-US`)

## What the model sees

```json
{
  "type": "time_introspect",
  "desc": "This JSON was generated automatically by the dsh-time-introspect plugin and describes the previous turn time distribution. Whether to introspect is your decision; call time_introspect_start to begin and time_introspect_stop when done.",
  "turn": 3,
  "waken": { "reason": "three turns of redundant tool calls; work is getting harder" },
  "estimate_ms": 100000,
  "overrun_ms": 30000,
  "overrun_ratio": 0.3,
  "time_consume_total_ms": 130000,
  "time_consume_details": {
    "tool": {
      "desc": "Tool time outside the introspection window. Tool calls made during introspection are excluded. Calls to this plugin's own tools outside the window, including the start and stop boundary tools, are included.",
      "ratio": 0.0769,
      "total_ms": 10000,
      "details": [
        { "name": "bash", "calls": 3, "ms": 4000, "ratio": 0.4 },
        { "name": "read", "calls": 2, "ms": 2000, "ratio": 0.2 },
        { "name": "write", "calls": 4, "ms": 3000, "ratio": 0.3 },
        { "name": "time_introspect_start", "calls": 1, "ms": 300, "ratio": 0.03 },
        { "name": "time_introspect_stop", "calls": 1, "ms": 700, "ratio": 0.07 }
      ]
    },
    "model": { "desc": "Model processing and waiting outside the introspection window. Model time inside introspection and all tool time are excluded.", "ratio": 0.7693, "total_ms": 100000 },
    "introspect": {
      "desc": "All time inside the introspection window, including tool calls (this plugin's tools included) and model processing. The start and stop tools themselves sit outside the window and are not included.",
      "ratio": 0.1538,
      "total_ms": 20000,
      "details": {
        "tool": {
          "desc": "Tool time inside the introspection window, including this plugin's tools called inside it. The start and stop tools themselves sit outside the window and are not included.",
          "ratio": 0.3,
          "total_ms": 6000,
          "details": [
            { "name": "bash", "calls": 10, "ms": 5000, "ratio": 0.8333 },
            { "name": "read", "calls": 2, "ms": 1000, "ratio": 0.1667 }
          ]
        },
        "model": { "desc": "Model processing and waiting inside the introspection window, excluding tool time.", "ratio": 0.7, "total_ms": 14000 }
      }
    }
  }
}
```

`waken` appears only in the first injection after a model restart. Every time layer carries a `desc` explaining whether it contains introspection tools and this plugin's tools. Each layer keeps four decimal places, with the rounding remainder assigned to its largest entry.

## Install

```sh
dsh plugin --profile <name> add dsh-time-introspect
```

`<name>` is the target profile, for example `web`, `desktop` or a dedicated profile.

## Tools

| Tool | Parameters | Behavior |
|:---:|:---|:---|
| `time_introspect_estimate` | `estimateMs` | Record this turn estimate; the last call wins |
| `time_introspect_start` | none | Start introspection; requires an injection in this turn, and fails if a window is already open |
| `time_introspect_stop` | none | Stop introspection; fails when no window is open |
| `time_introspect_shut` | `reason` | Sleep; idempotent when already dormant, discards an open window |
| `time_introspect_waken` | `reason` | Wake; idempotent when already active |
| `time_introspect_status` | none | Read-only state and last-turn totals |

Every tool name carries the `time_introspect_` prefix. The plugin blocks no tool call and never checks whether introspection was actually completed.

## Configuration

```yaml
- name: dsh-time-introspect
  config:
    minOverrunRatio: 0.15
    minOverrunMs: 3000
    locale: en-US
```

| Field | Default | Meaning |
|:---:|:---:|:---|
| `enabled` | `true` | Master switch; when off, no projection, tools or listener are registered |
| `minOverrunRatio` | `0.20` | Minimum overrun ratio required for injection |
| `minOverrunMs` | `5000` | Minimum absolute overrun in milliseconds required for injection |
| `maxTurnHistory` | `12` | Completed turns kept by the projection |
| `locale` | `zh-CN` | Model-facing text language, `zh-CN` or `en-US` |

The bubble auto-expand duration is fixed at 3 seconds, and the history auto-expand window is fixed at 15 seconds; neither is configurable.

## Measurement

- Actual duration: `turn/end` event time minus `turn/start` event time
- Tool duration: `tool/call` and `tool/result` paired by `callId`
- Introspection window: from the `time_introspect_start` result to the `time_introspect_stop` call
- All time inside the introspection window counts as introspection cost; ordinary and plugin tools inside it appear under `introspect.details.tool` and not in the top-level `tool.details`
- This plugin's own tools appear in `tool.details` like any other tool; there is no separate plugin overhead line
- Top-level relation: `time_consume_total_ms = tool.total_ms + model.total_ms + introspect.total_ms`
- Each layer `ratio` is relative to its parent total, four decimals, with the rounding remainder assigned to the largest entry
- Zero-duration turns produced by crash recovery are ignored by the injection decision

## States

| State | Behavior | Enter | Leave |
|:---:|:---|:---|:---|
| active | Judge and inject | Initial state, or a model wake | The model calls `time_introspect_shut` |
| dormant | No injection, no introspection accounting | The model calls `time_introspect_shut` | The model calls `time_introspect_waken` |

There is no automatic cooling or dormancy. Whether the plugin goes quiet is the model's decision.

## User-visible bubbles

- Bubbles live in the conversation transcript; they do not cover the composer, block the model or the user, and scroll with the transcript
- Every call to this plugin's tools has a red-dot button; the dot is a position marker, not an error state
- A new call auto-expands a one-line hint for 3 seconds, then collapses; the dot remains
- Only calls within 15 seconds of mount auto-expand; calls in history show the dot only, so opening an old session does not pop many bubbles at once
- Click the dot to expand or collapse details; an expanded bubble stays open until clicked again
- Details include tool, phase, time, turn, arguments and result; stopping introspection shows the introspection cost, and status queries show the result JSON
- Text follows the Web UI language

## Relationship to clock plugins

This plugin does not replace `dsh-time-context` or `dsh-time-reminder`. Those make the model aware of time; this plugin tells it where the time went after an overrun and gives introspection itself a cost. All three can be mounted together.

## Compatibility

| Item | Description |
|:---:|:---|
| dsh | `0.2.0-rc.2`, `0.2.1-rc.1`, `0.2.1-rc.2` |
| Node.js | `^22.19.0` or `>=24.0.0` |
| Enforcement | `engines.dsh` and every `@deepseek-ai/dsh*` peer declare the same supported set. From 0.2.1-rc.1 on, `engines.dsh` takes precedence when present |

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm run pack
```

Build output lives in `lib/`, with `lib/index.js` as the host entry and `lib/client.js` as the browser entry. `npm run build` produces both; `npm run build:client` rebuilds the client only. `npm run pack` writes the tgz artifact into `release/`. Mechanism details live in [docs/mechanism.md](./docs/mechanism.md).

Directory layout:

```text
dsh-time-introspect/
├── .gitignore            # git ignore rules
├── COPYRIGHT             # copyright notice
├── LICENSE               # Apache-2.0 license
├── README.md             # Chinese README
├── README_en-US.md       # English README
├── client/               # browser half: red-dot bubbles
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
- No automatic cooling or dormancy
- Writes no custom session event types; state folds entirely from official events
- Applies to the main session only

## License

[Apache-2.0](./LICENSE)
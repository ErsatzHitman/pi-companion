# apps/android/e2e

TypeScript support code for the Maestro flows in `../maestro/` (T37D, plan.md §6, §14.4). This
directory owns the harness logic; `../maestro/` owns the flow files themselves and documents the
one command that runs them — start there (`../maestro/README.md`).

## Layout

- `run-flow.ts` — the CLI entry point (`npx tsx apps/android/e2e/run-flow.ts <flow-name>`).
  Thin on purpose: it only orchestrates spawning and cleanup. (CORRECTED (T334): this said it
  "has never been executed in this wave"; `.github/workflows/android-maestro-e2e.yml` has run it
  on a real emulator on every dispatch since T320.)
- `harness/production-daemon-port.ts` — the one place that defines port `6767` and the two
  refusal functions everything else in this harness calls.
- `harness/daemon-endpoint.ts` — allocates one ephemeral, non-6767 port and one fresh
  `PASEO_HOME` directory per flow run.
- `harness/flow-registry.ts` — resolves a flow name to its `.yaml` path in `../maestro/`.
- `harness/run-plan.ts` — pure function from a resolved flow + endpoint to the exact daemon and
  Maestro argv `run-flow.ts` spawns; never touches a process or a socket itself, which is what
  makes it unit-testable without a device. T334 adds the optional `flowCwd`, passed to the flow
  as `-e FLOW_CWD=...`.
- `harness/scripted-pi.mjs` — the scripted `pi` the isolated daemon runs instead of a real one
  (T334): a plain-JavaScript JSONL RPC peer the daemon spawns through its own provider override,
  with one scenario per flow (`echo`, `approval`, `extension-sheets`). Its `createScriptedPi` is
  driven in-process by `harness/scripted-pi.test.ts`, which also spawns it once as a child.
- `harness/scripted-pi-provision.ts` — writes the daemon's config file into the fresh
  `PASEO_HOME` so `agents.providers.pi.command` is `[node, scripted-pi.mjs]`; refuses any home
  that is not a `daemon-endpoint.ts` throwaway (`assertThrowawayHome`).
- `harness/flow-cwd.ts` — one host-side working directory per run, the `${FLOW_CWD}` a flow
  types into the "New session" form.
- `harness/*.test.ts` — real Vitest tests for all of the above (`npm run test
--workspace=@picompanion/android`, or `npx vitest run apps/android/e2e --bail=1` for just
  this directory). No source-text regex tests here — every assertion above exercises the real
  function, not a string match against its own source.

## What's proven here vs. what isn't

Fully proven by `harness/*.test.ts`, without a device:

- flow-name resolution (a known name resolves; an unknown name lists the available flows; a
  malformed name is rejected before touching the filesystem);
- the daemon endpoint never resolves to port 6767, and two resolutions never collide;
- the built run-plan never contains port 6767, and refuses to build a plan when the endpoint's
  port is 6767 (checked in both directions — a safe endpoint still builds a plan);
- the scripted `pi` answers every startup RPC the daemon's provider makes, orders a prompt's
  ack before its events, raises the approval dialogs and the PIUI elements the two flows assert,
  and is provisioned only ever into a throwaway home; and no flow types a literal path where
  `${FLOW_CWD}` belongs (T334).

Not proven here, and out of scope for this wave: that `run-flow.ts` actually starts a working
daemon, that Maestro actually drives the emulator, or that any flow (including `smoke.yaml`)
passes on a device. Those belong to the first `T37E*` task with a device.

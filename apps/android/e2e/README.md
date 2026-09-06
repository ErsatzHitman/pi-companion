# apps/android/e2e

TypeScript support code for the Maestro flows in `../maestro/` (T37D, plan.md §6, §14.4). This
directory owns the harness logic; `../maestro/` owns the flow files themselves and documents the
one command that runs them — start there (`../maestro/README.md`).

## Layout

- `run-flow.ts` — the CLI entry point (`npx tsx apps/android/e2e/run-flow.ts <flow-name>`).
  Thin on purpose: it only orchestrates spawning and cleanup. It has never been executed in this
  wave — no emulator, device, or Maestro binary is available here (see `../maestro/README.md`'s
  "What T37D proved" section).
- `harness/production-daemon-port.ts` — the one place that defines port `6767` and the two
  refusal functions everything else in this harness calls.
- `harness/daemon-endpoint.ts` — allocates one ephemeral, non-6767 port and one fresh
  `PASEO_HOME` directory per flow run.
- `harness/flow-registry.ts` — resolves a flow name to its `.yaml` path in `../maestro/`.
- `harness/run-plan.ts` — pure function from a resolved flow + endpoint to the exact daemon and
  Maestro argv `run-flow.ts` spawns; never touches a process or a socket itself, which is what
  makes it unit-testable without a device.
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
  port is 6767 (checked in both directions — a safe endpoint still builds a plan).

Not proven here, and out of scope for this wave: that `run-flow.ts` actually starts a working
daemon, that Maestro actually drives the emulator, or that any flow (including `smoke.yaml`)
passes on a device. Those belong to the first `T37E*` task with a device.

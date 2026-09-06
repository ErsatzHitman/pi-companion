# apps/android

Android client (Expo Router + React Native), per `plan.md` §6/§9/§12.4. See the
repository root's `CLAUDE.md` and `plan.md` for the product spec and repo-wide
invariants; this file only carries Android-specific test conventions.

## Source-text tests must be mutation-checked

`react-native` component modules cannot be rendered under this workspace's plain
`vitest` setup (`RolldownError` on `react-native`'s own Flow-typed `index.js` —
the "VITEST LIMITATION" every `*-accessibility.test.ts`/`*-screen.test.ts` doc
comment in this tree references). Several suites work around that by asserting
against a component's raw file text instead of a render tree.

`toMatch`/`not.toMatch` against raw source is unanchored and does not know what a
comment is. Five instances across five merge gates (P5-W4 through P5-W16) were
proven decorative — a doc comment describing a prop, a bare identifier already
satisfied by the file's own `import` line, or a `\(`-literal prohibition blind to
an optional-chained call (`client.readFile?.(...)`) — each left the assertion
green after the real construct it was meant to check was deleted.

**A new source-text assertion is not proof of anything until it has been
mutation-checked**, and it must stay that way after any edit that changes what it
matches:

1. Read through a comment-stripping helper, not the raw file text, for any
   assertion that must reach real code:
   ```ts
   function readCode(): string {
     return readSource()
       .replace(/\/\*[\s\S]*?\*\//g, "")
       .replace(/\/\/.*$/gm, "");
   }
   ```
   (Copy this pattern — see `readCode()` in
   `src/app/h/[serverId]/session/[agentId]/index.test.ts` for the canonical
   version.) A `not.toMatch` prohibition needs this even more than a positive
   match: comment-bearing source can be tripped **by** the doc comment that
   explains the very thing being prohibited.
2. Match a full call or JSX expression, never a bare identifier — an identifier
   that also appears in the file's own `import` line can never fail.
3. A prohibition written as a literal `\(` call is blind to an optional-chained
   call site (`member?.(...)`) whenever the prohibited member is itself
   optional — write `member(?:\?\.)?\(` instead when that's the shape a real
   caller would naturally use.
4. Prove it: delete or restructure the real construct the assertion targets
   **while leaving the surrounding comments and imports intact**, run the
   suite, and confirm the assertion goes red. Restore the file byte-identical
   (diff it back against a backup kept outside the repo) and confirm the suite
   is green again. Record the mutation and its result — in the commit message
   at minimum, ideally in a comment beside the assertion.

A source-text assertion that passes without ever having been run against a
deliberately-broken version of the code it checks is not evidence that the code
is correct — it is evidence that the regex compiles. Do not add one without
doing the above, and do not trust one you didn't write without doing it either.

Touch-target/dimension checks carry one more rule: match **per interactive
element**, not per file. A file can contain several touchable primitives; if the
check aggregates evidence (any `minHeight`/`hitSlop` anywhere in the file) rather
than resolving each element's own `style`/`hitSlop`, one compliant element can
mask every other element's regression. See `src/ui/primitives/touch-targets.test.ts`
for the per-element pattern (each interactive JSX tag resolved back to its own
`StyleSheet.create` entry).

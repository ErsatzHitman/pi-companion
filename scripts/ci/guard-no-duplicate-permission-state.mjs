// T60D: CI guard — `apps/android/src/features/composer/permission-recovery.ts`
// is the ONE permission-recovery state vocabulary under `apps/android/src`
// (plan.md's "one shared home" unification; see that file's own header
// comment for the full history: T32A6's `features/connect/` and T33B7's
// `features/composer/` shipped independent five-state vocabularies in the
// same wave before T60D folded them onto this module).
//
// This guard fails if a SECOND private permission-state union reappears
// anywhere under `apps/android/src` — the exact regression this task exists
// to close off. It is deliberately narrow, not a generic "no duplicate
// types" linter: it flags a `type X = ...;` declaration (never a switch
// arm, a function call, an `export type { … } from …` re-export, or a
// doc-comment mention — comments are stripped before matching, and only a
// `type Name = <literal union>;` ALIAS with an `=` counts as a
// declaration) whose string-literal members either
//
//   (a) include `"denied-permanently"` — the one state literal that is
//       distinctive to *this* vocabulary (Android's own "don't ask again"
//       case; no other permission-shaped union in this tree has a reason
//       to declare it), or
//
//   (b) are ALL drawn from the canonical vocabulary's five literals
//       (`"undetermined" | "granted" | "denied" | "denied-permanently" |
//       "unavailable"`), i.e. the union is a non-trivial (2+ member)
//       *subset* of `PermissionState` even without the distinctive
//       literal.
//
// (T60E, P5-W17): condition (b) is what closes the KNOWN BLIND SPOT this
// guard shipped with at P5-W15 — a union that mirrors the vocabulary but
// happens to omit `"denied-permanently"` (the real, then-undetected shape
// of `features/connect/qr-scanner-port.ts`'s `CameraPermissionStatus`,
// folded away by T60E) used to pass keying on the literal alone. Condition
// (b) is deliberately a *pure subset* test, not "shares any literal with
// the vocabulary" — a union like `QrScanPhase` (`"idle" | "checking" |
// "ready" | "denied" | "settings" | "unavailable" | "pairing" | "paired" |
// "error"`) reuses two of the same words for an unrelated UI-phase enum,
// but most of its members fall outside the permission vocabulary, so it is
// not a subset and is correctly left unflagged — see
// `guard-no-duplicate-permission-state.test.mjs`'s "does not flag a
// same-domain enum that merely reuses a couple of vocabulary words" case.
// The 2-member floor on (b) exists for the same reason: a single reused
// word (e.g. some unrelated type that happens to have one `"granted"`
// member among otherwise-unrelated literals) is not, by itself, evidence
// of a redeclared vocabulary.
//
// `packages/frontend-core/src/platform/notifications.ts`'s
// `NotificationPermissionState` is out of this guard's scope on directory
// grounds alone (`run-guard-no-duplicate-permission-state.mjs` only walks
// `apps/android/src`), independent of shape — so a future adapter that
// merely *imports* it into `apps/android/src` (an import statement, not a
// `type X = …` declaration) triggers neither condition above.
//
// Pure, dependency-free check function only. `run-guard-no-duplicate-permission-
// state.mjs` is the CLI entry point CI actually runs; this module stays
// import-safe so `guard-no-duplicate-permission-state.test.mjs` can seed
// violations without touching the real working tree.

export const CANONICAL_PERMISSION_STATE_PATH =
  "apps/android/src/features/composer/permission-recovery.ts";

const DISTINCTIVE_LITERAL = "denied-permanently";

/** The exact five-member vocabulary declared by `PermissionState` in the canonical module above. */
const CANONICAL_LITERALS = new Set([
  "undetermined",
  "granted",
  "denied",
  "denied-permanently",
  "unavailable",
]);

/** A pure-subset union must have at least this many members before it counts as evidence of a redeclared vocabulary — see the module header's note on the 2-member floor. */
const MIN_SUBSET_MEMBERS = 2;

/** Strips `/* … *‍/` and `// …` comments so a comment mentioning the literal never counts as a declaration of it. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Extracts every double-quoted string literal's inner text from a type body, in source order, allowing duplicates (a union should not repeat a literal, but this is a reader, not a validator of that). */
function extractStringLiterals(body) {
  const matches = body.match(/"[^"\\]*(?:\\.[^"\\]*)*"/g) ?? [];
  return matches.map((raw) => raw.slice(1, -1));
}

/**
 * @param {{ path: string, content: string }[]} files repo-relative paths
 *   (forward-slash) paired with file content, restricted to files under
 *   `apps/android/src`
 * @returns {{ path: string, typeName: string }[]} every non-canonical
 *   `type <Name> = …;` declaration that redeclares the permission-state
 *   vocabulary — either literally (contains `"denied-permanently"`) or
 *   structurally (every one of its 2+ string-literal members is itself a
 *   `PermissionState` literal)
 */
export function findDuplicatePermissionStateUnions(files) {
  const violations = [];
  for (const { path, content } of files) {
    if (path === CANONICAL_PERMISSION_STATE_PATH) continue;
    const code = stripComments(content);
    // Matches a `type Name = <body up to the first semicolon>;` statement —
    // bounded by the first `;`, which every type-alias declaration in this
    // codebase's own style ends on (a union body is `|`-separated string
    // literals/type references, never itself containing a `;`).
    const declarationPattern = /(?:export\s+)?type\s+(\w+)\s*=\s*([\s\S]*?);/g;
    let match;
    while ((match = declarationPattern.exec(code)) !== null) {
      const [, typeName, body] = match;
      const literals = extractStringLiterals(body);
      const hasDistinctiveLiteral = literals.includes(DISTINCTIVE_LITERAL);
      const isNonTrivialCanonicalSubset =
        literals.length >= MIN_SUBSET_MEMBERS &&
        literals.every((literal) => CANONICAL_LITERALS.has(literal));
      if (hasDistinctiveLiteral || isNonTrivialCanonicalSubset) {
        violations.push({ path, typeName });
      }
    }
  }
  return violations;
}

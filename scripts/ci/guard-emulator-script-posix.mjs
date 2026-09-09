// T319: CI guard — the `script:` handed to
// `reactivecircus/android-emulator-runner` runs under POSIX `sh`, not bash,
// and must contain no bashisms.
//
// ## The defect this closes
//
// Both emulator jobs in `android-maestro-e2e.yml` opened their script with
// `set -euo pipefail`. That action does not run the script with bash; it
// runs `/usr/bin/sh -c <script>`, and on Ubuntu runners `/usr/bin/sh` is
// dash. Dash has no `pipefail`:
//
//   [command]/usr/bin/sh -c set -euo pipefail
//   /usr/bin/sh: 1: set: Illegal option -o pipefail
//   ##[error]The process '/usr/bin/sh' failed with exit code 2
//
// On Maestro run 34401219271 that killed every shard on the FIRST LINE of
// the script — after installing the SDK, creating an AVD, and waiting
// `Boot completed in 358363 ms` for the emulator. Six minutes of setup per
// shard to discover a one-word shell incompatibility, and it would have
// recurred the moment anyone added a second bashism.
//
// ## Why the rest of the workflow is not affected, and is not scanned
//
// An ordinary GitHub Actions `run:` step defaults to bash on Linux, so
// `set -euo pipefail` in a `run:` step is correct and this guard must not
// flag it. The distinction is exactly "is this text handed to
// android-emulator-runner's `script:` input", which is why
// `extractEmulatorScriptBlocks` below keys off the `uses:` line rather than
// scanning the file for `pipefail`.
//
// ## T320: the rule is stronger than "no bashisms"
//
// The next dispatch (run 34407860092) showed WHY dash was seeing `set -euo
// pipefail` alone on line 1. The action does not hand the script to one
// shell at all — it runs **each line separately**, as its own `sh -c`:
//
//   [command]/usr/bin/sh -c set -eu
//   [command]/usr/bin/sh -c adb install -r "$RUNNER_TEMP/picompanion-debug.apk"
//   [command]/usr/bin/sh -c flows="$(node -e "
//   /usr/bin/sh: 1: Syntax error: Unterminated quoted string
//
// `adb install` had already succeeded; the script died on the third line.
// So three further things are checked, none of which is a "bashism":
//
//   - a line with unbalanced quotes or an unclosed `$(` cannot run alone;
//   - a line ending in a backslash continuation cannot continue anywhere;
//   - `set -e`/`set -eu` is a no-op, because it configures a shell that
//     exits at the end of that one line. Failure still propagates — the
//     action checks each line's exit status, which is how the syntax error
//     above failed the step — so the fix is to delete it, not to keep it
//     for reassurance.
//
// Multi-line CONSTRUCTS (a `for` loop, an `if`) are caught by the same
// balance check in practice, because every such construct in this
// repository's history opened a quote or a substitution it could not close
// on the same line. The check is deliberately structural rather than an
// attempt to parse shell grammar.
//
// ## What counts as a bashism
//
// A curated list, not an attempt at a shell parser — the same call
// `guard-local-expo-module-sdk.mjs` makes about its three compileSdk
// mechanisms. Each entry is a construct dash genuinely lacks (or treats
// differently) and that a shell-fluent author would reasonably reach for.
// `local` is deliberately absent: dash supports it.
//
// Pure, dependency-free check functions only; `run-guard-emulator-script-
// posix.mjs` is the CLI entry point.

/**
 * @typedef {{ id: string, pattern: RegExp, reason: string }} Bashism
 */

/** @type {Bashism[]} */
export const BASHISMS = [
  {
    id: "pipefail",
    pattern: /\bset\s+[-\w]*o\s+pipefail\b|\bset\s+-o\s+pipefail\b/,
    reason: "`set -o pipefail` — dash rejects it with `set: Illegal option -o pipefail`",
  },
  {
    id: "double-bracket-test",
    pattern: /\[\[/,
    reason: "`[[ ... ]]` is a bash keyword; use `[ ... ]`",
  },
  {
    id: "process-substitution",
    pattern: /[<>]\(/,
    reason: "process substitution `<(...)` / `>(...)` is bash-only",
  },
  {
    id: "ampersand-redirect",
    pattern: /&>/,
    reason: "`&>` is a bash redirect; use `> file 2>&1`",
  },
  {
    id: "declare-or-array",
    pattern: /\bdeclare\s+-|\b[A-Za-z_][A-Za-z0-9_]*=\(/,
    reason: "`declare` and array assignment are bash-only",
  },
  {
    id: "source-builtin",
    pattern: /(?:^|[\s;&|])source\s+\S/,
    reason: "`source` is a bash alias for `.`; dash has only `.`",
  },
];

const EMULATOR_ACTION = "reactivecircus/android-emulator-runner";
const SCRIPT_KEY_PATTERN = /^(\s*)script:[ \t]*(.*)$/;
const BLOCK_SCALAR_INDICATOR_PATTERN = /^[|>][+-]?\d*$/;

/**
 * Extracts the literal `script:` body of every step that uses the emulator
 * action. Walks from each `uses:` line to the end of that step (the next
 * line at or left of the step's own `- ` indent), so a `script:` belonging
 * to some other step can never be attributed to this one.
 *
 * Deliberately text-based rather than a real YAML parser, matching
 * `guard-run-guard-wiring.mjs`'s and `guard-app-id-package-pairing.mjs`'s
 * own reasoning: every emulator step in this repository is one shape, and a
 * narrow, auditable extraction beats a general interpreter. A step this
 * cannot parse yields no script, which reads as "nothing to check" — so the
 * runner also fails when it finds ZERO emulator scripts, and that is what
 * keeps a parse regression from passing silently.
 *
 * @param {string} workflowContent raw `.github/workflows/*.yml` source
 * @returns {string[]} one entry per emulator step's script, in document order
 */
export function extractEmulatorScriptBlocks(workflowContent) {
  const lines = workflowContent.split("\n");
  const scripts = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(EMULATOR_ACTION)) continue;

    // The step's own indent: the `- ` list marker that opened it, which is
    // at or above this `uses:` line.
    const usesIndent = lines[i].match(/^(\s*)/)[1].length;

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === "") continue;
      const indent = line.match(/^(\s*)/)[1].length;
      // Left of, or level with, the `uses:` key means this step is over.
      if (indent < usesIndent || /^\s*-\s/.test(line)) break;

      const match = line.match(SCRIPT_KEY_PATTERN);
      if (!match) continue;

      const keyIndent = match[1].length;
      const inline = match[2].trim();
      if (inline !== "" && !BLOCK_SCALAR_INDICATOR_PATTERN.test(inline)) {
        scripts.push(inline);
        break;
      }

      const body = [];
      let k = j + 1;
      while (k < lines.length) {
        const bodyLine = lines[k];
        if (bodyLine.trim() === "") {
          body.push(bodyLine);
          k++;
          continue;
        }
        if (bodyLine.match(/^(\s*)/)[1].length <= keyIndent) break;
        body.push(bodyLine);
        k++;
      }
      scripts.push(body.join("\n"));
      break;
    }
  }

  return scripts;
}

/**
 * Blanks everything from a `#` to end of line, so the explanatory comments
 * these scripts carry — which name `set -o pipefail` precisely in order to
 * warn about it, as both real scripts now do — are not themselves reported
 * as the defect.
 *
 * @param {string} script
 * @returns {string}
 */
/** @param {string} text @returns {string[]} */
function splitLines(text) {
  return text.split(/\r?\n/);
}

export function stripShellComments(script) {
  return script
    .split("\n")
    .map((line) => {
      const hash = line.indexOf("#");
      return hash === -1 ? line : line.slice(0, hash);
    })
    .join("\n");
}

/**
 * Whether a single line could be executed on its own by `sh -c`, which is
 * exactly how this action runs it. Structural, not a shell parser: it
 * checks that quotes balance and that every `$(` is closed on the same
 * line. Escaped quotes and quoted characters are consumed so `echo "a\"b"`
 * and `echo "it's"` are not misread as unbalanced.
 *
 * @param {string} line one physical line of an emulator script, comments
 *   already stripped
 * @returns {boolean}
 */
export function isSelfContainedLine(line) {
  // A small context stack rather than a quote flag: inside a double quote,
  // `$(` still opens a command substitution (which is exactly what
  // `flows="$(node -e "` did), while inside a single quote nothing is
  // special. Getting that wrong reads the failing line as balanced.
  const stack = [];
  const top = () => stack[stack.length - 1];

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (top() === "'") {
      if (ch === "'") stack.pop();
      continue;
    }

    if (ch === "\\") {
      i++;
      continue;
    }

    if (top() === '"') {
      if (ch === '"') stack.pop();
      else if (ch === "$" && line[i + 1] === "(") {
        stack.push("$(");
        i++;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      stack.push(ch);
      continue;
    }
    if (ch === "$" && line[i + 1] === "(") {
      stack.push("$(");
      i++;
      continue;
    }
    if (ch === ")" && top() === "$(") stack.pop();
  }

  return stack.length === 0 && !line.trimEnd().endsWith("\\");
}

/** `set -e`, `set -eu`, `set -o ...` — configures a shell that exits at the
 * end of the line it is on, so it protects nothing and misleads the reader
 * into thinking the script is guarded. */
const USELESS_SET_PATTERN = /^\s*set\s+-/;

/**
 * @typedef {{ path: string, bashism: string, reason: string }} EmulatorScriptViolation
 */

/**
 * @param {{ path: string, content: string }[]} workflows
 * @returns {EmulatorScriptViolation[]}
 */
export function findEmulatorScriptViolations(workflows) {
  const violations = [];
  for (const workflow of workflows) {
    for (const script of extractEmulatorScriptBlocks(workflow.content)) {
      const code = stripShellComments(script);
      for (const bashism of BASHISMS) {
        if (bashism.pattern.test(code)) {
          violations.push({ path: workflow.path, bashism: bashism.id, reason: bashism.reason });
        }
      }
      for (const line of splitLines(code)) {
        if (line.trim() === "") continue;
        if (USELESS_SET_PATTERN.test(line)) {
          violations.push({
            path: workflow.path,
            bashism: "useless-set",
            reason:
              `\`${line.trim()}\` configures a shell that exits at the end of this one line. ` +
              "Delete it: the action already fails the step on any line's non-zero exit.",
          });
        }
        if (!isSelfContainedLine(line)) {
          violations.push({
            path: workflow.path,
            bashism: "not-self-contained",
            reason:
              `\`${line.trim()}\` cannot run on its own (unbalanced quote, unclosed \`$(\`, or ` +
              "a trailing backslash). Each line is executed as its own `sh -c`.",
          });
        }
      }
    }
  }
  return violations;
}

/**
 * @param {string[]} trackedPaths output of `git ls-files`
 * @returns {string[]}
 */
export function selectWorkflowFiles(trackedPaths) {
  return trackedPaths.filter((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path));
}

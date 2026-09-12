/**
 * Composer `@file` / `@skill` references (T389, plan.md §8.3/§10.4).
 *
 * A user types `@` followed by a token; a candidate list offers files and
 * skills whose ids match that token; choosing one rewrites the token as
 * plain `@id` text. This module is the platform-neutral half of that
 * feature: detection, filtering, insertion, and resolution are pure
 * functions over strings, and the candidate *listing* is a narrow port an
 * app supplies (web: the daemon's existing `listDirectory`; Android: its
 * own listing path once it has one). Core never invents file paths or
 * skill names — with no source supplied, the candidate list is simply
 * empty.
 *
 * Repository invariant: no React, React Native, Expo, DOM types, or
 * browser globals.
 */

/** The two reference kinds a composer token can resolve to. */
export type ReferenceKind = "file" | "skill";

/** One item the `@` candidate list can offer. */
export interface ReferenceCandidate {
  kind: ReferenceKind;
  /**
   * Stable id within its kind — a workspace-relative path for a file, a
   * skill name for a skill. This is what the inserted `@id` text names and
   * what `findResolvedReferences` matches against.
   */
  id: string;
  /** Text shown in the candidate list (and, for a resolved reference, on its chip). */
  label: string;
  /** Literal text inserted into the draft; defaults to `` `@${id}` ``. */
  insertText?: string;
  /** Optional one-line detail shown beside the label. */
  description?: string;
}

/**
 * An open `@` token under the caret. `start`/`end` bound the text a
 * selection should replace; `query` is what has been typed so far.
 */
export interface ReferenceToken {
  /** Index of the `@` in the draft. */
  start: number;
  /** Exclusive end of the whole token (the next whitespace, or the draft end). */
  end: number;
  /** Text typed after `@` up to the caret, with any `kind:` scope removed. */
  query: string;
  /** Explicit `file:`/`skill:` scope, or `null` when the token is unscoped. */
  kind: ReferenceKind | null;
}

/** The result of choosing a candidate: the new draft and where the caret belongs. */
export interface ReferenceInsertion {
  /** The full draft text with the token replaced by the candidate. */
  text: string;
  /** Caret offset into `text`, just after the inserted reference. */
  caret: number;
}

/** A reference already present in the draft, matched against a known candidate. */
export interface ResolvedReference {
  candidate: ReferenceCandidate;
  /** Index of the `@` in the draft. */
  start: number;
  /** Exclusive end of the matched token. */
  end: number;
}

/**
 * Lists the `@file` candidates an app can resolve. The app decides how
 * (web walks the daemon's `listDirectory` within a bound); core only
 * consumes the result.
 */
export interface ReferenceFileSource {
  /**
   * Resolves the file candidates for the active session. A source that
   * cannot list anything resolves to an empty array rather than rejecting,
   * so a missing/unauthorized workspace simply yields no file suggestions.
   */
  listFiles(): Promise<readonly ReferenceCandidate[]>;
}

/** Lists the `@skill` candidates an app can resolve (web: `listCommands`' `skill` entries). */
export interface ReferenceSkillSource {
  /** Resolves the skill candidates for the active session. Never rejects; `[]` when unsupported. */
  listSkills(): Promise<readonly ReferenceCandidate[]>;
}

/** The optional listing ports a caller can supply to `loadReferenceCandidates`. */
export interface ReferenceCandidateSources {
  files?: ReferenceFileSource;
  skills?: ReferenceSkillSource;
}

/**
 * Loads and concatenates every candidate the supplied sources can resolve.
 * Both lookups run in parallel; an omitted source contributes nothing.
 */
export async function loadReferenceCandidates(
  sources: ReferenceCandidateSources,
): Promise<readonly ReferenceCandidate[]> {
  const [files, skills] = await Promise.all([
    sources.files?.listFiles() ?? Promise.resolve([]),
    sources.skills?.listSkills() ?? Promise.resolve([]),
  ]);
  return [...files, ...skills];
}

/** `kind:` prefixes a query can start with to scope the candidate list. */
const KIND_SCOPES: ReadonlyArray<readonly [string, ReferenceKind]> = [
  ["file:", "file"],
  ["skill:", "skill"],
];

/** A reference token must start at the draft start or after whitespace, so `me@example.com` is never one. */
function isReferenceBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  return /\s/.test(text[index - 1] ?? "");
}

/** Index one past the last non-whitespace character starting at `from`. */
function tokenRunEnd(text: string, from: number): number {
  let end = from;
  while (end < text.length && !/\s/.test(text[end] ?? "")) {
    end += 1;
  }
  return end;
}

/**
 * Finds the `@` token the caret sits in, or `null` when it does not sit in
 * one. A token still counts while `@` is bare (empty query), so typing `@`
 * alone opens the list; it stops counting as soon as a space separates the
 * caret from the `@`.
 *
 * The returned `end` runs to the end of the whole token, not just to the
 * caret, so choosing a candidate replaces the complete `@...` text even
 * when the caret was placed in the middle of it.
 */
export function detectReferenceToken(
  text: string,
  caret: number = text.length,
): ReferenceToken | null {
  const position = Math.max(0, Math.min(caret, text.length));
  for (let index = position - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (/\s/.test(char ?? "")) return null;
    if (char !== "@") continue;
    if (!isReferenceBoundary(text, index)) return null;
    const raw = text.slice(index + 1, position);
    const scope = KIND_SCOPES.find(([prefix]) => raw.toLowerCase().startsWith(prefix));
    return {
      start: index,
      end: tokenRunEnd(text, position),
      query: scope ? raw.slice(scope[0].length) : raw,
      kind: scope ? scope[1] : null,
    };
  }
  return null;
}

/** Options accepted by `filterReferenceCandidates`. */
export interface FilterReferenceOptions {
  /** Caps how many candidates are returned (the UI list length). */
  limit?: number;
}

/**
 * Filters `candidates` against `token`: a `kind:` scope restricts to that
 * kind, and the query matches an id, label, or description substring
 * case-insensitively. Id-prefix matches sort first so `@src/` surfaces
 * `src/...` before a path that merely contains "src" elsewhere.
 */
export function filterReferenceCandidates(
  candidates: readonly ReferenceCandidate[],
  token: ReferenceToken,
  options: FilterReferenceOptions = {},
): ReferenceCandidate[] {
  const query = token.query.toLowerCase();
  const matches = candidates.filter((candidate) => {
    if (token.kind !== null && candidate.kind !== token.kind) return false;
    if (query.length === 0) return true;
    return (
      candidate.id.toLowerCase().includes(query) ||
      candidate.label.toLowerCase().includes(query) ||
      (candidate.description?.toLowerCase().includes(query) ?? false)
    );
  });
  matches.sort((a, b) => {
    const aPrefix = a.id.toLowerCase().startsWith(query) ? 0 : 1;
    const bPrefix = b.id.toLowerCase().startsWith(query) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return a.id.localeCompare(b.id);
  });
  return options.limit === undefined ? matches : matches.slice(0, options.limit);
}

/**
 * Replaces `token` in `text` with `candidate`'s `@id` (or its own
 * `insertText`) plus a trailing space, and reports where the caret should
 * land — always plain text, never a structured node: the draft the daemon
 * receives is exactly what the user sees.
 */
export function insertReference(
  text: string,
  token: ReferenceToken,
  candidate: ReferenceCandidate,
): ReferenceInsertion {
  const inserted = `${candidate.insertText ?? `@${candidate.id}`} `;
  return {
    text: text.slice(0, token.start) + inserted + text.slice(token.end),
    caret: token.start + inserted.length,
  };
}

/** Trailing punctuation that ends a sentence, not a reference id. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/**
 * Finds every already-typed `@` token in `text` that exactly names a known
 * candidate, in document order. Used to render a chip for each resolved
 * reference; an `@` that names nothing stays ordinary text.
 */
export function findResolvedReferences(
  text: string,
  candidates: readonly ReferenceCandidate[],
): ResolvedReference[] {
  if (candidates.length === 0) return [];
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const resolved: ResolvedReference[] = [];
  let index = text.indexOf("@");
  while (index !== -1) {
    if (isReferenceBoundary(text, index)) {
      const end = tokenRunEnd(text, index + 1);
      const run = text.slice(index + 1, end).replace(TRAILING_PUNCTUATION, "");
      const candidate = byId.get(run);
      if (candidate) resolved.push({ candidate, start: index, end });
    }
    index = text.indexOf("@", index + 1);
  }
  return resolved;
}

/**
 * Removes a resolved reference (and a single trailing space, when present)
 * from the draft, returning the new text and caret position. Lets a chip's
 * remove control edit the draft instead of leaving a stale `@id` behind.
 */
export function removeReference(
  text: string,
  reference: ResolvedReference,
): { text: string; caret: number } {
  const end = text[reference.end] === " " ? reference.end + 1 : reference.end;
  return {
    text: text.slice(0, reference.start) + text.slice(end),
    caret: reference.start,
  };
}

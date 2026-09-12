import { useEffect, useMemo, useRef, useState } from "react";

import { composer as coreComposer } from "@picompanion/frontend-core";

/**
 * `@file` / `@skill` completion state for the composer (T389).
 *
 * The detection/filtering/insertion rules live in
 * `@picompanion/frontend-core`'s `composer.references` module — this hook
 * is only the React lifecycle around them: it resolves the candidate list
 * from whatever ports the app supplies, tracks the highlighted option, and
 * hands the caller a plain-text insertion when one is chosen.
 *
 * Candidate loading is lazy (the first open `@` token triggers it) and
 * cached per source identity, so merely mounting a composer does no daemon
 * work. A missing source is not an error: the list is simply empty, and the
 * UI documents that instead of inventing entries.
 */

/** How many candidates the list shows at once. */
export const DEFAULT_REFERENCE_CANDIDATE_LIMIT = 22;

export interface UseComposerReferencesOptions {
  /** The composer's current draft text. */
  draftText: string;
  /** Caret offset into `draftText`; the token is detected from here. */
  caret: number;
  /** Optional `@file` listing port (web: `createReferenceFileSource`). */
  files?: coreComposer.ReferenceFileSource;
  /**
   * Skill candidates already resolved for this session — web derives them
   * from the same `listCommands` result the slash palette uses, rather than
   * listing twice.
   */
  skills?: readonly coreComposer.ReferenceCandidate[];
  /** Overridable for tests; defaults to `DEFAULT_REFERENCE_CANDIDATE_LIMIT`. */
  limit?: number;
}

export interface ComposerReferencesState {
  /** The open `@` token under the caret, or `null`. */
  token: coreComposer.ReferenceToken | null;
  /** The filtered candidates for the open token (empty when there is none). */
  candidates: readonly coreComposer.ReferenceCandidate[];
  /** `true` while the candidate list should be shown. */
  isOpen: boolean;
  /** Index of the highlighted candidate within `candidates`. */
  activeIndex: number;
  /** The highlighted candidate, or `undefined` when the list is empty. */
  activeCandidate: coreComposer.ReferenceCandidate | undefined;
  /** Every reference already present in the draft that names a known candidate. */
  resolved: readonly coreComposer.ResolvedReference[];
  /** Moves the highlight, clamped to the list bounds. */
  moveActive: (delta: number) => void;
  /** Hides the list for the current token (Escape), until the token changes. */
  dismiss: () => void;
  /**
   * Chooses `candidate` (default: the highlighted one) and returns the
   * plain-text insertion, or `null` if there is nothing to choose.
   */
  choose: (candidate?: coreComposer.ReferenceCandidate) => coreComposer.ReferenceInsertion | null;
}

/** Stable empty default so the memo identities below do not change every render. */
const EMPTY_CANDIDATES: readonly coreComposer.ReferenceCandidate[] = [];

export function useComposerReferences(
  options: UseComposerReferencesOptions,
): ComposerReferencesState {
  const {
    draftText,
    caret,
    files,
    skills = EMPTY_CANDIDATES,
    limit = DEFAULT_REFERENCE_CANDIDATE_LIMIT,
  } = options;

  const [fileCandidates, setFileCandidates] = useState<readonly coreComposer.ReferenceCandidate[]>(
    [],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const loadedSourceRef = useRef<coreComposer.ReferenceFileSource | null>(null);

  const token = useMemo(
    () => coreComposer.detectReferenceToken(draftText, caret),
    [draftText, caret],
  );

  // Resolve file candidates lazily, on the first open token, and cache them
  // for the lifetime of this source. A failed/absent listing yields no file
  // suggestions rather than an error.
  const hasToken = token !== null;
  useEffect(() => {
    if (!files || !hasToken || loadedSourceRef.current === files) return;
    loadedSourceRef.current = files;
    let cancelled = false;
    void files.listFiles().then(
      (list) => {
        if (!cancelled) setFileCandidates(list);
      },
      () => {
        if (!cancelled) setFileCandidates([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [files, hasToken]);

  const allCandidates = useMemo(() => [...fileCandidates, ...skills], [fileCandidates, skills]);

  const candidates = useMemo(
    () =>
      token === null ? [] : coreComposer.filterReferenceCandidates(allCandidates, token, { limit }),
    [allCandidates, token, limit],
  );

  const resolved = useMemo(
    () => coreComposer.findResolvedReferences(draftText, allCandidates),
    [draftText, allCandidates],
  );

  // A new token (a different `@`, or more typed after it) re-opens a list the
  // user had dismissed; the same token stays dismissed.
  useEffect(() => {
    setDismissed(false);
  }, [token?.start, token?.query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [token?.start, token?.query, candidates.length]);

  const isOpen = token !== null && candidates.length > 0 && !dismissed;
  const activeCandidate = candidates[activeIndex];

  function moveActive(delta: number): void {
    setActiveIndex((index) => {
      const next = index + delta;
      return Math.max(0, Math.min(next, candidates.length - 1));
    });
  }

  function dismiss(): void {
    setDismissed(true);
  }

  function choose(
    candidate: coreComposer.ReferenceCandidate | undefined = activeCandidate,
  ): coreComposer.ReferenceInsertion | null {
    if (token === null || candidate === undefined) return null;
    setDismissed(true);
    return coreComposer.insertReference(draftText, token, candidate);
  }

  return {
    token,
    candidates,
    isOpen,
    activeIndex,
    activeCandidate,
    resolved,
    moveActive,
    dismiss,
    choose,
  };
}

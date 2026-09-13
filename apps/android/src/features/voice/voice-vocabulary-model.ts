/**
 * User-maintained voice vocabulary (this task).
 *
 * RN-free, like every other `-model.ts` in this workspace
 * (`voice-model.ts`, `../settings/settings-model.ts`), so both the
 * persisted store and the repair pass below are unit-testable without a
 * device, an emulator, or a socket. The thin view over the store is
 * `VoiceVocabularySection` (`./voice-vocabulary-section.tsx`), mounted
 * as one section of `../settings/SettingsScreen.tsx`.
 *
 * ## What this is
 *
 * `voice-model.ts`'s `cleanTranscript` used to do no custom-word repair
 * at all — its header named the missing piece exactly: a
 * user-maintained vocabulary list this product had no UI for. This
 * module is that list: user-added words and phrases (names, project
 * words, spellings transcription keeps getting wrong), persisted as one
 * JSON envelope under `VOICE_VOCABULARY_STORAGE_KEY`, plus the
 * deterministic repair pass `voice-model.ts`'s `requestStop` applies to
 * every transcript after cleanup.
 *
 * ## What the repair pass is (and is not)
 *
 * `applyVoiceVocabularyRepair` rewrites case-insensitive, whole-word
 * matches of the saved entries to the saved canonical spelling
 * ("kubernetes" → "Kubernetes", "new york" → "New York") — longest
 * entries first, so a phrase always wins over a word it contains. It is
 * still NOT `D:\Handy`'s `audio_toolkit/text.rs` custom-word repair
 * (Levenshtein distance + Soundex phonetics): fuzzy phonetic matching
 * rewrites words the speaker never said, trading one transcription
 * error for a new one, while the deterministic pass fixes the failure
 * mode a vocabulary list can actually own — the model heard the right
 * word but wrote it wrong — without that trade. Concretely, the pass
 * can never invent text: every replacement's letters (up to casing)
 * already appear in the transcript at that position, so a transcript
 * containing none of the entries comes back byte-identical, and an
 * empty vocabulary is the identity function. Word boundaries are ASCII
 * (`A-Za-z0-9_`): enough for the names and project words this list
 * holds, documented here so a future entry with word-internal
 * non-ASCII neighbours knows where to look.
 *
 * ## Persistence
 *
 * Goes through the *existing* `AppCore.keyValueStorage` abstraction
 * (`@picompanion/frontend-core`'s `KeyValueStorage`) under its own key
 * — never `AsyncStorage` directly, never a second storage module,
 * matching `onboarding-model.ts` and `settings-model.ts` exactly. The
 * default when storage is missing, unreadable, or malformed is an empty
 * list (mirroring `settings-model.ts`'s four-failure-shapes rule):
 * failing to read must never block transcription, it just means the
 * repair pass has nothing to match against.
 *
 * Unlike `settings-model.ts`, `persist()` runs no secret-shaped guard:
 * an entry is a display string the settings UI reads back verbatim, and
 * refusing to save a word the user explicitly typed would silently
 * discard their data. A secret-shaped *transcript* is still annotated
 * (never blocked) at draft time by `voice-model.ts`'s own
 * `looksSecretShaped` field.
 *
 * ## Limits
 *
 * `MAX_VOICE_VOCABULARY_ENTRIES` (100) and
 * `MAX_VOICE_VOCABULARY_ENTRY_LENGTH` (60) keep the settings list
 * renderable and the repair pass — one regex per entry over a single
 * sentence — trivially cheap. Both are enforced in `addWord` (with an
 * explicit reason per rejection, so the UI never renders a generic
 * "couldn't save") and re-applied when sanitising whatever `load()`
 * finds, so entries written around this module can never grow the live
 * list past either bound.
 */
import type { KeyValueStorage } from "@picompanion/frontend-core";

export const VOICE_VOCABULARY_STORAGE_KEY = "picompanion.voice-vocabulary.v1";

/** See this module's "Limits" section. */
export const MAX_VOICE_VOCABULARY_ENTRIES = 100;
/** See this module's "Limits" section. */
export const MAX_VOICE_VOCABULARY_ENTRY_LENGTH = 60;

interface PersistedVoiceVocabulary {
  version: 1;
  words: string[];
}

/**
 * The single canonicalisation every entry goes through — on the way in
 * (`addWord`/`removeWord`), when sanitising a loaded envelope, and
 * before matching in `applyVoiceVocabularyRepair`, so all three agree
 * on what an entry is. Collapses runs of whitespace (a pasted phrase
 * with a stray newline is still one phrase) and trims the ends; `""`
 * means "not an entry".
 */
export function normalizeVoiceVocabularyEntry(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function sanitizeWordList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const entry = normalizeVoiceVocabularyEntry(item);
    if (entry.length === 0 || entry.length > MAX_VOICE_VOCABULARY_ENTRY_LENGTH) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(entry);
    if (words.length >= MAX_VOICE_VOCABULARY_ENTRIES) break;
  }
  return words;
}

function isPersistedVoiceVocabulary(value: unknown): value is PersistedVoiceVocabulary {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record["version"] === 1 && Array.isArray(record["words"]);
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deterministic custom-word repair — see this module's header for the
 * scope argument (canonical-casing repair only, never fuzzy phonetics,
 * never an LLM). For each saved entry, rewrites every
 * case-insensitive whole-word occurrence to the saved canonical
 * spelling. Entries run longest-first so a phrase wins over a word it
 * contains; matching is a pure function of `(text, vocabulary)` with no
 * storage access, so `voice-model.ts` calls it with whatever the caller
 * passed as `VoiceCaptureControllerDeps.vocabulary`.
 *
 * A `(_match, prefix)` replacer function (rather than a `$1`-bearing
 * replacement string) keeps entries containing `$` literal, and the
 * ASCII-boundary prefix is a capture group (rather than a lookbehind)
 * so this also runs on older Hermes builds without lookbehind support
 * — the suffix is a zero-width lookahead, which every Hermes has.
 */
export function applyVoiceVocabularyRepair(text: string, vocabulary: readonly string[]): string {
  if (text.length === 0 || vocabulary.length === 0) {
    return text;
  }
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const raw of vocabulary) {
    const entry = normalizeVoiceVocabularyEntry(raw);
    if (entry.length === 0) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  if (entries.length === 0) {
    return text;
  }
  entries.sort((a, b) => b.length - a.length);

  let repaired = text;
  for (const entry of entries) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(entry)}(?![A-Za-z0-9_])`, "gi");
    repaired = repaired.replace(pattern, (_match, prefix: string) => prefix + entry);
  }
  return repaired;
}

export interface VoiceVocabularySnapshot {
  /** Insertion order (oldest first), a fresh copy on every publish — never the controller's live array. */
  words: string[];
  /** False until `load()` has resolved once. Reads before then see `[]`, never `undefined`. */
  loaded: boolean;
  /** Set when `load()` fell back to `[]` because of a missing/malformed/throwing read. Never reset by a later successful `addWord`/`removeWord` within the same controller instance — mirrors `SettingsSnapshot.loadError`'s convention. */
  loadError: boolean;
}

export type VoiceVocabularySnapshotListener = (snapshot: VoiceVocabularySnapshot) => void;

export type VoiceVocabularyAddResult =
  | { added: true }
  | { added: false; reason: "empty" | "duplicate" | "too-long" | "full" };

export interface VoiceVocabularyController {
  getSnapshot(): VoiceVocabularySnapshot;
  subscribe(listener: VoiceVocabularySnapshotListener): () => void;
  /** Reads persisted state (or falls back to `[]`) and publishes the resulting snapshot. Call once, from the section's mount effect — mirrors `OnboardingController.load()`. */
  load(): Promise<void>;
  /**
   * Adds one entry, normalising it first. Rejections carry the reason
   * (`"empty"` for blank input, `"duplicate"` for a case-insensitive
   * match of a saved entry, `"too-long"`, `"full"`) so the caller can
   * say exactly what happened instead of a generic failure.
   */
  addWord(raw: string): Promise<VoiceVocabularyAddResult>;
  /** Removes the case-insensitive match of `raw`. Returns whether anything was removed (and persisted). */
  removeWord(raw: string): Promise<boolean>;
}

export interface VoiceVocabularyControllerDeps {
  storage: KeyValueStorage;
}

export function createVoiceVocabularyController(
  deps: VoiceVocabularyControllerDeps,
): VoiceVocabularyController {
  let words: string[] = [];
  let loaded = false;
  let loadError = false;
  const listeners = new Set<VoiceVocabularySnapshotListener>();

  function publish(): void {
    const snapshot: VoiceVocabularySnapshot = { words: [...words], loaded, loadError };
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  async function persist(): Promise<void> {
    const record: PersistedVoiceVocabulary = { version: 1, words };
    await deps.storage.setItem(VOICE_VOCABULARY_STORAGE_KEY, JSON.stringify(record));
  }

  return {
    getSnapshot: () => ({ words: [...words], loaded, loadError }),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async load() {
      let raw: string | null;
      try {
        raw = await deps.storage.getItem(VOICE_VOCABULARY_STORAGE_KEY);
      } catch {
        words = [];
        loaded = true;
        loadError = true;
        publish();
        return;
      }

      if (raw === null) {
        words = [];
        loaded = true;
        publish();
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        words = [];
        loaded = true;
        loadError = true;
        publish();
        return;
      }

      if (!isPersistedVoiceVocabulary(parsed)) {
        words = [];
        loaded = true;
        loadError = true;
        publish();
        return;
      }

      words = sanitizeWordList(parsed.words);
      loaded = true;
      publish();
    },
    async addWord(raw) {
      const entry = normalizeVoiceVocabularyEntry(raw);
      if (entry.length === 0) {
        return { added: false, reason: "empty" };
      }
      if (entry.length > MAX_VOICE_VOCABULARY_ENTRY_LENGTH) {
        return { added: false, reason: "too-long" };
      }
      if (words.some((saved) => saved.toLowerCase() === entry.toLowerCase())) {
        return { added: false, reason: "duplicate" };
      }
      if (words.length >= MAX_VOICE_VOCABULARY_ENTRIES) {
        return { added: false, reason: "full" };
      }
      words = [...words, entry];
      await persist();
      publish();
      return { added: true };
    },
    async removeWord(raw) {
      const entry = normalizeVoiceVocabularyEntry(raw);
      if (entry.length === 0) {
        return false;
      }
      const key = entry.toLowerCase();
      const next = words.filter((saved) => saved.toLowerCase() !== key);
      if (next.length === words.length) {
        return false;
      }
      words = next;
      await persist();
      publish();
      return true;
    },
  };
}

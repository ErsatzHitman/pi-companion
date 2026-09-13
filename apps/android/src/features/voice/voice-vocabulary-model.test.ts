import { describe, expect, it } from "vitest";

import type { KeyValueStorage } from "@picompanion/frontend-core";

import {
  applyVoiceVocabularyRepair,
  createVoiceVocabularyController,
  MAX_VOICE_VOCABULARY_ENTRIES,
  MAX_VOICE_VOCABULARY_ENTRY_LENGTH,
  normalizeVoiceVocabularyEntry,
  VOICE_VOCABULARY_STORAGE_KEY,
} from "./voice-vocabulary-model";

/** In-memory `KeyValueStorage` fake — mirrors `../settings/settings-model.test.ts`'s `makeMemoryStorage`. */
function makeMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const store = new Map(Object.entries(initial));
  return {
    async getItem(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
    async removeItem(key) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
    async keys(prefix) {
      const all = [...store.keys()];
      return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
    },
  };
}

/** A `KeyValueStorage` whose `getItem` always rejects. */
function makeThrowingStorage(): KeyValueStorage {
  return {
    async getItem() {
      throw new Error("simulated storage read failure");
    },
    async setItem() {},
    async removeItem() {},
    async clear() {},
    async keys() {
      return [];
    },
  };
}

describe("normalizeVoiceVocabularyEntry", () => {
  it("trims the ends and collapses runs of whitespace, including newlines", () => {
    expect(normalizeVoiceVocabularyEntry("  New   York\n")).toBe("New York");
  });

  it("a blank string normalises to empty — the model's own 'not an entry' signal", () => {
    expect(normalizeVoiceVocabularyEntry("   \n\t  ")).toBe("");
  });

  it("leaves an already-clean entry untouched", () => {
    expect(normalizeVoiceVocabularyEntry("Kubernetes")).toBe("Kubernetes");
  });
});

describe("applyVoiceVocabularyRepair (deterministic custom-word correction)", () => {
  it("rewrites a case-insensitive whole-word match to the saved canonical spelling", () => {
    expect(applyVoiceVocabularyRepair("deploy to kubernetes", ["Kubernetes"])).toBe(
      "deploy to Kubernetes",
    );
  });

  it("fixes every occurrence, at the start, middle, and end of the text", () => {
    expect(
      applyVoiceVocabularyRepair("kubernetes down, check kubernetes now kubernetes", [
        "Kubernetes",
      ]),
    ).toBe("Kubernetes down, check Kubernetes now Kubernetes");
  });

  it("leaves already-canonical text byte-identical", () => {
    expect(applyVoiceVocabularyRepair("deploy to Kubernetes", ["Kubernetes"])).toBe(
      "deploy to Kubernetes",
    );
  });

  it("repairs a multi-word phrase to its saved capitalisation", () => {
    expect(applyVoiceVocabularyRepair("fly to new york tomorrow", ["New York"])).toBe(
      "fly to New York tomorrow",
    );
  });

  it("a phrase wins over a word it contains", () => {
    expect(applyVoiceVocabularyRepair("fly to new york", ["York", "New York"])).toBe(
      "fly to New York",
    );
  });

  it("never rewrites a substring of a longer word", () => {
    expect(applyVoiceVocabularyRepair("superkubernetes cluster", ["Kubernetes"])).toBe(
      "superkubernetes cluster",
    );
    expect(applyVoiceVocabularyRepair("yorkshire pudding", ["York"])).toBe("yorkshire pudding");
  });

  it("still repairs before a possessive — the apostrophe is a boundary, not a word char", () => {
    expect(applyVoiceVocabularyRepair("kubernetes's logs", ["Kubernetes"])).toBe(
      "Kubernetes's logs",
    );
  });

  it("entries containing regex syntax are matched literally, not as a pattern", () => {
    expect(applyVoiceVocabularyRepair("i use node.js daily", ["Node.js"])).toBe(
      "i use Node.js daily",
    );
    expect(applyVoiceVocabularyRepair("i write c++ daily", ["C++"])).toBe("i write C++ daily");
  });

  it("never invents: a near-miss the vocabulary does not contain is returned unchanged", () => {
    expect(applyVoiceVocabularyRepair("koobrenetes are down", ["Kubernetes"])).toBe(
      "koobrenetes are down",
    );
  });

  it("an empty vocabulary is the identity function", () => {
    expect(applyVoiceVocabularyRepair("deploy to kubernetes", [])).toBe("deploy to kubernetes");
  });

  it("blank vocabulary entries are skipped, never matched as empty patterns", () => {
    expect(applyVoiceVocabularyRepair("deploy to kubernetes", ["   ", "Kubernetes"])).toBe(
      "deploy to Kubernetes",
    );
  });

  it("empty text stays empty regardless of vocabulary", () => {
    expect(applyVoiceVocabularyRepair("", ["Kubernetes"])).toBe("");
  });

  it("duplicate entries (up to casing) keep the FIRST canonical spelling", () => {
    expect(applyVoiceVocabularyRepair("kubernetes", ["kubernetes", "Kubernetes"])).toBe(
      "kubernetes",
    );
  });

  it("an entry containing `$` is replaced literally — the replacer is a function, not a `$1` template", () => {
    expect(applyVoiceVocabularyRepair("price is te$la low", ["TE$LA"])).toBe("price is TE$LA low");
  });
});

describe("createVoiceVocabularyController: the default-value rule", () => {
  it("missing key: resolves to an empty list, no loadError", async () => {
    const controller = createVoiceVocabularyController({ storage: makeMemoryStorage() });
    expect(controller.getSnapshot()).toEqual({ words: [], loaded: false, loadError: false });
    await controller.load();
    expect(controller.getSnapshot()).toEqual({ words: [], loaded: true, loadError: false });
  });

  it("malformed JSON: resolves to an empty list with loadError true", async () => {
    const storage = makeMemoryStorage({ [VOICE_VOCABULARY_STORAGE_KEY]: "{not json" });
    const controller = createVoiceVocabularyController({ storage });
    await controller.load();
    expect(controller.getSnapshot()).toEqual({ words: [], loaded: true, loadError: true });
  });

  it("wrong-shaped envelope (words not an array): resolves to an empty list with loadError true", async () => {
    const storage = makeMemoryStorage({
      [VOICE_VOCABULARY_STORAGE_KEY]: JSON.stringify({ version: 1, words: "Kubernetes" }),
    });
    const controller = createVoiceVocabularyController({ storage });
    await controller.load();
    expect(controller.getSnapshot()).toEqual({ words: [], loaded: true, loadError: true });
  });

  it("unknown version envelope is treated as malformed, not silently accepted", async () => {
    const storage = makeMemoryStorage({
      [VOICE_VOCABULARY_STORAGE_KEY]: JSON.stringify({ version: 2, words: ["Kubernetes"] }),
    });
    const controller = createVoiceVocabularyController({ storage });
    await controller.load();
    expect(controller.getSnapshot()).toEqual({ words: [], loaded: true, loadError: true });
  });

  it("storage read throws: resolves to an empty list with loadError true — transcription still works, the repair just has nothing to match", async () => {
    const controller = createVoiceVocabularyController({ storage: makeThrowingStorage() });
    await controller.load();
    expect(controller.getSnapshot()).toEqual({ words: [], loaded: true, loadError: true });
  });

  it("load() sanitises a hostile envelope instead of adopting it: drops blanks, non-strings, overlong entries and duplicates, and caps the list", async () => {
    const hostile = JSON.stringify({
      version: 1,
      words: [
        "  Kubernetes  ",
        "",
        "   ",
        42,
        null,
        "kubernetes",
        "x".repeat(MAX_VOICE_VOCABULARY_ENTRY_LENGTH + 1),
        ...Array.from({ length: MAX_VOICE_VOCABULARY_ENTRIES + 5 }, (_, i) => `word-${i}`),
      ],
    });
    const storage = makeMemoryStorage({ [VOICE_VOCABULARY_STORAGE_KEY]: hostile });
    const controller = createVoiceVocabularyController({ storage });
    await controller.load();
    const snapshot = controller.getSnapshot();
    expect(snapshot.words[0]).toBe("Kubernetes");
    expect(snapshot.words).toHaveLength(MAX_VOICE_VOCABULARY_ENTRIES);
    expect(snapshot.words).not.toContain("");
    expect(snapshot.loadError).toBe(false);
  });
});

describe("createVoiceVocabularyController: add/remove", () => {
  it("addWord normalises, persists the envelope, and publishes immediately", async () => {
    const storage = makeMemoryStorage();
    const controller = createVoiceVocabularyController({ storage });
    await controller.load();

    const result = await controller.addWord("  New   York ");
    expect(result).toEqual({ added: true });
    expect(controller.getSnapshot().words).toEqual(["New York"]);
    expect(await storage.getItem(VOICE_VOCABULARY_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, words: ["New York"] }),
    );
  });

  it("addWord rejects blank input without touching storage", async () => {
    const storage = makeMemoryStorage();
    const controller = createVoiceVocabularyController({ storage });
    await controller.load();

    expect(await controller.addWord("   ")).toEqual({ added: false, reason: "empty" });
    expect(await storage.getItem(VOICE_VOCABULARY_STORAGE_KEY)).toBeNull();
  });

  it("addWord rejects a case-insensitive duplicate without a second persist", async () => {
    const storage = makeMemoryStorage();
    const controller = createVoiceVocabularyController({ storage });
    await controller.load();
    await controller.addWord("Kubernetes");
    const before = await storage.getItem(VOICE_VOCABULARY_STORAGE_KEY);

    expect(await controller.addWord("KUBERNETES")).toEqual({ added: false, reason: "duplicate" });
    expect(controller.getSnapshot().words).toEqual(["Kubernetes"]);
    expect(await storage.getItem(VOICE_VOCABULARY_STORAGE_KEY)).toBe(before);
  });

  it("addWord rejects an entry past the length bound", async () => {
    const storage = makeMemoryStorage();
    const controller = createVoiceVocabularyController({ storage });
    await controller.load();

    expect(await controller.addWord("x".repeat(MAX_VOICE_VOCABULARY_ENTRY_LENGTH + 1))).toEqual({
      added: false,
      reason: "too-long",
    });
    expect(controller.getSnapshot().words).toEqual([]);
  });

  it("addWord rejects once the list is full", async () => {
    const storage = makeMemoryStorage();
    const controller = createVoiceVocabularyController({ storage });
    await controller.load();
    for (let i = 0; i < MAX_VOICE_VOCABULARY_ENTRIES; i += 1) {
      const result = await controller.addWord(`word-${i}`);
      expect(result).toEqual({ added: true });
    }

    expect(await controller.addWord("one-too-many")).toEqual({ added: false, reason: "full" });
    expect(controller.getSnapshot().words).toHaveLength(MAX_VOICE_VOCABULARY_ENTRIES);
  });

  it("removeWord removes the case-insensitive match and persists", async () => {
    const storage = makeMemoryStorage();
    const controller = createVoiceVocabularyController({ storage });
    await controller.load();
    await controller.addWord("Kubernetes");
    await controller.addWord("macOS");

    expect(await controller.removeWord("KUBERNETES")).toBe(true);
    expect(controller.getSnapshot().words).toEqual(["macOS"]);
    expect(await storage.getItem(VOICE_VOCABULARY_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, words: ["macOS"] }),
    );
  });

  it("removeWord reports false and writes nothing when nothing matches", async () => {
    const storage = makeMemoryStorage();
    const controller = createVoiceVocabularyController({ storage });
    await controller.load();
    await controller.addWord("Kubernetes");
    const before = await storage.getItem(VOICE_VOCABULARY_STORAGE_KEY);

    expect(await controller.removeWord("nonexistent")).toBe(false);
    expect(await controller.removeWord("   ")).toBe(false);
    expect(await storage.getItem(VOICE_VOCABULARY_STORAGE_KEY)).toBe(before);
  });

  it("survives a cold start: a second controller over the same storage reads back what the first wrote", async () => {
    const storage = makeMemoryStorage();
    const first = createVoiceVocabularyController({ storage });
    await first.load();
    await first.addWord("Kubernetes");

    const second = createVoiceVocabularyController({ storage });
    expect(second.getSnapshot()).toEqual({ words: [], loaded: false, loadError: false });
    await second.load();
    expect(second.getSnapshot()).toEqual({
      words: ["Kubernetes"],
      loaded: true,
      loadError: false,
    });
  });

  it("subscribe/unsubscribe: a listener sees load/add/remove snapshots, and nothing after unsubscribing", async () => {
    const storage = makeMemoryStorage();
    const controller = createVoiceVocabularyController({ storage });
    const seen: string[][] = [];
    const unsubscribe = controller.subscribe((snapshot) => seen.push(snapshot.words));

    await controller.load();
    await controller.addWord("Kubernetes");
    await controller.removeWord("kubernetes");
    unsubscribe();
    await controller.addWord("macOS");

    expect(seen).toEqual([[], ["Kubernetes"], []]);
  });

  it("snapshots are copies — mutating one never touches the controller's live list", async () => {
    const storage = makeMemoryStorage();
    const controller = createVoiceVocabularyController({ storage });
    await controller.load();
    await controller.addWord("Kubernetes");

    controller.getSnapshot().words.push("sneaky");
    expect(controller.getSnapshot().words).toEqual(["Kubernetes"]);
  });
});

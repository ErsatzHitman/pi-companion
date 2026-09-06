import { Share } from "react-native";

import type { NativeShareModule } from "./sharing.js";

/**
 * The real Android `NativeShareModule` — T78's mount of `./sharing.ts`'s
 * text-sharing half, backed by React Native's built-in `Share.share`.
 *
 * `./sharing.ts`'s own doc comment already explains why this needs no
 * uninstalled package: unlike `expo-sharing` (file sharing — not
 * installed, see that module's doc), plain-text sharing only needs
 * `react-native`'s own `Share` API, already a dependency of this app.
 * That doc comment says the real implementation is "imported at the
 * construction site" rather than inside `./sharing.ts` itself, for the
 * same reason `./haptics/vibration-platform.ts` keeps its own
 * `react-native` import out of every RN-free sibling: this workspace's
 * plain `vitest` cannot transform `react-native`'s entry point (see this
 * repo's `CLAUDE.md`'s "RN-in-vitest limitation" note), so the binding
 * itself stays this thin and swappable, and every consumer of
 * `NativeShareModule` (`./sharing.ts`, `../app-shell/core.ts`) stays
 * provable against a fake without ever importing `react-native` itself.
 *
 * `Share.share`'s real resolved shape (`{ action, activityType? }`)
 * already structurally satisfies `NativeShareModule.share`'s return
 * type, so this is a direct call-through, not a re-shaping wrapper —
 * apart from one narrow type reconciliation: RN's own `ShareContent`
 * type requires `message` whenever `url` is absent (a real API
 * constraint — Android's share sheet needs *something* to share), while
 * `NativeShareModule.share`'s `content` types it optional (matching
 * `./sharing.ts`'s `NativeShareContent`, which never sends `url` at
 * all). Every real caller (`./sharing.ts`'s `shareText`) always passes a
 * `message`, so `?? ""` here is a type-level safety net, never a
 * value this app's own callers actually hit.
 */
export function createRNShareModule(): NativeShareModule {
  return {
    share: (content, options) =>
      Share.share({ message: content.message ?? "", title: content.title }, options),
  };
}

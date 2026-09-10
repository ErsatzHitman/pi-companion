/**
 * T329 — the height the on-screen keyboard currently takes from the
 * bottom of the window, as a hook the session shell pads itself by.
 *
 * ## Why the shell has to do this itself
 *
 * `composer-focus-model.ts`'s `COMPOSER_LAYOUT_CONTRACT` promises the
 * composer "remains visible above the IME" (plan.md §9.3), and until this
 * task that promise rested on Android's `windowSoftInputMode=
 * "adjustResize"` shrinking the window around the keyboard. Under
 * edge-to-edge — mandatory for this app's target SDK (see
 * `app.config.ts`) — the window is never resized: it keeps drawing behind
 * every system inset, the IME included. Run 34444464068 measured exactly
 * that on every session-screen flow: with the keyboard open the shell
 * still spanned the full window, the keyboard covered its bottom 775px,
 * and the composer's input and send button — under the keyboard — were
 * pruned from the accessibility tree, so Maestro could not tap
 * `composer-send` and a user could not see what they were typing.
 *
 * React Native's root view still reports the keyboard through the
 * `Keyboard` module in this mode (`keyboardDidShow` carries the IME
 * height less the navigation-bar inset; `keyboardDidHide` follows), so
 * the shell applies that height as bottom padding. `KeyboardAvoidingView`
 * was considered and not used: it measures its own frame relative to its
 * PARENT and compares that with the keyboard's SCREEN position, so any
 * shell that does not start at the top of the screen (this one sits
 * under T327's top safe-area edge) pads itself short by exactly that
 * offset.
 */
import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

import { keyboardInsetFromEvent } from "./keyboard-inset-model";

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setInset(keyboardInsetFromEvent(event));
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setInset(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return inset;
}

/**
 * T329 — the RN-free half of `keyboard-inset.ts`: turns a `keyboardDidShow`
 * event's reported height into the bottom inset the session shell pads
 * itself by. Kept apart from the hook so it can be unit-tested without a
 * `react-native` import, the convention every `*-model.ts` in this app
 * follows.
 *
 * `endCoordinates.height` is what React Native's Android root view emits
 * for a visible IME: the IME inset minus the system-bar inset beneath it,
 * in dp — exactly the strip of the shell that the keyboard covers once
 * T327's bottom safe-area edge has already kept the shell above the
 * navigation bar. Anything that is not a positive finite number (a hide
 * event, a malformed payload) is "no keyboard", never `NaN` padding.
 */
export interface KeyboardInsetEvent {
  endCoordinates?: { height?: number } | null;
}

export function keyboardInsetFromEvent(event: KeyboardInsetEvent | null | undefined): number {
  const height = event?.endCoordinates?.height;
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : 0;
}

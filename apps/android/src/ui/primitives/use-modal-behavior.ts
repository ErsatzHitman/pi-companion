import { useEffect, useRef } from "react";
import { AccessibilityInfo, BackHandler, findNodeHandle, type View } from "react-native";

/**
 * Shared modal behaviour for `Dialog`/`Sheet` (plan.md §10.3, §10.5): move
 * TalkBack focus into the panel on open, and close on the Android
 * hardware/gesture back action — the platform-native equivalent of the
 * web primitive's focus-trap + Escape-to-close (`use-modal-behavior.ts`
 * on web). Not adapted from any external dialog implementation; this
 * reads directly from React Native's `AccessibilityInfo`/`BackHandler`
 * APIs.
 */
export function useModalBehavior(open: boolean, onClose: () => void) {
  const panelRef = useRef<View>(null);

  useEffect(() => {
    if (!open) return;

    const focusTimer = setTimeout(() => {
      const handle = findNodeHandle(panelRef.current);
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }, 50);

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });

    return () => {
      clearTimeout(focusTimer);
      subscription.remove();
    };
  }, [open, onClose]);

  return panelRef;
}

/**
 * T37E10 — single source of the testIds and literal copy
 * `accessibility-audit.yaml` asserts on (plan.md §14.4 "verify 48dp
 * touch targets and TalkBack labels on critical controls").
 *
 * RN-free by construction (a plain object of strings), same rationale as
 * every sibling `*-contract.ts` (`pairing-contract.ts`,
 * `composer-inputs-contract.ts`, `extension-sheets-contract.ts`,
 * `notification-approval-contract.ts`): Maestro's `.yaml` flows cannot
 * `import` this file (Maestro has no module system), so
 * `accessibility-audit.yaml` restates each value inline, commented with
 * the exact source line it mirrors — `accessibility-audit.contract.test.ts`
 * is what actually keeps that restatement honest, not this file by
 * itself.
 *
 * Every string below is a real `accessibilityLabel`/visible-text value a
 * mounted screen renders **today** — see this flow's own header comment
 * for the three features (real mic/attachment capture beyond the OS
 * permission check, share intent, and the files screen's
 * upload/download panels) this sampling deliberately does not claim to
 * cover, because nothing in the running app reaches them yet.
 */
export const ACCESSIBILITY_AUDIT_FLOW = {
  // --- Onboarding (`OnboardingGate.tsx`, mounted by `connect.tsx`) ------
  onboardingRoot: "connect-onboarding",
  onboardingWelcomeTitle: "Welcome to Pi Companion",
  /** `Button`'s `accessibilityLabel` is its own `label` prop — visible text and TalkBack name are the same string. */
  onboardingWelcomeContinueButton: "connect-onboarding-welcome-continue",
  onboardingWelcomeContinueLabel: "Get started",
  onboardingPermissionContinueButton: "connect-onboarding-permission-continue",
  onboardingPermissionContinueLabel: "Continue",

  // --- Connect form (`ConnectForm.tsx`) --------------------------------
  connectFormSection: "connect-form",
  connectFormAddressField: "connect-form-address-field",
  /** `TextField`'s `accessibilityLabel` with no `error` set: just the visible `label` text. */
  connectFormAddressLabelNoError: "Host address",
  connectFormSubmitButton: "connect-form-submit-button",
  /** `isNewProfile` is `true` on a fresh install (`profileId` defaults to `NEW_PROFILE_ID`), so the submit button's label is "Add host", not "Use this profile". */
  connectFormSubmitLabel: "Add host",
  /**
   * `parseConnectAddress("")`'s error (`connect-form-model.ts`), folded
   * into the address field's `accessibilityLabel` as
   * `"${label}. ${error}"` by `TextField.tsx` — this is the flow's one
   * live "error announced" proof: submitting a blank address changes
   * what the field's own accessible name is, not merely what a nearby
   * banner says.
   */
  connectFormEmptyAddressError: "Enter a host address, like ws://192.168.1.10:6767.",
  /** `TextField.tsx`: `error ? \`${label}. ${error}\` : label` — the folded accessibleName after that same submit. */
  connectFormAddressLabelWithError:
    "Host address. Enter a host address, like ws://192.168.1.10:6767.",

  // --- Composer (`Composer.tsx`, reached via the same deep link
  // `composer-inputs.yaml`/T37E3 already established) -------------------
  sessionDeepLink: "picompanion://h/e2e-host/session/e2e-session",
  composerRoot: "composer",
  composerInputField: "composer-input",
  /** `PromptBar.tsx`'s `TextInput`: `accessibilityLabel={label}`, `label` is `COMPOSER_INPUT_LABEL`. */
  composerInputLabel: "Message",
  composerSendButton: "composer-send",
  /** `PromptBar.tsx`'s `Button label="Send"` — `Button`'s own `accessibilityLabel` is that same `label`. */
  composerSendLabel: "Send",
  composerEntriesContainer: "composer-entries",
  /** `composer-model.ts`'s `entryStatusLabel("failed")` — the state a keyboard send reconciles to with no daemon connected (T32S13), rendered inside a live region (`accessibilityLiveRegion="polite"` on `composerEntriesContainer`'s own `View`), the flow's second "state change announced" proof. */
  entryFailedLabel: "Failed",
  composerMicButton: "composer-mic",
  /**
   * `composer-icon-action.tsx`'s `accessibleName` prop, wired to
   * `MIC_ACTION_LABEL`. The glyph itself
   * (`accessibilityElementsHidden`/`importantForAccessibility="no-hide-
   * descendants"`) carries no visible text a sighted user would read as
   * this string — on Android this string exists **only** as the
   * `Pressable`'s `contentDescription`, which is exactly what TalkBack
   * announces. Maestro's Android driver matches a `text:` selector
   * against an element's visible text **or** its content-description, so
   * asserting this text below is a real TalkBack-label proof, not a
   * restatement of on-screen text (contrast `composerSendLabel` above,
   * where the accessible name and the visible text happen to coincide).
   */
  composerMicLabel: "Record voice message",
  composerAttachButton: "composer-attach",
  /** Same mechanism as `composerMicLabel` — `ATTACH_ACTION_LABEL`, announced only via content-description. */
  composerAttachLabel: "Add attachment",

  // --- A2 Live (`live-screen.tsx`, T368) -------------------------------
  /** Reached by the same deep-link mechanism as the composer above, so this sampling does not depend on the session bar's own navigation. */
  liveDeepLink: "picompanion://h/e2e-host/session/e2e-session/live",
  liveScreenRoot: "live-screen",
  liveBackButton: "live-screen-back",
  /**
   * `ScreenBar.tsx`'s `ScreenBarAction.accessibleName`, required by that
   * interface precisely so a bar action can never ship announced as its
   * glyph. The `‹` itself carries `accessibilityElementsHidden` and
   * `importantForAccessibility="no-hide-descendants"`, so this string
   * exists ONLY as the Pressable's content-description — the same
   * content-description-only proof `composerMicLabel` gives, sampled on
   * the recipe all four redesigned screens mount.
   */
  liveBackLabel: "Back to session",
  liveStatusPill: "live-screen-status",
  /** `live-screen.tsx`'s pill reads `turnRunning ? "Working" : "Idle"`; nothing runs on this unpaired harness, so the honest reading is the idle one — announced as a word, never as a colour alone (plan.md §10.5). */
  liveIdleStatusLabel: "Idle",
  /** `HANDOFF.md` §7.4 moved Files and Terminal off the transcript header and onto A2, keeping both testIDs — asserting them here is what proves the relocation kept them. */
  liveFilesButton: "session-nav-actions-files",
  /** `Button`'s `accessibilityLabel` is its own `label`, so this is both the visible copy and the TalkBack name. */
  liveFilesLabel: "Files",
  liveTerminalButton: "session-nav-actions-terminal",
  liveTerminalLabel: "Terminal",

  // --- A3 Settings (`SettingsScreen.tsx`, T368) ------------------------
  settingsDeepLink: "picompanion://h/e2e-host/settings",
  settingsScreenRoot: "settings-screen",
  settingsHostRow: "settings-screen-host-row",
  /**
   * The whole row is one `accessible` element whose name
   * `settings-host-model.ts`'s `settingsHostAccessibilityLabel` builds,
   * so which daemon / its state / how it is reached are announced as one
   * TalkBack stop in the order they are drawn. This flow pairs with
   * nothing (its connect-form submit fails validation on purpose), so
   * the honest reading is the no-host one. `accessibility-audit.contract
   * .test.ts` derives this string by CALLING that function rather than
   * comparing two hand-typed copies — the model is RN-free, so it can.
   */
  settingsHostRowNoHostLabel: "No host saved, Not connected, Connect to a daemon to see it here",
  settingsHapticsToggle: "settings-screen-haptics-toggle",
  /** `Toggle.tsx`: `accessibilityLabel={label}` — visible copy and TalkBack name are the same string, as with `Button`. */
  settingsHapticsLabel: "Haptics",
} as const;

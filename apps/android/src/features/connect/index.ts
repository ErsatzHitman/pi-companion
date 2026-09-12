export { ConnectionShell } from "./connection-shell";
export { useConnectionStatus } from "./use-connection-status";
export { ConnectForm } from "./ConnectForm";
export { createDaemonConnectAttempt } from "./daemon-connect-attempt";
export type {
  ConnectAttemptFailure,
  ConnectAttemptResult,
  ConnectAttemptSuccess,
  DaemonConnectAttempt,
  DaemonConnectAttemptOptions,
} from "./daemon-connect-attempt";
export { createDaemonConnectionStore } from "./daemon-connection-store";
export type {
  DaemonConnectionPath,
  DaemonConnectionPhase,
  DaemonConnectionSnapshot,
  DaemonConnectionSnapshotListener,
  DaemonConnectionStore,
} from "./daemon-connection-store";
export { QrPairingPanel } from "./QrPairingPanel";
export type { QrPairingPanelProps } from "./QrPairingPanel";
export type { QrCameraPreviewComponent, QrCameraPreviewProps } from "./expo-camera-preview";
export { createExpoCameraScannerPort } from "./expo-camera-scanner-port";
export type {
  CameraScannerBindings,
  ExpoCameraPermissionResponse,
} from "./expo-camera-scanner-port";
export {
  CAMERA_BLOCKED_EXPLANATION,
  CAMERA_DENIED_EXPLANATION,
  CAMERA_UNAVAILABLE_EXPLANATION,
  createQrScanController,
  describeQrScanPhase,
} from "./qr-scan-model";
export type {
  QrScanController,
  QrScanControllerDeps,
  QrScanPhase,
  QrScanSnapshot,
  QrScanSnapshotListener,
} from "./qr-scan-model";
export { createUnavailableCameraScannerPort } from "./qr-scanner-port";
export type { CameraScannerPort } from "./qr-scanner-port";
export {
  classifyConnectionError,
  describeDirectConnectionError,
  describeRelayConnectionError,
  DIRECT_UNKNOWN_MESSAGE,
  DIRECT_UNREACHABLE_MESSAGE,
  PASSWORD_REQUIRED_MESSAGE,
  RELAY_UNREACHABLE_MESSAGE,
  WRONG_DAEMON_KEY_MESSAGE,
  WRONG_PASSWORD_MESSAGE,
} from "./daemon-connection-error";
export type { ConnectionErrorKind } from "./daemon-connection-error";
export {
  ConnectionOfferParseError,
  createApplyConnectionOfferAttempt,
  parseConnectionOfferInput,
} from "./apply-connection-offer";
export type {
  ApplyConnectionOfferAttempt,
  ApplyConnectionOfferFailure,
  ApplyConnectionOfferResult,
  ApplyConnectionOfferSuccess,
  CreateApplyConnectionOfferOptions,
} from "./apply-connection-offer";
export type { ConnectFormProps } from "./ConnectForm";
export {
  ADDRESS_FIELD_HINT,
  buildErrorSummaryMessage,
  buildProfileSelectOptions,
  NEW_PROFILE_ID,
  parseConnectAddress,
  validateConnectForm,
} from "./connect-form-model";
export type {
  ConnectAddressErrorKind,
  ConnectFormDraft,
  ConnectFormFieldErrors,
  ConnectFormValidation,
  ConnectFormValues,
  ConnectProfileOption,
  ConnectProfileSelectOption,
  ParseConnectAddressResult,
  ParsedConnectAddress,
} from "./connect-form-model";
export {
  clearAllHostProfiles,
  clearHostProfile,
  listHostProfiles,
  loadHostProfileSecrets,
  redactHostProfileForLogging,
  saveHostProfile,
  secureStorageKey,
} from "./credential-store";
export type {
  CredentialStoreDeps,
  HostProfileKind,
  HostProfileRecord,
  HostProfileSecrets,
  LoggableHostProfile,
} from "./credential-store";
export {
  createReconnectHostProfile,
  RELAY_PIN_MISMATCH_MESSAGE,
  RELAY_PIN_MISSING_MESSAGE,
} from "./host-profile-reconnect";
export type {
  ReconnectFailure,
  ReconnectHostProfile,
  ReconnectHostProfileOptions,
  ReconnectResult,
  ReconnectSuccess,
} from "./host-profile-reconnect";
export { createOnboardingController, ONBOARDING_STORAGE_KEY } from "./onboarding-model";
export type {
  OnboardingController,
  OnboardingControllerDeps,
  OnboardingPhase,
  OnboardingSnapshot,
  OnboardingSnapshotListener,
  OnboardingStepId,
} from "./onboarding-model";
export { describePermissionRecovery } from "./onboarding-permissions";
export type {
  OnboardingPermissionsPort,
  PermissionKind,
  PermissionPort,
  PermissionState,
} from "./onboarding-permissions";
export { createOnboardingPermissionsPort } from "./onboarding-permissions-port";
export { OnboardingGate } from "./OnboardingGate";
export type { OnboardingGateProps } from "./OnboardingGate";

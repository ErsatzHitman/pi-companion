/**
 * Connect feature barrel (T27A1-T27A6). `routes/screens/connect-screen.tsx`
 * imports only from here.
 */
export { ConnectForm } from "./ConnectForm.js";
export type { ConnectFormProps } from "./ConnectForm.js";
export { ConnectFormContainer } from "./ConnectFormContainer.js";
export type { ConnectFormContainerProps } from "./ConnectFormContainer.js";
export { createHostConnectAttempt } from "./attempt-host-connection.js";
export type {
  ConnectAttemptOutcome,
  CreateHostConnectAttemptOptions,
  HostConnectAttempt,
} from "./attempt-host-connection.js";
export { createConnectAndAuthenticateAttempt, forgetHostCredentials } from "./authenticate-host.js";
export type {
  ConnectAndAuthenticateAttempt,
  ConnectAndAuthenticateOutcome,
  CreateConnectAndAuthenticateOptions,
  ForgetHostCredentialsOptions,
} from "./authenticate-host.js";
export {
  ConnectionOfferParseError,
  CONNECTION_OFFER_EXPIRED_MESSAGE,
  createApplyConnectionOfferAttempt,
  parseConnectionOfferInput,
} from "./apply-connection-offer.js";
export type {
  ApplyConnectionOfferAttempt,
  ApplyConnectionOfferOutcome,
  CreateApplyConnectionOfferOptions,
} from "./apply-connection-offer.js";
export { parseHostAddress, validateConnectForm } from "./validate-connect-form.js";
export type {
  ConnectDraft,
  ConnectFormFieldErrors,
  ConnectFormValidation,
  ConnectFormValues,
} from "./validate-connect-form.js";
export { BootstrapConnectStatus } from "./BootstrapConnectStatus.js";
export type {
  BootstrapConnectPhase,
  BootstrapConnectStatusProps,
} from "./BootstrapConnectStatus.js";
export {
  BOOTSTRAP_CONNECTION_GLOBAL_KEY,
  bootstrapConnectDraft,
  readBootstrapConnectDraft,
  readInjectedConnectionHint,
} from "./bootstrap-connection.js";
export type { DaemonInjectedConnectionHint } from "./bootstrap-connection.js";
export {
  DIRECT_UNKNOWN_MESSAGE,
  DIRECT_UNREACHABLE_MESSAGE,
  PASSWORD_REQUIRED_MESSAGE,
  RELAY_UNREACHABLE_MESSAGE,
  WRONG_DAEMON_KEY_MESSAGE,
  WRONG_PASSWORD_MESSAGE,
  classifyConnectionError,
  describeDirectConnectionError,
  describeRelayConnectionError,
} from "./connection-error.js";
export type { ConnectionErrorKind } from "./connection-error.js";

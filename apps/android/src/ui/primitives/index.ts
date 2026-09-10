/**
 * §10.3 primitive layer barrel (plan.md §10.3, T26A). Product code
 * (`src/features/*`, routes) imports primitives from here rather than
 * reaching into individual files.
 */
export { Banner } from "./Banner";
export type { BannerProps, StatusTone as BannerTone } from "./Banner";
export { Button } from "./Button";
export type { ButtonKind, ButtonProps } from "./Button";
export { Card } from "./Card";
export { Chip, ChipGroup } from "./Chip";
export type { ChipProps, ChipTone } from "./Chip";
export { CodeBlock } from "./CodeBlock";
export type { CodeBlockProps } from "./CodeBlock";
export { Dialog } from "./Dialog";
export type { DialogProps } from "./Dialog";
export { Divider } from "./Divider";
export { IconButton } from "./IconButton";
export type { IconButtonProps } from "./IconButton";
export { Icon } from "./icons";
export type { IconName } from "./icons";
export { Link } from "./Link";
export type { LinkProps } from "./Link";
export { EmptyState, ErrorState, LoadingState } from "./PlaceholderState";
export type { PlaceholderStateProps } from "./PlaceholderState";
export { Popover } from "./Popover";
export type { PopoverProps } from "./Popover";
export { PortalHost, usePortalOutlet } from "./Portal";
export type { PortalHostProps } from "./Portal";
export { Progress } from "./Progress";
export type { ProgressProps } from "./Progress";
export { RecordList } from "./RecordList";
export type { RecordListColumn, RecordListProps, RecordListRow } from "./RecordList";
export { SearchField } from "./SearchField";
export type { SearchFieldProps } from "./SearchField";
export { Section } from "./Section";
export type { SectionProps } from "./Section";
export { Select } from "./Select";
export type { SelectOption, SelectProps } from "./Select";
export { Sheet } from "./Sheet";
export type { SheetProps } from "./Sheet";
export { StatusIndicator } from "./StatusIndicator";
export type { StatusIndicatorProps, StatusTone } from "./StatusIndicator";
export { TextArea } from "./TextArea";
export type { TextAreaProps } from "./TextArea";
export { TextField } from "./TextField";
export type { TextFieldProps } from "./TextField";
export { Toast, ToastRegion } from "./Toast";
export type { StatusTone as ToastTone, ToastProps } from "./Toast";
export { Toggle } from "./Toggle";
export type { ToggleProps } from "./Toggle";
export { VectorIcon } from "./vector-icons";
export type { VectorIconName, VectorIconProps } from "./vector-icons";

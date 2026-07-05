// Modal-coordination context (priority-based; functional logic, not styling) — kept post-migration.
export { useModalContext } from './legacy/ModalContext';

// Custom components (no shadcn equivalent)
export { default as Logo } from './Logo';
export { default as FileUpload } from './FileUpload';
export { default as TagInput } from './TagInput';
export { PhoneInput } from './PhoneInput';
export { default as EmptyTableState } from './EmptyTableState';
export { default as CircularProgress } from './CircularProgress';
export { default as PasswordStrengthIndicator } from './PasswordStrengthIndicator';
export { default as HCaptcha } from './HCaptcha';
export { default as TimePicker } from './TimePicker';
export { default as DatePicker } from './DatePicker';
export { default as SlideContentFitter } from './SlideContentFitter';
export { Field } from './field';
export { PasswordInput } from './password-input';
export { Alert } from './alert';
export { OtpInput } from './otp-input';
export { RowActionsMenu, type RowAction } from './RowActionsMenu';

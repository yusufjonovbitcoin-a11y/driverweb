export const MIN_ACCOUNT_PASSWORD_LENGTH = 12;
export const MIN_DRIVER_PASSWORD_LENGTH = 6;

export function accountPasswordError(password: string) {
  return password.length >= MIN_ACCOUNT_PASSWORD_LENGTH
    ? null
    : `Password must contain at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters`;
}

export function driverPasswordError(password: string) {
  return password.length >= MIN_DRIVER_PASSWORD_LENGTH && password.length <= 128 && password.trim()
    ? null
    : `Password must contain ${MIN_DRIVER_PASSWORD_LENGTH}–128 characters`;
}

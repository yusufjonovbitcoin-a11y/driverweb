export const MIN_ACCOUNT_PASSWORD_LENGTH = 12;

export function accountPasswordError(password: string) {
  return password.length >= MIN_ACCOUNT_PASSWORD_LENGTH
    ? null
    : `Password must contain at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters`;
}

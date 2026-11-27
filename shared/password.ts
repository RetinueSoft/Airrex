// Password rule for agencies and the site admin (checked in the browser and again on the server):
// at least 7 characters, with at least one capital letter, one number and one symbol.

export const PASSWORD_HINT = 'At least 7 characters, with a capital letter, a number and a symbol';

/** The problem with the password, or '' when it's fine. */
export function passwordProblem(pw: string): string {
  if (pw.length < 7) return 'Password must be at least 7 characters';
  if (pw.length > 200) return 'Password is too long';
  if (!/[A-Z]/.test(pw)) return 'Password needs at least one capital letter';
  if (!/[0-9]/.test(pw)) return 'Password needs at least one number';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password needs at least one symbol (e.g. @ # $ !)';
  return '';
}

// ─── PitLane Phase 11 compliance: password policy ──────────────────────────
//
// Client-side helper that mirrors the password rules we want enforced on
// Supabase Auth's hosted sign-up + reset flows. Used by /login to render
// progressive validation hints to the user.
//
// Policy (per PIPEDA / Quebec Law 25 best practice):
//   - minimum 12 characters
//   - at least one digit
//   - at least one special character (anything that isn't a letter or digit)
//
// PRODUCTION ENFORCEMENT
// Supabase Auth enforces password length via the "minimum-password-length"
// project setting (Supabase Dashboard → Auth → Configuration). We
// configure that to 12 in the Supabase project. The character-class
// requirement is enforced via the password_strength setting (Project
// Auth Settings → Passwords → required character classes). This module
// is the client-side mirror so users see immediate feedback rather than
// a generic Supabase error after submit.

export interface PasswordPolicyResult {
    ok: boolean;
    length: boolean;
    digit: boolean;
    special: boolean;
    feedback: string[];
}

export const PASSWORD_MIN_LENGTH = 12;

export function evaluatePasswordPolicy(password: string): PasswordPolicyResult {
    const length = password.length >= PASSWORD_MIN_LENGTH;
    const digit = /\d/.test(password);
    const special = /[^A-Za-z0-9]/.test(password);
    const feedback: string[] = [];
    if (!length) feedback.push(`At least ${PASSWORD_MIN_LENGTH} characters.`);
    if (!digit) feedback.push('At least one number.');
    if (!special) feedback.push('At least one special character.');
    return { ok: length && digit && special, length, digit, special, feedback };
}

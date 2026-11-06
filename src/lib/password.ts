// Single source of truth for account password requirements.
// Used by the registration UI (live checklist) and the register API route
// (server-side enforcement) so validation never diverges.

export type PasswordRequirement = {
  key: string;
  label: string;
  message: string;
  test: (value: string) => boolean;
};

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  {
    key: "length",
    label: "At least 8 characters",
    message: "Password must be at least 8 characters long.",
    test: (value) => value.length >= 8
  },
  {
    key: "uppercase",
    label: "One uppercase letter (A-Z)",
    message: "Password must contain at least 1 uppercase letter (A-Z).",
    test: (value) => /[A-Z]/.test(value)
  },
  {
    key: "lowercase",
    label: "One lowercase letter (a-z)",
    message: "Password must contain at least 1 lowercase letter (a-z).",
    test: (value) => /[a-z]/.test(value)
  },
  {
    key: "number",
    label: "One number (0-9)",
    message: "Password must contain at least 1 number (0-9).",
    test: (value) => /\d/.test(value)
  },
  {
    key: "special",
    label: "One special character (e.g. !, @, #, $, %, &, *)",
    message: "Password must contain at least 1 special character (e.g. !, @, #, $, %, &, *).",
    test: (value) => /[^A-Za-z0-9\s]/.test(value)
  }
];

// Mirrors the requirement list; \S also rejects whitespace anywhere in the
// password (a space is never accepted as a special character).
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s])\S{8,}$/;

export type PasswordRequirementStatus = PasswordRequirement & {
  met: boolean;
};

export function passwordRequirementStatuses(value: string): PasswordRequirementStatus[] {
  return PASSWORD_REQUIREMENTS.map((requirement) => ({
    ...requirement,
    met: requirement.test(value)
  }));
}

export function isPasswordValid(value: string): boolean {
  return PASSWORD_PATTERN.test(value);
}

/** Returns the first unmet requirement as a user-facing message, or null. */
export function firstPasswordIssue(value: string): string | null {
  if (/\s/.test(value)) {
    return "Password cannot contain spaces.";
  }

  for (const requirement of PASSWORD_REQUIREMENTS) {
    if (!requirement.test(value)) {
      return requirement.message;
    }
  }

  return null;
}

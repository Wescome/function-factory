// validators/taxonomy.ts - Purpose taxonomy validation
// Returns string[] of error messages (empty = valid).

import { validate_purpose } from "../kernel/taxonomy";

// Re-export the kernel's boolean validator for convenience
export { validate_purpose } from "../kernel/taxonomy";

/**
 * Validates a purpose string and returns error messages.
 * Wraps the kernel's boolean validate_purpose in the string[] error pattern.
 */
export function validate_purpose_strict(p: string): string[] {
  if (!p) {
    return ["purpose must not be empty"];
  }
  if (!validate_purpose(p)) {
    return [`purpose "${p}" is not a valid DOMAIN.ACTION from the taxonomy`];
  }
  return [];
}

import { SubmissionFields } from "@a-eye/shared";

/**
 * Parse the scalar multipart fields of a submission. Blank strings are dropped
 * before coercion so an empty `lat` or `accuracy_m` fails validation instead of
 * coercing to a perfect (0, 0) fix.
 */
export function parseSubmissionFields(form: FormData) {
  const entries = [...form.entries()].filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "",
  );
  return SubmissionFields.safeParse(Object.fromEntries(entries));
}

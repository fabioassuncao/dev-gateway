// Strip discovered secrets out of a string before it can reach a log, an
// error, a diagnostic or a task record. The panel holds a password for the
// duration of one request; this is what keeps it from outliving that request
// in anything we write down.

/**
 * Replace every known secret with a placeholder. Longer secrets are applied
 * first so a password that is a prefix of another cannot leave a residue.
 */
export function redactSecrets(text: string, secrets: Array<string | null | undefined>): string {
  const unique = [...new Set(secrets.filter((value): value is string => Boolean(value && value.length > 0)))]
  unique.sort((left, right) => right.length - left.length)
  let redacted = text
  for (const secret of unique) {
    redacted = redacted.split(secret).join('***')
  }
  return redacted
}

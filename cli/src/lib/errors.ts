/** An expected failure with a message meant for the user (printed without a stack trace). */
export class LabError extends Error {
  override name = 'LabError';
}

/** First/last parade markers in a message header, shared by the WhatsApp runner and the parser. */

/** "FIRST PARADE (STATE)", "FPS" or a bare "FP"; a bare "PARADE STATE" is not enough. */
const FIRST_PARADE = /first\s*parade|\bFPS\b|\bFP\b/i;

/** "LAST PARADE (STATE)", "LPS" or a bare "LP". */
const LAST_PARADE = /last\s*parade|\bLPS\b|\bLP\b/i;

/** Whether a header names a first parade. */
export function isFirstParade(header: string): boolean {
  return FIRST_PARADE.test(header);
}

/** Whether a header names a last parade. */
export function isLastParade(header: string): boolean {
  return LAST_PARADE.test(header);
}

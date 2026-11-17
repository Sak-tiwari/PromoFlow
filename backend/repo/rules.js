// Shared rules for both repositories.

/** Outcomes that say the code itself is bad (min spend / not applicable only say this cart does not qualify). */
export const FAIL_OUTCOMES = new Set(['invalid', 'expired', 'no_effect']);
/** A code is "dead" after failing for this many different clients within the window, with no success since. */
export const DEAD_AFTER_CLIENTS = 3;
export const DEAD_WINDOW_MS = 24 * 3600_000;
export const DEAD_FOR_MS = 3 * 24 * 3600_000;
/** A shared code is served to everyone once this many different clients shared it. */
export const SHARE_PROMOTE_CLIENTS = 2;

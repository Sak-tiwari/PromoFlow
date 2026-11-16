// Which coupon results may be shared (anonymously, and only if the user opted in).
// A user's own codes are never shared: they may be personal. A coupon that was merely already in the cart is not shared either.
export const REPORTABLE_ORIGINS = Object.freeze(['server', 'seed', 'listed']);
export const shouldReport = (origin) => REPORTABLE_ORIGINS.includes(origin);

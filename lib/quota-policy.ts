// These are domain safety bounds, not deployment defaults. They are centralized
// so API routes, forms, and persistence validation cannot drift independently.
export const MAX_ADMIN_DAILY_REQUEST_LIMIT = 1_000_000_000;
export const MAX_ADMIN_DAILY_INDEX_BYTES_LIMIT = Number.MAX_SAFE_INTEGER;
export const MAX_MEMBER_DAILY_REQUEST_LIMIT = 10_000_000;

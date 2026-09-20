// Relay re-encodes tenant stats through a Go map, which sorts keys
// alphabetically, so the entries shown must be chosen by size, not position.
export function topLanguages(
  languages: Record<string, number>,
  limit = 10,
): Array<[string, number]> {
  return Object.entries(languages)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort(([langA, countA], [langB, countB]) => countB - countA || langA.localeCompare(langB))
    .slice(0, limit);
}

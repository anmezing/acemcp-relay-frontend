export interface IndexOrganizationContext {
  id: string;
  name: string;
}

export function isCurrentIndexContext(
  current: IndexOrganizationContext | null,
  requested: IndexOrganizationContext | null,
): boolean {
  return (current?.id ?? null) === (requested?.id ?? null);
}

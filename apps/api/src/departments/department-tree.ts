/**
 * True if setting `newParentId` as the parent of `id` would create a cycle in
 * the department hierarchy. `parentOf` maps every department id to its parent
 * id (or null). Pure — the service loads the map, this decides.
 */
export function wouldCreateCycle(
  id: string,
  newParentId: string | null | undefined,
  parentOf: Map<string, string | null>,
): boolean {
  if (!newParentId) return false;
  if (newParentId === id) return true;

  const seen = new Set<string>([id]);
  let cursor: string | null = newParentId;
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

/** New ids first, then ids still present in the persisted order. */
export function reconcileFreshFirst(currentIds: string[], orderIds: string[]): string[] {
  const current = new Set(currentIds)
  // De-dupe the persisted order first: a polluted order (e.g. the same repo id
  // appearing N times) must never be carried forward, or it would replicate the
  // item N times in the rendered tree and re-persist the corruption.
  const retained = [...new Set(orderIds)].filter(id => current.has(id))
  const retainedSet = new Set(retained)

  return [...currentIds.filter(id => !retainedSet.has(id)), ...retained]
}

export function resolveManualSessionOrderIds(currentIds: string[], orderIds: string[], manual: boolean): string[] {
  if (!manual || !currentIds.length || !orderIds.length) {
    return []
  }

  const current = new Set(currentIds)
  const retained = orderIds.filter(id => current.has(id))

  if (!retained.length) {
    return []
  }

  return reconcileFreshFirst(currentIds, orderIds)
}

/** Reorder `items` by `orderIds`; items missing from the order surface first. */
export function orderByIds<T>(items: T[], getId: (item: T) => string, orderIds: string[]): T[] {
  if (!orderIds.length) {
    return items
  }

  // De-dupe the order so a corrupted order (same id N times) can't replicate an
  // item N times in the rendered list. Each id resolves to at most one item.
  const dedupedOrder: string[] = []
  const seenOrder = new Set<string>()

  for (const id of orderIds) {
    if (!seenOrder.has(id)) {
      seenOrder.add(id)
      dedupedOrder.push(id)
    }
  }

  const byId = new Map(items.map(item => [getId(item), item]))
  const ordered: T[] = []

  for (const id of dedupedOrder) {
    const item = byId.get(id)

    if (item) {
      ordered.push(item)
    }
  }

  // Items missing from the persisted order are new since it was last
  // reconciled. Callers pass recency-sorted lists (newest first), so surface
  // these at the TOP instead of burying them beneath the saved order —
  // otherwise a brand-new session sinks to the bottom of the sidebar and reads
  // as "my latest session never showed up".
  const seenItems = new Set(ordered.map(getId))
  const fresh = items.filter(item => !seenItems.has(getId(item)))

  return fresh.length ? [...fresh, ...ordered] : ordered
}

/** Reconcile a persisted order against the live id set (fresh-first). */
export function reconcileOrderIds(currentIds: string[], orderIds: string[]): string[] {
  if (!currentIds.length) {
    return []
  }

  if (!orderIds.length) {
    return currentIds
  }

  return reconcileFreshFirst(currentIds, orderIds)
}

/** True when two id lists are element-for-element identical. */
export function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

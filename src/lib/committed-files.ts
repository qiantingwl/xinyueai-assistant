const committedFileIds = new Set<string>()

export function markFileCommitted(id: string) {
  committedFileIds.add(id)
  if (committedFileIds.size > 256) {
    const oldest = committedFileIds.values().next().value
    if (oldest !== undefined) committedFileIds.delete(oldest)
  }
}

export function isFileCommitted(id: string) {
  return committedFileIds.has(id)
}

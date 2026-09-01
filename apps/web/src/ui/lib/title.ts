import { useEffect } from 'react'

export const SUFFIX = 'Dev Gateway'

/** Joins the known parts with a middle dot and appends the panel name. */
export function useDocumentTitle(...parts: Array<string | null | undefined>): void {
  const title = [
    ...parts.filter((part): part is string => Boolean(part?.trim())).map((part) => part.trim()),
    SUFFIX,
  ].join(' · ')

  useEffect(() => {
    document.title = title
  }, [title])
}

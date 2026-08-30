import type { Host } from '../types'

export function filterProfiles(profiles: Host[], query: string): Host[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return profiles
  return profiles.filter((host) => {
    const haystack = [host.name, host.group, host.host, host.user, host.note, ...(host.tags ?? [])]
    return haystack.some((field) => field?.toLowerCase().includes(needle))
  })
}

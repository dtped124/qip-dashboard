'use client'

/**
 * Whether AD sign-in is on, for the login page and the account page. Asked once per page load and cached at
 * module level. When the answer cannot be had it counts as "not enabled" (取不到視為未啟用): the pre-AD wording
 * stays. A failure is never cached; it is retried once, 5 seconds later.
 */
import { useEffect, useState } from 'react'
import { getAuthOptions } from '../entry/api'
import type { AuthOptions } from '../entry/types'

const DEFAULT_OPTIONS: AuthOptions = { ldap_enabled: false }
const RETRY_DELAY_MS = 5_000

let cached: AuthOptions | null = null
let pending: Promise<AuthOptions | null> | null = null

/** The server's answer, or null when it could not be had. */
function loadAuthOptions(): Promise<AuthOptions | null> {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = getAuthOptions()
      .then((options) => {
        cached = { ldap_enabled: options?.ldap_enabled === true }
        return cached
      })
      .catch(() => null)
      .finally(() => {
        pending = null
      })
  }
  return pending
}

export function useAuthOptions(): AuthOptions {
  const [options, setOptions] = useState<AuthOptions>(cached ?? DEFAULT_OPTIONS)
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = (retry: boolean) => {
      loadAuthOptions().then((o) => {
        if (cancelled) return
        if (o) setOptions(o)
        else if (retry) timer = setTimeout(() => attempt(false), RETRY_DELAY_MS)
      })
    }
    attempt(true)
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])
  return options
}

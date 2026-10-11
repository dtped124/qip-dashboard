/**
 * Role helpers for the SPA: pure functions, no React.
 *
 * Mirrors backend/apps/accounts/permissions.py: `admin` satisfies every role
 * check, and "dashboard readers" are viewer | reviewer | admin. This only
 * decides what to show or where to send the user; the backend is the real gate
 * and answers 403 on its own.
 */
import type { UserRole } from '../entry/types'

/** Roles of the signed-in user; null/undefined means "not signed in". */
export type Roles = readonly UserRole[] | null | undefined

export function isAdmin(roles: Roles): boolean {
  return !!roles && roles.includes('admin')
}

/** True if the user holds `role`. Admin holds every role (same as the backend). */
export function hasRole(roles: Roles, role: UserRole): boolean {
  return isAdmin(roles) || (!!roles && roles.includes(role))
}

export function hasAnyRole(roles: Roles, ...wanted: UserRole[]): boolean {
  return wanted.some((role) => hasRole(roles, role))
}

/** May open the dashboards and read indicator data (viewer | reviewer | admin). */
export function canViewDashboard(roles: Roles): boolean {
  return hasAnyRole(roles, 'viewer', 'reviewer')
}

/**
 * Landing page after login. admin or viewer -> dashboard; otherwise reviewer ->
 * review overview; otherwise reporter -> entry home. null = no usable role yet.
 */
export function homeFor(roles: Roles): string | null {
  if (!roles) return null
  if (roles.includes('admin') || roles.includes('viewer')) return '/'
  if (roles.includes('reviewer')) return '/entry/review'
  if (roles.includes('reporter')) return '/entry'
  return null
}

/** Strip query/hash and trailing slashes so '/entry/' and '/entry?x=1' match '/entry'. */
function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '')
  return path === '' ? '/' : path
}

/** `path` is `base` or lives under it ('/import' matches '/import' and '/import/x', not '/important'). */
function isUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(base + '/')
}

const ADMIN_ONLY_BASES = ['/entry/admin', '/settings/accounts', '/settings/indicators', '/settings/tcpi', '/import']

/**
 * Page-level policy for the route guard.
 *
 *   /entry/login                                    public
 *   /mock/*                                         anyone (to be restricted later)
 *   /entry, /entry/HAxx, /entry/case-list/*         reporter
 *   /entry/review*                                  reviewer
 *   /entry/admin*, /settings/{accounts,indicators,tcpi}, /import   admin
 *   everything else (/, /category, /indicators, /cross-campus,
 *   /davinci*, /settings, /settings/ai)             dashboard readers
 *
 * Admin passes everywhere. A path nobody listed falls into the last group, which
 * is safe because the API behind it still enforces its own roles.
 */
export function canAccess(pathname: string, roles: Roles): boolean {
  const path = normalizePath(pathname)

  if (path === '/entry/login') return true
  if (isUnder(path, '/mock')) return true
  if (isAdmin(roles)) return true

  if (path === '/entry' || /^\/entry\/HA\d{2}(\/|$)/.test(path) || isUnder(path, '/entry/case-list')) {
    return hasRole(roles, 'reporter')
  }
  if (isUnder(path, '/entry/review')) return hasRole(roles, 'reviewer')
  if (ADMIN_ONLY_BASES.some((base) => isUnder(path, base))) return false

  return canViewDashboard(roles)
}

/**
 * Role helpers for the SPA: pure functions, no React.
 *
 * Mirrors backend/apps/accounts/permissions.py: `admin` satisfies every role
 * check, and "dashboard readers" are viewer | reviewer | admin. This only
 * decides what to show or where to send the user; the backend is the real gate
 * and answers 403 on its own.
 */
import type { User, UserRole } from '../entry/types'

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

/**
 * True only if `role` is really assigned to the user: admin does NOT imply it (unlike `hasRole`).
 * For menu entries that belong to a person's own work, e.g. "my entry tasks" of a reporter.
 */
export function hasAssignedRole(roles: Roles, role: UserRole): boolean {
  return !!roles && roles.includes(role)
}

/** May open the dashboards and read indicator data (viewer | reviewer | admin). */
export function canViewDashboard(roles: Roles): boolean {
  return hasAnyRole(roles, 'viewer', 'reviewer')
}

/**
 * May see da Vinci case-level rows (account number, surgeon) and export them:
 * reviewer | admin. Viewers only get the aggregates (same rule as the backend's `cases/` and `export/`).
 */
export function canSeeDavinciCases(roles: Roles): boolean {
  return hasRole(roles, 'reviewer')
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

/**
 * Pages that render without a session (no route guard, no app shell): the login page, and the design
 * mock-ups under /mock (fake data) outside production builds.
 */
export function isPublicPath(pathname: string): boolean {
  const path = normalizePath(pathname)
  return path === '/entry/login' || (process.env.NODE_ENV !== 'production' && isUnder(path, '/mock'))
}

// Account administration lives under /entry/admin (reached from the "填報系統管理" card on /settings).
const ADMIN_ONLY_BASES = ['/entry/admin', '/settings/indicators', '/settings/tcpi', '/import']

/**
 * The reporter's workspace: /entry and everything under it except the login page and the reviewer / admin
 * areas - so /entry, /entry/HAxx, /entry/case-list/*, and also a path nobody listed (the dynamic
 * /entry/[category] route accepts any segment). It gets the minimal EntryShell frame (ClientLayout) and is
 * open to reporters (canAccess); both read this one definition so they cannot drift apart.
 */
export function isEntryWorkspace(pathname: string): boolean {
  const path = normalizePath(pathname)
  return (
    isUnder(path, '/entry') &&
    !isUnder(path, '/entry/login') &&
    !isUnder(path, '/entry/review') &&
    !isUnder(path, '/entry/admin')
  )
}

/**
 * Page-level policy for the route guard.
 *
 *   /entry/login                                    public
 *   /mock/*                                         dev only: anyone (public); in production nobody
 *   /entry/review*                                  reviewer
 *   /entry/admin*, /settings/{indicators,tcpi}, /import   admin
 *   /entry, /entry/HAxx, /entry/case-list/*,
 *   and any other path under /entry                 reporter (isEntryWorkspace)
 *   everything else (/, /category, /indicators, /cross-campus,
 *   /davinci*, /settings, /settings/ai)             dashboard readers
 *
 * Admin passes everywhere except /mock in production. A path nobody listed falls into the last group,
 * which is safe because the API behind it still enforces its own roles.
 */
export function canAccess(pathname: string, roles: Roles): boolean {
  const path = normalizePath(pathname)

  if (path === '/entry/login') return true
  // Design mock-ups with fake data: open in development (see isPublicPath), closed to everyone in production.
  if (isUnder(path, '/mock')) return process.env.NODE_ENV !== 'production'
  if (isAdmin(roles)) return true

  if (isUnder(path, '/entry/review')) return hasRole(roles, 'reviewer')
  if (ADMIN_ONLY_BASES.some((base) => isUnder(path, base))) return false
  if (isEntryWorkspace(path)) return hasRole(roles, 'reporter')

  return canViewDashboard(roles)
}

/** What the route guard does with a user whose session is known. */
export type RouteVerdict =
  | { kind: 'allow' }
  /** Not signed in: go to the login page, remembering the page asked for. */
  | { kind: 'login' }
  /** Signed in but must set a new password first: the login page shows that form. */
  | { kind: 'change-password' }
  /** Signed in, but this page is not for the roles: go to their landing page. */
  | { kind: 'home'; to: string }
  /** Signed in with no usable role at all: end the session. */
  | { kind: 'sign-out' }

/** `user` is null when nobody is signed in. The caller decides what to show while the session is still unknown. */
export function routeVerdict(
  pathname: string,
  user: Pick<User, 'roles' | 'must_change_password'> | null,
): RouteVerdict {
  if (isPublicPath(pathname)) return { kind: 'allow' }
  if (!user) return { kind: 'login' }
  if (user.must_change_password) return { kind: 'change-password' }
  if (canAccess(pathname, user.roles)) return { kind: 'allow' }

  const home = homeFor(user.roles)
  // The second test is a loop guard: never send someone to a page they would be sent away from again.
  if (home === null || !canAccess(home, user.roles)) return { kind: 'sign-out' }
  return { kind: 'home', to: home }
}

/**
 * The login page's `?next=` value, if it is safe to follow: a path on this site (`origin`) that the roles may
 * open. Anything else - another site, a scheme-relative `//host`, the login page itself, a page the roles
 * cannot enter - gives null and the caller falls back to `homeFor`.
 */
export function safeNextPath(raw: string | null | undefined, roles: Roles, origin: string): string | null {
  // Shape first; the URL parser below then catches what slips through ("/\host" and "/<tab>/host" both
  // parse as another site, because browsers read a backslash as a slash and drop tabs and newlines).
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  let url: URL
  try {
    url = new URL(raw, origin)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  // The parser resolves dot segments, so "/.//host" comes out as the path "//host", which a router
  // (or the browser) would read as another site again. Only a plain single-slash path may leave here.
  if (url.pathname.startsWith('//')) return null
  // No page of this app has an encoded slash or backslash in its path; one is only ever an attempt to
  // smuggle "//host" past a check that does not decode ("/%2F%2Fhost").
  if (/%2f|%5c/i.test(url.pathname)) return null
  if (isPublicPath(url.pathname) || !canAccess(url.pathname, roles)) return null
  return url.pathname + url.search + url.hash
}

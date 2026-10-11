/**
 * Unit tests of the role / route policy in roles.ts - the rules that decide where each role may go.
 *
 * There is no test framework: run `npm run test:unit` (node --test). Node 22.18+ strips the TypeScript types
 * by itself, so nothing is built or transpiled.
 *
 * roles.ts has to stay free of runtime imports (`import type` is erased): Node cannot resolve this app's
 * extension-less or `@/` specifiers. That is also why it is imported here with its `.ts` extension.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { UserRole } from '../entry/types'
import {
  canAccess,
  canSeeDavinciCases,
  canViewDashboard,
  hasAssignedRole,
  hasRole,
  homeFor,
  isAdmin,
  isEntryWorkspace,
  isPublicPath,
  routeVerdict,
  safeNextPath,
} from './roles.ts'

// ─── fixtures ────────────────────────────────────────────────────

type Combo = 'viewer' | 'reporter' | 'reviewer' | 'admin' | 'reporter+reviewer' | 'viewer+reporter' | 'none'

const COMBOS: Record<Combo, readonly UserRole[]> = {
  viewer: ['viewer'],
  reporter: ['reporter'],
  reviewer: ['reviewer'],
  admin: ['admin'],
  'reporter+reviewer': ['reporter', 'reviewer'],
  'viewer+reporter': ['viewer', 'reporter'],
  none: [],
}
const ALL = Object.keys(COMBOS) as Combo[]

/** Who may open dashboards: viewer, reviewer, admin (admin implies every role). */
const READERS: Combo[] = ['viewer', 'reviewer', 'admin', 'reporter+reviewer', 'viewer+reporter']
const REPORTERS: Combo[] = ['reporter', 'admin', 'reporter+reviewer', 'viewer+reporter']
const REVIEWERS: Combo[] = ['reviewer', 'admin', 'reporter+reviewer']
const ADMINS: Combo[] = ['admin']

/** Run `fn` with NODE_ENV set to `value` (undefined = unset), then put it back. */
function withNodeEnv(value: string | undefined, fn: () => void): void {
  const env = process.env as Record<string, string | undefined>
  const before = env.NODE_ENV
  if (value === undefined) delete env.NODE_ENV
  else env.NODE_ENV = value
  try {
    fn()
  } finally {
    if (before === undefined) delete env.NODE_ENV
    else env.NODE_ENV = before
  }
}

// ─── canAccess ───────────────────────────────────────────────────

const ROUTES: Array<[path: string, allowed: Combo[]]> = [
  // dashboards and their readers
  ['/', READERS],
  ['/category/process', READERS],
  ['/indicators/HA01-01', READERS],
  ['/cross-campus', READERS],
  ['/davinci', READERS],
  ['/davinci/DV04', READERS],
  ['/settings', READERS],
  ['/settings/ai', READERS],
  // administration
  ['/settings/indicators', ADMINS],
  ['/settings/tcpi', ADMINS],
  ['/import', ADMINS],
  ['/import/logs', ADMINS],
  ['/entry/admin', ADMINS],
  ['/entry/admin/indicatorassignment', ADMINS],
  // the reporter's workspace: everything else under /entry, whatever the segment is
  ['/entry', REPORTERS],
  ['/entry/', REPORTERS],
  ['/entry?status=rejected', REPORTERS],
  ['/entry/HA03', REPORTERS],
  ['/entry/ha03', REPORTERS],
  ['/entry/HA03/', REPORTERS],
  ['/entry/case-list/HA01-01', REPORTERS],
  ['/entry/foo', REPORTERS],
  ['/entry/Review', REPORTERS], // routes are case-sensitive: this is the [category] page, not the review area
  ['/entry/administrator', REPORTERS], // not under /entry/admin
  // review
  ['/entry/review', REVIEWERS],
  ['/entry/review/campus/zhubei/HA01', REVIEWERS],
  // always open
  ['/entry/login', ALL],
  ['/entry/login/', ALL],
]

describe('canAccess', () => {
  for (const [path, allowed] of ROUTES) {
    test(path, () => {
      for (const combo of ALL) {
        assert.equal(canAccess(path, COMBOS[combo]), allowed.includes(combo), `${combo} on ${path}`)
      }
    })
  }

  test('nobody signed in may open anything but the login page', () => {
    for (const roles of [null, undefined]) {
      assert.equal(canAccess('/entry/login', roles), true)
      for (const [path] of ROUTES) {
        if (path.startsWith('/entry/login')) continue
        assert.equal(canAccess(path, roles), false, path)
      }
    }
  })

  test('the withdrawn account-admin page under /settings gets no special rule', () => {
    // Account administration lives under /entry/admin (the "填報系統管理" card of /settings leads there); a
    // separate page under /settings was planned and withdrawn, so its path must not linger in the route table.
    const withdrawn = ['', 'settings', 'accounts'].join('/')
    for (const combo of ALL) {
      assert.equal(canAccess(withdrawn, COMBOS[combo]), canAccess('/settings', COMBOS[combo]), combo)
    }
  })

  test('/mock/* is open in development and closed to everyone, admin included, in production', () => {
    withNodeEnv('development', () => {
      for (const roles of [...Object.values(COMBOS), null]) assert.equal(canAccess('/mock/export-slide', roles), true)
    })
    withNodeEnv(undefined, () => assert.equal(canAccess('/mock/export-slide', null), true))
    withNodeEnv('production', () => {
      for (const roles of [...Object.values(COMBOS), null]) assert.equal(canAccess('/mock/export-slide', roles), false)
      assert.equal(canAccess('/mockery', COMBOS.viewer), true) // /mockery is just another reader page
    })
  })
})

describe('isEntryWorkspace (the reporter area, also the EntryShell frame)', () => {
  test('is /entry and everything under it except login, review and admin', () => {
    for (const path of ['/entry', '/entry/', '/entry/HA03', '/entry/foo', '/entry/case-list/HA01-01', '/entry/Review']) {
      assert.equal(isEntryWorkspace(path), true, path)
    }
    for (const path of [
      '/', '/settings', '/entrance', '/davinci',
      '/entry/login', '/entry/review', '/entry/review/campus/zhubei/HA01', '/entry/admin', '/entry/admin/indicatorassignment',
    ]) {
      assert.equal(isEntryWorkspace(path), false, path)
    }
  })

  test('agrees with canAccess: a non-admin may open exactly what only reporters (not readers) may', () => {
    for (const [path] of ROUTES) {
      if (!isEntryWorkspace(path)) continue
      assert.equal(canAccess(path, COMBOS.reporter), true, path)
      assert.equal(canAccess(path, COMBOS.viewer), false, path)
      assert.equal(canAccess(path, COMBOS.reviewer), false, path)
    }
  })
})

// ─── homeFor and the helpers ─────────────────────────────────────

describe('homeFor', () => {
  const HOME: Record<Combo, string | null> = {
    viewer: '/',
    reporter: '/entry',
    reviewer: '/entry/review',
    admin: '/',
    'reporter+reviewer': '/entry/review',
    'viewer+reporter': '/',
    none: null,
  }
  for (const combo of ALL) {
    test(combo, () => assert.equal(homeFor(COMBOS[combo]), HOME[combo]))
  }

  test('nobody signed in has no home', () => {
    assert.equal(homeFor(null), null)
    assert.equal(homeFor(undefined), null)
  })

  test('every landing page is open to the roles it is the landing page of (no redirect loop)', () => {
    for (const combo of ALL) {
      const home = homeFor(COMBOS[combo])
      if (home !== null) assert.equal(canAccess(home, COMBOS[combo]), true, `${combo} -> ${home}`)
    }
  })
})

describe('role helpers', () => {
  test('admin implies every role, except where the menu asks for an assigned one', () => {
    assert.equal(isAdmin(['admin']), true)
    assert.equal(hasRole(['admin'], 'reporter'), true)
    assert.equal(hasAssignedRole(['admin'], 'reporter'), false)
    assert.equal(hasAssignedRole(['reporter'], 'reporter'), true)
    assert.equal(hasAssignedRole(null, 'reporter'), false)
  })

  test('dashboard readers are viewer, reviewer and admin', () => {
    assert.deepEqual(new Set(ALL.filter((combo) => canViewDashboard(COMBOS[combo]))), new Set(READERS))
  })

  test('da Vinci case rows are for reviewer and admin only', () => {
    assert.deepEqual(new Set(ALL.filter((combo) => canSeeDavinciCases(COMBOS[combo]))), new Set(REVIEWERS))
    assert.equal(canSeeDavinciCases(null), false)
  })
})

// ─── isPublicPath and routeVerdict ───────────────────────────────

describe('isPublicPath', () => {
  test('the login page is public, and /mock/* outside production', () => {
    withNodeEnv('development', () => {
      assert.equal(isPublicPath('/entry/login'), true)
      assert.equal(isPublicPath('/entry/login/'), true)
      assert.equal(isPublicPath('/mock/export-slide'), true)
      assert.equal(isPublicPath('/mockery'), false)
      assert.equal(isPublicPath('/entry'), false)
    })
    withNodeEnv('production', () => {
      assert.equal(isPublicPath('/entry/login'), true)
      assert.equal(isPublicPath('/mock/export-slide'), false)
    })
  })
})

describe('routeVerdict', () => {
  const user = (combo: Combo, mustChange = false) => ({ roles: [...COMBOS[combo]], must_change_password: mustChange })

  test('the login page is always allowed', () => {
    assert.deepEqual(routeVerdict('/entry/login', null), { kind: 'allow' })
    assert.deepEqual(routeVerdict('/entry/login', user('none')), { kind: 'allow' })
  })

  test('nobody signed in goes to the login page', () => {
    assert.deepEqual(routeVerdict('/', null), { kind: 'login' })
    assert.deepEqual(routeVerdict('/entry/HA03', null), { kind: 'login' })
  })

  test('a pending password change beats everything else', () => {
    assert.deepEqual(routeVerdict('/', user('admin', true)), { kind: 'change-password' })
    assert.deepEqual(routeVerdict('/entry', user('reporter', true)), { kind: 'change-password' })
  })

  test('a page of the user\'s roles is allowed', () => {
    assert.deepEqual(routeVerdict('/', user('viewer')), { kind: 'allow' })
    assert.deepEqual(routeVerdict('/entry/foo', user('reporter')), { kind: 'allow' })
    assert.deepEqual(routeVerdict('/entry/review', user('reviewer')), { kind: 'allow' })
    assert.deepEqual(routeVerdict('/entry/admin', user('admin')), { kind: 'allow' })
  })

  test('another role\'s page leads to the landing page of the user\'s own roles', () => {
    assert.deepEqual(routeVerdict('/', user('reporter')), { kind: 'home', to: '/entry' })
    assert.deepEqual(routeVerdict('/entry', user('viewer')), { kind: 'home', to: '/' })
    assert.deepEqual(routeVerdict('/entry/foo', user('viewer')), { kind: 'home', to: '/' })
    assert.deepEqual(routeVerdict('/entry/review', user('reporter')), { kind: 'home', to: '/entry' })
    assert.deepEqual(routeVerdict('/entry/admin', user('reviewer')), { kind: 'home', to: '/entry/review' })
    assert.deepEqual(routeVerdict('/settings/tcpi', user('viewer')), { kind: 'home', to: '/' })
  })

  test('an account without any role is signed out', () => {
    assert.deepEqual(routeVerdict('/', user('none')), { kind: 'sign-out' })
    assert.deepEqual(routeVerdict('/entry', user('none')), { kind: 'sign-out' })
  })

  test('/mock/* in production leads home (or to the login page), in development it is open', () => {
    withNodeEnv('production', () => {
      assert.deepEqual(routeVerdict('/mock/export-slide', user('admin')), { kind: 'home', to: '/' })
      assert.deepEqual(routeVerdict('/mock/export-slide', user('reporter')), { kind: 'home', to: '/entry' })
      assert.deepEqual(routeVerdict('/mock/export-slide', null), { kind: 'login' })
    })
    withNodeEnv('development', () => {
      assert.deepEqual(routeVerdict('/mock/export-slide', null), { kind: 'allow' })
    })
  })
})

// ─── safeNextPath (the login page's ?next=) ──────────────────────

describe('safeNextPath', () => {
  const ORIGIN = 'http://localhost:3000'
  const BS = String.fromCharCode(92) // a backslash, spelled out so no escape rule can change it
  const next = (raw: string | null | undefined, combo: Combo = 'admin') => safeNextPath(raw, COMBOS[combo], ORIGIN)

  test('refuses everything that could leave this site', () => {
    const attacks = [
      '//evil.com',
      '//evil.com/x',
      '/.//evil.com',
      '/././/evil.com',
      '/a/..//evil.com',
      '/%2e//evil.com',
      'https://evil.com',
      'http://evil.com/settings',
      'javascript:alert(1)',
      'data:text/html,hi',
      '/' + BS + 'evil.com',
      '/' + BS + BS + 'evil.com',
      '/./' + BS + 'evil.com',
      '/%2F%2Fevil.com',
      '/%2f%2fevil.com',
      '/%5Cevil.com',
      '/\t/evil.com',
      '/\n/evil.com',
      '/\r\n/evil.com',
      'evil.com',
      'settings',
      '',
      ' ',
    ]
    for (const raw of attacks) {
      assert.equal(next(raw), null, JSON.stringify(raw))
    }
    assert.equal(next(null), null)
    assert.equal(next(undefined), null)
  })

  test('keeps the pages the user may open, with query and hash', () => {
    assert.equal(next('/settings', 'viewer'), '/settings')
    assert.equal(next('/settings/ai?x=1#top', 'viewer'), '/settings/ai?x=1#top')
    assert.equal(next('/entry/HA03?status=rejected', 'reporter'), '/entry/HA03?status=rejected')
    assert.equal(next('/entry/review', 'reviewer'), '/entry/review')
    assert.equal(next('/a/../settings', 'viewer'), '/settings') // dot segments are resolved
  })

  test('refuses pages the roles may not open (the caller then falls back to the landing page)', () => {
    assert.equal(next('/entry/review', 'viewer'), null)
    assert.equal(next('/entry/review', 'reporter'), null)
    assert.equal(next('/entry/admin', 'reviewer'), null)
    assert.equal(next('/settings/tcpi', 'reviewer'), null)
    assert.equal(next('/', 'reporter'), null)
    assert.equal(next('/entry/foo', 'viewer'), null)
    assert.equal(next('/', 'none'), null)
  })

  test('never sends a signed-in user back to the login page (that would loop)', () => {
    for (const raw of ['/entry/login', '/entry/login?next=/', '/entry/login/']) assert.equal(next(raw), null, raw)
  })

  test('whatever comes out is a plain path of this site (200000 random inputs)', () => {
    const alphabet = ['/', '/', '/', BS, '.', '.', '%', '2', 'e', 'E', 'f', 'F', '5', 'c', 'C', 'a', 'x', ':', '@', '?', '#', '\t', '\n', ' ', '-', 'h', 't', 'p', 's']
    let seed = 12345
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    let accepted = 0
    for (let i = 0; i < 200_000; i++) {
      let raw = '/'
      for (let k = 1 + Math.floor(random() * 12); k > 0; k--) raw += alphabet[Math.floor(random() * alphabet.length)]
      const out = next(raw)
      if (out === null) continue
      accepted++
      assert.ok(out.startsWith('/') && !out.startsWith('//'), `${JSON.stringify(raw)} -> ${out}`)
      assert.equal(new URL(out, ORIGIN).origin, ORIGIN, `${JSON.stringify(raw)} -> ${out}`)
      const path = out.split(/[?#]/)[0]
      assert.ok(!path.includes(BS) && !/%2f|%5c/i.test(path), `${JSON.stringify(raw)} -> ${out}`)
    }
    assert.ok(accepted > 1000, 'the fuzz should let plenty of harmless paths through, or it proves nothing')
  })
})

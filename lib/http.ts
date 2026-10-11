/**
 * Single HTTP client for the Django REST backend.
 *
 * The browser only calls same-origin relative paths (`/api/...`); Next.js
 * `rewrites` (next.config.mjs) proxy them to Django. Session and CSRF cookies
 * therefore live on one origin and no CORS is involved.
 *
 * All backend calls go through `request()` / `downloadFile()` so cookies, the
 * CSRF header, timeouts and error parsing behave identically everywhere.
 * (lib/ai/** talks to Anthropic directly and does not use this module.)
 */

/**
 * Base URL for backend calls. Empty string means same origin (relative paths).
 * Must be `??`, not `||`: an explicitly empty value has to stay empty instead
 * of falling back to a default.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

/**
 * `${API_BASE}${path}` for `<a href>` / `window.open` — a same-origin relative
 * URL by default. For fetching, use `request()`.
 */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

/**
 * Django's `csrftoken` cookie value, or null if not set yet. Browser-only: this
 * module is for client components (Node fetch rejects relative URLs anyway).
 */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)
  return match ? match[1] : null
}

// ─── Errors ──────────────────────────────────────────────────────

export class ApiError extends Error {
  /** HTTP status; 0 only for a client-side timeout. Network/DNS failures surface as the native TypeError. */
  status: number
  /** Machine-readable code, when the backend sends one (`{error: {code}}` or `{error: "CODE"}`). */
  code?: string
  /** Parsed JSON body of the error response, if it had one. */
  data?: unknown

  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.data = data
  }
}

// ─── Auth error hooks ────────────────────────────────────────────

type AuthErrorHandler = (err: ApiError) => void

const authErrorHandlers: AuthErrorHandler[] = []

/**
 * Register a handler that runs whenever any request fails with 401/403 (lib/auth/store.ts
 * uses it to forget a session the backend no longer knows). The failing request still
 * rejects afterwards. Returns an unsubscribe function.
 */
export function onAuthError(handler: AuthErrorHandler): () => void {
  // Wrap so that registering the same function twice gives independent subscriptions.
  const entry: AuthErrorHandler = (err) => handler(err)
  authErrorHandlers.push(entry)
  return () => {
    const i = authErrorHandlers.indexOf(entry)
    if (i !== -1) authErrorHandlers.splice(i, 1)
  }
}

function notifyAuthError(err: ApiError): void {
  // Iterate over a copy: a handler may unsubscribe while we are looping.
  for (const handler of [...authErrorHandlers]) {
    try {
      handler(err)
    } catch (e) {
      console.error('[http] onAuthError handler threw:', e)
    }
  }
}

// ─── Error body parsing ──────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Depth-first search for the first non-empty string in a DRF-style error payload. */
function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (Array.isArray(value) || isPlainObject(value)) {
    for (const item of Object.values(value)) {
      const found = firstString(item)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Turn a failed response body into { message, code }. Formats used by this
 * backend, in priority order:
 *   {"detail": "..."}                              DRF APIException (+ optional "code")
 *   {"non_field_errors": ["..."]}                  DRF serializer validation
 *   {"error": {"code": "...", "message": "..."}}   custom JsonResponse
 *   {"error": "SOME_CODE"}                         custom JsonResponse (short form)
 *   {"field": ["..."]}                             DRF serializer, first field error
 * Anything else (including a non-JSON body) becomes "HTTP <status>".
 */
function describeError(body: unknown, status: number): { message: string; code?: string } {
  const fallback = { message: `HTTP ${status}` }

  if (!isPlainObject(body)) {
    // e.g. DRF ValidationError("msg") serialises to ["msg"]
    const msg = firstString(body)
    return msg ? { message: msg } : fallback
  }

  if (typeof body.detail === 'string' && body.detail) {
    // The backend's DRF handler adds a machine-readable `code` next to `detail`.
    const code = typeof body.code === 'string' && body.code ? body.code : undefined
    return { message: body.detail, code }
  }

  const nonField = firstString(body.non_field_errors)
  if (nonField) return { message: nonField }

  const err = body.error
  if (isPlainObject(err)) {
    const code = typeof err.code === 'string' && err.code ? err.code : undefined
    const message = typeof err.message === 'string' && err.message ? err.message : code
    if (message) return { message, code }
  } else if (typeof err === 'string' && err) {
    return { message: err, code: err }
  }

  for (const [field, value] of Object.entries(body)) {
    // Field errors are lists / nested objects; a bare string is some other key.
    if (typeof value === 'string') continue
    const msg = firstString(value)
    if (msg) return { message: `${field}: ${msg}` }
  }

  return fallback
}

async function toApiError(res: Response): Promise<ApiError> {
  let data: unknown
  try {
    data = JSON.parse(await res.text())
  } catch (e) {
    // An aborted read must reach the caller's timeout handling; anything else
    // is just a non-JSON body (e.g. a proxy error page) -> "HTTP <status>".
    if (isAbortError(e)) throw e
  }
  const { message, code } = describeError(data, res.status)
  return new ApiError(message, res.status, code, data)
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

// ─── request ─────────────────────────────────────────────────────

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  /** Body sent as JSON (stringified; Content-Type is set automatically). */
  json?: unknown
  /** Multipart body. Never set Content-Type yourself: the browser adds the boundary. */
  form?: FormData
  /**
   * Extra headers. Applied *before* the built-in Content-Type / X-CSRFToken,
   * which always win — do not try to set those here.
   */
  headers?: Record<string, string>
  /**
   * Abort after this many ms. Default: 30000 for GET/HEAD, none for writes and
   * uploads (a client-side abort cannot undo a write the server already started).
   * Pass 0 to disable.
   */
  timeoutMs?: number
  /** How to read a successful body. Default 'json'. */
  responseType?: 'json' | 'blob' | 'text' | 'void'
  signal?: AbortSignal
}

const DEFAULT_READ_TIMEOUT_MS = 30_000
// File downloads can be generated on demand server-side. Must stay >= the proxy
// limit (experimental.proxyTimeout / API_PROXY_TIMEOUT_MS in next.config.mjs);
// change both together.
const DOWNLOAD_TIMEOUT_MS = 120_000

/**
 * Shared transport: builds the request, enforces the timeout (which also covers
 * reading the body), maps failures to ApiError, and lets the caller read the
 * successful Response while the timeout is still armed.
 */
async function execute<R>(
  path: string,
  opts: RequestOptions,
  read: (res: Response) => Promise<R>,
): Promise<R> {
  if (opts.json !== undefined && opts.form) {
    throw new TypeError('request(): pass either `json` or `form`, not both')
  }

  const method = opts.method ?? 'GET'
  const isRead = method === 'GET' || method === 'HEAD'

  const headers = new Headers(opts.headers ?? {})
  // Built-ins go last so a caller can never (even accidentally) override them.
  if (opts.json !== undefined) headers.set('Content-Type', 'application/json')
  // Django CSRF: every non-safe method needs the token echoed in a header.
  if (!isRead) {
    const token = getCsrfToken()
    if (token) headers.set('X-CSRFToken', token)
  }
  // A hand-set Content-Type would drop the multipart boundary.
  if (opts.form) headers.delete('Content-Type')

  const timeoutMs = opts.timeoutMs ?? (isRead && !opts.form ? DEFAULT_READ_TIMEOUT_MS : 0)
  const controller = new AbortController()
  let timedOut = false
  const timer =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
      : undefined

  const onCallerAbort = () => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', onCallerAbort, { once: true })
  }

  try {
    const res = await fetch(apiUrl(path), {
      method,
      headers,
      credentials: 'include',
      body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
      signal: controller.signal,
    })

    if (!res.ok) {
      const err = await toApiError(res)
      if (res.status === 401 || res.status === 403) notifyAuthError(err)
      throw err
    }

    return await read(res)
  } catch (e) {
    if (timedOut && isAbortError(e)) {
      throw new ApiError(
        `API 連線逾時（${Math.round(timeoutMs / 1000)}秒），請確認後端是否正在運行`,
        0,
        'TIMEOUT',
      )
    }
    throw e
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onCallerAbort)
  }
}

async function readBody(res: Response, type: NonNullable<RequestOptions['responseType']>): Promise<unknown> {
  if (res.status === 204 || type === 'void') return undefined
  if (type === 'blob') return res.blob()
  if (type === 'text') return res.text()
  return res.json()
}

/**
 * Call the backend. Always sends cookies; non-GET/HEAD requests also carry
 * `X-CSRFToken`. Non-2xx responses reject with an `ApiError`; 401/403 also
 * notify the handlers registered via `onAuthError`.
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const type = opts.responseType ?? 'json'
  return (await execute(path, opts, (res) => readBody(res, type))) as T
}

// ─── downloads ───────────────────────────────────────────────────

/** Filename from a Content-Disposition header: `filename*=UTF-8''...` first, then `filename="..."`. */
function parseContentDisposition(header: string | null): string | null {
  if (!header) return null
  const star = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (star) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      /* fall through to the plain filename */
    }
  }
  const plain = header.match(/filename="([^"]+)"/i)
  if (plain) {
    try {
      return decodeURIComponent(plain[1])
    } catch {
      return plain[1]
    }
  }
  return null
}

/** GET a binary file. `filename` is null when the response carries no usable Content-Disposition. */
export async function downloadFile(path: string): Promise<{ blob: Blob; filename: string | null }> {
  return execute(path, { timeoutMs: DOWNLOAD_TIMEOUT_MS }, async (res) => ({
    blob: await res.blob(),
    filename: parseContentDisposition(res.headers.get('content-disposition')),
  }))
}

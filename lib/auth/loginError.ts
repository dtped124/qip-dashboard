/**
 * Turns a failed login / password-change call into the sentence the user sees.
 *
 * Pure on purpose: no runtime imports (`import type` is erased), so `node --test` can load it. That is also why
 * `toErrorInfo` recognises an ApiError by its shape instead of `instanceof`.
 */
export const NO_ROLE_MESSAGE = '此帳號尚未指派身分，請聯絡品管中心'
export const LOCKED_FALLBACK_MESSAGE = '登入失敗次數過多，請稍後再試'
export const UNREACHABLE_MESSAGE = '無法連線到伺服器，請稍後再試'
export const BAD_FORMAT_MESSAGE = '帳號或密碼格式不正確'
const LOGIN_FAILED_MESSAGE = '登入失敗'

/**
 * What the messages below need to know about a failure. `status` 0 = no answer from the server was received
 * (timeout, network failure, any other non-API exception).
 */
export interface ErrorInfo {
  status: number
  code?: string
  message: string
}

/** The browser's own wording when fetch never reached the server (Chrome / Firefox / Safari / Node). */
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|fetch failed|^typeerror\b/i

/**
 * An ApiError (anything with a numeric `status` and a string `message`) keeps its status and code; every other
 * thrown value never got an answer from the server: status 0.
 */
export function toErrorInfo(e: unknown): ErrorInfo {
  if (typeof e === 'object' && e !== null) {
    const o = e as { status?: unknown; code?: unknown; message?: unknown }
    if (typeof o.status === 'number' && typeof o.message === 'string') {
      return { status: o.status, code: typeof o.code === 'string' ? o.code : undefined, message: o.message }
    }
  }
  return { status: 0, message: e instanceof Error ? e.message : '' }
}

/** No usable answer from the server: no response at all, a bare "HTTP nnn" (proxy error page), or fetch's own failure text. */
export function isUnreachable(err: ErrorInfo): boolean {
  const message = (err.message ?? '').trim()
  return err.status === 0 || /^HTTP \d{3}$/.test(message) || NETWORK_FAILURE.test(message)
}

export function loginErrorMessage(err: ErrorInfo | null | undefined): string {
  if (!err) return LOGIN_FAILED_MESSAGE
  // 429 = locked after too many failed attempts; the backend's `detail` says how long to wait.
  if (err.status === 429) return err.code === 'locked' ? err.message : LOCKED_FALLBACK_MESSAGE
  if (
    (err.status === 403 && (err.code === 'account_not_provisioned' || err.code === 'ldap_managed')) ||
    (err.status === 503 && err.code === 'ldap_unavailable')
  ) {
    return err.message
  }
  if (isUnreachable(err)) return UNREACHABLE_MESSAGE
  const message = (err.message ?? '').trim()
  // A field error of the login form (e.g. "employee_id: Ensure this field has no more than 20 characters.").
  if (err.status === 400 && /^[a-z_]+: /i.test(message)) return BAD_FORMAT_MESSAGE
  return message || LOGIN_FAILED_MESSAGE
}

/** The message when the password is managed by AD (change-password answers 403 `ldap_managed`), else null. */
export function changePasswordBlockedMessage(err: ErrorInfo | null | undefined): string | null {
  return err && err.status === 403 && err.code === 'ldap_managed' ? err.message : null
}

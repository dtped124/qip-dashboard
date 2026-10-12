/**
 * Unit tests of loginError.ts - the sentences shown for a failed login or password change.
 * Run with `npm run test:unit`; loginError.ts has no runtime imports, so it loads as is (see roles.test.ts).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  BAD_FORMAT_MESSAGE,
  LOCKED_FALLBACK_MESSAGE,
  NO_ROLE_MESSAGE,
  UNREACHABLE_MESSAGE,
  changePasswordBlockedMessage,
  isUnreachable,
  loginErrorMessage,
  toErrorInfo,
} from './loginError.ts'

describe('loginErrorMessage', () => {
  test('429 locked shows the backend detail (it says how long to wait)', () => {
    assert.equal(
      loginErrorMessage({ status: 429, code: 'locked', message: '帳號已鎖定，請於 10 分鐘後再試' }),
      '帳號已鎖定，請於 10 分鐘後再試',
    )
  })

  test('any other 429 shows the fixed fallback', () => {
    assert.equal(loginErrorMessage({ status: 429, message: 'Request was throttled.' }), LOCKED_FALLBACK_MESSAGE)
    assert.equal(loginErrorMessage({ status: 429, code: 'throttled', message: 'x' }), LOCKED_FALLBACK_MESSAGE)
  })

  test('403 account_not_provisioned shows the backend detail', () => {
    const detail = 'AD 驗證成功，但系統尚未開通此帳號，請洽品管中心'
    assert.equal(loginErrorMessage({ status: 403, code: 'account_not_provisioned', message: detail }), detail)
  })

  test('403 ldap_managed shows the backend detail', () => {
    const detail = '您的密碼由院內 AD 管理，如需變更請洽資訊室'
    assert.equal(loginErrorMessage({ status: 403, code: 'ldap_managed', message: detail }), detail)
  })

  test('503 ldap_unavailable shows the backend detail, not the generic connection message', () => {
    const detail = '目前無法連線到院內 AD 驗證服務，請稍後再試或洽資訊室'
    assert.equal(loginErrorMessage({ status: 503, code: 'ldap_unavailable', message: detail }), detail)
  })

  test('status 0 (client timeout / no answer) is a connection problem', () => {
    assert.equal(loginErrorMessage({ status: 0, code: 'TIMEOUT', message: 'API 連線逾時（30秒）' }), UNREACHABLE_MESSAGE)
    assert.equal(loginErrorMessage({ status: 0, message: 'whatever' }), UNREACHABLE_MESSAGE)
  })

  test('a bare "HTTP nnn" message (proxy error page, no JSON) is a connection problem', () => {
    assert.equal(loginErrorMessage({ status: 502, message: 'HTTP 502' }), UNREACHABLE_MESSAGE)
    assert.equal(loginErrorMessage({ status: 503, message: 'HTTP 503' }), UNREACHABLE_MESSAGE)
  })

  test('the browser network-failure wording is a connection problem', () => {
    assert.equal(loginErrorMessage({ status: 0, message: 'Failed to fetch' }), UNREACHABLE_MESSAGE)
    assert.equal(loginErrorMessage({ status: 500, message: 'Failed to fetch' }), UNREACHABLE_MESSAGE)
    assert.equal(loginErrorMessage({ status: 500, message: 'TypeError: NetworkError when attempting to fetch' }), UNREACHABLE_MESSAGE)
    assert.equal(loginErrorMessage({ status: 500, message: 'Load failed' }), UNREACHABLE_MESSAGE)
  })

  test('the wrong-password answer (400, no code) shows the backend text', () => {
    assert.equal(loginErrorMessage({ status: 400, message: '帳號或密碼錯誤' }), '帳號或密碼錯誤')
  })

  test('an unknown code shows the backend detail', () => {
    assert.equal(loginErrorMessage({ status: 403, code: 'something_new', message: '後端的說明' }), '後端的說明')
    assert.equal(loginErrorMessage({ status: 503, code: 'other', message: '服務維護中' }), '服務維護中')
  })

  test('a known code with another status does not borrow its rule', () => {
    assert.equal(loginErrorMessage({ status: 400, code: 'ldap_unavailable', message: '訊息' }), '訊息')
  })

  test('an empty message falls back to the generic failure; a missing error too', () => {
    assert.equal(loginErrorMessage({ status: 400, message: '' }), '登入失敗')
    assert.equal(loginErrorMessage({ status: 400, message: '   ' }), '登入失敗')
    assert.equal(loginErrorMessage(null), '登入失敗')
    assert.equal(loginErrorMessage(undefined), '登入失敗')
  })

  test('a plain Error (not an ApiError), converted the way the login page does it', () => {
    assert.equal(loginErrorMessage(toErrorInfo(new TypeError('Failed to fetch'))), UNREACHABLE_MESSAGE)
    assert.equal(loginErrorMessage(toErrorInfo(new Error('boom'))), UNREACHABLE_MESSAGE)
    assert.equal(loginErrorMessage(toErrorInfo('not an error')), UNREACHABLE_MESSAGE)
  })

  test('a login field error (400, "field: english text") shows the format message, not the English text', () => {
    assert.equal(
      loginErrorMessage({ status: 400, message: 'employee_id: Ensure this field has no more than 20 characters.' }),
      BAD_FORMAT_MESSAGE,
    )
    assert.equal(loginErrorMessage({ status: 400, message: 'password: This field may not be blank.' }), BAD_FORMAT_MESSAGE)
    // only a 400 is a field error; the wrong-password text has no field prefix
    assert.equal(loginErrorMessage({ status: 403, code: 'x', message: 'employee_id: foo' }), 'employee_id: foo')
    assert.equal(loginErrorMessage({ status: 400, message: '帳號或密碼錯誤' }), '帳號或密碼錯誤')
  })
})

describe('toErrorInfo', () => {
  test('an ApiError-shaped object keeps status, code and message', () => {
    class FakeApiError extends Error {
      status = 403
      code = 'ldap_managed'
    }
    assert.deepEqual(toErrorInfo(new FakeApiError('detail')), { status: 403, code: 'ldap_managed', message: 'detail' })
    assert.deepEqual(toErrorInfo({ status: 400, message: 'x' }), { status: 400, code: undefined, message: 'x' })
  })

  test('any other Error, or a non-error, becomes status 0', () => {
    assert.deepEqual(toErrorInfo(new TypeError('Failed to fetch')), { status: 0, message: 'Failed to fetch' })
    assert.deepEqual(toErrorInfo(new Error('boom')), { status: 0, message: 'boom' })
    assert.deepEqual(toErrorInfo('text'), { status: 0, message: '' })
    assert.deepEqual(toErrorInfo(null), { status: 0, message: '' })
    assert.deepEqual(toErrorInfo({ status: '500', message: 'x' }), { status: 0, message: '' })
  })
})

describe('isUnreachable', () => {
  test('no answer, a bare HTTP nnn, or the fetch failure wording', () => {
    assert.equal(isUnreachable({ status: 0, message: '' }), true)
    assert.equal(isUnreachable({ status: 502, message: 'HTTP 502' }), true)
    assert.equal(isUnreachable({ status: 500, message: 'HTTP 500' }), true)
    assert.equal(isUnreachable({ status: 0, message: 'Failed to fetch' }), true)
  })

  test('an answer with a real message is reachable', () => {
    assert.equal(isUnreachable({ status: 400, message: '新密碼太常見' }), false)
    assert.equal(isUnreachable({ status: 403, code: 'ldap_managed', message: 'x' }), false)
  })
})

describe('changePasswordBlockedMessage', () => {
  test('403 ldap_managed gives the backend detail', () => {
    assert.equal(
      changePasswordBlockedMessage({ status: 403, code: 'ldap_managed', message: '您的密碼由院內 AD 管理，如需變更請洽資訊室' }),
      '您的密碼由院內 AD 管理，如需變更請洽資訊室',
    )
  })

  test('anything else gives null', () => {
    assert.equal(changePasswordBlockedMessage({ status: 400, code: 'ldap_managed', message: 'x' }), null)
    assert.equal(changePasswordBlockedMessage({ status: 403, message: 'x' }), null)
    assert.equal(changePasswordBlockedMessage({ status: 403, code: 'other', message: 'x' }), null)
    assert.equal(changePasswordBlockedMessage({ status: 0, message: 'Failed to fetch' }), null)
    assert.equal(changePasswordBlockedMessage(null), null)
  })
})

describe('constants', () => {
  test('the no-role message points to 品管中心', () => {
    assert.match(NO_ROLE_MESSAGE, /品管中心/)
  })
})

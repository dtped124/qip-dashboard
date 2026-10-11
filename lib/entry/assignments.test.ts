/**
 * Unit tests of the client-side mirror of the assignment rules (overlap, coverage) and of how a refused save is worded.
 *
 * Run with `npm run test:unit` (node --test; see roles.test.ts for the setup).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { AssignmentField } from './types'
import {
  ASSIGNMENT_FIELD_LABEL,
  coverageOf,
  describeAssignmentError,
  fieldsCovered,
  fieldsOverlap,
} from './assignments.ts'

describe('fieldsCovered / fieldsOverlap', () => {
  test('both is the numerator and the denominator', () => {
    assert.deepEqual(fieldsCovered('both'), ['numerator', 'denominator'])
    assert.deepEqual(fieldsCovered('numerator'), ['numerator'])
    assert.deepEqual(fieldsCovered('denominator'), ['denominator'])
  })

  test('two assignments clash when they cover a number in common (the backend rule)', () => {
    const table: Array<[AssignmentField, AssignmentField, boolean]> = [
      ['both', 'both', true],
      ['both', 'numerator', true],
      ['both', 'denominator', true],
      ['numerator', 'both', true],
      ['denominator', 'both', true],
      ['numerator', 'numerator', true],
      ['denominator', 'denominator', true],
      ['numerator', 'denominator', false],
      ['denominator', 'numerator', false],
    ]
    for (const [a, b, expected] of table) {
      assert.equal(fieldsOverlap(a, b), expected, `${a} vs ${b}`)
    }
  })

  test('every field has a label', () => {
    assert.deepEqual(Object.keys(ASSIGNMENT_FIELD_LABEL).sort(), ['both', 'denominator', 'numerator'])
  })
})

describe('coverageOf', () => {
  test('nobody covers nothing', () => {
    assert.deepEqual(coverageOf([]), { numerator: [], denominator: [] })
  })

  test('both covers both numbers; a half assignment only its own', () => {
    const coverage = coverageOf([
      { field: 'both', role: 'primary', user_name: '王小明' },
    ])
    assert.deepEqual(coverage, { numerator: ['王小明'], denominator: ['王小明'] })

    const split = coverageOf([
      { field: 'numerator', role: 'primary', user_name: '王小明' },
    ])
    assert.deepEqual(split, { numerator: ['王小明'], denominator: [] }) // the denominator is uncovered
  })

  test('different people for the two numbers', () => {
    const coverage = coverageOf([
      { field: 'denominator', role: 'primary', user_name: '李大華' },
      { field: 'numerator', role: 'primary', user_name: '王小明' },
    ])
    assert.deepEqual(coverage, { numerator: ['王小明'], denominator: ['李大華'] })
  })

  test('primaries come before deputies and a name is listed once per number', () => {
    const coverage = coverageOf([
      { field: 'numerator', role: 'deputy', user_name: '代理人' },
      { field: 'both', role: 'primary', user_name: '王小明' },
      { field: 'numerator', role: 'deputy', user_name: '代理人' },
    ])
    assert.deepEqual(coverage.numerator, ['王小明', '代理人'])
    assert.deepEqual(coverage.denominator, ['王小明'])
  })
})

describe('describeAssignmentError', () => {
  test('puts every message of a field-error body together, without the field names', () => {
    assert.equal(
      describeAssignmentError({ field: ['指標 HA01-01 沒有分母，不能只指派分母'], user: ['此帳號已停用，不能被指派'] }, '失敗'),
      '指標 HA01-01 沒有分母，不能只指派分母；此帳號已停用，不能被指派',
    )
  })

  test('a combination error arrives as non_field_errors', () => {
    assert.equal(
      describeAssignmentError({ non_field_errors: ['王小明 在此院區對 HA01-01 已有現行指派涵蓋分子，請先結束或修改原指派'] }, '失敗'),
      '王小明 在此院區對 HA01-01 已有現行指派涵蓋分子，請先結束或修改原指派',
    )
  })

  test('a {detail, code} body is its detail only', () => {
    assert.equal(
      describeAssignmentError({ detail: '你沒有權限執行此操作', code: 'permission_denied' }, '失敗'),
      '你沒有權限執行此操作',
    )
  })

  test('repeated messages are said once; a body without text gives the fallback', () => {
    assert.equal(describeAssignmentError({ a: ['同一句'], b: ['同一句'] }, '失敗'), '同一句')
    assert.equal(describeAssignmentError(undefined, '儲存失敗'), '儲存失敗')
    assert.equal(describeAssignmentError({}, '儲存失敗'), '儲存失敗')
    assert.equal(describeAssignmentError(null, '儲存失敗'), '儲存失敗')
  })
})

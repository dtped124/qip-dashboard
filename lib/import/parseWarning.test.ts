/**
 * Unit tests of the import-log warning parser behind the three correction buttons.
 *
 * Run with `npm run test:unit` (node --test; see lib/auth/roles.test.ts for the setup).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseWarning } from './parseWarning.ts'

// Same shape as backend/apps/imports/services/excel_parser.py writes it
// (made-up numbers): value and cell with 4 decimals, ratio with 1, n/d as Python floats.
const CELL_TOO_BIG =
  '[警告] HA01-02 竹北 114年7月: n/d 計算值 1.2000 與儲存格顯示值 120.0000 差異 100.0 倍 (n=3.0, d=250.0) — 儲存格偏大 (疑似格式錯誤)；請人工確認後以資料庫更新修正。'
const ND_TOO_BIG =
  '[警告] HA03-01 新竹 113年12月: n/d 計算值 42.8571 與儲存格顯示值 9.3750 差異 4.6 倍 (n=9.0, d=21.0) — n/d 偏大 (疑似分母 typo)；請人工確認後以資料庫更新修正。'

describe('parseWarning', () => {
  test('reads the backend line with float n/d (the regression)', () => {
    assert.deepEqual(parseWarning(CELL_TOO_BIG), {
      indicatorCode: 'HA01-02',
      campus: '竹北',
      year: 114,
      month: 7,
      computedValue: 1.2,
      cellValue: 120,
      numerator: 3,
      denominator: 250,
    })
  })

  test('reads the other direction too', () => {
    const info = parseWarning(ND_TOO_BIG)
    assert.ok(info)
    assert.equal(info.indicatorCode, 'HA03-01')
    assert.equal(info.campus, '新竹')
    assert.equal(info.year, 113)
    assert.equal(info.month, 12)
    assert.equal(info.computedValue, 42.8571)
    assert.equal(info.cellValue, 9.375)
    assert.equal(info.numerator, 9)
    assert.equal(info.denominator, 21)
  })

  test('still reads integer n/d (lines written by older parsers)', () => {
    const info = parseWarning(CELL_TOO_BIG.replace('(n=3.0, d=250.0)', '(n=3, d=250)'))
    assert.ok(info)
    assert.equal(info.numerator, 3)
    assert.equal(info.denominator, 250)
  })

  test('the n/d part is informational: a line without it still yields the buttons', () => {
    const info = parseWarning(
      '[警告] HA01-02 竹北 114年7月: n/d 計算值 1.2000 與儲存格顯示值 120.0000 差異 100.0 倍'
    )
    assert.ok(info)
    assert.equal(info.cellValue, 120)
    assert.equal(info.computedValue, 1.2)
    assert.equal(info.numerator, undefined)
    assert.equal(info.denominator, undefined)
  })

  test('ignores every other kind of import message', () => {
    for (const line of [
      '',
      '自動修正: HA01-02 竹北 114年7月 120 → 1.2 (÷100)',
      '異常值: HA01-02 竹北 114年7月 值=120 (為中位數的100.0倍)',
      '修正 (分母 typo): HA01-02 竹北 114年7月 n/d 計算值 42.8571 (n=9, d=21) → 儲存格值 9.3750；',
      'HA01-02: 找不到分母行',
      '[警告] 工作表 115年 竹北: 無法解析時間欄位',
      // Must start at the beginning of the line.
      '  ' + CELL_TOO_BIG,
    ]) {
      assert.equal(parseWarning(line), null, line)
    }
  })
})

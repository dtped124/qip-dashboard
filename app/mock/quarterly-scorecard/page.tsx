'use client';

/**
 * 季度分析 PPTX 匯出 — 投影片版型示意
 *
 * 三張投影片（新竹/竹北/竹東）疊在同一頁面，方便檢視。
 * 每張投影片 = 1280×720 (16:9)，最終會被 html-to-image → PNG → 嵌入 PPTX。
 *
 * 假資料只是版型測試用，不接資料來源。
 */

import type { Campus } from '@/lib/types';

// ===== 假資料（仿照使用者範例圖片的 114.Q1 數據） =====

interface MockRow {
  category: string;
  no: number;
  name: string;
  curRatio: string;     // 當季比率
  curND: string;        // 當季 (分子/分母)
  prevRatio: string;
  prevND: string;
  delta: string;        // 季增減
  spcTrend: '穩定' | '波動';  // 警示+注意 → 波動，其餘 → 穩定
  yearAvg: string;
  yearAvgND: string;
  peer: string;         // 同儕值（依院區別取醫學中心/區域/地區）
}

const ROWS: MockRow[] = [
  { category: '整體綜合急性照護', no: 1,  name: '住院死亡率(含病危自動出院)',                 curRatio: '6.55%', curND: '(35/534)', prevRatio: '6.73%', prevND: '(34/505)', delta: '−2.7%',  spcTrend: '穩定', yearAvg: '5.33%',  yearAvgND: '(110/2064)', peer: '3.12' },
  { category: '整體綜合急性照護', no: 2,  name: '出院14天內相關病情非計畫性再住院率',         curRatio: '3.61%', curND: '(18/499)', prevRatio: '2.97%', prevND: '(14/471)', delta: '+21.5%', spcTrend: '波動', yearAvg: '2.20%',  yearAvgND: '(43/1954)',  peer: '1.35' },
  { category: '整體綜合急性照護', no: 3,  name: '急性病房住院日數超過三十日 (季)',            curRatio: '1.51%', curND: '(7/464)',  prevRatio: '1.13%', prevND: '(5/443)',  delta: '+33.6%', spcTrend: '穩定', yearAvg: '1.54%',  yearAvgND: '(28/1820)',  peer: 'NR'   },
  { category: '加護病房照護',     no: 4,  name: '48小時(含)內加護病房重返率',                 curRatio: '0%',    curND: '(0/61)',   prevRatio: '4.55%', prevND: '(2/44)',   delta: '−100%',  spcTrend: '穩定', yearAvg: '1.37%',  yearAvgND: '(3/219)',    peer: '0.75' },
  { category: '加護病房照護',     no: 5,  name: '加護病房死亡率(含病危自動出院)',             curRatio: '13.7%', curND: '(10/73)',  prevRatio: '21.54%',prevND: '(14/65)',  delta: '−36.4%', spcTrend: '穩定', yearAvg: '13.67%', yearAvgND: '(38/278)',   peer: '11.87' },
  { category: '加護病房照護',     no: 6,  name: '加護病房呼吸器相關肺炎',                     curRatio: '0‰',    curND: '(0/152)',  prevRatio: '0‰',    prevND: '(0/171)',  delta: '—',      spcTrend: '穩定', yearAvg: '0.00',   yearAvgND: '(0/795)',    peer: '0.73' },
  { category: '加護病房照護',     no: 7,  name: '加護病房留置導尿管相關尿路感染',             curRatio: '0‰',    curND: '(0/282)',  prevRatio: '0‰',    prevND: '(0/220)',  delta: '—',      spcTrend: '穩定', yearAvg: '0.00',   yearAvgND: '(0/1045)',   peer: '2.37' },
  { category: '加護病房照護',     no: 8,  name: '加護病房中心導管相關血流感染',               curRatio: '0‰',    curND: '(0/175)',  prevRatio: '8.62‰', prevND: '(1/116)',  delta: '−100%',  spcTrend: '穩定', yearAvg: '4.94',   yearAvgND: '(4/809)',    peer: '2.41' },
  { category: '手術照護',         no: 9,  name: '手術後48小時內死亡率(含病危自動出院)',       curRatio: '0%',    curND: '(0/94)',   prevRatio: '0%',    prevND: '(0/82)',   delta: '—',      spcTrend: '穩定', yearAvg: '0%',     yearAvgND: '(0/400)',    peer: '0.11' },
  { category: '手術照護',         no: 10, name: '手術病人住院期間非計畫相關重返手術室',       curRatio: '0%',    curND: '(0/94)',   prevRatio: '1.22%', prevND: '(1/82)',   delta: '−100%',  spcTrend: '穩定', yearAvg: '0.50%',  yearAvgND: '(2/400)',    peer: '0.44' },
  { category: '手術照護',         no: 11, name: '所有住院病人手術部位感染',                   curRatio: '0%',    curND: '(0/94)',   prevRatio: '0%',    prevND: '(0/82)',   delta: '—',      spcTrend: '穩定', yearAvg: '0.00%',  yearAvgND: '(0/400)',    peer: '0.24' },
  { category: '手術照護',         no: 12, name: '預防性抗生素手術劃刀前1小時給予比率',         curRatio: '100%',  curND: '(46/46)',  prevRatio: '100%',  prevND: '(40/40)',  delta: '0%',     spcTrend: '穩定', yearAvg: '100%',   yearAvgND: '(183/183)',  peer: '100'  },
];

const PEER_LABELS: Record<Campus, string> = {
  '新竹': '醫學中心同儕值',
  '竹北': '區域同儕值',
  '竹東': '地區同儕值',
};

const CAMPUSES: Campus[] = ['新竹', '竹北', '竹東'];

// ===== 樣式（顏色仿照範例圖片） =====
const HEADER_BG = '#F5C77E';      // 橘黃
const CATEGORY_BG = '#FAEACA';    // 構面欄淺橘
const CURRENT_BLUE = '#1B5FAD';   // 當季欄位文字藍
const ROW_BORDER = '#9E9E9E';
const TABLE_FONT = '"Microsoft JhengHei", "PingFang TC", sans-serif';

// 行群組 — 用於 rowSpan
function groupByCategory(rows: MockRow[]) {
  const groups: { category: string; rows: MockRow[] }[] = [];
  rows.forEach(r => {
    const last = groups[groups.length - 1];
    if (last && last.category === r.category) last.rows.push(r);
    else groups.push({ category: r.category, rows: [r] });
  });
  return groups;
}

interface SlideProps {
  campus: Campus;
  quarterLabel: string;     // 例：114.Q1
  prevQuarterLabel: string; // 例：113.Q4
  yearAvgLabel: string;     // 例：113年平均值
}

function Slide({ campus, quarterLabel, prevQuarterLabel, yearAvgLabel }: SlideProps) {
  const groups = groupByCategory(ROWS);
  const peerLabel = PEER_LABELS[campus];

  return (
    <div
      style={{
        width: 1280,
        height: 720,
        background: '#fff',
        fontFamily: TABLE_FONT,
        padding: '20px 24px 16px',
        boxSizing: 'border-box',
        color: '#1a1a1a',
        position: 'relative',
      }}
    >
      {/* 投影片標題 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 10 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>
          {campus}院區　季度品質指標分析
        </h1>
        <span style={{ fontSize: 16, color: '#555', fontWeight: 600 }}>
          {prevQuarterLabel} → {quarterLabel}
        </span>
      </div>

      {/* 表格 */}
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
        }}
      >
        <colgroup>
          <col style={{ width: 88 }} />
          <col style={{ width: 44 }} />
          <col style={{ width: 300 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 78 }} />
          <col style={{ width: 70 }} />
          <col style={{ width: 138 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 92 }} />
        </colgroup>
        <thead>
          <tr style={{ background: HEADER_BG, height: 44 }}>
            <th style={thStyle}>構面</th>
            <th style={thStyle}>NO</th>
            <th style={thStyle}>指標名稱</th>
            <th style={{ ...thStyle, color: CURRENT_BLUE }}>{quarterLabel}</th>
            <th style={thStyle}>{prevQuarterLabel}</th>
            <th style={thStyle}>季增減<br />(%)</th>
            <th style={thStyle}>趨勢<br />SPC</th>
            <th style={thStyle}>{yearAvgLabel}</th>
            <th style={thStyle}>{peerLabel}</th>
            <th style={thStyle}>檢視</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) =>
            g.rows.map((r, idx) => (
              <tr key={r.no} style={{ height: 47 }}>
                {idx === 0 && (
                  <td
                    rowSpan={g.rows.length}
                    style={{
                      ...tdCategoryStyle,
                    }}
                  >
                    {g.category.split('').reduce<string[]>((acc, ch, i) => {
                      // 強制每行 4 字斷行（讓垂直顯示更接近原圖）
                      if (i % 4 === 0) acc.push('');
                      acc[acc.length - 1] += ch;
                      return acc;
                    }, []).map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </td>
                )}
                <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>{r.no}</td>
                <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 10, fontWeight: 700, fontSize: 15 }}>{r.name}</td>
                <td style={{ ...tdStyle, color: CURRENT_BLUE, fontWeight: 700 }}>
                  <div style={{ fontSize: 16 }}>{r.curRatio}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.curND}</div>
                </td>
                <td style={tdStyle}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{r.prevRatio}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.prevND}</div>
                </td>
                <td style={{ ...tdStyle, fontSize: 15, fontWeight: 700 }}>{r.delta}</td>
                <td style={{ ...tdStyle, fontSize: 15, fontWeight: 700, color: r.spcTrend === '波動' ? '#c0392b' : '#1a1a1a' }}>
                  {r.spcTrend}
                </td>
                <td style={tdStyle}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{r.yearAvg}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.yearAvgND}</div>
                </td>
                <td style={{ ...tdStyle, fontSize: 16, fontWeight: 700 }}>{r.peer}</td>
                <td style={tdStyle}>{/* 留白 */}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* 右下角頁碼 */}
      <div
        style={{
          position: 'absolute',
          right: 24,
          bottom: 6,
          fontSize: 11,
          color: '#888',
        }}
      >
        {campus}院區 · {CAMPUSES.indexOf(campus) + 1} / {CAMPUSES.length}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  border: `1px solid ${ROW_BORDER}`,
  fontSize: 16,
  fontWeight: 800,
  padding: '6px 6px',
  textAlign: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.2,
};

const tdStyle: React.CSSProperties = {
  border: `1px solid ${ROW_BORDER}`,
  textAlign: 'center',
  verticalAlign: 'middle',
  padding: '3px 5px',
  lineHeight: 1.25,
};

const tdCategoryStyle: React.CSSProperties = {
  border: `1px solid ${ROW_BORDER}`,
  background: CATEGORY_BG,
  fontWeight: 800,
  fontSize: 17,
  textAlign: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  padding: '4px',
};

export default function QuarterlyScorecardMockPage() {
  return (
    <div style={{ background: '#eef1f5', padding: 24, minHeight: '100vh' }}>
      <div
        style={{
          maxWidth: 1340,
          margin: '0 auto',
          fontFamily: TABLE_FONT,
        }}
      >
        <h1 style={{ fontSize: 18, marginBottom: 4 }}>
          季度分析 PPTX 匯出 — 投影片版型示意
        </h1>
        <p style={{ fontSize: 13, color: '#555', marginTop: 0, marginBottom: 16, lineHeight: 1.6 }}>
          下方三張為 1280×720 16:9 投影片，最終會被截圖嵌入 PPTX。
          <br />
          <strong>同儕欄（單欄）：</strong>新竹 = 醫學中心同儕值　|　竹北 = 區域同儕值　|　竹東 = 地區同儕值
          <br />
          <strong>SPC 趨勢：</strong>警示 + 注意 → <span style={{ color: '#c0392b', fontWeight: 700 }}>波動</span>　|　其餘 → 穩定
          <br />
          <strong>當季欄藍字</strong>＋<strong>構面欄淺橘合併</strong>＋<strong>橘黃表頭</strong>＋兩行儲存格（比率 + 分子分母）— 樣式仿原圖。
        </p>

        {CAMPUSES.map((campus) => (
          <div
            key={campus}
            style={{
              marginBottom: 24,
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              border: '1px solid #cfd6df',
            }}
          >
            <Slide
              campus={campus}
              quarterLabel="114.Q1"
              prevQuarterLabel="113.Q4"
              yearAvgLabel="113年平均值"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

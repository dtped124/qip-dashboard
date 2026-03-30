/**
 * QIP 分析報告匯出（Word .docx）
 * 支援：單指標 AI 分析、跨院區季度分析
 */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  LevelFormat, Header, Footer, PageNumber, VerticalAlign,
} from 'docx';
import type { ParsedAnalysis } from '@/lib/ai/promptBuilder';
import type {
  ParsedCampusAnalysis, ParsedCommonIssues,
} from '@/lib/ai/promptBuilder';

// ── 共用樣式常數 ──────────────────────────────────────────────

const FONT = 'Arial';
const COLOR_PRIMARY   = '5B21B6'; // purple-700
const COLOR_RED       = 'B91C1C';
const COLOR_ORANGE    = 'C2410C';
const COLOR_YELLOW    = '92400E';
const COLOR_GRAY      = '374151';
const COLOR_LIGHT_BG  = 'F3F4F6';
const COLOR_RED_BG    = 'FEE2E2';
const COLOR_ORANGE_BG = 'FFEDD5';
const COLOR_YELLOW_BG = 'FEF9C3';

const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function spacer(pt = 6): Paragraph {
  return new Paragraph({ spacing: { before: 0, after: pt * 20 }, children: [] });
}

function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB', space: 4 } },
    children: [new TextRun({ text, font: FONT, size: 24, bold: true, color: COLOR_PRIMARY })],
  });
}

function bodyText(text: string, options: { bold?: boolean; color?: string; size?: number } = {}): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 80 },
    children: [new TextRun({
      text,
      font: FONT,
      size: options.size ?? 20,
      bold: options.bold,
      color: options.color ?? COLOR_GRAY,
    })],
  });
}

function bulletItem(text: string, color?: string): Paragraph {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun({ text, font: FONT, size: 20, color: color ?? COLOR_GRAY })],
  });
}

function makeHeader(title: string): Header {
  return new Header({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: `QIP 品質改善指標分析報告  `, font: FONT, size: 18, color: '9CA3AF' }),
          new TextRun({ text: title, font: FONT, size: 18, color: '6B7280' }),
        ],
        alignment: AlignmentType.RIGHT,
      }),
    ],
  });
}

function makeFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: `由 QIP 監測系統自動產生  ·  第 `, font: FONT, size: 16, color: '9CA3AF' }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '9CA3AF' }),
          new TextRun({ text: ' 頁', font: FONT, size: 16, color: '9CA3AF' }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    ],
  });
}

// ── 觸發瀏覽器下載 ───────────────────────────────────────────

async function downloadDocx(doc: Document, filename: string): Promise<void> {
  const buffer = await Packer.toBlob(doc);
  const url = URL.createObjectURL(buffer);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ════════════════════════════════════════════════════════════
// 1. 單指標 AI 分析報告
// ════════════════════════════════════════════════════════════

export async function exportSingleIndicatorReport(options: {
  indicatorCode: string;
  indicatorName: string;
  campus: string;
  latestValue: string;
  latestMonth: string;
  peerValue?: string;
  parsed: ParsedAnalysis;
  quarter?: string;
}): Promise<void> {
  const { indicatorCode, indicatorName, campus, latestValue, latestMonth, peerValue, parsed, quarter } = options;
  const now = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

  const children: (Paragraph | Table)[] = [
    // 標題
    new Paragraph({
      spacing: { before: 0, after: 160 },
      children: [new TextRun({ text: indicatorName, font: FONT, size: 36, bold: true, color: '1F2937' })],
    }),
    new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [
        new TextRun({ text: `${indicatorCode}  ·  ${campus}院區  ·  `, font: FONT, size: 20, color: '6B7280' }),
        new TextRun({ text: quarter ?? latestMonth, font: FONT, size: 20, color: '6B7280' }),
      ],
    }),
    new Paragraph({
      spacing: { before: 0, after: 240 },
      children: [new TextRun({ text: `報告產製日期：${now}`, font: FONT, size: 18, color: '9CA3AF' })],
    }),

    // 數值摘要表
    sectionTitle('指標概況'),
    spacer(4),
    new Table({
      width: { size: 9000, type: WidthType.DXA },
      columnWidths: [4500, 4500],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 4500, type: WidthType.DXA },
              borders: cellBorders,
              margins: { top: 120, bottom: 120, left: 160, right: 160 },
              shading: { fill: COLOR_LIGHT_BG, type: ShadingType.CLEAR },
              children: [
                new Paragraph({ children: [new TextRun({ text: '最新值', font: FONT, size: 18, color: '6B7280' })] }),
                new Paragraph({ children: [new TextRun({ text: latestValue, font: FONT, size: 32, bold: true, color: '1F2937' })] }),
                new Paragraph({ children: [new TextRun({ text: latestMonth, font: FONT, size: 18, color: '9CA3AF' })] }),
              ],
            }),
            new TableCell({
              width: { size: 4500, type: WidthType.DXA },
              borders: cellBorders,
              margins: { top: 120, bottom: 120, left: 160, right: 160 },
              shading: { fill: COLOR_LIGHT_BG, type: ShadingType.CLEAR },
              children: [
                new Paragraph({ children: [new TextRun({ text: 'TCPI 同儕標竿', font: FONT, size: 18, color: '6B7280' })] }),
                new Paragraph({ children: [new TextRun({ text: peerValue ?? '—', font: FONT, size: 32, bold: true, color: '1F2937' })] }),
              ],
            }),
          ],
        }),
      ],
    }),
    spacer(12),

    // 關鍵發現
    sectionTitle('關鍵發現'),
    spacer(4),
    ...parsed.keyFindings.map(f => bulletItem(f)),
    spacer(8),

    // 可能原因
    ...(parsed.possibleCauses.length > 0 ? [
      sectionTitle('可能原因分析'),
      spacer(4),
      ...parsed.possibleCauses.flatMap((c, i) => {
        const likelihoodColor = c.likelihood === '高' ? COLOR_RED : c.likelihood === '中' ? COLOR_ORANGE : COLOR_YELLOW;
        return [
          new Paragraph({
            spacing: { before: 120, after: 40 },
            children: [
              new TextRun({ text: `${i + 1}.  `, font: FONT, size: 20, bold: true, color: COLOR_GRAY }),
              new TextRun({ text: c.cause, font: FONT, size: 20, bold: true, color: COLOR_GRAY }),
              new TextRun({ text: `  可能性：${c.likelihood}`, font: FONT, size: 18, color: likelihoodColor }),
            ],
          }),
          new Paragraph({
            spacing: { before: 0, after: 80 },
            indent: { left: 360 },
            children: [new TextRun({ text: c.evidence, font: FONT, size: 18, color: '6B7280' })],
          }),
        ];
      }),
      spacer(8),
    ] : []),

    // 建議行動
    ...(parsed.recommendedActions.length > 0 ? [
      sectionTitle('建議改善行動'),
      spacer(4),
      ...parsed.recommendedActions.flatMap((a, i) => [
        new Paragraph({
          spacing: { before: 120, after: 40 },
          children: [
            new TextRun({ text: `${i + 1}.  `, font: FONT, size: 20, bold: true, color: COLOR_PRIMARY }),
            new TextRun({ text: a.action, font: FONT, size: 20, bold: true, color: COLOR_GRAY }),
          ],
        }),
        new Paragraph({
          spacing: { before: 0, after: 80 },
          indent: { left: 360 },
          children: [
            ...(a.timeline ? [new TextRun({ text: `時程：${a.timeline}  `, font: FONT, size: 18, color: '6B7280' })] : []),
            ...(a.owner ? [new TextRun({ text: `負責單位：${a.owner}`, font: FONT, size: 18, color: '6B7280' })] : []),
          ],
        }),
      ]),
    ] : []),
  ];

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 280 } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },
      headers: { default: makeHeader(`${indicatorCode} ${campus}院區`) },
      footers: { default: makeFooter() },
      children,
    }],
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  await downloadDocx(doc, `QIP_${indicatorCode}_${campus}_${dateStr}.docx`);
}

// ════════════════════════════════════════════════════════════
// 2. 跨院區季度分析報告
// ════════════════════════════════════════════════════════════

const URGENCY_COLOR: Record<string, string> = {
  high: COLOR_RED, medium: COLOR_ORANGE, low: COLOR_YELLOW,
};
const URGENCY_BG: Record<string, string> = {
  high: COLOR_RED_BG, medium: COLOR_ORANGE_BG, low: COLOR_YELLOW_BG,
};
const URGENCY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };

function campusSection(campus: string, result: ParsedCampusAnalysis): (Paragraph | Table)[] {
  const items: (Paragraph | Table)[] = [
    new Paragraph({
      spacing: { before: 320, after: 100 },
      children: [new TextRun({ text: `${campus}院區分析`, font: FONT, size: 26, bold: true, color: '1F2937' })],
    }),
    new Paragraph({
      spacing: { before: 60, after: 120 },
      indent: { left: 200 },
      children: [new TextRun({ text: result.campus_summary, font: FONT, size: 20, color: COLOR_GRAY })],
    }),
  ];

  if (result.focus_this_quarter) {
    items.push(
      new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [new TextRun({ text: '本季重點', font: FONT, size: 20, bold: true, color: COLOR_PRIMARY })],
      }),
      new Paragraph({
        spacing: { before: 0, after: 120 },
        indent: { left: 200 },
        children: [new TextRun({ text: result.focus_this_quarter, font: FONT, size: 20, color: COLOR_GRAY })],
      }),
    );
  }

  if (result.key_concerns.length > 0) {
    items.push(
      new Paragraph({
        spacing: { before: 80, after: 60 },
        children: [new TextRun({ text: '重點關注', font: FONT, size: 20, bold: true, color: COLOR_PRIMARY })],
      }),
    );

    result.key_concerns.forEach(concern => {
      const urgColor = URGENCY_COLOR[concern.urgency] ?? COLOR_GRAY;
      const urgBg   = URGENCY_BG[concern.urgency]    ?? COLOR_LIGHT_BG;
      items.push(
        new Table({
          width: { size: 9000, type: WidthType.DXA },
          columnWidths: [9000],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 9000, type: WidthType.DXA },
                  borders: cellBorders,
                  margins: { top: 100, bottom: 100, left: 160, right: 160 },
                  shading: { fill: urgBg, type: ShadingType.CLEAR },
                  verticalAlign: VerticalAlign.TOP,
                  children: [
                    new Paragraph({
                      spacing: { before: 0, after: 40 },
                      children: [
                        new TextRun({ text: concern.concern, font: FONT, size: 20, bold: true, color: urgColor }),
                        new TextRun({ text: `  ${concern.indicator_code} · 緊迫度：${URGENCY_LABEL[concern.urgency] ?? concern.urgency}`, font: FONT, size: 18, color: urgColor }),
                      ],
                    }),
                    ...(concern.possible_causes.length > 0 ? [
                      new Paragraph({
                        spacing: { before: 0, after: 40 },
                        children: [new TextRun({ text: `可能原因：${concern.possible_causes.join('；')}`, font: FONT, size: 18, color: urgColor })],
                      }),
                    ] : []),
                    ...(concern.recommended_action ? [
                      new Paragraph({
                        spacing: { before: 0, after: 0 },
                        children: [new TextRun({ text: `建議行動：${concern.recommended_action}`, font: FONT, size: 18, bold: true, color: urgColor })],
                      }),
                    ] : []),
                  ],
                }),
              ],
            }),
          ],
        }),
        spacer(6),
      );
    });
  }

  if (result.campus_strengths.length > 0) {
    items.push(
      new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [new TextRun({ text: '院區優點', font: FONT, size: 20, bold: true, color: '059669' })],
      }),
      ...result.campus_strengths.map(s => bulletItem(s, '065F46')),
    );
  }

  return items;
}

export async function exportCrossRampusReport(options: {
  quarter: string;
  prevQuarter: string;
  campusResults: { campus: string; result: ParsedCampusAnalysis }[];
  commonIssues: ParsedCommonIssues | null;
}): Promise<void> {
  const { quarter, prevQuarter, campusResults, commonIssues } = options;
  const now = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

  const children: (Paragraph | Table)[] = [
    // 封面標題
    new Paragraph({
      spacing: { before: 0, after: 120 },
      children: [new TextRun({ text: '跨院區季度品質分析報告', font: FONT, size: 40, bold: true, color: '1F2937' })],
    }),
    new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: `比較季度：${prevQuarter}  →  ${quarter}`, font: FONT, size: 22, color: '6B7280' })],
    }),
    new Paragraph({
      spacing: { before: 0, after: 320 },
      children: [new TextRun({ text: `報告產製日期：${now}`, font: FONT, size: 18, color: '9CA3AF' })],
    }),

    // 院級優先建議
    ...(commonIssues?.priority_recommendation ? [
      new Table({
        width: { size: 9000, type: WidthType.DXA },
        columnWidths: [9000],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 9000, type: WidthType.DXA },
                borders: cellBorders,
                margins: { top: 140, bottom: 140, left: 200, right: 200 },
                shading: { fill: 'EDE9FE', type: ShadingType.CLEAR },
                children: [
                  new Paragraph({
                    spacing: { before: 0, after: 40 },
                    children: [new TextRun({ text: '院級優先建議', font: FONT, size: 20, bold: true, color: COLOR_PRIMARY })],
                  }),
                  new Paragraph({
                    spacing: { before: 0, after: 0 },
                    children: [new TextRun({ text: commonIssues.priority_recommendation, font: FONT, size: 20, color: COLOR_GRAY })],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      spacer(16),
    ] : []),

    // 各院區分析
    ...campusResults.flatMap(({ campus, result }) => campusSection(campus, result)),

    // 跨院區共通問題
    ...(commonIssues && commonIssues.common_issues.length > 0 ? [
      spacer(8),
      new Paragraph({
        spacing: { before: 0, after: 120 },
        pageBreakBefore: true,
        children: [new TextRun({ text: '跨院區共通問題', font: FONT, size: 32, bold: true, color: '1F2937' })],
      }),
      ...commonIssues.common_issues.flatMap((issue, i) => [
        new Paragraph({
          spacing: { before: 200, after: 60 },
          children: [
            new TextRun({ text: `${i + 1}.  `, font: FONT, size: 22, bold: true, color: COLOR_GRAY }),
            new TextRun({ text: issue.issue, font: FONT, size: 22, bold: true, color: COLOR_GRAY }),
          ],
        }),
        ...(issue.affected_campuses.length > 0 ? [bodyText(`影響院區：${issue.affected_campuses.join('、')}`, { color: '6B7280' })] : []),
        ...(issue.root_cause_hypothesis ? [bodyText(`根本原因假設：${issue.root_cause_hypothesis}`, { color: '6B7280' })] : []),
        ...(issue.system_level_action ? [bodyText(`建議系統層級行動：${issue.system_level_action}`, { bold: true })] : []),
      ]),
      ...(commonIssues.positive_highlights.length > 0 ? [
        spacer(12),
        sectionTitle('正向亮點'),
        spacer(4),
        ...commonIssues.positive_highlights.map(h => bulletItem(h, '065F46')),
      ] : []),
    ] : []),
  ];

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 280 } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },
      headers: { default: makeHeader(quarter) },
      footers: { default: makeFooter() },
      children,
    }],
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  await downloadDocx(doc, `QIP_跨院區季度報告_${quarter}_${dateStr}.docx`);
}

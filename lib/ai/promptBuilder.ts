/**
 * Prompt 組裝模組
 *
 * 組裝送給 Claude 的 System Prompt 和 User Prompt。
 * 回應格式請求結構化 JSON，解析失敗時 fallback 顯示原始文字。
 */

import type { IndicatorMeta, MonthlyDataPoint, YearlySummary, AnomalyResult, ControlChartParams, IndicatorStatus } from '@/lib/types';
import type { Campus } from '@/lib/types';

export interface PromptInput {
  meta: IndicatorMeta;
  campus: Campus;
  latestValue: number | null;
  latestMonth: string | null;
  status: IndicatorStatus;
  trend: string;
  peerValue: number | null;
  peerYear: number | null;
  benchmarkValue: number | null;
  controlChart: ControlChartParams | null;
  anomalies: AnomalyResult[];
  monthlyData: MonthlyDataPoint[];
  yearlySummaries: YearlySummary[];
}

// ============================
// System Prompt
// ============================

export const SYSTEM_PROMPT = `你是一位資深醫院品質管理顧問，專精於醫療品質持續改善（QIP）。
你的角色是協助品管人員理解指標異常的可能原因，並提供實務可行的改善建議。

分析原則：
- 聚焦「為什麼」和「怎麼辦」，不只描述現象
- 回答必須具體、可執行，避免空泛的建議
- 考量醫療實務脈絡（人力、排班、設備、季節性因素等）
- 同時提供短期（1個月內）和中長期（1季內）的行動方向
- 語言：繁體中文

回應必須嚴格使用以下 JSON 格式，不要包含任何 JSON 以外的文字：

{
  "key_findings": [
    "最重要發現 1（一句話）",
    "最重要發現 2（一句話）",
    "最重要發現 3（一句話，選填）"
  ],
  "possible_causes": [
    {
      "cause": "可能原因描述",
      "likelihood": "高/中/低",
      "evidence": "支持此判斷的數據依據"
    }
  ],
  "recommended_actions": [
    {
      "action": "具體行動",
      "timeline": "立即/本週/本月/本季",
      "owner": "建議負責單位（如：護理部、品管中心、醫師團隊）"
    }
  ],
  "additional_data_needed": [
    "若要更精確分析，還需要哪些資料（選填）"
  ]
}`;

// ============================
// User Prompt 組裝
// ============================

export function buildUserPrompt(input: PromptInput): string {
  const {
    meta, campus, latestValue, latestMonth, status,
    trend, peerValue, peerYear, benchmarkValue,
    controlChart, anomalies, monthlyData, yearlySummaries,
  } = input;

  const directionLabel = meta.direction === 'lower' ? '越低越好'
    : meta.direction === 'higher' ? '越高越好' : '持續監測';

  const statusLabel: Record<string, string> = {
    alert: '警示（明顯超標）',
    warning: '注意（略超標）',
    watch: '留意（邊緣達標）',
    good: '良好',
    excellent: '卓越',
    neutral: '監測中（無標竿）',
  };

  const trendLabel: Record<string, string> = {
    up: meta.direction === 'higher' ? '上升（有利）' : '上升（不利）',
    down: meta.direction === 'lower' ? '下降（有利）' : '下降（不利）',
    flat: '持平',
  };

  // 最近 12 個月數據
  const recentMonthly = [...monthlyData]
    .filter(d => d.value !== null)
    .sort((a, b) => a.year !== b.year ? b.year - a.year : b.month - a.month)
    .slice(0, 12)
    .reverse();

  const monthlyStr = recentMonthly
    .map(d => `${d.year}/${d.month}: ${d.value}${d.denominator ? ` (${d.numerator}/${d.denominator})` : ''}`)
    .join('，');

  // 年度摘要
  const yearlyStr = yearlySummaries
    .slice(-3)
    .map(s => `${s.year}年均值: ${s.average ?? 'N/A'}`)
    .join('，');

  // 異常事件
  const anomalyStr = anomalies
    .filter(a => a.direction === 'unfavorable')
    .slice(0, 5)
    .map(a => `[${a.mechanism}] ${a.message}`)
    .join('\n');

  // 管制圖資訊
  let chartStr = '無管制圖資料';
  if (controlChart) {
    chartStr = `類型: ${controlChart.chartType}，中心線(CL): ${controlChart.cl?.toFixed(3) ?? 'N/A'}，UCL: ${controlChart.ucl?.toFixed(3) ?? 'N/A'}，LCL: ${controlChart.lcl?.toFixed(3) ?? 'N/A'}`;
  }

  return `請分析以下醫院品質指標的異常狀況，並提供改善建議。

## 指標資訊
- 指標代碼：${meta.code}
- 指標名稱：${meta.name}
- 面向：${meta.category}
- 院區：${campus}
- 方向性：${directionLabel}
- 計算說明：${meta.formula ?? '無'}

## 當前狀態
- 最新值：${latestValue ?? 'N/A'}（${latestMonth ?? ''}）
- 狀態：${statusLabel[status] ?? status}
- 趨勢：${trendLabel[trend] ?? trend}

## 標竿比較
- TCPI 標竿（${peerYear ?? ''}年）：${peerValue ?? '無資料'}
- QIP 標竿值：${benchmarkValue ?? '無資料'}

## 管制圖
${chartStr}

## 近期異常事件
${anomalyStr || '無異常事件'}

## 歷史數據（最近12個月）
${monthlyStr || '無資料'}

## 年度摘要（近3年）
${yearlyStr || '無資料'}

請根據以上資料，判斷此指標異常的可能原因及改善行動，並以指定的 JSON 格式回應。`;
}

// ============================
// 回應解析
// ============================

export interface ParsedAnalysis {
  keyFindings: string[];
  possibleCauses: { cause: string; likelihood: string; evidence: string }[];
  recommendedActions: { action: string; timeline: string; owner: string }[];
  additionalDataNeeded: string[];
}

// ============================
// Cross-campus Analysis Types
// ============================

export interface CrossCampusIndicatorInput {
  code: string;
  name: string;
  category: string;
  direction: string;
  currentValue: number | null;
  prevQuarterValue: number | null;
  changeArrow: '↑' | '↓' | '→';
  status: string;
  isUniqueToThisCampus: boolean;
  anomalyMessages: string[];
}

export interface CampusAnalysisInput {
  campus: string;
  quarter: string;
  prevQuarter: string;
  anomalousIndicators: CrossCampusIndicatorInput[];
}

export interface CommonIssuesInput {
  quarter: string;
  campusResults: { campus: string; summary: string; topConcerns: string[] }[];
  sharedCodes: { code: string; name: string }[];
}

export interface ParsedCampusAnalysis {
  campus_summary: string;
  key_concerns: {
    indicator_code: string;
    concern: string;
    urgency: 'high' | 'medium' | 'low';
    possible_causes: string[];
    recommended_action: string;
  }[];
  campus_strengths: string[];
  focus_this_quarter: string;
}

export interface ParsedCommonIssues {
  common_issues: {
    issue: string;
    affected_campuses: string[];
    related_indicators: string[];
    root_cause_hypothesis: string;
    system_level_action: string;
  }[];
  campus_differentiation: string;
  priority_recommendation: string;
  positive_highlights: string[];
}

// ============================
// Cross-campus System Prompts
// ============================

export const CAMPUS_ANALYSIS_SYSTEM_PROMPT = `你是一位資深醫院品質管理顧問，專精於 QI（品質改善）指標分析。
請以繁體中文（台灣用語）回應。

你將收到某一院區本季的異常指標清單，以及與上一季的比較。
請輸出 JSON 格式，不要包含任何 JSON 以外的文字：

{
  "campus_summary": "<30 字以內的本院區整體評估>",
  "key_concerns": [
    {
      "indicator_code": "<指標代碼>",
      "concern": "<核心問題描述>",
      "urgency": "high",
      "possible_causes": ["<原因1>", "<原因2>"],
      "recommended_action": "<最優先改善行動>"
    }
  ],
  "campus_strengths": ["<優點1>"],
  "focus_this_quarter": "<本季最需關注的事（50 字以內）>"
}

注意：
- key_concerns urgency 填 high/medium/low，最多 5 項，按緊迫程度排序
- isUniqueToThisCampus=true 的指標在分析中特別說明這是院區特色
- 若與上一季相比惡化，urgency 提高一級
- concern 欄位只描述數值事實（如：較前季上升 X%、高於同儕值 Y%），不加「顯示…惡化」「反映…問題」等結論性語句`;

export const COMMON_ISSUES_SYSTEM_PROMPT = `你是一位資深醫院品質管理顧問。
你將收到同一醫院體系三個院區的本季 AI 分析結果摘要。

請識別跨院區的共通問題，並給出整體建議。
請輸出 JSON 格式，不要包含任何 JSON 以外的文字：

{
  "common_issues": [
    {
      "issue": "<共通問題描述>",
      "affected_campuses": ["竹北", "竹東"],
      "related_indicators": ["<指標代碼1>"],
      "root_cause_hypothesis": "<可能根本原因>",
      "system_level_action": "<需要院級層面介入的改善行動>"
    }
  ],
  "campus_differentiation": "<各院區最顯著差異摘要（50 字以內）>",
  "priority_recommendation": "<給品管委員會的最高優先建議（60 字以內）；只描述問題方向與行動，不訂期限>",
  "positive_highlights": ["<跨院區正面亮點>"]
}

注意：
- common_issues 最多 3 項，只列真正跨院區的問題
- 若某指標三院區都異常，必須列入 common_issues
- priority_recommendation 不得訂定具體期限（如「一個月內」），由人工判讀後決定時程`;

// ============================
// Cross-campus Prompt Builders
// ============================

export function buildCampusAnalysisPrompt(input: CampusAnalysisInput): string {
  const indicatorLines = input.anomalousIndicators.map(ind => {
    const uniqueTag = ind.isUniqueToThisCampus ? '【院區特色】' : '';
    const anomalies = ind.anomalyMessages.length > 0
      ? `異常：${ind.anomalyMessages.slice(0, 2).join('；')}`
      : '';
    return `- ${ind.code} ${ind.name}${uniqueTag}（${ind.category}，${ind.direction}）` +
      `\n  現值：${ind.currentValue ?? 'N/A'} ${ind.changeArrow} 前季：${ind.prevQuarterValue ?? 'N/A'}` +
      `\n  狀態：${ind.status}　${anomalies}`;
  }).join('\n');

  return `請分析 ${input.campus} 院區在 ${input.quarter} 的品質指標異常狀況。

## 本季（${input.quarter}）異常指標（共 ${input.anomalousIndicators.length} 項）

${indicatorLines || '（無異常指標）'}

## 比較基準
- 對比季度：${input.prevQuarter}

請根據以上資料，判斷本院區本季的品質重點，並以指定的 JSON 格式回應。`;
}

export function buildCommonIssuesPrompt(input: CommonIssuesInput): string {
  const campusSections = input.campusResults.map(r => {
    return `### ${r.campus}\n摘要：${r.summary}\n重點關注：${r.topConcerns.slice(0, 3).join('；')}`;
  }).join('\n\n');

  const sharedStr = input.sharedCodes.length > 0
    ? input.sharedCodes.map(c => `${c.code} ${c.name}`).join('、')
    : '（無）';

  return `請分析 ${input.quarter} 跨院區品質共通問題。

## 各院區 AI 分析摘要

${campusSections}

## 三院區共同異常指標
${sharedStr}

請根據以上資料，識別跨院區共通問題與院級改善方向，並以指定的 JSON 格式回應。`;
}

// ============================
// Cross-campus Response Parsers
// ============================

export function parseCampusAnalysis(rawText: string): ParsedCampusAnalysis | null {
  try {
    const parsed = JSON.parse(extractJSON(rawText));
    return {
      campus_summary: parsed.campus_summary ?? '',
      key_concerns: Array.isArray(parsed.key_concerns) ? parsed.key_concerns : [],
      campus_strengths: Array.isArray(parsed.campus_strengths) ? parsed.campus_strengths : [],
      focus_this_quarter: parsed.focus_this_quarter ?? '',
    };
  } catch {
    return null;
  }
}

export function parseCommonIssues(rawText: string): ParsedCommonIssues | null {
  try {
    const parsed = JSON.parse(extractJSON(rawText));
    return {
      common_issues: Array.isArray(parsed.common_issues) ? parsed.common_issues : [],
      campus_differentiation: parsed.campus_differentiation ?? '',
      priority_recommendation: parsed.priority_recommendation ?? '',
      positive_highlights: Array.isArray(parsed.positive_highlights) ? parsed.positive_highlights : [],
    };
  } catch {
    return null;
  }
}

function extractJSON(rawText: string): string {
  // 1. markdown code block（含收尾）
  const m1 = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m1) return m1[1]!;
  // 2. 找第一個 { 到最後一個 }（處理未閉合的 code block）
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start !== -1 && end > start) return rawText.slice(start, end + 1);
  return rawText;
}

export function parseAIResponse(rawText: string): ParsedAnalysis | null {
  try {
    const jsonStr = extractJSON(rawText);
    const parsed = JSON.parse(jsonStr);

    return {
      keyFindings: Array.isArray(parsed.key_findings) ? parsed.key_findings : [],
      possibleCauses: Array.isArray(parsed.possible_causes) ? parsed.possible_causes : [],
      recommendedActions: Array.isArray(parsed.recommended_actions) ? parsed.recommended_actions : [],
      additionalDataNeeded: Array.isArray(parsed.additional_data_needed) ? parsed.additional_data_needed : [],
    };
  } catch {
    return null;
  }
}

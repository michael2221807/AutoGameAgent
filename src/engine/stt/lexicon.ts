// App doc: docs/user-guide/pages/game-main.md §3.14 (语音输入 · STT)
/**
 * 专有名词词典 — 纯函数层(归一化 + 组 FunASR hotwords)。
 *
 * 引擎铁律:本文件**不碰游戏字段名**、不 import vue-i18n。词表的「收割」(从游戏状态
 * 取人名/地名)在 UI 层(useSttLexicon)完成后,把纯字符串数组交给这里归一化并组成
 * 后端要的 `hotwords` JSON 字符串。
 *
 * 后端契约(docs/design/stt-hotword-handoff.md 头部回告):
 *   - 格式 `{"词":权重}` JSON 字符串;每词 2-10 汉字、1 字词/非汉字词丢弃;≤200 词、JSON≤8KB
 *   - 空/缺省 = 关闭(等价不传)
 */
import { MAX_LEXICON_TERMS, LEXICON_TERM_MIN_CHARS, LEXICON_TERM_MAX_CHARS } from './types';

/** 是否为「纯汉字且长度合规」的可用热词(2-10 个 CJK)。UI 校验加词合法性可复用。 */
export function isValidLexiconTerm(term: string): boolean {
  const t = term.trim();
  if (t.length < LEXICON_TERM_MIN_CHARS || t.length > LEXICON_TERM_MAX_CHARS) return false;
  // 仅保留全 CJK 统一表意文字的词(后端会丢弃含非汉字的词,前置对齐避免浪费名额)。
  return /^[一-鿿]+$/.test(t);
}

/**
 * 归一化词表:去空白 → 过滤(2-10 汉字) → 去重(保序) → 截断到上限。
 * 保序 = 先来的(如自定义/玩家名)优先占名额。
 */
export function normalizeLexiconTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (!isValidLexiconTerm(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_LEXICON_TERMS) break;
  }
  return out;
}

/**
 * 组成后端 `hotwords` JSON 字符串 `{"词":权重}`。空表 → 返回 ''(调用方据此不传 = 关闭)。
 * 传入的 terms 应已 normalize;此处再兜底一次(幂等)。
 */
export function buildHotwords(terms: readonly string[], weight: number): string {
  const clean = normalizeLexiconTerms(terms);
  if (clean.length === 0) return '';
  const map: Record<string, number> = {};
  for (const t of clean) map[t] = weight;
  return JSON.stringify(map);
}

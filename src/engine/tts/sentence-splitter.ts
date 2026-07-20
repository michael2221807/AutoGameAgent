// App doc: docs/user-guide/pages/game-main.md §3.13 (配音 · CosyVoice)
/**
 * TTS 文本预处理 — 纯函数,无副作用,便于单测。
 *
 * 两步:
 *   1. stripMarkersForSpeech — 去掉 AGA 正文的 markdown/inline marker 记号,避免把
 *      `【环境】` / 反引号 / 引号 / 表格竖线 等读出来。
 *   2. splitSentences — 把清洗后的整段切成"句"级片段。配音走「分句 + 每句
 *      streaming=1」流水线:逐句请求服务端流式合成,当前句播放时预取下一句,
 *      首句快出声、句间近无缝。分句让每次请求更小、可被独立 stop/回落,可靠可控。
 */

/**
 * 去掉朗读不需要的记号,保留纯可读文本。
 * - 【标签】环境标记 → 去掉方括号标签,保留内容? 环境标记 `【环境】xxx` 中
 *   `【环境】` 是分类标签不该读,内容要读 → 去掉 `【...】` 整体前缀标签,
 *   但普通正文里的书名号《》要保留。这里只剥离 AGA 已知的分类标签。
 * - 反引号 `内心` → 去反引号,读内容
 * - markdown 强调/标题/列表符号 → 去掉
 * - 表格竖线/分隔行 → 折叠为空格
 */
export function stripMarkersForSpeech(raw: string): string {
  if (!raw) return '';
  let t = raw;

  // 代码块 ``` ... ``` 整体移除(朗读代码无意义)
  t = t.replace(/```[\s\S]*?```/g, ' ');
  // 行内反引号:去引号读内容(AGA 内心独白 `...`)
  t = t.replace(/`([^`]*)`/g, '$1');
  // AGA 分类标签:行首/句中的 【环境】【判定】等作为标签前缀 → 去掉方括号本身,
  // 保留其后内容;〖判定〗同理。仅剥离括号,不吞内容。
  t = t.replace(/[【〖]([^】〗]*)[】〗]/g, '$1，');
  // markdown 标题 #、引用 >、列表 -/*/数字. 前缀
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s{0,3}>\s?/gm, '');
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, '');
  t = t.replace(/^\s{0,3}\d+\.\s+/gm, '');
  // markdown 强调 **bold** *italic* __x__ ~~x~~ → 去符号
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/\*([^*]+)\*/g, '$1');
  t = t.replace(/__([^_]+)__/g, '$1');
  t = t.replace(/~~([^~]+)~~/g, '$1');
  // markdown 表格:去掉竖线与分隔行
  t = t.replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, ' '); // 分隔行 |---|---|
  t = t.replace(/\|/g, '，');                      // 单元格分隔 → 顿号停顿
  // markdown 链接 [text](url) → text
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // 图片 ![alt](url) → 去掉
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  // 折叠多余空白
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  return t;
}

/** 句末标点(切句点,保留在片段尾部) */
const SENTENCE_END = /([。！？!?…]+|\n)/;
/** 次级切点(超长句时按这些软停顿再切) */
const SOFT_BREAK = /([，,；;：:])/;
/** 单句字符封顶 — 超过则按软停顿二次切,以此约束单次请求延迟与内存 */
const MAX_SEGMENT_LEN = 80;
/** 片段最短长度 — 短于此(即 1-2 字)的碎片并入前一段,避免极短音频卡顿;
 *  3 字及以上视为合法短句独立成段(如「下一行」)。 */
const MIN_SEGMENT_LEN = 3;

/**
 * 把清洗后的整段文本切成句级片段(供分句流式流水线逐句合成)。
 *
 * 规则:
 *   - 主切点:句末标点 。！？!?… 与换行(标点保留在片段尾)。
 *   - 超长片段(> MAX_SEGMENT_LEN)按软停顿 ，,；;：: 二次切,封顶单请求延迟。
 *   - 过短碎片(< MIN_SEGMENT_LEN)并入前一段,避免极短音频。
 *   - 空白/纯标点片段丢弃。
 *
 * 输入应为 stripMarkersForSpeech 的输出;直接传原始正文也安全(只是保留了记号)。
 */
export function splitSentences(text: string): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  // 1) 主切:句末标点/换行,保留标点在句尾。
  const primary: string[] = [];
  for (const part of cleaned.split(SENTENCE_END)) {
    if (!part) continue;
    if (SENTENCE_END.test(part)) {
      // 分隔符 → 附到上一片段尾部(换行折成句界,不入朗读)。
      if (part === '\n') continue;
      if (primary.length > 0) primary[primary.length - 1] += part;
      else primary.push(part);
    } else {
      primary.push(part);
    }
  }

  // 2) 超长片段按软停顿二次切。
  const sized: string[] = [];
  for (const seg of primary) {
    if (seg.length <= MAX_SEGMENT_LEN) {
      sized.push(seg);
      continue;
    }
    let buf = '';
    for (const chunk of seg.split(SOFT_BREAK)) {
      if (!chunk) continue;
      // 追加前预判:若当前 buf 非空且加上该 chunk 会超封顶,先把 buf flush 掉,
      // 避免"整个子句都追加进来后才发现超长"导致的一大坨片段。
      if (buf && buf.length + chunk.length > MAX_SEGMENT_LEN) {
        sized.push(buf);
        buf = '';
      }
      buf += chunk;
    }
    if (buf) sized.push(buf);
  }

  // 3) 归一化:去空白/纯标点片段;过短碎片并入前一段。
  const result: string[] = [];
  for (const raw of sized) {
    const s = raw.trim();
    if (!s) continue;
    // 纯标点(无任何字母/汉字/数字)不单独成段 → 并入前一段。
    const hasSpeakable = /[\p{L}\p{N}]/u.test(s);
    if (!hasSpeakable) {
      if (result.length > 0) result[result.length - 1] += s;
      continue;
    }
    if (s.length < MIN_SEGMENT_LEN && result.length > 0) {
      result[result.length - 1] += s;
    } else {
      result.push(s);
    }
  }
  return result;
}

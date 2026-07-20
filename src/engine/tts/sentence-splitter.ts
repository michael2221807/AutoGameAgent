/**
 * TTS 文本预处理 — 纯函数,无副作用,便于单测。
 *
 * 两个职责:
 *   1. stripMarkersForSpeech — 去掉 AGA 正文的 markdown/inline marker 记号,
 *      避免把 `【环境】` / 反引号 / 引号 / 表格竖线 等读出来。
 *   2. splitSentences — 把清洗后的文本切成句段,供 TtsService 的分段流水线
 *      (逐句合成 + 队列播放)使用。
 *
 * MVP 不区分角色 —— 所有段共用同一 speaker(设计文档 §3.5)。P2 才接
 * formatted-text-parser 的 InlineKind → speaker 映射。
 */

/** 句末标点(中/英/省略号/分号/换行作为切点) */
const SENTENCE_BOUNDARY = /([。！？…；\n]+|[.!?]+(?=\s|$))/;

/** 过短片段合并阈值(字符数)—— 低于此值的片段并入下一段,避免碎块频繁调 API。 */
const MIN_SEGMENT_LEN = 6;

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

/**
 * 把文本切成句段。已内部调用 stripMarkersForSpeech,调用方传原始正文即可。
 * 返回去空后的句段数组(每段含其句末标点)。
 */
export function splitSentences(raw: string): string[] {
  const clean = stripMarkersForSpeech(raw);
  if (!clean) return [];

  // 按边界切,保留标点(SENTENCE_BOUNDARY 用捕获组 → split 结果里标点独立成项)
  const parts = clean.split(SENTENCE_BOUNDARY);
  const merged: string[] = [];
  let buf = '';
  for (const part of parts) {
    if (!part) continue;
    buf += part;
    // 遇到边界标点(整段都是标点/换行)→ 结算当前 buf
    if (/^[。！？…；\n.!?]+$/.test(part)) {
      const seg = buf.trim();
      if (seg) merged.push(seg);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail) merged.push(tail);

  // 合并过短片段(并入下一段;末尾过短并入上一段)
  const out: string[] = [];
  for (const seg of merged) {
    if (out.length > 0 && seg.replace(/[。！？…；.!?\s]/g, '').length < MIN_SEGMENT_LEN) {
      out[out.length - 1] += seg;
    } else if (out.length > 0 && out[out.length - 1].replace(/[。！？…；.!?\s]/g, '').length < MIN_SEGMENT_LEN) {
      out[out.length - 1] += seg;
    } else {
      out.push(seg);
    }
  }
  return out.filter((s) => s.replace(/[\s，。！？…；.!?、]/g, '').length > 0);
}

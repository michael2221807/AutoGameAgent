// App doc: docs/user-guide/pages/game-main.md §3.13 (配音 · 回合全配音下载)
/**
 * WAV 拼接 — 把一个回合里逐段合成的多个 WAV blob 合并成**一个**可下载的 WAV。
 *
 * 为什么需要:假流式/整段模式下每段是独立 WAV(各自带 44+ 字节 RIFF 头)。裸字节
 * 拼接会得到多头非法文件。这里解析各 WAV 的 `fmt ` / `data` 块,拼接 PCM 数据,
 * 重写单一 RIFF 头,产出合法单文件。假定同一音色 → fmt 一致(CosyVoice 非流式
 * 24kHz WAV)。纯函数(只碰 ArrayBuffer),便于单测。
 */

function readFourCC(u8: Uint8Array, off: number): string {
  return String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
}

function writeFourCC(u8: Uint8Array, off: number, cc: string): void {
  for (let i = 0; i < 4; i++) u8[off + i] = cc.charCodeAt(i);
}

/** 解析单个 WAV,取出 fmt payload 与所有 data payload。非 WAV 抛错。 */
function parseWav(buf: ArrayBuffer): { fmt: Uint8Array; data: Uint8Array[] } {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  if (u8.length < 12 || readFourCC(u8, 0) !== 'RIFF' || readFourCC(u8, 8) !== 'WAVE') {
    throw new Error('[TTS] concat: not a RIFF/WAVE blob');
  }
  let fmt: Uint8Array | null = null;
  const data: Uint8Array[] = [];
  let off = 12;
  while (off + 8 <= u8.length) {
    const id = readFourCC(u8, off);
    const size = dv.getUint32(off + 4, true);
    const payloadStart = off + 8;
    const payloadEnd = Math.min(payloadStart + size, u8.length);
    if (id === 'fmt ' && !fmt) fmt = u8.slice(payloadStart, payloadEnd);
    else if (id === 'data') data.push(u8.slice(payloadStart, payloadEnd));
    // chunks 按偶数字节对齐(奇数 size 补 1 字节填充)
    off = payloadStart + size + (size % 2);
  }
  if (!fmt) throw new Error('[TTS] concat: no fmt chunk');
  return { fmt, data };
}

/**
 * 把多个 WAV blob 合并成一个 WAV blob。
 * - 0 个 → 空 WAV;1 个 → 原样返回(零拷贝)。
 * - 任一 blob 非 WAV 或解析失败 → 抛错(调用方回落:如只下第一段)。
 */
export async function concatWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) return new Blob([], { type: 'audio/wav' });
  if (blobs.length === 1) return blobs[0];

  const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));
  let fmt: Uint8Array | null = null;
  const dataParts: Uint8Array[] = [];
  for (const buf of buffers) {
    const parsed = parseWav(buf);
    if (!fmt) fmt = parsed.fmt;
    for (const d of parsed.data) dataParts.push(d);
  }
  if (!fmt) throw new Error('[TTS] concat: no usable WAV data');

  const dataSize = dataParts.reduce((sum, p) => sum + p.length, 0);
  const fmtSize = fmt.length;
  // RIFF chunkSize = 'WAVE'(4) + ('fmt '+size+payload)(8+fmtSize) + ('data'+size+payload)(8+dataSize)
  const riffSize = 4 + (8 + fmtSize) + (8 + dataSize);
  const out = new Uint8Array(8 + riffSize);
  const dv = new DataView(out.buffer);

  writeFourCC(out, 0, 'RIFF');
  dv.setUint32(4, riffSize, true);
  writeFourCC(out, 8, 'WAVE');
  let p = 12;
  writeFourCC(out, p, 'fmt ');
  dv.setUint32(p + 4, fmtSize, true);
  out.set(fmt, p + 8);
  p += 8 + fmtSize;
  writeFourCC(out, p, 'data');
  dv.setUint32(p + 4, dataSize, true);
  p += 8;
  for (const part of dataParts) {
    out.set(part, p);
    p += part.length;
  }
  return new Blob([out], { type: 'audio/wav' });
}

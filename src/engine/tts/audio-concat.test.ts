import { describe, it, expect } from 'vitest';
import { concatWavBlobs } from '@/engine/tts/audio-concat';

// ─── minimal WAV builder (PCM) ───
function writeStr(u8: Uint8Array, off: number, s: string): void {
  for (let i = 0; i < s.length; i++) u8[off + i] = s.charCodeAt(i);
}
function makeWav(data: number[], sampleRate = 24000, channels = 1, bits = 16): Blob {
  const bytes = new Uint8Array(data);
  const blockAlign = channels * (bits / 8);
  const byteRate = sampleRate * blockAlign;
  const buf = new ArrayBuffer(44 + bytes.length);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  writeStr(u8, 0, 'RIFF'); dv.setUint32(4, 36 + bytes.length, true); writeStr(u8, 8, 'WAVE');
  writeStr(u8, 12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true); dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true); dv.setUint16(32, blockAlign, true); dv.setUint16(34, bits, true);
  writeStr(u8, 36, 'data'); dv.setUint32(40, bytes.length, true); u8.set(bytes, 44);
  return new Blob([buf], { type: 'audio/wav' });
}

function readStr(u8: Uint8Array, off: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(u8[off + i]);
  return s;
}
/** Locate the 'data' chunk payload of a WAV ArrayBuffer. */
function dataPayload(buf: ArrayBuffer): Uint8Array {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let off = 12;
  while (off + 8 <= u8.length) {
    const id = readStr(u8, off, 4);
    const size = dv.getUint32(off + 4, true);
    if (id === 'data') return u8.slice(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  throw new Error('no data');
}

describe('concatWavBlobs', () => {
  it('returns an empty WAV for []', async () => {
    const out = await concatWavBlobs([]);
    expect(out.size).toBe(0);
    expect(out.type).toBe('audio/wav');
  });

  it('returns the single blob unchanged (identity)', async () => {
    const w = makeWav([1, 2, 3, 4]);
    const out = await concatWavBlobs([w]);
    expect(out).toBe(w);
  });

  it('merges PCM data of multiple WAVs into one valid WAV', async () => {
    const a = makeWav([10, 20, 30, 40]);
    const b = makeWav([50, 60]);
    const c = makeWav([70, 80, 90, 100, 110, 120]);
    const out = await concatWavBlobs([a, b, c]);
    const buf = await out.arrayBuffer();
    const u8 = new Uint8Array(buf);
    // Valid RIFF/WAVE header.
    expect(readStr(u8, 0, 4)).toBe('RIFF');
    expect(readStr(u8, 8, 4)).toBe('WAVE');
    // Concatenated data = a+b+c in order.
    const data = Array.from(dataPayload(buf));
    expect(data).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    // RIFF chunkSize is consistent (36 + dataSize for a canonical single fmt+data).
    const dv = new DataView(buf);
    expect(dv.getUint32(4, true)).toBe(36 + 12);
  });

  it('rejects a non-WAV blob', async () => {
    const junk = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], { type: 'audio/wav' });
    await expect(concatWavBlobs([junk, makeWav([1, 2])])).rejects.toThrow();
  });
});

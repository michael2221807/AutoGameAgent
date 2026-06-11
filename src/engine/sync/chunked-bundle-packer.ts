// Design doc: docs/design/chunked-cloud-sync-design.md
// App doc: docs/user-guide/cloud-sync.md, docs/user-guide/pages/game-save.md §2.3

// ─── Types ───

export interface ChunkManifest {
  manifestVersion: 2;
  createdAt: string;
  engineVersion: string;
  totalSizeBytes: number;
  bundleChecksum: string;
  chunks: ChunkEntry[];
}

export interface ChunkEntry {
  name: string;
  path: string;
  compressedSize: number;
  originalSize: number;
  checksum: string;
}

export interface PackResult {
  manifest: ChunkManifest;
  chunks: Map<string, Blob>;
}

export class ChecksumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChecksumError';
  }
}

// ─── Constants ───

const TARGET_CHUNK_BYTES = 20_000_000;
const ENGINE_VERSION = '0.1.0';

// ─── Public API ───

export async function pack(json: string): Promise<PackResult> {
  const bundleChecksum = await sha256String(json);
  const parsed = JSON.parse(json) as Record<string, unknown>;

  const hadImages = 'imageAssets' in parsed;
  const imageAssets = (hadImages ? parsed.imageAssets : []) as unknown[];
  // Only extract from state when there are actual images to chunk separately
  if (hadImages && imageAssets.length > 0) delete parsed.imageAssets;

  const chunks = new Map<string, Blob>();
  const entries: ChunkEntry[] = [];

  const stateJson = JSON.stringify(parsed);
  const stateEntry = await compressChunk('state', 'v2/state.gz', stateJson);
  chunks.set(stateEntry.path, stateEntry.blob);
  entries.push(stateEntry.entry);

  if (imageAssets.length > 0) {
    let currentBatch: unknown[] = [];
    let currentSize = 0;
    let chunkIndex = 0;

    for (const asset of imageAssets) {
      const assetSize = JSON.stringify(asset).length;

      if (currentSize + assetSize > TARGET_CHUNK_BYTES && currentBatch.length > 0) {
        const imgEntry = await compressChunk(
          `img-${chunkIndex}`, `v2/img-${chunkIndex}.gz`,
          JSON.stringify(currentBatch),
        );
        chunks.set(imgEntry.path, imgEntry.blob);
        entries.push(imgEntry.entry);
        chunkIndex++;
        currentBatch = [];
        currentSize = 0;
      }

      currentBatch.push(asset);
      currentSize += assetSize;
    }

    if (currentBatch.length > 0) {
      const imgEntry = await compressChunk(
        `img-${chunkIndex}`, `v2/img-${chunkIndex}.gz`,
        JSON.stringify(currentBatch),
      );
      chunks.set(imgEntry.path, imgEntry.blob);
      entries.push(imgEntry.entry);
    }
  }

  const manifest: ChunkManifest = {
    manifestVersion: 2,
    createdAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    totalSizeBytes: json.length,
    bundleChecksum,
    chunks: entries,
  };

  return { manifest, chunks };
}

export async function unpack(
  manifest: ChunkManifest,
  chunks: Map<string, Blob>,
): Promise<string> {
  // Layer 1: per-chunk checksum verification
  for (const entry of manifest.chunks) {
    const blob = chunks.get(entry.path);
    if (!blob) throw new ChecksumError(`分块 ${entry.name} 缺失`);

    const actual = await sha256Blob(blob);
    if (actual !== entry.checksum) {
      throw new ChecksumError(`分块 ${entry.name} 数据损坏（校验不通过）`);
    }
  }

  // Decompress state
  const stateEntry = manifest.chunks.find(e => e.name === 'state');
  if (!stateEntry) throw new ChecksumError('缺少 state 分块');
  const stateJson = await gzipDecompress(chunks.get(stateEntry.path)!);
  const stateObj = JSON.parse(stateJson) as Record<string, unknown>;

  // Decompress and merge image chunks (ordered by manifest)
  const imgEntries = manifest.chunks
    .filter(e => e.name.startsWith('img-'))
    .sort((a, b) => {
      const ai = parseInt(a.name.split('-')[1], 10);
      const bi = parseInt(b.name.split('-')[1], 10);
      return ai - bi;
    });

  if (imgEntries.length > 0) {
    const allImages: unknown[] = [];
    for (const entry of imgEntries) {
      const imgJson = await gzipDecompress(chunks.get(entry.path)!);
      const batch = JSON.parse(imgJson) as unknown[];
      allImages.push(...batch);
    }
    stateObj.imageAssets = allImages;
  }

  // Layer 2: bundle checksum verification
  const reassembledJson = JSON.stringify(stateObj, null, 2);
  const actualChecksum = await sha256String(reassembledJson);
  if (actualChecksum !== manifest.bundleChecksum) {
    throw new ChecksumError('存档重组校验失败（SHA-256 不匹配）');
  }

  return reassembledJson;
}

// ─── Compression ───

export async function gzipCompress(data: string): Promise<Blob> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

/**
 * Decompress a gzip blob to text.
 *
 * @param maxBytes Optional decompressed-size ceiling (default Infinity = unbounded, the legacy
 *   behavior for backup/sync). The card-import path passes a bound to defend against a zip-bomb
 *   (a small compressed blob that balloons to GBs and OOMs the tab) on an untrusted .aga-card file.
 */
export async function gzipDecompress(blob: Blob, maxBytes = Infinity): Promise<string> {
  if (maxBytes === Infinity) {
    // Fast path — unchanged legacy behavior for trusted internal callers (backup/github-sync).
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('decompressed size exceeds limit');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(merged);
}

// ─── Hashing ───

export async function sha256(data: ArrayBuffer): Promise<string> {
  // crypto.subtle requires secure context (HTTPS or localhost)
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256Js(new Uint8Array(data));
}

// Pure JS SHA-256 fallback for non-secure contexts (e.g. http://192.168.x.x dev server)
/* eslint-disable no-bitwise */
function sha256Js(data: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  const msgLen = data.length;
  const bitLen = msgLen * 8;
  const padLen = 64 - ((msgLen + 9) % 64 || 64) + msgLen + 9;
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[msgLen] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 4, bitLen & 0xffffffff);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000));

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15], 7) ^ rotr(w[i-15], 18) ^ (w[i-15] >>> 3);
      const s1 = rotr(w[i-2], 17) ^ rotr(w[i-2], 19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0;
    h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0;
  }

  return [h0,h1,h2,h3,h4,h5,h6,h7]
    .map(v => (v >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export async function sha256String(str: string): Promise<string> {
  return sha256(new TextEncoder().encode(str).buffer as ArrayBuffer);
}

export async function sha256Blob(blob: Blob): Promise<string> {
  return sha256(await blob.arrayBuffer());
}

// ─── Internal ───

async function compressChunk(
  name: string, path: string, json: string,
): Promise<{ entry: ChunkEntry; blob: Blob; path: string }> {
  const blob = await gzipCompress(json);
  const checksum = await sha256Blob(blob);

  return {
    path,
    blob,
    entry: {
      name,
      path,
      compressedSize: blob.size,
      originalSize: json.length,
      checksum,
    },
  };
}

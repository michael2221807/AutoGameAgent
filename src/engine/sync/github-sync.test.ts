import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubSyncService, type SyncStatus } from './github-sync';
import { pack } from './chunked-bundle-packer';
import type { ChunkManifest } from './chunked-bundle-packer';

// ─── Mock infrastructure ───

function createMockBackup(jsonOverride?: string) {
  const json = jsonOverride ?? JSON.stringify({
    version: 1,
    exportedAt: '2026-05-09T12:00:00Z',
    engineVersion: '0.1.0',
    bundleType: 'full',
    activeProfile: { profileId: 'p1', slotId: 's1' },
    profiles: { p1: { name: '测试角色' } },
    saves: { 'p1/s1': { 角色: { 姓名: '李明' } } },
    vectors: {},
    configs: {},
    prompts: {},
    engineSettings: { aga_theme: 'dark' },
    imageAssets: [
      { id: 'img1', metadata: { id: 'img1', backend: 'novelai', createdAt: 1 }, base64: 'A'.repeat(500), mimeType: 'image/png' },
      { id: 'img2', metadata: { id: 'img2', backend: 'civitai', createdAt: 2 }, base64: 'B'.repeat(500), mimeType: 'image/webp' },
    ],
  }, null, 2);

  return {
    exportAll: vi.fn().mockResolvedValue(new Blob([json], { type: 'application/json' })),
    importAll: vi.fn().mockResolvedValue(undefined),
  };
}

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, val: string) => storage.set(key, val),
  removeItem: (key: string) => storage.delete(key),
});

type FetchCall = { url: string; method: string; body?: unknown };
let fetchCalls: FetchCall[];
let fetchResponses: Map<string, { status: number; body: unknown }>;

function mockFetch() {
  fetchCalls = [];
  fetchResponses = new Map();

  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    let body: unknown;
    if (init?.body && typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    fetchCalls.push({ url, method, body });

    const key = `${method} ${url}`;

    // Check exact match first, then prefix match for dynamic paths
    let resp = fetchResponses.get(key);
    if (!resp) {
      for (const [pattern, r] of fetchResponses) {
        if (key.startsWith(pattern) || key.includes(pattern.replace('GET ', '').replace('PUT ', '').replace('DELETE ', ''))) {
          resp = r;
          break;
        }
      }
    }

    if (!resp) {
      // Default: 404 for GET, 201 for PUT/POST/DELETE
      if (method === 'GET') {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ content: {} }), { status: 201 });
    }

    return new Response(JSON.stringify(resp.body), { status: resp.status });
  };

  vi.stubGlobal('fetch', vi.fn(impl));
}

function setupDefaultResponses() {
  // All GETs to contents/ for SHA lookup → 404 (file doesn't exist yet)
  // PUT responses → 201 success
  // Default is already handled by mockFetch's default behavior
}

function setupV2DirectoryListing(files: Array<{ path: string; sha: string }>) {
  fetchResponses.set(
    `GET https://api.github.com/repos/testuser/aga-cloud-save/contents/v2`,
    { status: 200, body: files },
  );
}

// ─── Setup ───

beforeEach(() => {
  storage.clear();
  storage.set('aga_github_sync_token', 'ghp_test123');
  storage.set('aga_github_sync_owner', 'testuser');
  storage.set('aga_github_sync_repo', 'aga-cloud-save');
  vi.restoreAllMocks();
  mockFetch();
  setupDefaultResponses();
});

// ─── upload: basic flow ───

describe('upload — v2 chunked pipeline', () => {
  it('calls exportAll, packs, and uploads chunks + manifest', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    expect(backup.exportAll).toHaveBeenCalledOnce();

    // Should have PUT calls for state.gz, img-0.gz, manifest.json
    const puts = fetchCalls.filter(c => c.method === 'PUT');
    const putPaths = puts.map(c => c.url);

    expect(putPaths.some(p => p.includes('v2/state.gz'))).toBe(true);
    expect(putPaths.some(p => p.includes('v2/img-0.gz'))).toBe(true);
    expect(putPaths.some(p => p.includes('v2/manifest.json'))).toBe(true);
  });

  it('uploads manifest LAST (after all chunks)', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    const puts = fetchCalls.filter(c => c.method === 'PUT');
    const manifestIdx = puts.findIndex(c => c.url.includes('manifest.json'));
    const lastChunkIdx = puts.findIndex(c => c.url.includes('.gz') && !c.url.includes('manifest'));

    expect(manifestIdx).toBeGreaterThan(lastChunkIdx);
  });

  it('includes SHA when file already exists (update mode)', async () => {
    setupV2DirectoryListing([
      { path: 'v2/manifest.json', sha: 'sha_manifest_old' },
      { path: 'v2/state.gz', sha: 'existing_sha_123' },
      { path: 'v2/img-0.gz', sha: 'sha_img0_old' },
    ]);

    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    const statePut = fetchCalls.find(c => c.method === 'PUT' && c.url.includes('state.gz'));
    expect(statePut).toBeDefined();
    expect((statePut!.body as Record<string, string>).sha).toBe('existing_sha_123');
  });

  it('omits SHA when file is new (first upload, v2/ empty)', async () => {
    // Default mock: v2/ returns 404 → listV2Files returns [] → no SHAs
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    const statePut = fetchCalls.find(c => c.method === 'PUT' && c.url.includes('state.gz'));
    expect(statePut).toBeDefined();
    expect((statePut!.body as Record<string, string>).sha).toBeUndefined();
  });

  it('PUT body contains base64 content and commit message', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    const puts = fetchCalls.filter(c => c.method === 'PUT');
    for (const put of puts) {
      const body = put.body as Record<string, string>;
      expect(body.content).toBeTruthy();
      expect(body.message).toMatch(/^sync \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    }
  });
});

// ─── upload: progress callbacks ───

describe('upload — progress callbacks', () => {
  it('emits uploading stages in order', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);
    const statuses: SyncStatus[] = [];

    await sync.upload((s) => statuses.push({ ...s }));

    const messages = statuses.map(s => s.message);

    expect(statuses[0]).toEqual({ stage: 'uploading', message: '正在导出存档…' });
    expect(messages.some(m => m === '正在压缩…')).toBe(true);
    expect(messages.some(m => m.includes('正在上传分块'))).toBe(true);
    expect(messages.some(m => m === '正在更新索引…')).toBe(true);
    expect(statuses[statuses.length - 1]).toEqual({ stage: 'done', message: '上传完成' });
  });

  it('chunk progress shows correct N/total format', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);
    const statuses: SyncStatus[] = [];

    await sync.upload((s) => statuses.push({ ...s }));

    const chunkMsgs = statuses
      .map(s => s.message)
      .filter(m => m.includes('正在上传分块'));

    expect(chunkMsgs.length).toBeGreaterThanOrEqual(2); // state + img
    expect(chunkMsgs[0]).toMatch(/正在上传分块 1\/\d+…/);
    expect(chunkMsgs[1]).toMatch(/正在上传分块 2\/\d+…/);
  });
});

// ─── upload: no images bundle ───

describe('upload — bundle without images', () => {
  it('uploads only state.gz + manifest.json (no img chunks)', async () => {
    const json = JSON.stringify({
      version: 1, exportedAt: '2026-05-09', engineVersion: '0.1.0',
      profiles: {}, saves: {}, vectors: {}, configs: {}, prompts: {},
      engineSettings: {},
    }, null, 2);

    const backup = createMockBackup(json);
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    const puts = fetchCalls.filter(c => c.method === 'PUT');
    const putPaths = puts.map(c => c.url);

    expect(putPaths.some(p => p.includes('v2/state.gz'))).toBe(true);
    expect(putPaths.some(p => p.includes('v2/manifest.json'))).toBe(true);
    expect(putPaths.some(p => p.includes('v2/img-'))).toBe(false);
  });
});

// ─── upload: stale chunk cleanup ───

describe('upload — stale chunk cleanup', () => {
  it('deletes old img chunks not in new manifest', async () => {
    // Simulate: v2/ has img-0, img-1, img-2 from previous upload
    // New upload only produces img-0 → img-1 and img-2 should be deleted
    setupV2DirectoryListing([
      { path: 'v2/manifest.json', sha: 'sha_manifest' },
      { path: 'v2/state.gz', sha: 'sha_state' },
      { path: 'v2/img-0.gz', sha: 'sha_img0' },
      { path: 'v2/img-1.gz', sha: 'sha_img1' },
      { path: 'v2/img-2.gz', sha: 'sha_img2' },
    ]);

    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    const deletes = fetchCalls.filter(c => c.method === 'DELETE');
    const deletePaths = deletes.map(c => c.url);

    // img-1 and img-2 should be deleted (new upload only has img-0)
    expect(deletePaths.some(p => p.includes('img-1.gz'))).toBe(true);
    expect(deletePaths.some(p => p.includes('img-2.gz'))).toBe(true);
    // state, manifest, img-0 should NOT be deleted
    expect(deletePaths.some(p => p.includes('state.gz'))).toBe(false);
    expect(deletePaths.some(p => p.includes('manifest.json'))).toBe(false);
  });

  it('handles empty v2 directory (first upload)', async () => {
    // v2/ doesn't exist → listV2Files returns [] → no deletes
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    const deletes = fetchCalls.filter(c => c.method === 'DELETE');
    expect(deletes).toHaveLength(0);
  });

  it('handles v2 directory listing failure gracefully', async () => {
    fetchResponses.set(
      'GET https://api.github.com/repos/testuser/aga-cloud-save/contents/v2',
      { status: 500, body: { message: 'Internal Server Error' } },
    );

    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    // Should throw because listV2Files throws on non-404 errors
    await expect(sync.upload()).rejects.toThrow();
  });
});

// ─── upload: error handling ───

describe('upload — error handling', () => {
  it('throws when not configured (no token)', async () => {
    storage.delete('aga_github_sync_token');
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await expect(sync.upload()).rejects.toThrow('Token');
  });

  it('throws when not configured (no owner)', async () => {
    storage.delete('aga_github_sync_owner');
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await expect(sync.upload()).rejects.toThrow('用户名');
  });

  it('throws when PUT returns error', async () => {
    fetchResponses.set(
      'PUT https://api.github.com/repos/testuser/aga-cloud-save/contents/v2/state.gz',
      { status: 422, body: { message: 'Validation Failed' } },
    );

    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await expect(sync.upload()).rejects.toThrow(/422/);
  });
});

// ─── upload: API request format ───

describe('upload — API request details', () => {
  it('sends correct Authorization header', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    const fetchImpl = vi.mocked(fetch);
    const firstCall = fetchImpl.mock.calls[0];
    const headers = firstCall[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghp_test123');
  });

  it('uses configured repo name in URLs', async () => {
    storage.set('aga_github_sync_repo', 'my-custom-repo');
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    const puts = fetchCalls.filter(c => c.method === 'PUT');
    for (const put of puts) {
      expect(put.url).toContain('my-custom-repo');
    }
  });

  it('manifest JSON in PUT is valid and contains expected fields', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    const manifestPut = fetchCalls.find(c => c.method === 'PUT' && c.url.includes('manifest.json'));
    expect(manifestPut).toBeDefined();

    const b64Content = (manifestPut!.body as Record<string, string>).content;
    const manifestStr = new TextDecoder().decode(Uint8Array.from(atob(b64Content), c => c.charCodeAt(0)));
    const manifest = JSON.parse(manifestStr);

    expect(manifest.manifestVersion).toBe(2);
    expect(manifest.bundleChecksum).toHaveLength(64);
    expect(manifest.chunks.length).toBeGreaterThanOrEqual(2);
    expect(manifest.chunks[0].name).toBe('state');
    expect(manifest.chunks[0].path).toBe('v2/state.gz');
  });
});

// ─── upload: chunk contents ───

describe('upload — chunk contents are valid gzipped data', () => {
  it('state chunk can be decoded back to valid JSON', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    const statePut = fetchCalls.find(c => c.method === 'PUT' && c.url.includes('state.gz'));
    const b64 = (statePut!.body as Record<string, string>).content;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const blob = new Blob([bytes]);

    // Decompress
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    const parsed = JSON.parse(text);

    expect(parsed.version).toBe(1);
    expect(parsed.profiles.p1).toBeDefined();
    // imageAssets should NOT be in state (extracted to img chunks)
    expect(parsed.imageAssets).toBeUndefined();
  });

  it('image chunk can be decoded back to valid JSON array', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await sync.upload();

    const imgPut = fetchCalls.find(c => c.method === 'PUT' && c.url.includes('img-0.gz'));
    expect(imgPut).toBeDefined();

    const b64 = (imgPut!.body as Record<string, string>).content;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const blob = new Blob([bytes]);

    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    const parsed = JSON.parse(text);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0].id).toBeTruthy();
    expect(parsed[0].base64).toBeTruthy();
  });
});

// ─── Download test infrastructure ───

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function utf8ToBase64(str: string): string {
  return bytesToBase64(new TextEncoder().encode(str));
}

const REPO_BASE = 'https://api.github.com/repos/testuser/aga-cloud-save';

async function setupDownloadableBundle(bundleJson?: string): Promise<{ manifest: ChunkManifest; json: string }> {
  const json = bundleJson ?? JSON.stringify({
    version: 1,
    exportedAt: '2026-05-09T12:00:00Z',
    engineVersion: '0.1.0',
    bundleType: 'full',
    activeProfile: { profileId: 'p1', slotId: 's1' },
    profiles: { p1: { name: '李逍遥' } },
    saves: { 'p1/s1': { 角色: { 姓名: '李逍遥', 属性: { 体力: 100 } } } },
    vectors: {},
    configs: {},
    prompts: {},
    engineSettings: { aga_theme: 'dark', aga_token: null },
    imageAssets: [
      { id: 'img1', metadata: { id: 'img1', backend: 'novelai', createdAt: 1 }, base64: 'A'.repeat(500), mimeType: 'image/png' },
      { id: 'img2', metadata: { id: 'img2', backend: 'civitai', createdAt: 2, origin: 'generated' }, base64: 'B'.repeat(500), mimeType: 'image/webp' },
    ],
  }, null, 2);

  const { manifest, chunks } = await pack(json);

  // Setup manifest responses: GET contents → sha, GET blobs/{sha} → base64 content
  const manifestSha = 'sha_manifest_' + Date.now();
  const manifestB64 = utf8ToBase64(JSON.stringify(manifest, null, 2));

  fetchResponses.set(
    `GET ${REPO_BASE}/contents/v2/manifest.json`,
    { status: 200, body: { sha: manifestSha, path: 'v2/manifest.json', size: manifestB64.length } },
  );
  fetchResponses.set(
    `GET ${REPO_BASE}/git/blobs/${manifestSha}`,
    { status: 200, body: { content: manifestB64, encoding: 'base64' } },
  );

  // Setup each chunk: contents → sha, blobs → base64
  for (const entry of manifest.chunks) {
    const chunkSha = `sha_${entry.name}_${Date.now()}`;
    const chunkBytes = new Uint8Array(await chunks.get(entry.path)!.arrayBuffer());
    const chunkB64 = bytesToBase64(chunkBytes);

    fetchResponses.set(
      `GET ${REPO_BASE}/contents/${entry.path}`,
      { status: 200, body: { sha: chunkSha, path: entry.path, size: chunkBytes.length } },
    );
    fetchResponses.set(
      `GET ${REPO_BASE}/git/blobs/${chunkSha}`,
      { status: 200, body: { content: chunkB64, encoding: 'base64' } },
    );
  }

  return { manifest, json };
}

// ─── download: basic flow ───

describe('download — v2 chunked pipeline', () => {
  it('fetches manifest, downloads chunks, unpacks, and calls importAll', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);
    const { json } = await setupDownloadableBundle();

    await sync.download();

    expect(backup.importAll).toHaveBeenCalledOnce();
    const importedBlob = backup.importAll.mock.calls[0][0] as Blob;
    const importedText = await importedBlob.text();
    expect(importedText).toBe(json);
  });

  it('restores exact same data that was packed (roundtrip via API)', async () => {
    const originalJson = JSON.stringify({
      version: 1,
      exportedAt: '2026-05-09T18:00:00Z',
      engineVersion: '0.1.0',
      profiles: { p1: { name: '赵灵儿' } },
      saves: { 'p1/s1': { 角色: { 姓名: '赵灵儿', 属性: { 灵力: 200 } }, 世界: { 天气: '月光' } } },
      vectors: { 'p1/s1': { nodes: [{ embedding: new Array(10).fill(0.5) }] } },
      configs: {},
      prompts: { entries: [{ key: 'sys', value: '修仙世界' }] },
      engineSettings: { aga_nsfw: 'true' },
      customPresets: { pack1: { worlds: [{ id: 'w1' }] } },
      imageAssets: [
        { id: 'img_a', metadata: { id: 'img_a', backend: 'civitai', origin: 'upload', createdAt: 100 }, base64: 'C'.repeat(1000), mimeType: 'image/png' },
      ],
    }, null, 2);

    const backup = createMockBackup(originalJson);
    const sync = new GitHubSyncService(backup as never);
    await setupDownloadableBundle(originalJson);

    await sync.download();

    const importedBlob = backup.importAll.mock.calls[0][0] as Blob;
    expect(await importedBlob.text()).toBe(originalJson);
  });

  it('handles bundle without imageAssets', async () => {
    const json = JSON.stringify({
      version: 1, exportedAt: '2026-05-09', engineVersion: '0.1.0',
      profiles: {}, saves: {}, vectors: {}, configs: {}, prompts: {},
      engineSettings: {},
    }, null, 2);

    const backup = createMockBackup(json);
    const sync = new GitHubSyncService(backup as never);
    await setupDownloadableBundle(json);

    await sync.download();

    const importedBlob = backup.importAll.mock.calls[0][0] as Blob;
    expect(await importedBlob.text()).toBe(json);
  });
});

// ─── download: progress callbacks ───

describe('download — progress callbacks', () => {
  it('emits downloading stages in order', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);
    await setupDownloadableBundle();

    const statuses: SyncStatus[] = [];
    await sync.download((s) => statuses.push({ ...s }));

    const messages = statuses.map(s => s.message);
    expect(statuses[0]).toEqual({ stage: 'downloading', message: '正在获取云端索引…' });
    expect(messages.some(m => m.includes('正在下载分块'))).toBe(true);
    expect(messages.some(m => m === '正在校验并恢复…')).toBe(true);
    expect(statuses[statuses.length - 1]).toEqual({ stage: 'done', message: '下载并恢复完成' });
  });

  it('chunk progress shows correct N/total format', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);
    await setupDownloadableBundle();

    const statuses: SyncStatus[] = [];
    await sync.download((s) => statuses.push({ ...s }));

    const chunkMsgs = statuses.map(s => s.message).filter(m => m.includes('正在下载分块'));
    expect(chunkMsgs.length).toBeGreaterThanOrEqual(2); // state + img
    expect(chunkMsgs[0]).toMatch(/正在下载分块 1\/\d+…/);
  });
});

// ─── download: manifest not found ───

describe('download — manifest not found', () => {
  it('throws user-friendly message when manifest does not exist', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await expect(sync.download()).rejects.toThrow('云端无存档，请先上传');
    expect(backup.importAll).not.toHaveBeenCalled();
  });
});

// ─── download: error handling ───

describe('download — error handling', () => {
  it('throws when not configured', async () => {
    storage.delete('aga_github_sync_token');
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await expect(sync.download()).rejects.toThrow('Token');
  });

  it('throws when a chunk download fails (404)', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);
    const { manifest } = await setupDownloadableBundle();

    // Remove one chunk's response to simulate 404
    const imgEntry = manifest.chunks.find(c => c.name.startsWith('img-'))!;
    fetchResponses.delete(`GET ${REPO_BASE}/contents/${imgEntry.path}`);

    await expect(sync.download()).rejects.toThrow(/404/);
    expect(backup.importAll).not.toHaveBeenCalled();
  });

  it('does not call importAll when checksum verification fails', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);
    const { manifest } = await setupDownloadableBundle();

    // Tamper the manifest bundleChecksum after setup
    // We need to re-setup manifest with wrong checksum
    const tamperedManifest = { ...manifest, bundleChecksum: '0'.repeat(64) };
    const manifestSha = 'sha_tampered';
    const manifestB64 = utf8ToBase64(JSON.stringify(tamperedManifest, null, 2));

    fetchResponses.set(
      `GET ${REPO_BASE}/contents/v2/manifest.json`,
      { status: 200, body: { sha: manifestSha } },
    );
    fetchResponses.set(
      `GET ${REPO_BASE}/git/blobs/${manifestSha}`,
      { status: 200, body: { content: manifestB64, encoding: 'base64' } },
    );

    await expect(sync.download()).rejects.toThrow(/校验失败/);
    expect(backup.importAll).not.toHaveBeenCalled();
  });
});

// ─── getCloudInfo ───

describe('getCloudInfo — v2 manifest', () => {
  it('returns exists:true with correct metadata when manifest exists', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);
    const { manifest } = await setupDownloadableBundle();

    const info = await sync.getCloudInfo();

    expect(info.exists).toBe(true);
    expect(info.updatedAt).toBe(manifest.createdAt);
    expect(info.sizeKB).toBe(Math.round(manifest.totalSizeBytes / 1024));
  });

  it('returns exists:false when manifest not found', async () => {
    // Default mock returns 404 → manifest not found
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    const info = await sync.getCloudInfo();

    expect(info.exists).toBe(false);
    expect(info.updatedAt).toBeUndefined();
    expect(info.sizeKB).toBeUndefined();
  });

  it('throws on non-404 errors', async () => {
    fetchResponses.set(
      `GET ${REPO_BASE}/contents/v2/manifest.json`,
      { status: 500, body: { message: 'Server Error' } },
    );

    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);

    await expect(sync.getCloudInfo()).rejects.toThrow(/500/);
  });

  it('does not call old backup.json path', async () => {
    const backup = createMockBackup();
    const sync = new GitHubSyncService(backup as never);
    await setupDownloadableBundle();

    await sync.getCloudInfo();

    const gets = fetchCalls.filter(c => c.method === 'GET');
    const backupJsonCalls = gets.filter(c => c.url.includes('backup.json'));
    expect(backupJsonCalls).toHaveLength(0);
  });
});

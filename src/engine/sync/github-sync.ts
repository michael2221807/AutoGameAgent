// Archived research: docs/design/archive/cloud-sync-options.md
// App doc: docs/user-guide/cloud-sync.md, docs/user-guide/pages/game-save.md §2.2 + §7.5 (上传保护), docs/user-guide/pages/home.md §1.3.3
/**
 * GitHub Sync Service — 通过 GitHub Contents API 实现存档云同步
 *
 * API 参考：https://docs.github.com/en/rest/repos/contents
 *
 * 前提条件：
 * - 用户手动创建一个私有仓库（如 aga-cloud-save），勾选 auto_init
 * - 创建 Fine-grained PAT，权限：Contents → Read & Write，仅限该仓库
 * - 或创建 Classic PAT，scope: repo
 *
 * 设计：
 * - 不自动创建仓库（避免需要 Administration 权限）
 * - 纯浏览器实现，api.github.com 原生 CORS
 * - 全覆盖语义：上传覆盖云端，下载覆盖本地
 * - 用户需提供 GitHub 用户名（fine-grained PAT 可能无法通过 GET /user 获取）
 */

import type { BackupService, ExportImageIntegrity } from '../persistence/backup-service';
import { packChunks, unpack, type ChunkManifest } from './chunked-bundle-packer';

// ─── 常量 ───

const API = 'https://api.github.com';
const SAVE_PATH = 'backup.json';
const MANIFEST_PATH = 'v2/manifest.json';
const V2_DIR = 'v2';
const LS_TOKEN = 'aga_github_sync_token';
const LS_OWNER = 'aga_github_sync_owner';
const LS_REPO = 'aga_github_sync_repo';
const DEFAULT_REPO = 'aga-cloud-save';
const API_VERSION = '2022-11-28';

// ─── 类型 ───

export interface SyncStatus {
  stage: 'idle' | 'checking' | 'uploading' | 'downloading' | 'done' | 'error';
  message: string;
}

export interface DegradedUploadDetail {
  /** distinct image asset ids referenced by the local save being exported */
  referencedAssets: number;
  /** how many of those were actually exported (fewer = local image cache evicted) */
  exportedAssets: number;
  /** referencedAssets − exportedAssets: images that would be MISSING from the upload */
  missingAssets: number;
}

/**
 * Thrown by {@link GitHubSyncService.upload} BEFORE any cloud file is touched when
 * the outgoing backup references more image assets than it could actually export —
 * i.e. the local image cache was evicted (TOTALLY or PARTIALLY), so uploading would
 * replace a healthy cloud save with an image-degraded one. The UI catches this,
 * shows the specifics, and may re-call upload with `{ force: true }` after explicit
 * user confirmation. Primary guard against the 2026-07-10 class of incident.
 */
export class DegradedUploadError extends Error {
  constructor(public readonly detail: DegradedUploadDetail) {
    super('degraded-upload-blocked');
    this.name = 'DegradedUploadError';
  }
}

// ─── 服务 ───

export class GitHubSyncService {
  constructor(private backup: BackupService) {}

  // ── 配置读写 ──

  getToken(): string { return localStorage.getItem(LS_TOKEN) ?? ''; }
  setToken(v: string): void { v.trim() ? localStorage.setItem(LS_TOKEN, v.trim()) : localStorage.removeItem(LS_TOKEN); }

  getOwner(): string { return localStorage.getItem(LS_OWNER) ?? ''; }
  setOwner(v: string): void { v.trim() ? localStorage.setItem(LS_OWNER, v.trim()) : localStorage.removeItem(LS_OWNER); }

  getRepoName(): string { return localStorage.getItem(LS_REPO) || DEFAULT_REPO; }
  setRepoName(v: string): void { localStorage.setItem(LS_REPO, v.trim() || DEFAULT_REPO); }

  isConfigured(): boolean { return !!(this.getToken() && this.getOwner()); }

  // ── 验证连接 ──

  async validate(): Promise<{ ok: boolean; error?: string }> {
    if (!this.getToken()) return { ok: false, error: '请填写 Token' };

    // 1. 尝试 GET /user 自动获取用户名
    try {
      const user = await this.get<{ login: string }>('/user');
      if (user.login) this.setOwner(user.login);
    } catch {
      // fine-grained PAT 可能 403 — 需要用户手动填写用户名
    }

    // 2. 检查 owner 是否已知
    const owner = this.getOwner();
    if (!owner) {
      return { ok: false, error: '无法自动获取用户名，请手动填写 GitHub 用户名' };
    }

    // 3. 验证能否访问目标仓库
    const repo = this.getRepoName();
    try {
      await this.get(`/repos/${owner}/${repo}`);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return { ok: false, error: `仓库 ${owner}/${repo} 不存在。请先在 GitHub 上手动创建该私有仓库。` };
      }
      return { ok: false, error: fmtErr(err) };
    }
  }

  // ── 上传存档（v2 分块管道）──

  async upload(onStatus?: (s: SyncStatus) => void, opts?: { force?: boolean }): Promise<void> {
    const emit = (stage: SyncStatus['stage'], message: string) => onStatus?.({ stage, message });
    const { owner, repo } = this.resolveTarget();

    emit('uploading', '正在导出存档…');
    let exportBlob: Blob;
    let imageIntegrity: ExportImageIntegrity;
    try {
      // Atomic export: the blob AND its image integrity come from the SAME call, so
      // the guard evaluates exactly this export (no shared-field TOCTOU with a
      // concurrent export).
      ({ blob: exportBlob, imageIntegrity } = await this.backup.exportForSync());
    } catch (err) {
      throw stageError('导出存档', err);
    }
    const approxMB = Math.round(exportBlob.size / 1_048_576);

    // ── Overwrite guardrail (hard block unless forced) ──
    // Runs BEFORE any cloud file is created/overwritten, so a block leaves the cloud
    // save fully intact. Fires whenever the export references MORE image assets than
    // it could actually produce (referencedAssets > exportedAssets) — the local
    // image cache was evicted, TOTALLY (21→0, the reported incident) or PARTIALLY
    // (21→15). An internally-consistent export (referenced === exported, incl. a
    // legitimately imageless save) is never blocked, so deliberate profile/image
    // deletion uploads freely without a false alarm.
    if (!opts?.force && imageIntegrity.referencedAssets > imageIntegrity.exportedAssets) {
      throw new DegradedUploadError({
        referencedAssets: imageIntegrity.referencedAssets,
        exportedAssets: imageIntegrity.exportedAssets,
        missingAssets: imageIntegrity.referencedAssets - imageIntegrity.exportedAssets,
      });
    }

    // Batch-fetch the existing v2/ listing up front (needed for the manifest.json
    // SHA on the in-place manifest write, and for cleaning up old chunks after the
    // commit). Must run BEFORE the first chunk PUT.
    let existingFiles: Array<{ path: string; sha: string }>;
    try {
      existingFiles = await this.listV2Files(owner, repo);
    } catch (err) {
      throw stageError('读取云端文件列表', err);
    }
    const shaMap = new Map(existingFiles.map(f => [f.path, f.sha]));

    // STREAMING pack + upload: compress ONE chunk, PUT it, release it, then
    // compress the next — memory stays bounded to ~one chunk instead of holding
    // the whole compressed set. The eager pack() held every compressed chunk in a
    // Map and OOM-crashed the tab on 110MB+ base64-image saves; feeding the Blob
    // (not exportBlob.text()) also keeps the decoded JSON string generator-local
    // so the caller never holds a second ~100MB copy.
    //
    // ATOMICITY (2026-07-09 audit fix): each chunk is written to a per-upload,
    // GENERATION-SUFFIXED path (v2/state-0.<genTag>.gz), never the bare path a
    // PRIOR upload used. So a re-upload can NEVER overwrite a chunk the CURRENT
    // cloud manifest still references. Combined with writing the manifest LAST,
    // this makes an interrupted upload truly non-destructive: the old manifest
    // keeps pointing at its old chunks, whose bytes are untouched (the new bytes
    // went to fresh paths), so the previously-healthy cloud save stays
    // downloadable. Old-generation chunks are pruned by cleanupStaleFromList only
    // AFTER the new manifest commits. (Previously chunks were overwritten in place
    // at stable paths, so an interrupted upload could brick the live save — the
    // "old chunks intact" claim was false whenever a path was reused.)
    const genTag = uploadGenTag();
    emit('uploading', '正在压缩并上传…');
    const gen = packChunks(exportBlob);
    let res: IteratorResult<{ path: string; blob: Blob }, ChunkManifest>;
    try {
      res = await gen.next();
    } catch (err) {
      throw stageError(`压缩存档（约 ${approxMB}MB）`, err);
    }
    let uploaded = 0;
    const genPathByOriginal = new Map<string, string>();
    while (!res.done) {
      const { path, blob } = res.value;
      const genPath = withGenTag(path, genTag);
      genPathByOriginal.set(path, genPath);
      uploaded++;
      emit('uploading', `正在压缩并上传分块 ${uploaded}…`);
      try {
        // Fresh generation path → always a NEW file → create (no SHA, never an
        // in-place overwrite of a live-referenced chunk).
        await this.uploadFile(owner, repo, genPath, await blobToBase64(blob), undefined);
      } catch (err) {
        throw stageError(`上传分块 ${genPath}`, err);
      }
      // Advance the generator only after the current chunk is uploaded + released,
      // so the next chunk's compression peak never overlaps a retained prior chunk.
      try {
        res = await gen.next();
      } catch (err) {
        throw stageError(`压缩存档（约 ${approxMB}MB）`, err);
      }
    }
    const manifest = res.value;
    // Point the manifest at the generation-suffixed paths we actually wrote, so a
    // download fetches the freshly-written chunks. (Names stay canonical —
    // 'state'/'state-N'/'img-N' — only paths carry the generation tag.)
    for (const c of manifest.chunks) {
      const gp = genPathByOriginal.get(c.path);
      if (gp) c.path = gp;
    }

    // The manifest is written LAST so it is the commit point: if any chunk PUT
    // above fails, the cloud still has the OLD manifest pointing at OLD chunks,
    // so a partial upload can never be silently downloaded as wrong data (it
    // fails loudly via the per-chunk SHA-256 check on download).
    emit('uploading', '正在更新索引…');
    try {
      const manifestJson = JSON.stringify(manifest, null, 2);
      await this.uploadFile(owner, repo, MANIFEST_PATH, utf8ToBase64(manifestJson), shaMap.get(MANIFEST_PATH));
    } catch (err) {
      throw stageError('更新云端索引', err);
    }

    // Cleanup stale chunks using the already-fetched listing
    this.cleanupStaleFromList(owner, repo, manifest, existingFiles);

    emit('done', '上传完成');
  }

  // ── v1 上传方法（保留供紧急回退，当前不调用）──

  // @ts-expect-error kept for emergency rollback
  private async uploadViaContentsApi(
    owner: string, repo: string, b64: string,
    emit: (stage: SyncStatus['stage'], message: string) => void,
  ): Promise<void> {
    emit('uploading', '正在上传…');
    const sha = await this.getFileSha(owner, repo, SAVE_PATH);
    const body: Record<string, string> = {
      message: `sync ${new Date().toISOString().slice(0, 19)}`,
      content: b64,
    };
    if (sha) body.sha = sha;
    await this.put(`/repos/${owner}/${repo}/contents/${SAVE_PATH}`, body);
  }

  // @ts-expect-error kept for emergency rollback
  private async uploadViaGitDataApi(
    owner: string, repo: string, b64: string,
    emit: (stage: SyncStatus['stage'], message: string) => void,
  ): Promise<void> {
    const commitMsg = `sync ${new Date().toISOString().slice(0, 19)}`;

    const repoInfo = await this.get<{ default_branch: string }>(`/repos/${owner}/${repo}`);
    const branch = repoInfo.default_branch;

    emit('uploading', '正在上传存档数据…');
    const blobRes = await this.post<{ sha: string }>(
      `/repos/${owner}/${repo}/git/blobs`,
      { content: b64, encoding: 'base64' },
    );

    emit('uploading', '正在同步仓库状态…');
    const refRes = await this.get<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    );
    const parentSha = refRes.object.sha;

    const commitInfo = await this.get<{ tree: { sha: string } }>(
      `/repos/${owner}/${repo}/git/commits/${parentSha}`,
    );

    emit('uploading', '正在构建提交…');
    const treeRes = await this.post<{ sha: string }>(
      `/repos/${owner}/${repo}/git/trees`,
      {
        base_tree: commitInfo.tree.sha,
        tree: [{
          path: SAVE_PATH,
          mode: '100644',
          type: 'blob',
          sha: blobRes.sha,
        }],
      },
    );

    const newCommit = await this.post<{ sha: string }>(
      `/repos/${owner}/${repo}/git/commits`,
      {
        message: commitMsg,
        tree: treeRes.sha,
        parents: [parentSha],
      },
    );

    emit('uploading', '正在更新分支…');
    await this.patch(
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      { sha: newCommit.sha, force: false },
    );
  }

  // ── 下载存档（v2 分块管道）──

  async download(onStatus?: (s: SyncStatus) => void): Promise<void> {
    const emit = (stage: SyncStatus['stage'], message: string) => onStatus?.({ stage, message });
    const { owner, repo } = this.resolveTarget();

    emit('downloading', '正在获取云端索引…');
    let manifest: ChunkManifest;
    try {
      manifest = await this.fetchManifest(owner, repo);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new Error('云端无存档，请先上传');
      }
      throw err;
    }

    const total = manifest.chunks.length;
    const chunks = new Map<string, Blob>();

    for (let i = 0; i < manifest.chunks.length; i++) {
      const entry = manifest.chunks[i];
      emit('downloading', `正在下载分块 ${i + 1}/${total}…`);
      chunks.set(entry.path, await this.downloadBlob(owner, repo, entry.path));
    }

    emit('downloading', '正在校验并恢复…');
    const json = await unpack(manifest, chunks);
    await this.backup.importAll(new Blob([json], { type: 'application/json' }));
    emit('done', '下载并恢复完成');
  }

  // ── v1 下载（保留供紧急回退，当前不调用）──

  // @ts-expect-error kept for emergency rollback
  private async downloadV1(onStatus?: (s: SyncStatus) => void): Promise<void> {
    const emit = (stage: SyncStatus['stage'], message: string) => onStatus?.({ stage, message });
    const { owner, repo } = this.resolveTarget();

    emit('downloading', '正在获取文件信息…');
    const meta = await this.get<{ sha: string }>(`/repos/${owner}/${repo}/contents/${SAVE_PATH}`);

    emit('downloading', '正在下载存档…');
    const blob = await this.get<{ content: string; encoding: string }>(
      `/repos/${owner}/${repo}/git/blobs/${meta.sha}`,
    );
    if (blob.encoding !== 'base64') throw new Error(`Blob API 返回了非预期编码: ${blob.encoding}`);

    emit('downloading', '正在恢复本地数据…');
    const json = base64ToUtf8(blob.content);
    await this.backup.importAll(new Blob([json], { type: 'application/json' }));
    emit('done', '下载并恢复完成');
  }

  // ── 查询云端信息（v2）──

  async getCloudInfo(): Promise<{ exists: boolean; updatedAt?: string; sizeKB?: number }> {
    const { owner, repo } = this.resolveTarget();
    try {
      const manifest = await this.fetchManifest(owner, repo);
      return {
        exists: true,
        updatedAt: manifest.createdAt,
        sizeKB: Math.round(manifest.totalSizeBytes / 1024),
      };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return { exists: false };
      throw err;
    }
  }

  // ── v2 下载辅助 ──

  private async fetchManifest(owner: string, repo: string): Promise<ChunkManifest> {
    const meta = await this.get<{ sha: string }>(`/repos/${owner}/${repo}/contents/${MANIFEST_PATH}`);
    const blob = await this.get<{ content: string; encoding: string }>(
      `/repos/${owner}/${repo}/git/blobs/${meta.sha}`,
    );
    if (blob.encoding !== 'base64') throw new Error(`Unexpected blob encoding: ${blob.encoding}`);
    const json = base64ToUtf8(blob.content);
    return JSON.parse(json) as ChunkManifest;
  }

  private async downloadBlob(owner: string, repo: string, path: string): Promise<Blob> {
    const meta = await this.get<{ sha: string }>(`/repos/${owner}/${repo}/contents/${path}`);
    const blobRes = await this.get<{ content: string; encoding: string }>(
      `/repos/${owner}/${repo}/git/blobs/${meta.sha}`,
    );
    if (blobRes.encoding !== 'base64') throw new Error(`Unexpected blob encoding: ${blobRes.encoding}`);
    const cleaned = blobRes.content.replace(/\s/g, '');
    const bin = atob(cleaned);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes]);
  }

  // ── v2 上传辅助 ──

  private async uploadFile(
    owner: string, repo: string, path: string, b64Content: string,
    knownSha?: string,
  ): Promise<void> {
    const sha = knownSha ?? null;
    const body: Record<string, string> = {
      message: `sync ${new Date().toISOString().slice(0, 19)}`,
      content: b64Content,
    };
    if (sha) body.sha = sha;
    await this.put(`/repos/${owner}/${repo}/contents/${path}`, body);
  }

  private cleanupStaleFromList(
    owner: string, repo: string, manifest: ChunkManifest,
    existingFiles: Array<{ path: string; sha: string }>,
  ): void {
    const validPaths = new Set([
      MANIFEST_PATH,
      ...manifest.chunks.map(c => c.path),
    ]);

    for (const file of existingFiles) {
      if (!validPaths.has(file.path)) {
        this.del(`/repos/${owner}/${repo}/contents/${file.path}`, {
          message: `cleanup ${file.path}`,
          sha: file.sha,
        }).catch(() => { /* stale chunk deletion is best-effort */ });
      }
    }
  }

  private async listV2Files(owner: string, repo: string): Promise<Array<{ path: string; sha: string }>> {
    try {
      const items = await this.get<Array<{ path: string; sha: string }>>(
        `/repos/${owner}/${repo}/contents/${V2_DIR}`,
      );
      return Array.isArray(items) ? items : [];
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return [];
      throw err;
    }
  }

  // ── 内部 ──

  private resolveTarget(): { owner: string; repo: string } {
    const owner = this.getOwner();
    const repo = this.getRepoName();
    if (!owner) throw new Error('请填写 GitHub 用户名');
    if (!this.getToken()) throw new Error('请填写 Token');
    return { owner, repo };
  }

  private async getFileSha(owner: string, repo: string, path: string): Promise<string | null> {
    try {
      const res = await this.get<{ sha: string }>(`/repos/${owner}/${repo}/contents/${path}`);
      return res.sha;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${API}${path}`, { headers: this.headers() });
    if (!res.ok) throw new ApiError(res.status, await safeBody(res));
    return res.json() as Promise<T>;
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, await safeBody(res));
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, await safeBody(res));
    return res.json() as Promise<T>;
  }

  private async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, await safeBody(res));
    return res.json() as Promise<T>;
  }

  private async del(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${API}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, await safeBody(res));
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.getToken()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    };
  }
}

// ─── 工具 ───

export class ApiError extends Error {
  constructor(public status: number, body: string) {
    super(`GitHub API ${status}: ${body.slice(0, 300)}`);
  }
}

function fmtErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Per-upload generation tag. Chunk filenames are suffixed with it so each upload
 * writes to fresh paths and never overwrites a chunk the current cloud manifest
 * still references — the property that makes "manifest written last" atomic.
 * Timestamp + a small random suffix keeps it unique even for two uploads in the
 * same millisecond.
 */
function uploadGenTag(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')}`;
}

/** Insert the generation tag before the `.gz` extension: `v2/state-0.gz` → `v2/state-0.<tag>.gz`. */
function withGenTag(path: string, tag: string): string {
  return path.replace(/\.gz$/, `.${tag}.gz`);
}

/**
 * Wrap a stage failure so the surfaced message names the failing step.
 *
 * `fetch()` (and `Response.blob()` over a failed CompressionStream) throws a
 * bare `TypeError: Failed to fetch` with no HTTP status and no Network-tab
 * entry — useless on its own. Prefixing the stage + a likely-cause hint turns
 * it into something actionable, while preserving the original stack.
 */
function stageError(stage: string, err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const hint = /failed to fetch/i.test(raw)
    ? '（网络中断、被浏览器/扩展拦截，或存档过大导致内存不足）'
    : '';
  const wrapped = new Error(`${stage}失败：${raw}${hint}`);
  if (err instanceof Error && err.stack) wrapped.stack = err.stack;
  return wrapped;
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const CHUNK = 8192;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}


function base64ToUtf8(b64: string): string {
  const cleaned = b64.replace(/\s/g, '');
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function safeBody(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 8192;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

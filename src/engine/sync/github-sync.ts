// Archived research: docs/design/archive/cloud-sync-options.md
// App doc: docs/user-guide/cloud-sync.md, docs/user-guide/pages/game-save.md §2.3, docs/user-guide/pages/home.md §1.3.3
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

import type { BackupService } from '../persistence/backup-service';
import { pack, unpack, type ChunkManifest } from './chunked-bundle-packer';

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

  async upload(onStatus?: (s: SyncStatus) => void): Promise<void> {
    const emit = (stage: SyncStatus['stage'], message: string) => onStatus?.({ stage, message });
    const { owner, repo } = this.resolveTarget();

    emit('uploading', '正在导出存档…');
    const exportBlob = await this.backup.exportAll();
    const json = await exportBlob.text();

    emit('uploading', '正在压缩…');
    const { manifest, chunks } = await pack(json);
    const total = chunks.size;

    // Batch-fetch existing file SHAs to avoid per-file 404s
    const existingFiles = await this.listV2Files(owner, repo);
    const shaMap = new Map(existingFiles.map(f => [f.path, f.sha]));

    let i = 0;
    for (const [path, blob] of chunks) {
      i++;
      emit('uploading', `正在上传分块 ${i}/${total}…`);
      await this.uploadFile(owner, repo, path, await blobToBase64(blob), shaMap.get(path));
    }

    emit('uploading', '正在更新索引…');
    const manifestJson = JSON.stringify(manifest, null, 2);
    await this.uploadFile(owner, repo, MANIFEST_PATH, utf8ToBase64(manifestJson), shaMap.get(MANIFEST_PATH));

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

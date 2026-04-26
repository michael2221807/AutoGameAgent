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

// ─── 常量 ───

const API = 'https://api.github.com';
const SAVE_PATH = 'backup.json';
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

  // ── 上传存档 ──

  async upload(onStatus?: (s: SyncStatus) => void): Promise<void> {
    const emit = (stage: SyncStatus['stage'], message: string) => onStatus?.({ stage, message });
    const { owner, repo } = this.resolveTarget();

    emit('uploading', '正在导出存档…');
    const blob = await this.backup.exportAll();
    if (blob.size > 75_000_000) {
      throw new Error(`存档 ${Math.round(blob.size / 1048576)}MB 超过 GitHub 上限（~75MB）`);
    }
    const json = await blob.text();
    const b64 = utf8ToBase64(json);

    emit('uploading', '正在上传…');

    // 获取当前文件 SHA（如果文件已存在则需要）
    const sha = await this.getFileSha(owner, repo, SAVE_PATH);

    const body: Record<string, string> = {
      message: `sync ${new Date().toISOString().slice(0, 19)}`,
      content: b64,
    };
    if (sha) body.sha = sha;

    await this.put(`/repos/${owner}/${repo}/contents/${SAVE_PATH}`, body);
    emit('done', '上传完成');
  }

  // ── 下载存档 ──

  async download(onStatus?: (s: SyncStatus) => void): Promise<void> {
    const emit = (stage: SyncStatus['stage'], message: string) => onStatus?.({ stage, message });
    const { owner, repo } = this.resolveTarget();

    emit('downloading', '正在从 GitHub 下载…');

    // Use raw media type to support files > 1MB (Contents API returns encoding: "none" for large files)
    const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${SAVE_PATH}`, {
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': API_VERSION,
      },
    });
    if (!res.ok) throw new ApiError(res.status, await safeBody(res));

    emit('downloading', '正在恢复本地数据…');
    const blob = await res.blob();
    await this.backup.importAll(blob);
    emit('done', '下载并恢复完成');
  }

  // ── 查询云端信息 ──

  async getCloudInfo(): Promise<{ exists: boolean; updatedAt?: string; sizeKB?: number }> {
    const { owner, repo } = this.resolveTarget();
    try {
      const file = await this.get<{ size: number }>(
        `/repos/${owner}/${repo}/contents/${SAVE_PATH}`,
      );
      // 获取最新 commit 时间
      let updatedAt: string | undefined;
      try {
        const commits = await this.get<Array<{ commit: { committer: { date: string } } }>>(
          `/repos/${owner}/${repo}/commits?path=${SAVE_PATH}&per_page=1`,
        );
        if (Array.isArray(commits) && commits.length > 0) {
          updatedAt = commits[0].commit.committer.date;
        }
      } catch { /* non-critical */ }
      return { exists: true, updatedAt, sizeKB: Math.round(file.size / 1024) };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return { exists: false };
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

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.getToken()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    };
  }
}

// ─── 工具 ───

class ApiError extends Error {
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


async function safeBody(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

/**
 * Image Task Queue — Sprint Image-4
 *
 * Manages pending image generation tasks. Serial execution by default;
 * parallelism classification per PRINCIPLES §3.14 deferred to Image-5.
 *
 * Supports optional persistence callback: when provided, every mutation
 * triggers onPersist with the full task list, allowing the caller
 * to write to state tree + auto-save.
 */
import type { ImageTask, ImageTaskStatus } from './types';

let taskIdCounter = 1;

export class ImageTaskQueue {
  private tasks = new Map<string, ImageTask>();
  private onPersist?: (tasks: ImageTask[]) => void;

  constructor(options?: { onPersist?: (tasks: ImageTask[]) => void }) {
    this.onPersist = options?.onPersist;
  }

  /** Restore tasks from persisted data (called on game load) */
  restore(saved: ImageTask[]): void {
    this.tasks.clear();
    let maxSeen = 0;
    for (const t of saved) {
      this.tasks.set(t.id, t);
      // Extract counter from ID format: img_task_<N>_<timestamp>
      const n = parseInt(t.id.split('_')[2] ?? '0', 10);
      if (n > maxSeen) maxSeen = n;
    }
    if (maxSeen >= taskIdCounter) taskIdCounter = maxSeen + 1;
  }

  create(params: Omit<ImageTask, 'id' | 'status' | 'createdAt' | 'updatedAt'>): ImageTask {
    const now = Date.now();
    const task: ImageTask = {
      id: `img_task_${taskIdCounter++}_${now}`,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ...params,
    };
    this.tasks.set(task.id, task);
    this.persist();
    return task;
  }

  updateStatus(taskId: string, status: ImageTaskStatus, extra?: Partial<ImageTask>): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.tasks.set(taskId, { ...task, status, updatedAt: Date.now(), ...extra });
    this.persist();
  }

  get(taskId: string): ImageTask | undefined {
    return this.tasks.get(taskId);
  }

  getPending(): ImageTask[] {
    return [...this.tasks.values()].filter((t) => t.status === 'pending');
  }

  getAll(): ImageTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  remove(taskId: string): void {
    this.tasks.delete(taskId);
    this.persist();
  }

  clear(): void {
    this.tasks.clear();
    this.persist();
  }

  private persist(): void {
    // Auto-evict oldest completed/failed tasks beyond cap to prevent unbounded growth
    const MAX_FINISHED = 50;
    const finished = [...this.tasks.values()]
      .filter((t) => t.status === 'complete' || t.status === 'failed')
      .sort((a, b) => b.createdAt - a.createdAt);
    if (finished.length > MAX_FINISHED) {
      for (const t of finished.slice(MAX_FINISHED)) {
        this.tasks.delete(t.id);
      }
    }
    this.onPersist?.(this.getAll());
  }
}

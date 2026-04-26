/**
 * Command fixture factories for CommandExecutor tests.
 */
interface Command {
  action: string;
  key: string;
  value?: unknown;
  [k: string]: unknown;
}

export function makeSetCommand(key: string, value: unknown): Command {
  return { action: 'set', key, value };
}

export function makeAddCommand(key: string, value: number): Command {
  return { action: 'add', key, value };
}

export function makeDeleteCommand(key: string): Command {
  return { action: 'delete', key };
}

export function makePushCommand(key: string, value: unknown): Command {
  return { action: 'push', key, value };
}

export function makePullCommand(key: string, value: unknown): Command {
  return { action: 'pull', key, value };
}

export function makeInvalidCommand(overrides?: Partial<Command>): Record<string, unknown> {
  return { ...overrides };
}

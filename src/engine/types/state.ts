/** Generic game state tree — structure fully defined by Game Pack schema */
export type GameStateTree = Record<string, unknown>;

/** Dot-path string, e.g. "角色.属性.体力.当前" */
export type StatePath = string;

/** Command action types */
export type CommandAction = 'set' | 'add' | 'delete' | 'push' | 'pull';

/** Single state change record */
export interface StateChange {
  path: StatePath;
  action: CommandAction;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

/** Transaction log grouping multiple changes */
export interface ChangeLog {
  changes: StateChange[];
  source: 'command' | 'system' | 'user';
  timestamp: number;
}

/** Single command — AI returns these in the commands array */
export interface Command {
  action: CommandAction;
  key: StatePath;
  value?: unknown;
}

/** Result of executing a single command */
export interface CommandResult {
  success: boolean;
  /** Original command reference */
  command: Command;
  change?: StateChange;
  error?: string;
}

/** Result of executing a batch of commands */
export interface BatchCommandResult {
  results: CommandResult[];
  /** Aggregated change log for the batch */
  changeLog: ChangeLog;
  /** Whether any command failed */
  hasErrors: boolean;
}

/** Action queue entry — player actions queued for next AI round */
export interface QueuedAction {
  id: string;
  type: string;
  description: string;
  data?: Record<string, unknown>;
  createdAt: number;
}

/**
 * World Book data model — ported from MRJH models/worldbook.ts
 *
 * The world book system allows users to manage prompt entries that get
 * injected into the AI context. Entries can override built-in prompts
 * via slot ID matching, or inject additional lore/rules by scope + keywords.
 */

// ─── Entry Types ────────────────────────────────────────────

export type WorldBookEntryType = 'world_lore' | 'system_rule' | 'command_rule' | 'output_rule';

export type WorldBookScope =
  | 'main'
  | 'opening'
  | 'world_evolution'
  | 'variable_calibration'
  | 'story_plan'
  | 'heroine_plan'
  | 'recall'
  | 'all';

export type WorldBookInjectionMode = 'always' | 'match_any';

export type WorldBookEntryShape = 'normal' | 'timeline_outline' | 'time_injection';

export type BuiltinPromptCategory =
  | '常驻'
  | '开局'
  | '主剧情'
  | '变量生成'
  | '文章优化'
  | '回忆'
  | '世界演变';

// ─── Entry Interface ────────────────────────────────────────

export interface WorldBookEntry {
  id: string;
  /** Display title */
  title: string;
  /** Prompt content (template variables like ${playerName} are supported) */
  content: string;
  /** Entry shape — normal text, timeline outline, or time-based injection */
  shape?: WorldBookEntryShape;
  /** Entry type — determines how it's categorized in the UI */
  type: WorldBookEntryType;
  /** Which flows/contexts this entry applies to */
  scope: WorldBookScope[];
  /** If set, this entry overrides the built-in prompt with this slot ID */
  builtinSlotId?: string;
  /** Category for built-in entries (UI grouping) */
  builtinCategory?: BuiltinPromptCategory;
  /** Condition description for built-in entries */
  builtinCondition?: string;
  /** Injection description (shown in UI) */
  injectionNote?: string;
  /** Injection mode — always inject, or only when keywords match */
  injectionMode: WorldBookInjectionMode;
  /** For timeline entries: start time */
  timelineStart?: string;
  /** For timeline entries: end time */
  timelineEnd?: string;
  /** Keywords for match_any injection mode */
  keywords?: string[];
  /** Priority (higher = injected earlier in prompt) */
  priority?: number;
  /** Whether this entry is enabled */
  enabled?: boolean;
  /** Whether this is a built-in (non-deletable) entry */
  builtin?: boolean;
  /** Creation timestamp */
  createdAt?: number;
  /** Last update timestamp */
  updatedAt?: number;
}

// ─── World Book (Collection of Entries) ─────────────────────

export interface WorldBook {
  id: string;
  title: string;
  description?: string;
  /** Persistent outline injected as lore context */
  outline?: string;
  enabled?: boolean;
  builtin?: boolean;
  entries: WorldBookEntry[];
  createdAt?: number;
  updatedAt?: number;
}

// ─── Built-in Prompt Entry ──────────────────────────────────
// These are the "default prompts" that ship with the pack.
// Users can override them via the world book system.

export interface BuiltinPromptEntry {
  id: string;
  /** Links to a built-in slot — world book entries with matching builtinSlotId override this */
  slotId: string;
  title: string;
  category: BuiltinPromptCategory;
  /** Default content (from pack prompt files) */
  content: string;
  /** User-edited content (overrides default when set) */
  userContent?: string;
  enabled?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

// ─── Preset Groups ──────────────────────────────────────────

export interface WorldBookPresetGroup {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  /** Snapshot of books at the time this preset was created */
  bookSnapshots: WorldBook[];
  createdAt?: number;
  updatedAt?: number;
}

// ─── Export/Import Structures ────────────────────────────────

export interface WorldBookExportData {
  version: number;
  exportedAt: string;
  books: WorldBook[];
}

export interface BuiltinPromptExportData {
  version: number;
  exportedAt: string;
  entries: BuiltinPromptEntry[];
}

export interface PresetGroupExportData {
  version: number;
  exportedAt: string;
  groups: WorldBookPresetGroup[];
}

// ─── Context Piece (output of SystemPromptBuilder) ──────────

export interface ContextPiece {
  id: string;
  title: string;
  category: string;
  content: string;
  role: 'system' | 'user' | 'assistant';
  /** Estimated token count (rough: chars / 3 for Chinese, chars / 4 for English) */
  tokenEstimate?: number;
}

export interface MessageEntry {
  id: string;
  title: string;
  category: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Whether this entry contains the user's current input */
  isUserInput?: boolean;
}

export interface SystemPromptBuildResult {
  /** Named context pieces for debugging/display */
  contextPieces: Record<string, string>;
  /** Ordered messages for the API call */
  messageEntries: MessageEntry[];
  /** Short-term memory context (injected separately as assistant message) */
  shortMemoryContext: string;
  /** Runtime prompt enable/disable states for tracking */
  runtimePromptStates: Record<string, boolean>;
}

// ─── Prompt Settings (stored in state tree at 系统.设置.prompt) ──

export interface PromptSettings {
  /** Narrator perspective — 第一人称 (I), 第二人称 (you), 第三人称 (he/she/name) */
  perspective: '第一人称' | '第二人称' | '第三人称';
  /** Minimum word count for narrative output */
  wordCountRequirement: number;
  /** Story style preference */
  storyStyle: 'general' | 'harem' | 'pureLove' | 'cultivation' | 'shura' | 'ntlHarem';
  /** NTL harem tier (only when storyStyle = 'ntlHarem') */
  ntlTier?: '禁止乱伦' | '假乱伦' | '无限制';
  /** Enable NoControl directive (prevents AI from controlling player actions) */
  enableNoControl: boolean;
  /** Enable action options generation */
  enableActionOptions: boolean;
  /** Action options mode */
  actionOptionsMode: 'action' | 'story';
  /** Action pace */
  actionPace: 'fast' | 'slow';
  /** Custom additional system prompt */
  customSystemPrompt: string;
}

export const DEFAULT_PROMPT_SETTINGS: PromptSettings = {
  perspective: '第二人称',
  wordCountRequirement: 650,
  storyStyle: 'general',
  enableNoControl: true,
  enableActionOptions: true,
  actionOptionsMode: 'action',
  actionPace: 'fast',
  customSystemPrompt: '',
};

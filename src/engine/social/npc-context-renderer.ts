/**
 * NpcContextRenderer — Sprint Social-2
 *
 * Renders NPC data into prompt-ready text blocks, split by presence.
 * Produces `presentBlock` (detailed dossiers for in-scene NPCs) and
 * `absentBlock` (lean summaries with last-interaction anchors for off-scene NPCs).
 *
 * Used by ContextAssemblyStage to populate `{{NPC_PRESENT_BLOCK}}` and
 * `{{NPC_ABSENT_BLOCK}}` template variables (wired in Social-2; consumed by
 * pack prompts when `presenceEnabled` flag is ON).
 *
 * Design: inspired by MRJH's `构建NPC上下文` (`npcContext.ts:129-668`), but
 * redesigned as AGA-native — reads all field names via `paths.npcFieldNames`,
 * no hardcoded Chinese field literals (PRINCIPLES §3.3, §3.8).
 */
import type { EnginePathConfig } from '../pipeline/types';
import { NpcPresenceService, type NpcRecord } from './npc-presence';
import { formatMemoryEntry } from './npc-memory-format';

export interface RenderSplitResult {
  presentBlock: string;
  absentBlock: string;
}

export class NpcContextRenderer {
  private fields: EnginePathConfig['npcFieldNames'];

  constructor(
    private presenceService: NpcPresenceService,
    paths: EnginePathConfig,
  ) {
    this.fields = paths.npcFieldNames;
  }

  renderSplit(): RenderSplitResult {
    const { present, absent } = this.presenceService.partition();

    const presentBlock = present.length > 0
      ? present.map((n) => this.renderDetailedNpc(n)).join('\n\n---\n\n')
      : '（当前场景没有 NPC 在场）';

    const absentBlock = absent.length > 0
      ? absent.map((n) => this.renderLeanNpc(n)).join('\n')
      : '';

    return { presentBlock, absentBlock };
  }

  private renderDetailedNpc(npc: NpcRecord): string {
    const f = this.fields;
    const lines: string[] = [];

    const name = this.str(npc, f.name);
    lines.push(`### ${name}`);

    this.pushIfPresent(lines, f.type, npc, f.type);
    this.pushIfPresent(lines, f.gender, npc, f.gender);
    this.pushIfPresent(lines, f.age, npc, f.age);
    this.pushIfPresent(lines, f.location, npc, f.location);
    this.pushIfPresent(lines, f.affinity, npc, f.affinity);
    this.pushIfPresent(lines, f.description, npc, f.description);
    this.pushIfPresent(lines, f.appearance, npc, f.appearance);
    this.pushIfPresent(lines, f.bodyDescription, npc, f.bodyDescription);
    this.pushIfPresent(lines, f.outfitStyle, npc, f.outfitStyle);
    this.pushIfPresent(lines, f.background, npc, f.background);
    this.pushIfPresent(lines, f.corePersonality, npc, f.corePersonality);
    this.pushIfPresent(lines, f.relationshipStatus, npc, f.relationshipStatus);
    this.pushIfPresent(lines, f.innerThought, npc, f.innerThought);
    this.pushIfPresent(lines, f.currentActivity, npc, f.currentActivity);

    const traits = npc[f.personalityTraits];
    if (Array.isArray(traits) && traits.length > 0) {
      lines.push(`- **性格特征**：${(traits as string[]).join('、')}`);
    }

    const memory = npc[f.memory];
    if (Array.isArray(memory) && memory.length > 0) {
      const recent = memory.slice(-5);
      lines.push(`- **近期记忆**：`);
      for (const m of recent) {
        const rendered = formatMemoryEntry(m);
        if (rendered) lines.push(`  - ${rendered}`);
      }
    }

    const summaries = npc[f.memorySummaries];
    if (Array.isArray(summaries) && summaries.length > 0) {
      const latest = summaries[summaries.length - 1] as Record<string, unknown> | undefined;
      const summaryText = this.extractSummaryContent(latest);
      if (summaryText) lines.push(`- **${f.memorySummaries}**：${summaryText}`);
    }

    return lines.join('\n');
  }

  private renderLeanNpc(npc: NpcRecord): string {
    const f = this.fields;
    const name = this.str(npc, f.name);
    const location = this.str(npc, f.location);
    const lastInteraction = this.str(npc, f.lastInteractionTime);
    const relationship = this.str(npc, f.relationshipStatus);

    const latestSummary = this.extractSummaryContent(
      this.getLatestSummary(npc[f.memorySummaries]),
    );

    const parts = [`**${name}**`];
    if (relationship) parts.push(`（${relationship}）`);
    if (location) parts.push(`| ${f.location}：${location}`);
    if (lastInteraction) parts.push(`| ${f.lastInteractionTime}：${lastInteraction}`);
    if (latestSummary) parts.push(`| ${latestSummary.slice(0, 80)}`);

    return `- ${parts.join(' ')}`;
  }

  private getLatestSummary(summaries: unknown): Record<string, unknown> | undefined {
    if (!Array.isArray(summaries) || summaries.length === 0) return undefined;
    return summaries[summaries.length - 1] as Record<string, unknown> | undefined;
  }

  private extractSummaryContent(entry: Record<string, unknown> | undefined): string {
    if (!entry) return '';
    const content = entry['摘要'] ?? entry['summary'] ?? entry['content'];
    return typeof content === 'string' ? content : '';
  }

  private str(npc: NpcRecord, field: string): string {
    const v = npc[field];
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    return '';
  }

  private pushIfPresent(lines: string[], label: string, npc: NpcRecord, field: string): void {
    const v = npc[field];
    if (v === undefined || v === null) return;
    if (typeof v === 'string' && !v.trim()) return;
    lines.push(`- **${label}**：${String(v)}`);
  }
}

/**
 * Plot Direction System — AI-Assisted Outline Decomposition
 *
 * Takes a natural-language outline from the player and calls the LLM
 * to decompose it into a structured PlotNode chain + suggested gauges.
 *
 * Sprint Plot-1 P1.5 (GAP-04 fix)
 */
import type { AIService } from '../ai/ai-service';
import type { ResponseParser } from '../ai/response-parser';
import type { StateManager } from '../core/state-manager';
import type { EnginePathConfig } from '../pipeline/types';
import type { GamePack } from '../types';
import type { PlotNode, PlotGauge, OpportunityTier } from './types';
import { DEFAULT_GAUGE_MAX_DELTA } from './types';

export interface DecomposeResult {
  nodes: Omit<PlotNode, 'id' | 'arcId' | 'status' | 'consecutiveReachedCount' | 'activatedAtRound' | 'completedAtRound'>[];
  suggestedGauges: Omit<PlotGauge, 'id' | 'lastAutoDecrementRound' | 'boundaryFiredAtRound'>[];
}

export class PlotDecomposer {
  constructor(
    private aiService: AIService,
    private responseParser: ResponseParser,
    private stateManager: StateManager,
    private pack: GamePack,
    private paths: EnginePathConfig,
  ) {}

  async decompose(
    outline: string,
    signal?: AbortSignal,
  ): Promise<DecomposeResult | null> {
    const playerName = this.stateManager.get<string>(this.paths.playerName) ?? '';
    const location = this.stateManager.get<string>(this.paths.playerLocation) ?? '';
    const round = this.stateManager.get<number>(this.paths.roundNumber) ?? 0;
    const stateSummary = `Player: ${playerName}, Location: ${location}, Round: ${round}`;

    const promptContent = this.pack.prompts?.['plotDecompose'] ?? '';
    if (!promptContent) {
      console.warn('[PlotDecomposer] plotDecompose prompt not found in pack');
      return null;
    }

    const rendered = promptContent
      .split('{{PLOT_OUTLINE}}').join(outline)
      .split('{{PLOT_STATE_SUMMARY}}').join(stateSummary);

    const messages: { role: 'system' | 'user'; content: string }[] = [];

    // Jailbreak — always inject as first system message (same pattern as assistant-service)
    const jailbreak = this.pack.prompts?.['assistantJailbreak']?.trim();
    if (jailbreak) {
      messages.push({ role: 'system', content: jailbreak });
    }

    messages.push({ role: 'system', content: rendered });
    messages.push({ role: 'user', content: outline });

    try {
      const rawResponse = await this.aiService.generate({
        messages,
        usageType: 'plot_decompose',
        signal,
      });

      const parsed = this.responseParser.parse(rawResponse);
      const json = parsed.customFields ?? {};

      // Try to extract from customFields first, then from the raw text
      let result = json as Record<string, unknown>;
      if (!result['nodes'] && parsed.text) {
        try {
          result = JSON.parse(parsed.text) as Record<string, unknown>;
        } catch {
          // Try extracting JSON from code block
          const match = parsed.text.match(/```json\s*([\s\S]*?)```/);
          if (match) {
            try {
              result = JSON.parse(match[1]) as Record<string, unknown>;
            } catch (innerErr) {
              console.warn('[PlotDecomposer] Failed to parse JSON from code block:', innerErr);
            }
          }
        }
      }

      if (!Array.isArray(result['nodes'])) {
        console.warn('[PlotDecomposer] AI response missing nodes array');
        return null;
      }

      return {
        nodes: this.normalizeNodes(result['nodes'] as unknown[]),
        suggestedGauges: this.normalizeGauges(
          (result['suggested_gauges'] ?? result['suggestedGauges'] ?? []) as unknown[],
        ),
      };
    } catch (err) {
      if (signal?.aborted) return null;
      console.error('[PlotDecomposer] Decomposition failed:', err);
      return null;
    }
  }

  private normalizeNodes(raw: unknown[]): DecomposeResult['nodes'] {
    return raw
      .filter((item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object')
      .map(item => ({
        title: String(item['title'] ?? ''),
        narrativeGoal: String(item['narrativeGoal'] ?? item['narrative_goal'] ?? ''),
        directive: String(item['directive'] ?? ''),
        completionHint: String(item['completionHint'] ?? item['completion_hint'] ?? ''),
        completionConditions: [],
        completionMode: 'hint_only' as const,
        activationConditions: [],
        maxRounds: typeof item['maxRounds'] === 'number' ? item['maxRounds']
          : typeof item['max_rounds'] === 'number' ? item['max_rounds'] : 6,
        importance: item['importance'] === 'skippable' ? 'skippable' as const : 'critical' as const,
        opportunityTiers: this.normalizeOpportunityTiers(item['opportunityTiers'] ?? item['opportunity_tiers']),
        emotionalTone: typeof item['emotionalTone'] === 'string' ? item['emotionalTone']
          : typeof item['emotional_tone'] === 'string' ? item['emotional_tone'] : undefined,
      }));
  }

  private normalizeOpportunityTiers(raw: unknown): OpportunityTier[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t): t is Record<string, unknown> => t !== null && typeof t === 'object')
      .map(t => ({
        tier: (typeof t['tier'] === 'number' ? t['tier'] : 1) as 1 | 2 | 3,
        afterRounds: typeof t['afterRounds'] === 'number' ? t['afterRounds']
          : typeof t['after_rounds'] === 'number' ? t['after_rounds'] : 3,
        prompt: String(t['prompt'] ?? ''),
      }));
  }

  private normalizeGauges(raw: unknown[]): DecomposeResult['suggestedGauges'] {
    return raw
      .filter((item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object')
      .map(item => ({
        name: String(item['name'] ?? ''),
        description: String(item['description'] ?? ''),
        min: typeof item['min'] === 'number' ? item['min'] : 0,
        max: typeof item['max'] === 'number' ? item['max'] : 100,
        current: typeof item['initialValue'] === 'number' ? item['initialValue']
          : typeof item['initial_value'] === 'number' ? item['initial_value'] : 0,
        initialValue: typeof item['initialValue'] === 'number' ? item['initialValue']
          : typeof item['initial_value'] === 'number' ? item['initial_value'] : 0,
        unit: String(item['unit'] ?? '%'),
        color: typeof item['color'] === 'string' ? item['color'] : undefined,
        showInMainPanel: item['showInMainPanel'] !== false,
        aiUpdatable: item['aiUpdatable'] !== false,
        maxDeltaPerRound: typeof item['maxDeltaPerRound'] === 'number'
          ? item['maxDeltaPerRound'] : DEFAULT_GAUGE_MAX_DELTA,
        autoDecrement: typeof item['autoDecrement'] === 'number' ? item['autoDecrement'] : undefined,
      }));
  }
}

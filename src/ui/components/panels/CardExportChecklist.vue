<script setup lang="ts">
// App doc: docs/user-guide/pages/game-save.md §2.5.1
/**
 * CardExportChecklist — the selective-export checklist for Game Card export (Story 5, P5 / U4).
 * Reusable by Story 7. Each optional item carries a one-sentence Tooltip hint (U12 consumption point).
 */
import { useI18n } from 'vue-i18n';
import Tooltip from '@/ui/components/shared/Tooltip.vue';
import type { ExportFlags } from '@/engine/export/game-card-bundle.types';

const props = defineProps<{ modelValue: ExportFlags }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: ExportFlags): void }>();

const { t } = useI18n();

/** Optional creative-asset toggles → (ExportFlags field, i18n key stem). */
const CREATIVE: { field: keyof ExportFlags; key: string }[] = [
  { field: 'includedWorldBooks', key: 'worldBook' },
  { field: 'includedBuiltinOverrides', key: 'builtinOverride' },
  { field: 'includedEngineConfig', key: 'engineConfig' },
  { field: 'includedPromptSettings', key: 'promptSettings' },
  { field: 'includedHeroinePlan', key: 'heroinePlan' },
  { field: 'includedPlotDirection', key: 'plotDirection' },
  { field: 'includedSettings', key: 'settings' },
  { field: 'includedApiTemplate', key: 'apiTemplate' },
];

function toggle(field: keyof ExportFlags): void {
  emit('update:modelValue', { ...props.modelValue, [field]: !props.modelValue[field] });
}
</script>

<template>
  <div class="ckl">
    <!-- Core (always included) -->
    <div class="ckl-core">
      <p class="ckl-core__title">{{ t('save.export.content.coreTitle') }}</p>
      <p class="ckl-core__body">{{ t('save.export.content.core') }}</p>
    </div>

    <!-- Optional creative assets -->
    <p class="ckl-group-title">{{ t('save.export.content.optionalTitle') }}</p>
    <div class="ckl-list">
      <label v-for="item in CREATIVE" :key="item.field" class="ckl-row">
        <input
          type="checkbox"
          class="ckl-box"
          :checked="modelValue[item.field]"
          @change="toggle(item.field)"
        />
        <span class="ckl-label">{{ t(`save.export.checklist.${item.key}.label`) }}</span>
        <Tooltip :text="t(`save.export.checklist.${item.key}.hint`)">
          <span class="ckl-info" aria-hidden="true">?</span>
        </Tooltip>
      </label>
    </div>

    <!-- Images -->
    <p class="ckl-group-title">{{ t('save.export.images.sectionTitle') }}</p>
    <div class="ckl-list">
      <p class="ckl-static">{{ t('save.export.images.selectedOnly') }}</p>
      <label class="ckl-row">
        <input type="checkbox" class="ckl-box" :checked="modelValue.includedGenerationHistory" @change="toggle('includedGenerationHistory')" />
        <span class="ckl-label">{{ t('save.export.images.includeHistory') }}</span>
      </label>
      <label class="ckl-row">
        <input type="checkbox" class="ckl-box" :checked="modelValue.includedReferenceGallery" @change="toggle('includedReferenceGallery')" />
        <span class="ckl-label">{{ t('save.export.images.includeGallery') }}</span>
      </label>
    </div>

    <!-- Content rating -->
    <label class="ckl-row ckl-row--nsfw">
      <input type="checkbox" class="ckl-box" :checked="modelValue.containsNsfw" @change="toggle('containsNsfw')" />
      <span class="ckl-label">{{ t('save.export.images.nsfw') }}</span>
    </label>
  </div>
</template>

<style scoped>
.ckl-core {
  padding: 10px 12px;
  margin-bottom: 14px;
  background: color-mix(in oklch, var(--color-sage-400) 8%, transparent);
  border-radius: var(--radius-md);
}
.ckl-core__title {
  margin: 0 0 2px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text);
}
.ckl-core__body {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.ckl-group-title {
  margin: 14px 0 6px;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

.ckl-list { display: flex; flex-direction: column; gap: 3px; }

.ckl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 4px;
  font-size: 0.88rem;
  color: var(--color-text);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
@media (hover: hover) {
  .ckl-row:hover { background: color-mix(in oklch, var(--color-text) 4%, transparent); }
}
.ckl-row--nsfw {
  margin-top: 12px;
  color: var(--color-amber-400);
}
.ckl-box {
  width: 16px;
  height: 16px;
  accent-color: var(--color-sage-400);
  cursor: pointer;
  flex-shrink: 0;
}
.ckl-label { flex: 1; }
.ckl-static {
  margin: 0;
  padding: 5px 4px;
  font-size: 0.88rem;
  color: var(--color-text-secondary);
}
.ckl-info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-secondary);
  background: color-mix(in oklch, var(--color-text) 10%, transparent);
  border-radius: var(--radius-full);
  cursor: help;
}
</style>

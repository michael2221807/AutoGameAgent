<script setup lang="ts">
/**
 * NpcEditDialog — NPC 编辑专用对话框。
 *
 * 提供 NPC 的关键字段编辑:
 *   - name (名称)
 *   - type (类型，如 "商人"、"守卫" 等)
 *   - location (所在位置)
 *   - description (描述)
 *   - relationshipType (关系类型)
 *
 * 使用 BaseModal 作为对话框容器。
 * 新建模式 (npcData 未传入) 与编辑模式 (npcData 已传入) 自动切换。
 */
import { reactive, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '@/ui/components/shared/BaseModal.vue';
import AgaSelect from '@/ui/components/shared/AgaSelect.vue';
import AgaButton from '@/ui/components/shared/AgaButton.vue';

const { t } = useI18n();

/** NPC 表单数据结构 */
interface NpcFormData {
  name: string;
  type: string;
  location: string;
  description: string;
  relationshipType: string;
}

/** Relationship type options — values are state tree data, not display-only strings */
const RELATIONSHIP_OPTIONS = [
  '友好', '中立', '敌对', '商业', '从属', '同盟', '竞争', '未知',
] as const;

/** NPC type options — values are state tree data, not display-only strings */
const NPC_TYPE_OPTIONS = [
  '商人', '守卫', '村民', '贵族', '冒险者', '导师', '敌人', '神秘人', '其他',
] as const;

const props = withDefaults(defineProps<{
  /** 控制对话框显示/隐藏（v-model） */
  modelValue: boolean;
  /** 已有 NPC 数据（编辑模式） */
  npcData?: Record<string, unknown>;
}>(), {
  npcData: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 保存 NPC 数据 */
  save: [npc: Record<string, unknown>];
}>();

/** 是否为编辑模式 */
const isEdit = computed<boolean>(() => props.npcData !== undefined);

/** 对话框标题 */
const dialogTitle = computed<string>(() =>
  isEdit.value ? t('relationship.edit.titleEdit') : t('relationship.npcEdit.titleNew'),
);

/** 内部表单数据 */
const form = reactive<NpcFormData>(buildInitial());

function buildInitial(): NpcFormData {
  const d = props.npcData;
  return {
    name: extractString(d, 'name'),
    type: extractString(d, 'type'),
    location: extractString(d, 'location'),
    description: extractString(d, 'description'),
    relationshipType: extractString(d, 'relationshipType', '中立'),
  };
}

/** 安全提取字符串字段 */
function extractString(
  obj: Record<string, unknown> | undefined,
  key: string,
  fallback = '',
): string {
  if (!obj) return fallback;
  const val = obj[key];
  return typeof val === 'string' ? val : fallback;
}

/** npcData 变更或对话框打开时重置表单 */
watch([() => props.npcData, () => props.modelValue], ([, open]) => {
  if (open) {
    const fresh = buildInitial();
    form.name = fresh.name;
    form.type = fresh.type;
    form.location = fresh.location;
    form.description = fresh.description;
    form.relationshipType = fresh.relationshipType;
  }
}, { deep: true });

/** 表单是否可提交（name 必填） */
const canSave = computed<boolean>(() => form.name.trim().length > 0);

/** 关闭 */
function closeDialog(): void {
  emit('update:modelValue', false);
}

/** NPC 类型下拉选项（值即状态树数据） */
const npcTypeOptions = computed(() =>
  NPC_TYPE_OPTIONS.map((t) => ({ label: t, value: t })),
);

/** 关系类型下拉选项（值即状态树数据） */
const relationshipOptions = computed(() =>
  RELATIONSHIP_OPTIONS.map((r) => ({ label: r, value: r })),
);

/** 保存 — 合并原有数据和表单修改 */
function saveNpc(): void {
  if (!canSave.value) return;

  const result: Record<string, unknown> = {
    ...(props.npcData ?? {}),
    name: form.name.trim(),
    type: form.type,
    location: form.location.trim(),
    description: form.description.trim(),
    relationshipType: form.relationshipType,
  };

  emit('save', result);
  closeDialog();
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="dialogTitle"
    max-width="520px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="npc-form" @submit.prevent="saveNpc">
      <!-- 名称 -->
      <div class="form-group">
        <label for="npc-name" class="form-label">
          {{ $t('relationship.npcEdit.label.name') }} <span class="required-mark">*</span>
        </label>
        <input
          id="npc-name"
          v-model="form.name"
          type="text"
          class="form-input"
          :placeholder="$t('relationship.npcEdit.placeholder.name')"
        />
      </div>

      <!-- 类型 -->
      <div class="form-group">
        <label for="npc-type" class="form-label">{{ $t('relationship.npcEdit.label.type') }}</label>
        <AgaSelect
          id="npc-type"
          v-model="form.type"
          :options="npcTypeOptions"
          :placeholder="$t('relationship.npcEdit.placeholder.selectType')"
        />
      </div>

      <!-- 位置 -->
      <div class="form-group">
        <label for="npc-location" class="form-label">{{ $t('relationship.npcEdit.label.location') }}</label>
        <input
          id="npc-location"
          v-model="form.location"
          type="text"
          class="form-input"
          :placeholder="$t('relationship.npcEdit.placeholder.location')"
        />
      </div>

      <!-- 描述 -->
      <div class="form-group">
        <label for="npc-desc" class="form-label">{{ $t('relationship.npcEdit.label.description') }}</label>
        <textarea
          id="npc-desc"
          v-model="form.description"
          class="form-input form-textarea"
          rows="4"
          :placeholder="$t('relationship.npcEdit.placeholder.description')"
        />
      </div>

      <!-- 关系类型 -->
      <div class="form-group">
        <label for="npc-rel" class="form-label">{{ $t('relationship.npcEdit.label.relationshipType') }}</label>
        <AgaSelect
          id="npc-rel"
          v-model="form.relationshipType"
          :options="relationshipOptions"
        />
      </div>
    </form>

    <template #footer>
      <AgaButton variant="secondary" @click="closeDialog">{{ $t('common.actions.cancel') }}</AgaButton>
      <AgaButton
        variant="primary"
        :disabled="!canSave"
        @click="saveNpc"
      >
        {{ $t('common.actions.save') }}
      </AgaButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.npc-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.form-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.required-mark {
  color: var(--color-danger);
}

.form-input {
  padding: 0.55rem 0.7rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: 0.88rem;
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-out);
}

.form-input:focus {
  border-color: var(--color-sage-400);
}

.form-textarea {
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
}
</style>

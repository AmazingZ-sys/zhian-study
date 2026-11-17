<script setup lang="ts">
import { computed } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import type { CategoryProgress } from '@zhian/contracts';
import { buildCatalog } from './catalog';

const props = defineProps<{
  categories: CategoryProgress[];
  selectedId: string;
  includesDescendants: boolean;
}>();
const emit = defineEmits<{
  select: [categoryId: string, includeDescendants: boolean];
}>();

const groups = computed(() => buildCatalog(props.categories));
const openSubject = computed(
  () =>
    groups.value.find((group) => group.rows.some((row) => row.id === props.selectedId))?.subject ??
    groups.value[0]?.subject,
);
</script>

<template>
  <section id="practice-catalog" class="panel" aria-labelledby="practice-catalog-title">
    <h2 id="practice-catalog-title" class="catalog-heading">章节目录</h2>
    <p v-if="!groups.length" class="catalog-empty">暂无章节</p>
    <div v-else class="catalog-groups">
      <details
        v-for="group in groups"
        :key="group.subject"
        name="practice-catalog-subject"
        :open="openSubject === group.subject"
        class="catalog-subject"
      >
        <summary>
          {{ group.subject }}
          <ChevronDown :size="17" aria-hidden="true" />
        </summary>
        <ul class="catalog-rows">
          <li
            v-for="row in group.rows"
            :key="row.id"
            :style="{ '--chapter-indent': Math.min(row.depth, 4) * 10 + 'px' }"
          >
            <button
              type="button"
              class="catalog-chapter"
              :aria-labelledby="`catalog-name-${row.id}`"
              :aria-describedby="`catalog-progress-${row.id}`"
              :aria-pressed="selectedId === row.id && includesDescendants === row.includeDescendants"
              @click="emit('select', row.id, row.includeDescendants)"
            >
              <span :id="`catalog-name-${row.id}`" class="catalog-name">{{ row.name }}</span>
              <span :id="`catalog-progress-${row.id}`" class="catalog-progress">
                <span>已练 {{ row.progress.attempted }} / {{ row.progress.count }} 题</span>
                <span v-if="!row.progress.count">暂无题目</span>
                <span v-else-if="row.progress.attempts">
                  正确率 {{ Math.round((row.progress.correctAttempts / row.progress.attempts) * 100) }}%
                </span>
                <span v-else>正确率 —</span>
                <span v-if="row.includeDescendants" class="catalog-scope">含下级章节</span>
              </span>
            </button>
          </li>
        </ul>
      </details>
    </div>
  </section>
</template>

<style scoped>
.catalog-heading {
  margin-bottom: 12px;
}
.catalog-empty {
  color: var(--muted);
}
.catalog-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  align-items: start;
  gap: 10px 14px;
}
.catalog-subject {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.catalog-subject summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 44px;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 7px;
  font-weight: 650;
  list-style: none;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.catalog-subject summary::-webkit-details-marker {
  display: none;
}
.catalog-subject summary:hover,
.catalog-chapter:hover {
  background: var(--wash);
}
.catalog-subject summary:focus-visible {
  outline: 3px solid #b68442;
  outline-offset: 3px;
}
.catalog-subject summary svg {
  flex: none;
}
.catalog-subject[open] summary svg {
  transform: rotate(180deg);
}
.catalog-rows {
  margin: 0;
  border-top: 1px solid var(--line);
  padding: 4px;
  list-style: none;
}
.catalog-rows li {
  padding-inline-start: var(--chapter-indent);
}
.catalog-chapter {
  display: grid;
  width: 100%;
  min-height: 44px;
  gap: 2px;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--ink);
  text-align: start;
}
.catalog-chapter[aria-pressed='true'] {
  border-color: var(--primary);
  background: var(--wash);
}
.catalog-name {
  font-weight: 550;
  overflow-wrap: anywhere;
}
.catalog-progress {
  display: flex;
  flex-wrap: wrap;
  gap: 0 8px;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.catalog-scope {
  color: var(--primary);
}
</style>

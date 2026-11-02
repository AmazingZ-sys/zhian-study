<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, AriaComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer]);
const props = defineProps<{ labels: string[]; values: number[]; name?: string; bar?: boolean }>(),
  el = ref<HTMLElement>();
let chart: echarts.ECharts | undefined, observer: ResizeObserver | undefined;
function draw() {
  chart?.setOption({
    animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    aria: { enabled: true },
    grid: { left: 36, right: 16, top: 28, bottom: 32 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: props.labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#65746e' },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: '#edf0ea' } },
      axisLabel: { color: '#65746e' },
    },
    series: [
      {
        type: props.bar ? 'bar' : 'line',
        name: props.name ?? '答题数量',
        data: props.values,
        smooth: true,
        symbolSize: 7,
        barMaxWidth: 34,
        itemStyle: { color: '#176b5b', borderRadius: [4, 4, 0, 0] },
        lineStyle: { width: 3 },
        areaStyle: props.bar ? undefined : { color: '#e5f1ea' },
      },
    ],
  });
}
onMounted(() => {
  if (el.value) {
    chart = echarts.init(el.value);
    observer = new ResizeObserver(() => chart?.resize());
    observer.observe(el.value);
    draw();
  }
});
watch(() => [props.labels, props.values], draw, { deep: true });
onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.dispose();
});
</script>
<template>
  <div ref="el" class="chart" role="img" :aria-label="name ?? '学习趋势图'"></div>
  <details class="chart-data">
    <summary>查看图表数据</summary>
    <table>
      <thead>
        <tr>
          <th>日期 / 科目</th>
          <th>{{ name ?? '答题数量' }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(label, i) in labels" :key="label">
          <td>{{ label }}</td>
          <td>{{ values[i] }}</td>
        </tr>
      </tbody>
    </table>
  </details>
</template>

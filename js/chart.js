// The forecast distribution chart. Colours come from CSS custom properties in index.html.
import Chart from 'chart.js/auto';
import { normalPDF } from '../forecast.js';
import { $ } from './dom.js';

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Draws dashed vertical lines at the values given in options.plugins.markers.lines.
const markersPlugin = {
  id: 'markers',
  afterDraw(chart, _args, { lines = [] }) {
    const { ctx, chartArea, scales: { x } } = chart;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.font = cssVar('--chart-label-font');
    lines.forEach(({ value, color, label }, i) => {
      const px = x.getPixelForValue(value);
      if (px < chartArea.left || px > chartArea.right) return;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      // Staggered, so labels on lines that sit close together stay readable.
      ctx.fillText(label, px + 4, chartArea.top + 12 + i * 14);
    });
    ctx.restore();
  },
};

let chart = null;

function createChart() {
  return new Chart($('#dist-chart'), {
    type: 'line',
    data: {
      datasets: [{
        label: 'Forecast density',
        data: [],
        borderColor: cssVar('--chart-line'),
        backgroundColor: cssVar('--chart-fill'),
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        markers: { lines: [] },
      },
      scales: {
        // Linear, not category, so the markers land at their value rather than at a label index.
        x: { type: 'linear', title: { display: true, text: 'Final enrolment' }, ticks: { maxTicksLimit: 10, precision: 0 } },
        y: { display: false },
      },
    },
    plugins: [markersPlugin],
  });
}

export function drawChart(f, cap, safetyBuffer) {
  chart ??= createChart();
  const min = Math.max(0, f.meanNewIntake - 4 * f.sd);
  const max = f.meanNewIntake + 4 * f.sd;
  const step = Math.max(1, Math.round((max - min) / 80));
  const xs = [];
  for (let x = min; x <= max; x += step) xs.push(x);

  chart.data.datasets[0].data = xs.map(x => ({ x, y: normalPDF(x, f.meanNewIntake, f.sd) }));
  chart.options.scales.x.min = Math.floor(min);
  chart.options.scales.x.max = Math.ceil(max);
  chart.options.plugins.markers.lines = [
    { value: cap, color: cssVar('--chart-cap'), label: `Cap (${cap})` },
    { value: f.targetWithBuffer, color: cssVar('--chart-buffer'), label: `Cap +${Math.round(safetyBuffer * 100)}% (${Math.round(f.targetWithBuffer)})` },
    { value: f.meanNewIntake, color: cssVar('--chart-mean'), label: `Mean (${Math.round(f.meanNewIntake)})` },
  ];
  chart.update();
}

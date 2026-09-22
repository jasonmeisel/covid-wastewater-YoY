// Source: index.html // [1272-1303] // [1305-1324] // [1326-1740] // [1742-1757] // [1759-1795] // [1854-1860] // [1862-1870] // [1872-1877] // [1879-1884]

import { formatShortDate, formatDate } from './util.js';
import { state, syncStateToUrl } from './state.js';
import { YEAR_COLOR_PALETTE, movingAverage, sortedSeriesValues, inclusivePercentile, percentileStats, getLatestSamplePoint, getPercentileEmoji, summarize } from './stats.js';

    export function updatePercentileSummaryUI(stats) {
      const currentLabel = document.getElementById('currentValuePercentile');
      const currentEmoji = document.getElementById('currentValueEmoji');
      const medianLabel = document.getElementById('medianValueBadge');
      const quartileLabel = document.getElementById('quartileValueBadge');
      const p5Label = document.getElementById('percentile5Badge');
      const p1Label = document.getElementById('percentile1Badge');

      const formatStat = value => value === null ? 'N/A' : value.toFixed(1);
      const formatPercentile = value => value === null ? 'N/A' : `${value.toFixed(1)}%`;

      if (currentLabel) {
        currentLabel.innerText = `Current value percentile: ${formatPercentile(stats.currentPercentile)}`;
      }
      if (currentEmoji) {
        currentEmoji.innerText = getPercentileEmoji(stats.currentPercentile);
      }
      if (medianLabel) {
        medianLabel.innerText = `Median: ${formatStat(stats.median)}`;
      }
      if (quartileLabel) {
        quartileLabel.innerText = `Q1: ${formatStat(stats.q1)}, Q3: ${formatStat(stats.q3)}`;
      }
      if (p5Label) {
        p5Label.innerText = `5th: ${formatStat(stats.p5)}`;
      }
      if (p1Label) {
        p1Label.innerText = `1st: ${formatStat(stats.p1)}`;
      }

      updateChartTakeaway(stats);
    }

    export function updateChartTakeaway(stats) {
      const takeaway = document.getElementById('chartTakeaway');
      const latestPoint = getLatestSamplePoint();
      if (!takeaway || !latestPoint) return;

      const latestYear = state.years.reduce((max, year) => Math.max(max, Number(year)), 0);
      const latestYearSeries = state.series[latestYear] || [];
      const yearMean = latestYearSeries.length ? summarize(latestYearSeries).mean : null;
      const percentileText = stats.currentPercentile === null
        ? ''
        : ` — ${stats.currentPercentile.toFixed(1)}th percentile of all ${stats.count} samples`;
      const meanText = yearMean && yearMean > 0
        ? `; ${ (latestPoint.y / yearMean).toFixed(1) }× the ${latestYear} average`
        : '';
      const dateText = formatShortDate(latestPoint.originalDate);

      takeaway.innerText = `Latest normalized reading: ${latestPoint.y.toFixed(1)} (${dateText})${percentileText}${meanText}.`;
    }

    // Build Chart JS configuration and inject into container.
    // createChart() runs once per page; updateChart() re-derives datasets and options from state.

    const clampXAxisRange = (min, max) => {
      const fullMin = 1;
      const fullMax = 365;
      if (min <= fullMin && max >= fullMax) {
        return { min: fullMin, max: fullMax };
      }

      const nextMin = Math.max(fullMin, Math.min(fullMax - 1, min));
      const nextMax = Math.max(nextMin + 1, Math.min(fullMax, max));

      if (nextMax - nextMin >= fullMax - fullMin) {
        return { min: fullMin, max: fullMax };
      }

      return { min: nextMin, max: nextMax };
    };

    // Applies a clamped x-axis window to the live scale and its options, then repaints.
    function applyXAxisRange(min, max) {
      const chart = state.chartInstance;
      const xScale = chart?.scales?.x;
      if (!xScale) return;

      const clamped = clampXAxisRange(min, max);
      xScale.min = clamped.min;
      xScale.max = clamped.max;

      if (chart.options?.scales?.x) {
        chart.options.scales.x.min = clamped.min;
        chart.options.scales.x.max = clamped.max;
      }

      chart.update('none');
    }

    function percentileLinesFor(stats) {
      return [
        { label: '25th', value: stats.q1, color: 'rgba(16, 185, 129, 0.7)', dash: [4, 4] },
        { label: 'Median', value: stats.median, color: 'rgba(14, 165, 233, 0.7)', dash: [4, 4] },
        { label: '75th', value: stats.q3, color: 'rgba(168, 85, 247, 0.7)', dash: [4, 4] },
        { label: '5th', value: stats.p5, color: 'rgba(245, 158, 11, 0.7)', dash: [4, 4] },
        { label: '1st', value: stats.p1, color: 'rgba(239, 68, 68, 0.7)', dash: [4, 4] }
      ].filter(line => line.value !== null);
    }

    // Derives the Chart.js dataset array from the current state.
    function buildChartDatasets() {
      const isPercentileScale = state.yScaleType === 'percentile';
      const percentileValues = sortedSeriesValues();
      const percentileLookup = value => inclusivePercentile(value, percentileValues);
      const latestYear = state.years.reduce((max, yr) => Math.max(max, Number(yr)), 0);

      return state.years.map(yr => {
        const colorConf = YEAR_COLOR_PALETTE[yr] || YEAR_COLOR_PALETTE.default;
        const originalSeries = state.series[yr] || [];
        const isLatestYear = Number(yr) === latestYear;
        const finalSeries = movingAverage(originalSeries, state.smoothingWindow, isLatestYear);
        const chartSeries = isPercentileScale
          ? finalSeries.map(point => ({
              ...point,
              value: point.y,
              y: percentileLookup(point.y)
            }))
          : finalSeries;
        const lineColor = isLatestYear
          ? colorConf.stroke
          : colorConf.stroke.replace(/,\s*1\)$/, ', 0.45)');

        return {
          label: String(yr),
          data: chartSeries,
          borderColor: lineColor,
          backgroundColor: colorConf.fill,
          borderWidth: isLatestYear ? 3 : 1,
          pointRadius: (context) => {
            const isLatestSample = isLatestYear && context.dataIndex === context.dataset.data.length - 1;
            return isLatestSample ? 5 : 0;
          },
          pointHoverRadius: (context) => {
            const isLatestSample = isLatestYear && context.dataIndex === context.dataset.data.length - 1;
            return isLatestSample ? 7 : 0;
          },
          pointBackgroundColor: lineColor,
          pointBorderColor: lineColor,
          pointBorderWidth: isLatestYear ? 2 : 1,
          fill: false,
          spanGaps: true,
          hidden: !state.visibleYears[yr]
        };
      });
    }

    // One-time setup: canvas context, drawing plugins, pan/pinch handlers and the Chart instance.
    export function createChart(canvasElement = document.getElementById('yoyChart')) {
      if (!canvasElement) return null;

      const ctx = canvasElement.getContext('2d');
      const isDark = document.documentElement.classList.contains('dark');

      // Month labels matching the standardized indices on the 365-day grid
      const monthStarts = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

      const monthLabelPlugin = {
        id: 'monthLabels',
        afterDraw: (chart) => {
          const dark = document.documentElement.classList.contains('dark');
          const { ctx, chartArea: { bottom }, scales: { x } } = chart;
          ctx.save();
          ctx.font = '10px Inter';
          ctx.fillStyle = dark ? '#94a3b8' : '#475569';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';

          const labelY = Math.min(bottom + 12, chart.height - 10);

          monthStarts.forEach((value, index) => {
            const xPixel = x.getPixelForValue(value);
            if (xPixel < x.left || xPixel > x.right) return;
            ctx.fillText(monthNames[index], xPixel, labelY);
          });

          ctx.restore();
        }
      };

      const percentileLinesPlugin = {
        id: 'percentileLines',
        beforeDraw: (chart) => {
          const lines = chart.options.plugins?.percentileLines?.lines || [];
          if (!lines.length) return;
          const { ctx, chartArea: { top, bottom, left, right }, scales: { y } } = chart;
          ctx.save();
          lines.forEach(line => {
            const yValue = y.getPixelForValue(line.value);
            if (yValue < top || yValue > bottom) return;
            ctx.strokeStyle = line.color;
            ctx.lineWidth = 1;
            ctx.setLineDash(line.dash || []);
            ctx.beginPath();
            ctx.moveTo(left, yValue);
            ctx.lineTo(right, yValue);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = line.color;
            ctx.font = '11px Inter';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`${line.label}: ${line.value.toFixed(1)}`, right - 6, yValue - 4);
          });
          ctx.restore();
        }
      };

      const customPanState = {
        active: false,
        startX: 0,
        startMin: 1,
        startMax: 365
      };
      const activePointers = new Map();
      const pinchState = {
        active: false,
        startDistance: 0,
        startCenterData: 0,
        startRange: 364
      };

      const getPointerDistance = () => {
        const [firstPointer, secondPointer] = [...activePointers.values()];
        return Math.hypot(secondPointer.clientX - firstPointer.clientX, secondPointer.clientY - firstPointer.clientY);
      };

      const getPointerCenterX = () => {
        const [firstPointer, secondPointer] = [...activePointers.values()];
        return (firstPointer.clientX + secondPointer.clientX) / 2;
      };

      const startPinch = () => {
        const xScale = state.chartInstance?.scales?.x;
        const rect = canvasElement.getBoundingClientRect();
        if (!xScale || rect.width === 0 || activePointers.size < 2) return;

        const centerRatio = Math.min(Math.max((getPointerCenterX() - rect.left) / rect.width, 0), 1);
        pinchState.active = true;
        pinchState.startDistance = getPointerDistance();
        pinchState.startRange = xScale.max - xScale.min;
        pinchState.startCenterData = xScale.min + pinchState.startRange * centerRatio;
        customPanState.active = false;
        canvasElement.style.cursor = 'grabbing';
      };

      const handleCustomPanStart = (event) => {
        if (event.button !== 0) return;
        activePointers.set(event.pointerId, event);
        canvasElement.setPointerCapture(event.pointerId);

        if (activePointers.size === 2) {
          startPinch();
          return;
        }
        if (activePointers.size > 1) return;

        const xScale = state.chartInstance?.scales?.x;
        if (!xScale) return;
        if (xScale.min <= 1 && xScale.max >= 365) return;

        customPanState.active = true;
        customPanState.startX = event.clientX;
        customPanState.startMin = xScale.min;
        customPanState.startMax = xScale.max;
        canvasElement.style.cursor = 'grabbing';
      };

      const handleCustomPanMove = (event) => {
        if (!activePointers.has(event.pointerId) || !state.chartInstance?.scales?.x) return;
        activePointers.set(event.pointerId, event);

        if (pinchState.active && activePointers.size >= 2) {
          const rect = canvasElement.getBoundingClientRect();
          const distance = getPointerDistance();
          if (rect.width === 0 || distance === 0 || pinchState.startDistance === 0) return;

          const scale = distance / pinchState.startDistance;
          const nextRange = pinchState.startRange / scale;
          const centerRatio = Math.min(Math.max((getPointerCenterX() - rect.left) / rect.width, 0), 1);
          applyXAxisRange(
            pinchState.startCenterData - nextRange * centerRatio,
            pinchState.startCenterData + nextRange * (1 - centerRatio)
          );
          return;
        }

        if (!customPanState.active) return;
        const xScale = state.chartInstance.scales.x;
        const chartArea = state.chartInstance.chartArea;
        if (!chartArea) return;

        const deltaPixels = event.clientX - customPanState.startX;
        const deltaUnits = (deltaPixels / Math.max(1, chartArea.right - chartArea.left)) * (customPanState.startMax - customPanState.startMin);

        const newMin = customPanState.startMin - deltaUnits;
        const newMax = customPanState.startMax - deltaUnits;
        const nextRange = clampXAxisRange(newMin, newMax);

        xScale.min = nextRange.min;
        xScale.max = nextRange.max;
        if (state.chartInstance.options?.scales?.x) {
          state.chartInstance.options.scales.x.min = nextRange.min;
          state.chartInstance.options.scales.x.max = nextRange.max;
        }
        state.chartInstance.update('none');
      };

      const handleCustomPanEnd = (event) => {
        activePointers.delete(event.pointerId);
        if (activePointers.size < 2) pinchState.active = false;

        if (!customPanState.active) {
          canvasElement.style.cursor = 'grab';
          return;
        }
        customPanState.active = false;
        canvasElement.style.cursor = 'grab';
      };

      const handleWheelZoom = (event) => {
        const xScale = state.chartInstance?.scales?.x;
        if (!xScale) return;

        event.preventDefault();
        const rect = canvasElement.getBoundingClientRect();
        const px = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
        const ratio = rect.width ? px / rect.width : 0.5;
        const range = xScale.max - xScale.min;
        const nextRange = event.deltaY < 0 ? range * 0.96 : range * 1.04;

        if (nextRange >= 364) {
          applyXAxisRange(1, 365);
          return;
        }

        const center = xScale.min + range * ratio;
        const newMin = center - nextRange * ratio;
        const newMax = center + nextRange * (1 - ratio);

        applyXAxisRange(newMin, newMax);
      };

      canvasElement.onwheel = handleWheelZoom;
      canvasElement.onpointerdown = handleCustomPanStart;
      canvasElement.onpointermove = handleCustomPanMove;
      canvasElement.onpointerup = handleCustomPanEnd;
      canvasElement.onpointercancel = handleCustomPanEnd;
      canvasElement.onpointerleave = handleCustomPanEnd;
      canvasElement.style.cursor = 'grab';
      canvasElement.style.touchAction = 'none';

      // Chart configuration options with dynamic responsive scales and NO background grid lines
      state.chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: []
        },
        plugins: [monthLabelPlugin, percentileLinesPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              bottom: 24
            }
          },
          events: ['click'],
          interaction: {
            mode: 'index',
            intersect: false,
          },
          scales: {
            x: {
              type: 'linear',
              min: 1,
              max: 365,
              grid: {
                display: false, // REMOVED X-AXIS GRID LINES
                drawOnChartArea: false,
                drawTicks: true
              },
              border: {
                color: isDark ? '#334155' : '#cbd5e1'
              },
              ticks: {
                display: false
              }
            },
            y: {
              type: 'linear',
              min: 0,
              grid: {
                display: false, // REMOVED Y-AXIS GRID LINES
                drawOnChartArea: false,
                drawTicks: true
              },
              border: {
                color: isDark ? '#334155' : '#cbd5e1'
              },
              ticks: {
                color: isDark ? '#94a3b8' : '#475569',
                font: { family: 'Inter', size: 10 },
                callback: (value) => {
                  if (state.yScaleType === 'percentile') {
                    return `${value}%`;
                  }
                  if (state.yScaleType === 'logarithmic') {
                    // Filter down to cleaner scientific/base-10 markers if in log mode
                    const logVal = Math.log10(value);
                    if (Number.isInteger(logVal)) {
                      return value.toLocaleString();
                    }
                    return ''; // avoid messy intermediate log ticks
                  }
                  return value.toLocaleString();
                }
              },
              title: {
                display: true,
                text: 'N Gene / PMMoV (× 1,000,000)',
                color: isDark ? '#94a3b8' : '#475569',
                font: { family: 'Inter', size: 11, weight: 'semibold' }
              }
            }
          },
          plugins: {
            legend: {
              display: false // Using our premium custom interactive HTML legend instead
            },
            percentileLines: {
              lines: []
            },
            tooltip: {
              enabled: false,
              backgroundColor: isDark ? '#0f172a' : '#ffffff',
              titleColor: isDark ? '#f8fafc' : '#0f172a',
              bodyColor: isDark ? '#cbd5e1' : '#334155',
              borderColor: isDark ? '#334155' : '#e2e8f0',
              borderWidth: 1,
              padding: 11,
              titleFont: { family: 'Inter', weight: 'bold', size: 12 },
              bodyFont: { family: 'Inter', size: 11 },
              callbacks: {
                title: function(context) {
                  if (context.length > 0 && context[0].raw) {
                    return formatDate(context[0].raw.originalDate, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' });
                  }
                  return '';
                },
                label: function(context) {
                  const originalY = context.raw.value ?? context.raw.y;
                  const labelYear = context.dataset.label;
                  const percentileLabel = state.yScaleType === 'percentile' ? ` (${context.raw.y.toFixed(1)}th percentile)` : '';
                  return ` ${labelYear}: ${originalY.toFixed(2)}${percentileLabel}`;
                }
              }
            }
          }
        }
      });

      return state.chartInstance;
    }

    // Recomputes the percentile summary, datasets and axis options from state, then repaints.
    export function updateChart() {
      const chart = state.chartInstance || createChart();
      if (!chart) return;

      const isDark = document.documentElement.classList.contains('dark');
      const isPercentileScale = state.yScaleType === 'percentile';
      const percentileValues = sortedSeriesValues();
      const stats = percentileStats(percentileValues);
      updatePercentileSummaryUI(stats);

      chart.data.datasets = buildChartDatasets();
      chart.options.plugins.percentileLines.lines = isPercentileScale ? [] : percentileLinesFor(stats);

      const yOptions = chart.options.scales.y;
      yOptions.type = isPercentileScale ? 'linear' : state.yScaleType;
      yOptions.min = isPercentileScale ? 0 : state.yScaleType === 'linear' ? 0 : 0.1;
      yOptions.max = isPercentileScale ? 100 : undefined;
      yOptions.suggestedMin = isPercentileScale ? 0 : state.yScaleType === 'linear' ? 0 : 0.1;
      yOptions.suggestedMax = isPercentileScale ? 100 : undefined;
      yOptions.title.text = isPercentileScale
        ? 'Percentile'
        : state.yScaleType === 'logarithmic' ? 'N Gene / PMMoV (× 1,000,000) [Log Scale]' : 'N Gene / PMMoV (× 1,000,000)';
      yOptions.title.color = isDark ? '#94a3b8' : '#475569';
      yOptions.ticks.color = isDark ? '#94a3b8' : '#475569';
      yOptions.border.color = isDark ? '#334155' : '#cbd5e1';
      chart.options.scales.x.border.color = isDark ? '#334155' : '#cbd5e1';

      const tooltip = chart.options.plugins.tooltip;
      tooltip.backgroundColor = isDark ? '#0f172a' : '#ffffff';
      tooltip.titleColor = isDark ? '#f8fafc' : '#0f172a';
      tooltip.bodyColor = isDark ? '#cbd5e1' : '#334155';
      tooltip.borderColor = isDark ? '#334155' : '#e2e8f0';

      // A fresh render starts unzoomed; the chart used to be destroyed and rebuilt on every toggle.
      chart.options.scales.x.min = 1;
      chart.options.scales.x.max = 365;

      chart.update();
    }

    export function resetChartZoom() {
      applyXAxisRange(1, 365);
    }

    // Render interactive HTML legend items with live analytics values
    export function updateCustomLegendUI() {
      const container = document.getElementById('legendContainer');
      if (!container) return;
      container.innerHTML = '';

      const latestYear = state.years.reduce((max, year) => Math.max(max, Number(year)), 0);
      state.years.forEach(yr => {
        const colorConf = YEAR_COLOR_PALETTE[yr] || YEAR_COLOR_PALETTE.default;
        const isChecked = state.visibleYears[yr];
        const isLatestYear = Number(yr) === latestYear;
        const series = state.series[yr] || [];
        
        // Calculate dynamic basic statistics for each year series
        const averageVal = series.length > 0 ? summarize(series).mean.toFixed(1) : 'N/A';

        const wrapper = document.createElement('div');
        wrapper.className = `flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer select-none transition-all-300 ${
          isChecked 
            ? 'bg-slate-800 text-slate-100 border-slate-600' 
            : 'bg-slate-900/30 text-slate-500 border-slate-800/80 hover:border-slate-700'
        }${isLatestYear && isChecked ? ' ring-1 ring-rose-400/40' : ''}`;
        wrapper.onclick = () => toggleYearVisibility(yr);

        wrapper.innerHTML = `
          <span class="w-3 h-3 rounded-full ${colorConf.bg} shrink-0 block"></span>
          <div class="flex items-center gap-1.5">
            <span class="font-bold">${yr}</span>
            ${isLatestYear ? '<span class="text-[9px] font-semibold uppercase tracking-wide text-rose-300">Latest</span>' : ''}
            <span class="text-[10px] text-slate-400 font-mono">(Avg: ${averageVal})</span>
          </div>
          <input type="checkbox" ${isChecked ? 'checked' : ''} class="w-3.5 h-3.5 accent-brand-500 ml-1 cursor-pointer pointer-events-none">
        `;

        container.appendChild(wrapper);
      });
    }

    // Toggle year chart visibility
    export function toggleYearVisibility(year) {
      state.visibleYears[year] = !state.visibleYears[year];
      syncStateToUrl();
      updateCustomLegendUI();
      updateChart();
    }

    // Select/deselect all helper buttons
    export function toggleAllYears(visible) {
      state.years.forEach(yr => {
        state.visibleYears[yr] = visible;
      });
      syncStateToUrl();
      updateCustomLegendUI();
      updateChart();
    }

    // Update scale mode (Linear/Logarithmic) dynamically
    export function updateYScale(value) {
      state.yScaleType = value;
      syncStateToUrl();
      updateChart();
    }

    // Update charts based on smoothing level changed
    export function updateSmoothing(value) {
      state.smoothingWindow = parseInt(value, 10);
      syncStateToUrl();
      updateChart();
    }

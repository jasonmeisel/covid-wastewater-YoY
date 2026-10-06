// Source: index.html // [1272-1303] // [1305-1324] // [1326-1740] // [1742-1757] // [1759-1795] // [1854-1860] // [1862-1870] // [1872-1877] // [1879-1884]

import { formatShortDate, formatDate, parseDateParts } from './util.js';
import { state, syncStateToUrl, sortedSamples } from './state.js';
import { pickYearColor, dailyAggregate, movingAverage, sortedSeriesValues, inclusivePercentile, percentileStats, getLatestSamplePoint, getPercentileEmoji, summarize, dayOfYearIndex, preWaveBaselineRange } from './stats.js';

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

    function fullXAxisBounds() {
      if (state.chartMode !== 'timeline') return { min: 1, max: 365 };
      const points = sortedSamples();
      if (!points.length) return { min: 0, max: 1 };
      const dates = points.map(point => Math.floor(Date.parse(`${String(point.originalDate).slice(0, 10)}T00:00:00Z`) / 86400000));
      const projection = state.chartInstance?.data?.datasets?.find(dataset => dataset.label === 'Projected wave decline');
      const min = Math.min(...dates);
      const max = Math.max(...dates, ...(projection?.data || []).map(point => point.x));
      return { min, max: max > min ? max : min + 1 };
    }

    const clampXAxisRange = (min, max) => {
      const { min: fullMin, max: fullMax } = fullXAxisBounds();
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

    function percentileLinesFor(stats, isPercentileScale) {
      if (isPercentileScale) return [];
      return [{
        label: 'Median',
        value: stats.median,
        color: 'rgba(14, 165, 233, 0.8)',
        dash: [4, 4],
      }].filter(line => line.value !== null);
    }

    function isHighlightedWaveSegment(context, year) {
      const isTimeline = state.chartMode === 'timeline';
      const waves = isTimeline && state.highlightAllWaves
        ? state.detectedWaves
        : state.highlightedWave ? [state.highlightedWave] : [];
      if (!waves.length) return false;
      const dataset = context?.dataset || context?.chart?.data?.datasets?.[context?.datasetIndex];
      const data = dataset?.data;
      const p0 = data?.[context?.p0DataIndex] || context?.p0?.$context?.raw;
      const p1 = data?.[context?.p1DataIndex] || context?.p1?.$context?.raw;
      if (!p0 || !p1 || !Number.isFinite(Number(p0.x)) || !Number.isFinite(Number(p1.x))) return false;
      const midpoint = (Number(p0.x) + Number(p1.x)) / 2;
      if (isTimeline) return getTimelineHighlightCache(data).ranges.some(range =>
        midpoint >= range.start && midpoint <= range.end);
      const wave = waves[0];
      const startParts = parseDateParts(wave.startDate);
      const endParts = parseDateParts(wave.highlightEndDate || wave.endDate);
      if (!startParts || !endParts || year < startParts.year || year > endParts.year) return false;

      const minX = year === startParts.year ? dayOfYearIndex(startParts) : 1;
      const maxX = year === endParts.year ? dayOfYearIndex(endParts) : 365;
      return midpoint >= minX && midpoint <= maxX;
    }

    const WAVE_HIGHLIGHT_COLOR = 'rgba(250, 204, 21, 1)';
    let timelineHighlightCache = null;

    function getTimelineHighlightCache(data) {
      const source = state.highlightAllWaves ? state.detectedWaves : state.highlightedWave;
      if (timelineHighlightCache?.data === data && timelineHighlightCache.source === source) return timelineHighlightCache;
      const waves = state.highlightAllWaves ? source : source ? [source] : [];
      const ranges = [];
      const nearestPeakIndices = new Set();
      for (const wave of waves) {
        const start = Math.floor(Date.parse(`${wave.startDate}T00:00:00Z`) / 86400000);
        const end = Math.floor(Date.parse(`${wave.highlightEndDate || wave.endDate}T00:00:00Z`) / 86400000);
        const peak = Math.floor(Date.parse(`${wave.peakDate}T00:00:00Z`) / 86400000);
        if (Number.isFinite(start) && Number.isFinite(end)) ranges.push({ start, end });
        if (Number.isFinite(peak) && data?.length) {
          let nearest = 0;
          let distance = Infinity;
          for (let i = 0; i < data.length; i++) {
            const nextDistance = Math.abs(Number(data[i].x) - peak);
            if (nextDistance < distance) { nearest = i; distance = nextDistance; }
          }
          if (distance <= 14) nearestPeakIndices.add(nearest);
        }
      }
      timelineHighlightCache = { data, source, ranges, nearestPeakIndices };
      return timelineHighlightCache;
    }

    function isHighlightedWavePeak(context, year) {
      const waves = state.chartMode === 'timeline' && state.highlightAllWaves
        ? state.detectedWaves
        : state.highlightedWave ? [state.highlightedWave] : [];
      return waves.some(wave => {
        if (state.chartMode === 'timeline') {
          return getTimelineHighlightCache(context.dataset?.data || []).nearestPeakIndices.has(context.dataIndex);
        }
        const peakParts = parseDateParts(wave.peakDate);
        return Boolean(peakParts && peakParts.year === year &&
          Math.abs(Number(context.raw?.x) - dayOfYearIndex(peakParts)) < 0.5);
      });
    }

    const waveHighlightPlugin = {
      id: 'waveHighlightLabel',
      afterDatasetsDraw: chart => {
        const waves = state.chartMode === 'timeline' && state.highlightAllWaves
          ? state.detectedWaves
          : state.highlightedWave ? [state.highlightedWave] : [];
        if (state.chartMode === 'timeline') {
          const datasetIndex = chart.data.datasets.findIndex(dataset => dataset.label === 'All dates');
          if (datasetIndex < 0 || !chart.isDatasetVisible(datasetIndex)) return;
          const dataset = chart.data.datasets[datasetIndex];
          const { ctx, chartArea } = chart;
          waves.forEach((wave, index) => {
            const peakX = Math.floor(Date.parse(`${wave.peakDate}T00:00:00Z`) / 86400000);
            let pointIndex = -1;
            let distance = Infinity;
            dataset.data.forEach((point, i) => {
              const nextDistance = Math.abs(Number(point.x) - peakX);
              if (nextDistance < distance) { distance = nextDistance; pointIndex = i; }
            });
            if (pointIndex < 0) return;
            const point = chart.getDatasetMeta(datasetIndex).data[pointIndex];
            if (!point || point.skip) return;
            const { x, y } = point.getProps(['x', 'y'], true);
            const peakYear = parseDateParts(wave.peakDate)?.year;
            const sameYearWaves = state.detectedWaves.filter(candidate =>
              parseDateParts(candidate.peakDate)?.year === peakYear);
            const label = `${peakYear} Wave #${sameYearWaves.indexOf(wave) + 1}`;
            ctx.save();
            ctx.font = '600 8.5px Inter, sans-serif';
            const paddingX = 5.25;
            const width = ctx.measureText(label).width + paddingX * 2;
            const height = 15;
            const left = Math.min(Math.max(x + 8, chartArea.left), chartArea.right - width);
            const top = y - height - 14 < chartArea.top ? y + 2 : y - height - 14;
            ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
            ctx.strokeStyle = WAVE_HIGHLIGHT_COLOR;
            ctx.lineWidth = 0.75;
            ctx.beginPath(); ctx.roundRect(left, top, width, height, 4); ctx.fill(); ctx.stroke();
            ctx.fillStyle = WAVE_HIGHLIGHT_COLOR; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(label, left + paddingX, top + height / 2);
            ctx.restore();
          });
          return;
        }
        const wave = waves[0];
        const peakParts = parseDateParts(wave?.peakDate);
        if (!wave || !peakParts) return;
        const datasetIndex = chart.data.datasets.findIndex(dataset => Number(dataset.label) === peakParts.year);
        if (datasetIndex < 0 || !chart.isDatasetVisible(datasetIndex)) return;

        const dataset = chart.data.datasets[datasetIndex];
        const peakX = dayOfYearIndex(peakParts);
        let pointIndex = -1;
        let distance = Infinity;
        dataset.data.forEach((point, index) => {
          const nextDistance = Math.abs(Number(point.x) - peakX);
          if (nextDistance < distance) {
            distance = nextDistance;
            pointIndex = index;
          }
        });
        if (pointIndex < 0 || distance > 0.5) return;

        const point = chart.getDatasetMeta(datasetIndex).data[pointIndex];
        if (!point || point.skip) return;
        const { x, y } = point.getProps(['x', 'y'], true);
        const sameYearWaves = state.detectedWaves.filter(candidate =>
          parseDateParts(candidate.peakDate)?.year === peakParts.year);
        const label = `${peakParts.year} Wave #${sameYearWaves.indexOf(wave) + 1}`;
        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.font = '600 11px Inter, sans-serif';
        const paddingX = 7;
        const width = ctx.measureText(label).width + paddingX * 2;
        const height = 20;
        const left = Math.min(Math.max(x + 8, chartArea.left), chartArea.right - width);
        const top = y - height - 8 < chartArea.top ? y + 8 : y - height - 8;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
        ctx.strokeStyle = WAVE_HIGHLIGHT_COLOR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(left, top, width, height, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = WAVE_HIGHLIGHT_COLOR;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, left + paddingX, top + height / 2);
        ctx.restore();
      },
    };

    // Derives the Chart.js dataset array from the current state.
    function buildChartDatasets() {
      const isPercentileScale = state.yScaleType === 'percentile';
      const percentileValues = sortedSeriesValues();
      const percentileLookup = value => inclusivePercentile(value, percentileValues);
      const latestYear = state.years.reduce((max, yr) => Math.max(max, Number(yr)), 0);
      if (state.chartMode === 'timeline') {
        const absoluteDated = sortedSamples().map(point => ({
          ...point,
          x: Math.floor(Date.parse(`${String(point.originalDate).slice(0, 10)}T00:00:00Z`) / 86400000),
        }));
        const chronological = dailyAggregate(absoluteDated);
        const smoothed = movingAverage(chronological, state.smoothingWindow, true);
        const data = smoothed.map(point => ({
          ...point,
          value: point.y,
          y: isPercentileScale ? percentileLookup(point.y) : point.y,
        }));
        return [{
          label: 'All dates',
          data,
          borderColor: pickYearColor(latestYear).stroke,
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          segment: {
            borderColor: context => isHighlightedWaveSegment(context, latestYear) ? WAVE_HIGHLIGHT_COLOR : pickYearColor(latestYear).stroke,
            borderWidth: context => isHighlightedWaveSegment(context, latestYear) ? 4 : 2.5,
          },
          pointRadius: context => isHighlightedWavePeak(context, latestYear)
            ? 5 : context.dataIndex === context.dataset.data.length - 1 ? 4 : 0,
          pointHoverRadius: context => isHighlightedWavePeak(context, latestYear) ? 7 : 5,
          pointBackgroundColor: context => isHighlightedWavePeak(context, latestYear) ? WAVE_HIGHLIGHT_COLOR : pickYearColor(latestYear).stroke,
          pointBorderColor: context => isHighlightedWavePeak(context, latestYear) ? WAVE_HIGHLIGHT_COLOR : pickYearColor(latestYear).stroke,
          fill: false,
          spanGaps: true,
        }];
      }

      return state.years.map(yr => {
        const colorConf = pickYearColor(yr);
        // One point per day before smoothing, so the window counts days and every
        // date has a single value regardless of how many plants reported.
        const originalSeries = dailyAggregate(state.series[yr] || []);
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
          segment: {
            borderColor: context => isHighlightedWaveSegment(context, Number(yr)) ? WAVE_HIGHLIGHT_COLOR : lineColor,
            borderWidth: context => isHighlightedWaveSegment(context, Number(yr)) ? 4 : (isLatestYear ? 3 : 1),
          },
          tension: 0.25,
          cubicInterpolationMode: 'monotone',
          pointRadius: context => {
            if (isHighlightedWavePeak(context, Number(yr))) return 5;
            const isLatestSample = isLatestYear && context.dataIndex === context.dataset.data.length - 1;
            return isLatestSample ? 5 : 0;
          },
          pointHoverRadius: context => {
            if (isHighlightedWavePeak(context, Number(yr))) return 7;
            const isLatestSample = isLatestYear && context.dataIndex === context.dataset.data.length - 1;
            return isLatestSample ? 7 : 0;
          },
          pointBackgroundColor: context => isHighlightedWavePeak(context, Number(yr)) ? WAVE_HIGHLIGHT_COLOR : lineColor,
          pointBorderColor: context => isHighlightedWavePeak(context, Number(yr)) ? WAVE_HIGHLIGHT_COLOR : lineColor,
          pointBorderWidth: isLatestYear ? 2 : 1,
          fill: false,
          spanGaps: true,
          hidden: !state.visibleYears[yr]
        };
      });
    }

    function buildWaveProjectionDataset(seriesDatasets) {
      const wave = state.detectedWaves.at(-1);
      if (!wave?.ongoing || !wave.forecast) return null;
      const isTimeline = state.chartMode === 'timeline';

      const latestYear = state.years.reduce((max, year) => Math.max(max, Number(year)), 0);
      const startParts = parseDateParts(wave.startDate);
      const peakParts = parseDateParts(wave.peakDate);
      const latestPoint = getLatestSamplePoint();
      const endDate = new Date((Date.parse(`${wave.forecast.earliestDate}T00:00:00Z`) +
        Date.parse(`${wave.forecast.latestDate}T00:00:00Z`)) / 2).toISOString().slice(0, 10);
      const endParts = parseDateParts(endDate);
      const currentParts = parseDateParts(latestPoint?.originalDate);
      if (!startParts || !peakParts || !latestPoint || !endParts ||
          (!isTimeline && (startParts.year !== latestYear || peakParts.year !== latestYear ||
            endParts.year > latestYear + 1 || currentParts?.year !== latestYear))) return null;

      const currentDataset = seriesDatasets.find(dataset => isTimeline || Number(dataset.label) === latestYear);
      if (!currentDataset?.data?.length) return null;
      const startX = isTimeline ? Math.floor(Date.parse(`${wave.startDate}T00:00:00Z`) / 86400000) : dayOfYearIndex(startParts);
      const peakX = isTimeline ? Math.floor(Date.parse(`${wave.peakDate}T00:00:00Z`) / 86400000) : dayOfYearIndex(peakParts);
      const currentX = Number(currentDataset.data.at(-1).x);
      const startDay = Math.floor(Date.parse(`${wave.startDate}T00:00:00Z`) / 86400000);
      const peakDay = Math.floor(Date.parse(`${wave.peakDate}T00:00:00Z`) / 86400000);
      const currentDay = Math.floor(Date.parse(`${String(latestPoint.originalDate).slice(0, 10)}T00:00:00Z`) / 86400000);
      const forecastEndDay = Math.floor(Date.parse(`${endDate}T00:00:00Z`) / 86400000);
      const lastDayThisYear = Math.floor(Date.parse(`${latestYear}-12-31T00:00:00Z`) / 86400000);
      if (!(startX < peakX && peakX < currentX && startDay < peakDay && peakDay < currentDay &&
          currentDay < forecastEndDay && (isTimeline || lastDayThisYear > currentDay))) return null;
      const nearestPoint = x => currentDataset.data.reduce((closest, point) =>
        Math.abs(Number(point.x) - x) < Math.abs(Number(closest.x) - x) ? point : closest,
      currentDataset.data[0]);
      const peakY = Number(nearestPoint(peakX).y);
      const currentY = Number(currentDataset.data.at(-1).y);
      const baselineRange = preWaveBaselineRange(sortedSamples(), state.detectedWaves);
      const baseline = baselineRange?.p90 ?? wave.baseline;
      const medianBaseline = baselineRange?.median ?? wave.baseline;
      const percentileValues = sortedSeriesValues();
      const forecastBaselineY = state.yScaleType === 'percentile'
        ? inclusivePercentile(baseline, percentileValues) : baseline;
      const medianY = state.yScaleType === 'percentile'
        ? inclusivePercentile(medianBaseline, percentileValues) : medianBaseline;
      if (![peakY, currentY, forecastBaselineY, medianY].every(Number.isFinite) || currentY <= medianY) return null;
      // Keep a downward projection even when the baseline's upper bound is above
      // the current value; in that case anchor the forecast at the lower median.
      const endY = forecastBaselineY < currentY ? forecastBaselineY : medianY;

      // Fit a concave-down quadratic through the current point and forecast end,
      // choosing curvature closest to the observed peak while keeping the
      // projected segment descending. Continue this same curve until the median.
      const tPeak = (peakDay - startDay) / (forecastEndDay - startDay);
      const tCurrent = (currentDay - startDay) / (forecastEndDay - startDay);
      const secant = (endY - currentY) / (1 - tCurrent);
      const peakCurvature = (peakY - currentY - secant * (tPeak - tCurrent)) /
        ((tPeak - tCurrent) * (tPeak - 1));
      const minCurvature = secant / (1 - tCurrent);
      const curvature = Math.min(-1e-9, Math.max(minCurvature, peakCurvature));
      const linear = secant - curvature * (1 + tCurrent);
      const constant = currentY - curvature * tCurrent * tCurrent - linear * tCurrent;
      const evaluate = t => curvature * t * t + linear * t + constant;
      // If the forecast crosses New Year, draw only through Dec 31.
      const projectionLimitDay = isTimeline ? currentDay + 365 : lastDayThisYear;
      let displayedEndDay = projectionLimitDay;
      for (let day = currentDay + 1; day <= projectionLimitDay; day++) {
        const t = (day - startDay) / (forecastEndDay - startDay);
        if (evaluate(t) <= medianY) {
          displayedEndDay = day;
          break;
        }
      }
      const data = [];
      for (let day = currentDay; day <= displayedEndDay; day++) {
        const t = (day - startDay) / (forecastEndDay - startDay);
        const date = new Date(day * 86400000).toISOString().slice(0, 10);
        data.push({ x: isTimeline ? day : dayOfYearIndex(parseDateParts(date)), y: evaluate(t) });
      }
      const color = document.documentElement.classList.contains('dark')
        ? 'rgba(250, 204, 21, 0.95)' : 'rgba(180, 83, 9, 0.95)';
      return {
        label: 'Projected wave decline',
        data,
        borderColor: color,
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [2, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0,
        fill: false,
        spanGaps: false,
        order: -1,
      };
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
          if (state.chartMode === 'timeline') return;
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
          const band = chart.options.plugins?.percentileLines?.band;
          if (!lines.length && !band) return;
          const { ctx, chartArea: { top, bottom, left, right }, scales: { y } } = chart;
          ctx.save();
          if (band && Number.isFinite(band.low) && Number.isFinite(band.high)) {
            const lowPixel = y.getPixelForValue(band.low);
            const highPixel = y.getPixelForValue(band.high);
            const bandTop = Math.max(top, Math.min(lowPixel, highPixel));
            const bandBottom = Math.min(bottom, Math.max(lowPixel, highPixel));
            if (bandBottom > bandTop) {
              ctx.fillStyle = 'rgba(250, 204, 21, 0.10)';
              ctx.fillRect(left, bandTop, right - left, bandBottom - bandTop);
              ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)';
              ctx.lineWidth = 1;
              ctx.setLineDash([5, 4]);
              [bandTop, bandBottom].forEach(yPixel => {
                ctx.beginPath();
                ctx.moveTo(left, yPixel);
                ctx.lineTo(right, yPixel);
                ctx.stroke();
              });
              ctx.setLineDash([]);
              ctx.fillStyle = 'rgba(250, 204, 21, 0.95)';
              ctx.font = '11px Inter';
              ctx.textAlign = 'right';
              ctx.textBaseline = 'top';
              ctx.fillText(band.label, right - 6, bandTop + 3);
            }
          }
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
        const bounds = fullXAxisBounds();
        if (xScale.min <= bounds.min && xScale.max >= bounds.max) return;

        customPanState.active = true;
        customPanState.startX = event.clientX;
        customPanState.startMin = xScale.min;
        customPanState.startMax = xScale.max;
        canvasElement.style.cursor = 'grabbing';
      };

      const handleCustomPanMove = (event) => {
        if (!activePointers.has(event.pointerId) || !state.chartInstance?.scales?.x) return;
        activePointers.set(event.pointerId, event);

        if (customPanState.active || pinchState.active) event.preventDefault();

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

        if (nextRange >= fullXAxisBounds().max - fullXAxisBounds().min) {
          const bounds = fullXAxisBounds();
          applyXAxisRange(bounds.min, bounds.max);
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
      // pan-y keeps vertical page scrolling working on touch devices; only horizontal
      // drags are claimed for x-axis panning.
      canvasElement.style.touchAction = 'pan-y';

      // Chart configuration options with dynamic responsive scales and NO background grid lines
      state.chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: []
        },
        plugins: [monthLabelPlugin, percentileLinesPlugin, waveHighlightPlugin],
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
                display: true,
                maxTicksLimit: 12,
                autoSkip: true,
                callback: value => state.chartMode === 'timeline'
                  ? new Date(Number(value) * 86400000).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
                  : ''
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
              lines: [],
              band: null,
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
      const isTimeline = state.chartMode === 'timeline';
      const title = document.getElementById('chartTitle');
      const description = document.getElementById('chartDescription');
      const legend = document.getElementById('legendContainer')?.parentElement;
      if (title) title.textContent = isTimeline ? 'Continuous Timeline' : 'Year-over-Year Seasonal Overlay';
      if (description) description.textContent = isTimeline
        ? 'Daily normalized SARS-CoV-2 wastewater levels over time, including the projected wave decline when available.'
        : 'Daily SARS-CoV-2 levels normalized by PMMoV; each line is a calendar year aligned by day of year.';
      if (legend) legend.classList.toggle('hidden', isTimeline);
      const percentileValues = sortedSeriesValues();
      const stats = percentileStats(percentileValues);
      updatePercentileSummaryUI(stats);

      const seriesDatasets = buildChartDatasets();
      const projectionDataset = buildWaveProjectionDataset(seriesDatasets);
      chart.data.datasets = projectionDataset ? [...seriesDatasets, projectionDataset] : seriesDatasets;
      const preWaveRange = preWaveBaselineRange(sortedSamples(), state.detectedWaves);
      chart.options.plugins.percentileLines.lines = percentileLinesFor(stats, isPercentileScale);
      chart.options.plugins.percentileLines.band = preWaveRange ? {
        low: isPercentileScale ? inclusivePercentile(preWaveRange.p10, percentileValues) : preWaveRange.p10,
        high: isPercentileScale ? inclusivePercentile(preWaveRange.p90, percentileValues) : preWaveRange.p90,
        label: 'Pre-Wave Baseline (10–90%)',
      } : null;

      const yOptions = chart.options.scales.y;
      yOptions.type = isPercentileScale ? 'linear' : state.yScaleType;
      yOptions.min = isPercentileScale ? 0 : state.yScaleType === 'linear' ? 0 : 1;
      yOptions.max = isPercentileScale ? 100 : undefined;
      yOptions.suggestedMin = isPercentileScale ? 0 : state.yScaleType === 'linear' ? 0 : 1;
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
      const xBounds = fullXAxisBounds();
      chart.options.scales.x.min = xBounds.min;
      chart.options.scales.x.max = xBounds.max;

      const canvas = document.getElementById('yoyChart');
      if (canvas) {
        const visibleYears = state.years.filter(yr => state.visibleYears[yr]);
        const latest = getLatestSamplePoint();
        canvas.setAttribute('aria-label', latest
          ? `Year-over-year normalized SARS-CoV-2 wastewater levels, ${visibleYears.join(', ')}; latest ${latest.y.toFixed(1)} on ${formatShortDate(latest.originalDate)}`
          : 'Year-over-year normalized SARS-CoV-2 wastewater levels; no data loaded');
      }

      chart.update();
    }

    export function resetChartZoom() {
      const bounds = fullXAxisBounds();
      applyXAxisRange(bounds.min, bounds.max);
    }

    // Render interactive HTML legend items with live analytics values
    export function updateCustomLegendUI() {
      const container = document.getElementById('legendContainer');
      if (!container) return;

      // Rebuilding the chips drops focus; remember which year was active so keyboard
      // users can toggle the same year repeatedly without re-tabbing.
      const focused = document.activeElement;
      const focusedYear = focused && focused.dataset && focused.dataset.action === 'toggle-year'
        ? focused.dataset.year
        : null;

      container.innerHTML = '';

      const latestYear = state.years.reduce((max, year) => Math.max(max, Number(year)), 0);
      state.years.forEach(yr => {
        const colorConf = pickYearColor(yr);
        const isChecked = state.visibleYears[yr];
        const isLatestYear = Number(yr) === latestYear;
        const series = state.series[yr] || [];
        
        // Calculate dynamic basic statistics for each year series
        const averageVal = series.length > 0 ? summarize(series).mean.toFixed(1) : 'N/A';

        const wrapper = document.createElement('div');
        wrapper.className = `flex items-center gap-2 px-2.5 py-1 rounded-sm border text-xs cursor-pointer select-none transition-all-300 ${
          isChecked 
            ? 'bg-slate-800 text-slate-100 border-slate-700' 
            : 'bg-slate-900/30 text-slate-500 border-slate-800/60 hover:border-slate-700'
        }${isLatestYear && isChecked ? ' ring-1 ring-rose-400/40' : ''}`;
        wrapper.setAttribute('role', 'switch');
        wrapper.setAttribute('tabindex', '0');
        wrapper.setAttribute('aria-checked', String(Boolean(isChecked)));
        wrapper.setAttribute('aria-label', `Toggle ${yr}`);
        wrapper.dataset.action = 'toggle-year';
        wrapper.dataset.year = String(yr);

        wrapper.innerHTML = `
          <span class="w-3 h-3 rounded-full ${colorConf.bg} shrink-0 block"></span>
          <div class="flex items-center gap-1.5">
            <span class="font-bold">${yr}</span>
            ${isLatestYear ? '<span class="text-[10px] font-semibold uppercase tracking-wide text-rose-300">Latest</span>' : ''}
            <span class="text-[10px] text-slate-400 font-mono">(Avg: ${averageVal})</span>
          </div>
          <input type="checkbox" ${isChecked ? 'checked' : ''} tabindex="-1" aria-hidden="true" class="w-3.5 h-3.5 accent-brand-500 ml-1 cursor-pointer pointer-events-none">
        `;

        container.appendChild(wrapper);
      });

      if (focusedYear) {
        const restored = container.querySelector(`[data-action="toggle-year"][data-year="${focusedYear}"]`);
        if (restored) restored.focus();
      }
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

    export function updateChartMode(value) {
      state.chartMode = value === 'timeline' ? 'timeline' : 'yoy';
      syncStateToUrl();
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

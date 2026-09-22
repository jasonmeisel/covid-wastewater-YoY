// Source: index.html // [577-586] // [1040-1055] // [1057-1068] // [1070-1078] // [1080-1131] // [1133-1157] // [1159-1168] // [1170-1180] // [1182-1191] // [1193-1207] // [1209-1219] // [1221-1223] // [1225-1259] // [1261-1270]

import { state } from './state.js';

    // Color definitions for individual years
    export const YEAR_COLOR_PALETTE = {
      2022: { stroke: 'rgba(56, 189, 248, 1)', fill: 'rgba(56, 189, 248, 0.05)', bg: 'bg-sky-400' },
      2023: { stroke: 'rgba(59, 130, 246, 1)', fill: 'rgba(59, 130, 246, 0.05)', bg: 'bg-blue-500' },
      2024: { stroke: 'rgba(168, 85, 247, 1)', fill: 'rgba(168, 85, 247, 0.05)', bg: 'bg-purple-500' },
      2025: { stroke: 'rgba(236, 72, 153, 1)', fill: 'rgba(236, 72, 153, 0.05)', bg: 'bg-pink-500' },
      2026: { stroke: 'rgba(244, 63, 94, 1)', fill: 'rgba(244, 63, 94, 0.05)', bg: 'bg-rose-500' },
      default: { stroke: 'rgba(148, 163, 184, 1)', fill: 'rgba(148, 163, 184, 0.05)', bg: 'bg-slate-400' }
    };


    // Helper functions for dates
    // Computes continuous Day of Year index (1-365) ensuring leap days align smoothly with regular days
    export function dateToDayOfYear(dateStr) {
      const d = new Date(dateStr);
      const start = new Date(d.getFullYear(), 0, 0);
      const diff = d - start;
      const oneDay = 24 * 60 * 60 * 1000;
      let dayNum = Math.floor(diff / oneDay);
      
      // If it's a leap year, decrement index by 1 from March 1 onwards so identical calendar dates overlay
      const isLeap = (d.getFullYear() % 4 === 0 && d.getFullYear() % 100 !== 0) || (d.getFullYear() % 400 === 0);
      if (isLeap && dayNum > 60) {
        dayNum -= 1; // Flatten Feb 29 into the timeline seamlessly
      }
      return dayNum;
    }

    // Helper to extract nested PMMOV ratio safely from sample target structures
    export function extractPMMOV(s) {
      try {
        if (s.targets && s.targets["N Gene"]) {
          const val = s.targets["N Gene"].gc_g_dry_weight_trimmed5_pmmov;
          return val !== undefined && val !== null ? Number(val) : null;
        }
      } catch (err) {
        console.warn("Failed parsing targets for item", s, err);
      }
      return null;
    }

    // Dynamic key discovery for robustness across diverse wastewater GCS schemas
    export function findSampleDate(s) {
      if (s.date) return s.date;
      if (s.collection_date) return s.collection_date;
      if (s.sample_date) return s.sample_date;
      
      const potentialKey = Object.keys(s).find(k => k.toLowerCase().includes('date') || k.toLowerCase().includes('time'));
      return potentialKey ? s[potentialKey] : null;
    }

    // Central Parsing and Grouping Algorithm
    export function processRawWastewaterSamples(samplesArray) {
      const grouped = {};
      const uniqueYears = new Set();

      samplesArray.forEach(s => {
        const rawDate = findSampleDate(s);
        const pmmovVal = extractPMMOV(s);

        if (!rawDate || pmmovVal === null || isNaN(pmmovVal)) return;

        const valScaled = pmmovVal * 1000000;
        
        // Log scale safety configuration: omit or clamp non-positive numbers
        if (valScaled <= 0) return; 

        const dObj = new Date(rawDate);
        if (isNaN(dObj.getTime())) return;

        const year = dObj.getFullYear();
        uniqueYears.add(year);

        const dayIndex = dateToDayOfYear(rawDate);

        if (!grouped[year]) {
          grouped[year] = [];
        }

        grouped[year].push({
          x: dayIndex, // aligned X coordinate (1-365)
          y: valScaled, // scaled target ratio value (N Gene / PMMoV * 1,000,000)
          originalDate: rawDate,
          actualYear: year,
          rawRatio: pmmovVal
        });
      });

      // Sort chronological values within each year group
      Object.keys(grouped).forEach(yr => {
        grouped[yr].sort((a, b) => a.x - b.x);
      });

      state.processedData = grouped;
      state.yearsList = Array.from(uniqueYears).sort((a, b) => b - a); // descending sort
      
      // Default to having all years checked/visible
      state.yearsList.forEach(yr => {
        if (state.visibleYears[yr] === undefined) {
          state.visibleYears[yr] = true;
        }
      });
    }

    // Dynamic moving average smoothing window logic
    export function computeMovingAverage(dataSeries, windowSize, preserveLastPoint = false) {
      if (windowSize <= 1 || dataSeries.length <= 1) return dataSeries;

      return dataSeries.map((currentPoint, currentIdx, list) => {
        // Keep only the current year's endpoint tied to the latest observed sample.
        if (preserveLastPoint && currentIdx === list.length - 1) return currentPoint;

        let sum = 0;
        let count = 0;
        const offset = Math.floor(windowSize / 2);

        for (let i = currentIdx - offset; i <= currentIdx + offset; i++) {
          if (i >= 0 && i < list.length) {
            sum += list[i].y;
            count++;
          }
        }

        return {
          ...currentPoint,
          y: sum / count // smoothed Y coordinate
        };
      });
    }

    // Percentile analytics helper functions
    export let percentileStats = {
      q1: null,
      median: null,
      q3: null,
      p5: null,
      p1: null,
      currentPercentile: null,
      currentValue: null
    };

    export function computeQuantile(sortedList, ratio) {
      if (!sortedList.length) return null;
      const position = (sortedList.length - 1) * ratio;
      const lowerIndex = Math.floor(position);
      const upperIndex = Math.ceil(position);
      if (lowerIndex === upperIndex) return sortedList[lowerIndex];
      const lowerValue = sortedList[lowerIndex];
      const upperValue = sortedList[upperIndex];
      const weight = position - lowerIndex;
      return lowerValue + (upperValue - lowerValue) * weight;
    }

    export function getVisibleSampleValues() {
      const values = [];
      state.yearsList.forEach(yr => {
        if (state.visibleYears[yr]) {
          (state.processedData[yr] || []).forEach(pt => values.push(pt.y));
        }
      });
      return values.sort((a, b) => a - b);
    }


    export function getInclusivePercentile(value, sortedValues) {
      let lower = 0;
      let upper = sortedValues.length;

      while (lower < upper) {
        const middle = Math.floor((lower + upper) / 2);
        if (sortedValues[middle] <= value) {
          lower = middle + 1;
        } else {
          upper = middle;
        }
      }

      return sortedValues.length ? (lower / sortedValues.length) * 100 : null;
    }

    export function getLatestSamplePoint() {
      let latestPoint = null;
      Object.values(state.processedData).forEach(series => {
        series.forEach(point => {
          if (!latestPoint || new Date(point.originalDate) > new Date(latestPoint.originalDate)) {
            latestPoint = point;
          }
        });
      });
      return latestPoint;
    }

    export function getLatestSampleValue() {
      return getLatestSamplePoint()?.y ?? null;
    }

    export function computePercentileStats(values = getVisibleSampleValues()) {
      const currentValue = getLatestSampleValue();
      if (!values.length) {
        percentileStats = {
          q1: null,
          median: null,
          q3: null,
          p5: null,
          p1: null,
          currentPercentile: null,
          currentValue: null
        };
        return percentileStats;
      }

      const q1 = computeQuantile(values, 0.25);
      const median = computeQuantile(values, 0.5);
      const q3 = computeQuantile(values, 0.75);
      const p5 = computeQuantile(values, 0.05);
      const p1 = computeQuantile(values, 0.01);
      const currentPercentile = currentValue === null
        ? null
        : (values.filter(v => v <= currentValue).length / values.length) * 100;

      percentileStats = {
        q1,
        median,
        q3,
        p5,
        p1,
        currentPercentile,
        currentValue
      };
      return percentileStats;
    }

    export function getPercentileEmoji(percentile) {
      if (percentile === null || percentile === undefined || Number.isNaN(percentile)) return '—';
      if (percentile <= 1) return '👌';
      if (percentile <= 5) return '🙂';
      if (percentile <= 10) return '🟢';
      if (percentile <= 25) return '🟨';
      if (percentile <= 50) return '😣';
      if (percentile <= 75) return '⚠️';
      return '🚨';
    }

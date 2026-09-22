// Source: index.html // [1946-1951] // [1953-1986] // [1988-1992] // [1994-2044] // [2046-2050] // [2052-2075]

import { formatDate, formatLongDate } from './util.js';
import { state } from './state.js';

    // Sync Table Search string
    export function handleSearch(query) {
      state.tableSearchQuery = query.toLowerCase().trim();
      state.tablePage = 1;
      applyTableFiltering();
    }

    // Filter tabular data based on current query string
    export function applyTableFiltering() {
      const allList = [];
      Object.keys(state.processedData).forEach(yr => {
        state.processedData[yr].forEach(pt => {
          allList.push(pt);
        });
      });

      // Search matching logic
      if (!state.tableSearchQuery) {
        state.filteredTableSamples = [...allList];
      } else {
        state.filteredTableSamples = allList.filter(pt => {
          const dateStr = formatDate(pt.originalDate, { month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase();
          const pmmovRawStr = pt.rawRatio.toString();
          const yoyValStr = pt.y.toFixed(2);
          
          return pt.originalDate.includes(state.tableSearchQuery) || 
                 dateStr.includes(state.tableSearchQuery) || 
                 pmmovRawStr.includes(state.tableSearchQuery) || 
                 yoyValStr.includes(state.tableSearchQuery);
        });
      }

      // Sort chronological default order (descending)
      state.filteredTableSamples.sort((a, b) => {
        const cmp = String(a.originalDate).localeCompare(String(b.originalDate));
        return state.tableSortAsc ? cmp : -cmp;
      });

      renderTableUI();
    }

    // Switch data sort direction
    export function sortTableByDate() {
      state.tableSortAsc = !state.tableSortAsc;
      applyTableFiltering();
    }

    // Draw active filtered items to HTML table body
    export function renderTableUI() {
      const tbody = document.getElementById('rawTableBody');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (state.filteredTableSamples.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" class="text-center py-8 text-slate-500 font-medium bg-slate-900/10">No matching wastewater samples discovered.</td>
          </tr>
        `;
        document.getElementById('tablePaginationInfo').innerText = "Showing 0 to 0 of 0 entries";
        document.getElementById('prevPageBtn').disabled = true;
        document.getElementById('nextPageBtn').disabled = true;
        return;
      }

      const startIndex = (state.tablePage - 1) * state.tableLimit;
      const endIndex = Math.min(startIndex + state.tableLimit, state.filteredTableSamples.length);
      const visibleRows = state.filteredTableSamples.slice(startIndex, endIndex);

      visibleRows.forEach(row => {
        const formattedDate = formatLongDate(row.originalDate);
        
        // Severity scale indicators
        let severityBadge = '';
        if (row.y < 10) {
          severityBadge = '<span class="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold text-[10px]">Low Baseline</span>';
        } else if (row.y >= 10 && row.y < 35) {
          severityBadge = '<span class="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-semibold text-[10px]">Moderate</span>';
        } else {
          severityBadge = '<span class="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-semibold text-[10px]">High Surge</span>';
        }

        const tr = document.createElement('tr');
        tr.className = "border-b border-slate-800 hover:bg-slate-800/30 transition-all-300";
        tr.innerHTML = `
          <td class="py-3 px-4 font-semibold text-slate-200">${formattedDate}</td>
          <td class="py-3 px-4 font-mono text-slate-400">${row.rawRatio.toExponential(4)}</td>
          <td class="py-3 px-4 font-mono font-bold text-teal-400">${row.y.toFixed(2)}</td>
          <td class="py-3 px-4">${severityBadge}</td>
        `;
        tbody.appendChild(tr);
      });

      // Pagination dynamic status texts
      document.getElementById('tablePaginationInfo').innerText = `Showing ${startIndex + 1} to ${endIndex} of ${state.filteredTableSamples.length} entries`;
      document.getElementById('prevPageBtn').disabled = state.tablePage === 1;
      document.getElementById('nextPageBtn').disabled = endIndex >= state.filteredTableSamples.length;
    }

    // Change pages back or forward
    export function changePage(direction) {
      state.tablePage += direction;
      renderTableUI();
    }

    // Export raw data as styled clean comma-separated values CSV format
    export function downloadCSV() {
      if (state.rawSamples.length === 0) return;
      
      let csvContent = "data:text/csv;charset=utf-8,Date,Raw Ratio,Scaled Target Ratio (x1M)\n";
      
      const allSorted = [];
      Object.keys(state.processedData).forEach(yr => {
        state.processedData[yr].forEach(pt => allSorted.push(pt));
      });
      allSorted.sort((a, b) => String(a.originalDate).localeCompare(String(b.originalDate)));

      allSorted.forEach(pt => {
        csvContent += `${pt.originalDate},${pt.rawRatio},${pt.y.toFixed(6)}\n`;
      });

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `wastewater_analytics_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

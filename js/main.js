// Entry point: wires URL state, event delegation and the initial data loads.
import { applyStateFromUrl, syncControlsFromState } from './state.js';
import { loadPlantsCatalog, loadCountyCovidData, loadAndRenderPlantSamples } from './data.js';
import { bindActions } from './ui.js';

export function init() {
  // Apply any options carried in the URL query params
  applyStateFromUrl();
  syncControlsFromState();
  bindActions();
  // Load plants catalog first
  loadPlantsCatalog();
  loadCountyCovidData();
  // Fetch default plant dataset
  loadAndRenderPlantSamples();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

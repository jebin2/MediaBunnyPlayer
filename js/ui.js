// ============================================================================
// UI STATE MANAGEMENT
// ============================================================================


import { $, videoContainer, dropZone, loading, timeDisplay, progressBar, videoControls, progressHandle, startTimeInput, endTimeInput, showMessage } from './constants.js';
import { state } from './state.js';
import { hideTrackMenus } from './player.js'
import { formatTime } from './utility.js'
// import { updatePlaylistUIOptimized } from './playlist.js'

export const showPlayerUI = () => {
	dropZone.style.display = 'none';
	videoContainer.style.display = 'block';
};

export const showDropZoneUI = () => {
	dropZone.style.display = 'flex';
	videoContainer.style.display = 'none';
	updateProgressBarUI(0);
	state.totalDuration = 0;
};

export const showLoading = show => loading.classList.toggle('hidden', !show);

export const showError = msg => {
	showMessage.innerHTML = "";
	showMessage.className = "showMessage error-message"

	const el = document.createElement('div');
	el.textContent = msg;
	showMessage.appendChild(el);
	setTimeout(() => {
		showMessage.innerHTML = ""
		showMessage.className = "showMessage hidden"
	}, 4000);
};

export const showInfo = msg => {
	showMessage.innerHTML = "";
	showMessage.className = "showMessage"

	const el = document.createElement('div');
	el.textContent = msg;
	showMessage.appendChild(el);
	setTimeout(() => {
		showMessage.innerHTML = ""
		showMessage.className = "showMessage hidden"
	}, 4000);
};

export const showStatusMessage = (msg) => {
	const statusEl = $('statusMessage');
	if (statusEl) {
		statusEl.textContent = msg;
		statusEl.style.display = 'block';
	}
	showLoading(true);
};

export const hideStatusMessage = () => {
	const statusEl = $('statusMessage');
	if (statusEl) {
		statusEl.textContent = '';
		statusEl.style.display = 'none';
	}
	showLoading(false);
};

export const showControlsTemporarily = () => {
	clearTimeout(state.hideControlsTimeout);
	if (state.isPositioningCaptions) {
		videoControls.classList.add('hidden');
		return;
	}
	videoControls.classList.add('show');
	videoContainer.classList.remove('hide-cursor');

	if (state.playing) {
		state.hideControlsTimeout = setTimeout(() => {
			if (state.playing && !state.isSeeking && !videoControls.matches(':hover') && !document.querySelector('.control-group:hover')) {
				videoControls.classList.remove('show');
				videoContainer.classList.add('hide-cursor');
				hideTrackMenus();
			}
		}, 3000);
	}
};

export const updateProgressBarUI = (time) => {
	// updatePlaylistUIOptimized();
	const displayTime = Math.max(0, Math.min(time, state.totalDuration));
	timeDisplay.textContent = `${formatTime(displayTime)} / ${formatTime(state.totalDuration)}`;
	const percent = state.totalDuration > 0 ? (displayTime / state.totalDuration) * 100 : 0;
	progressBar.style.width = `${percent}%`;
	progressHandle.style.left = `${percent}%`;

	if (state.playing) updateTimeInputs(time);
};

export const updateTimeInputs = (time) => {
	const currentFocused = document.activeElement;
	if (currentFocused !== startTimeInput && currentFocused !== endTimeInput) {
		// Optionally update inputs here if needed
	}
};
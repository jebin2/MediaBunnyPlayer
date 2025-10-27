import { $, settingsMenu, settingsCtrlBtn, playerArea, sidebar, loopBtn, startTimeInput, endTimeInput, scaleOptionContainer, scaleWithRatioToggle, blurOptionContainer, smoothOptionContainer, smoothPathToggle, cropModeNoneRadio, blurBackgroundToggle, blurAmountInput, captionMenu } from './constants.js';
import { state } from './state.js';
import { formatTime, guidedPanleInfo, rightPanel } from './utility.js'
import { positionCropCanvas, togglePanning, toggleStaticCrop } from './crop.js'
import { pause } from './player.js'
import { showInfo } from './ui.js'

export const setupSettingsListeners = () => {
	settingsCtrlBtn.onclick = (e) => {
		e.stopPropagation();
		rightPanel('settings', true);
	};
	configTrimRange();
};

export const updateDynamicCropOptionsUI = () => {
	scaleOptionContainer.style.display = (state.dynamicCropMode === 'max-size') ? 'flex' : 'none';
	blurOptionContainer.style.display = (state.dynamicCropMode === 'spotlight' || state.dynamicCropMode === 'max-size') ? 'flex' : 'none';
	// Show the smooth option for ANY dynamic mode
	smoothOptionContainer.style.display = (state.dynamicCropMode !== 'none') ? 'flex' : 'none';
};

export const resetAllConfigs = () => {
	// 1. Pause the player if it's running
	if (state.playing) pause();

	// 2. Deactivate and reset any active cropping/panning modes
	// Using the reset flag in our existing toggle functions is perfect for this
	toggleStaticCrop(null, true);
	togglePanning(null, true);

	// 3. Reset all dynamic crop configuration states
	state.dynamicCropMode = 'none';
	state.scaleWithRatio = false;
	state.useBlurBackground = false;
	state.smoothPath = true;
	state.blurAmount = 15;
	updateDynamicCropOptionsUI();

	// 4. Reset the UI for dynamic crop options
	if (cropModeNoneRadio) cropModeNoneRadio.checked = true;

	if (scaleWithRatioToggle) scaleWithRatioToggle.checked = false;

	if (smoothPathToggle) smoothPathToggle.checked = true;

	if (blurBackgroundToggle) blurBackgroundToggle.checked = false;
	if (blurAmountInput) {
		blurAmountInput.value = 15;
	}


	// 5. Reset the time range inputs to the full duration of the video
	if (state.fileLoaded) {
		startTimeInput.value = formatTime(0);
		endTimeInput.value = formatTime(state.totalDuration);
	}

	// 6. Reset the looping state and UI
	state.isLooping = false;
	state.loopStartTime = 0;
	state.loopEndTime = 0;
	loopBtn.textContent = 'Loop';
	loopBtn.classList.remove('hover_highlight');

	// 8. Remove Guided Panel
	guidedPanleInfo("");

	// 9. Give user feedback
	showInfo("All configurations have been reset.");
};

const trimRangeList = $('trimRangeList');
const configTrimRange = () => {
	trimRangeList.addEventListener('click', (e) => {
		const target = e.target;

		const rowElement = target.closest('.trim-range');

		if (target.matches('.trimRangeRemove')) {
			rowElement.remove();
			if (document.querySelectorAll("#trimRangeList .trim-range").length == 0) {
				createTrimRange();
			}
		}

		if (target.matches('.trimRangeAdd')) {
			createTrimRange(rowElement);
		}
	});
}

const createTrimRange = (beforeElement = null) => {
	const trimRow = document.createElement('div');
	trimRow.className = 'trim-menu-controls trim-range';
	trimRow.innerHTML = `
		<input type="text" class="startTime time-input" placeholder="00:00" title="Start Time">
		<span>-</span>
		<input type="text" class="endTime time-input" placeholder="00:00" title="End Time">
		<button class="trimRangeRemove close-btn">-</button>
		<button class="trimRangeAdd close-btn tick-btn">+</button>
	`;

	if (beforeElement) {
		trimRangeList.insertBefore(trimRow, beforeElement);
	} else {
		trimRangeList.appendChild(trimRow);
	}
};

// [
//   { "start": "00:00", "end": "00:50" },
//   { "start": "01:00", "end": "02:00" }
// ]
export const getTrimRanges = () => {
	const ranges = [];
	const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:MM validation

	document.querySelectorAll('#trimRangeList .trim-range').forEach(range => {
		const start = range.querySelector('.startTime')?.value.trim();
		const end = range.querySelector('.endTime')?.value.trim();

		// Validate format
		if (!timeRegex.test(start) || !timeRegex.test(end)) return;

		// Convert to minutes
		const [sh, sm] = start.split(':').map(Number);
		const [eh, em] = end.split(':').map(Number);
		const startMins = sh * 60 + sm;
		const endMins = eh * 60 + em;

		// Skip invalid order
		if (endMins <= startMins) return;

		ranges.push({ startMins, endMins });
	});

	if (!ranges.length) return [];

	// Sort by start time
	ranges.sort((a, b) => a.startMins - b.startMins);

	// Merge overlapping intervals
	const merged = [ranges[0]];
	for (let i = 1; i < ranges.length; i++) {
		const prev = merged[merged.length - 1];
		const curr = ranges[i];

		if (curr.startMins <= prev.endMins) {
			// Overlapping → merge
			prev.endMins = Math.max(prev.endMins, curr.endMins);
		} else {
			merged.push(curr);
		}
	}

	// Convert back to HH:MM format
	const normalize = mins => {
		const h = String(Math.floor(mins / 60)).padStart(2, '0');
		const m = String(mins % 60).padStart(2, '0');
		return `${h}:${m}`;
	};

	return merged.map(({ startMins, endMins }) => ({
		start: normalize(startMins),
		end: normalize(endMins)
	}));
};
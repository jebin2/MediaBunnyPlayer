import { settingsMenu, settingsCtrlBtn, playerArea, sidebar, loopBtn, startTimeInput, endTimeInput, scaleOptionContainer, scaleWithRatioToggle, blurOptionContainer, smoothOptionContainer, smoothPathToggle, cropModeNoneRadio, blurBackgroundToggle, blurAmountInput, captionMenu } from './constants.js';
import { state } from './state.js';
import { formatTime, guidedPanleInfo, } from './utility.js'
import { positionCropCanvas, togglePanning, toggleStaticCrop } from './crop.js'
import { pause } from './player.js'
import { showInfo } from './ui.js'



export const setupSettingsListeners = () => {
    settingsCtrlBtn.onclick = (e) => {
        e.stopPropagation();

        // If playlist is open, close it first
        if (playerArea.classList.contains('playlist-visible')) {
            playerArea.classList.remove('playlist-visible');
        }
        playerArea.classList.toggle('playlist-visible');
        // Toggle the settings sidebar
        sidebar.classList.add('hidden');
		captionMenu.classList.add('hidden');
        settingsMenu.classList.toggle('hidden');

        // After the transition, reposition the crop canvas if it's active
		setTimeout(() => {
			state.cropCanvasDimensions = positionCropCanvas();
		}, 200);
    };
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
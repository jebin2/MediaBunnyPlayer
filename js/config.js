// ============================================================================
// CONFIGURATION & SETTINGS
// ============================================================================

import {
	Input,
	ALL_FORMATS,
	BlobSource,
	UrlSource,
	AudioBufferSink,
	CanvasSink,
	Conversion,
	Output,
	Mp4OutputFormat,
	BufferTarget,
	QUALITY_HIGH
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';

import { $, MEDIABUNNY_URL, playerArea, videoContainer, canvas, dropZone, loading, playBtn, timeDisplay, progressContainer, progressBar, volumeSlider, muteBtn, fullscreenBtn, sidebar, playlistContent, videoControls, progressHandle, startTimeInput, endTimeInput, settingsCtrlBtn, settingsMenu, loopBtn, cutBtn, screenshotBtn, screenshotOverlay, screenshotPreviewImg, closeScreenshotBtn, copyScreenshotBtn, downloadScreenshotBtn, playbackSpeedInput, autoplayToggle, urlModal, urlInput, loadUrlBtn, cancelUrlBtn, showMessage, cropModeRadios, scaleOptionContainer, scaleWithRatioToggle, blurOptionContainer, smoothOptionContainer, smoothPathToggle, blurBackgroundToggle, blurAmountInput, HANDLE_SIZE, HANDLE_HALF, fixSizeBtn, prevBtn, nextBtn, cropBtn, cropCanvas, cropCtx, queuedAudioNodes, panScanBtn, ctx } from './constants.js';
import { state } from './state.js';
import { dynamicVideoUrl, escapeHTML, formatTime, guidedPanleInfo, parseTime, registerServiceWorker, updateShortcutKeysVisibility, } from './utility.js'
import { applyResize, clampRectToVideoBounds, drawCropOverlay,drawCropWithHandles, getCursorForHandle, getInterpolatedCropRect, getResizeHandle, getScaledCoordinates, isInsideCropRect, positionCropCanvas, smoothPathWithMovingAverage, toggleCropFixed, togglePanning, toggleStaticCrop, updateFixSizeButton } from './crop.js'
import { handleCutAction } from './editing.js'
import { setupEventListeners } from './eventListeners.js'
import { checkPlaybackState, ensureSubtitleRenderer, getPlaybackTime, handleConversion, hideTrackMenus, loadMedia, pause, play, playNext, playPrevious, removeSubtitleOverlay, renderLoop, runAudioIterator, scheduleProgressUpdate, seekToTime, setPlaybackSpeed, setVolume, startVideoIterator, stopAndClear, switchAudioTrack, switchSubtitleTrack, toggleLoop, togglePlay, updateNextFrame, updateSubtitlesOptimized, updateTrackMenus } from './player.js'
import { clearPlaylist, findFileByPath, handleFiles, handleFolderSelection, removeItemFromPath, updatePlaylistUIOptimized } from './playlist.js'
import { takeScreenshot } from './screenshot.js'
import { hideStatusMessage, showControlsTemporarily, showDropZoneUI, showError, showInfo, showLoading, showPlayerUI, showStatusMessage, updateProgressBarUI, updateTimeInputs } from './ui.js'

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
	state.smoothPath = false;
	state.blurAmount = 15;
	updateDynamicCropOptionsUI();

	// 4. Reset the UI for dynamic crop options
	const cropModeNoneRadio = $('cropModeNone');
	if (cropModeNoneRadio) cropModeNoneRadio.checked = true;

	const scaleWithRatioToggle = $('scaleWithRatioToggle');
	if (scaleWithRatioToggle) scaleWithRatioToggle.checked = false;

	const smoothPathToggle = $('smoothPathToggle');
	if (smoothPathToggle) smoothPathToggle.checked = false;

	const blurBackgroundToggle = $('blurBackgroundToggle');
	const blurAmountInput = $('blurAmountInput');
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
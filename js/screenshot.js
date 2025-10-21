// ============================================================================
// SCREENSHOT FUNCTIONALITY
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
import { resetAllConfigs, updateDynamicCropOptionsUI } from './config.js'
import { applyResize, clampRectToVideoBounds, drawCropOverlay,drawCropWithHandles, getCursorForHandle, getInterpolatedCropRect, getResizeHandle, getScaledCoordinates, isInsideCropRect, positionCropCanvas, smoothPathWithMovingAverage, toggleCropFixed, togglePanning, toggleStaticCrop, updateFixSizeButton } from './crop.js'
import { handleCutAction } from './editing.js'
import { setupEventListeners } from './eventListeners.js'
import { checkPlaybackState, ensureSubtitleRenderer, getPlaybackTime, handleConversion, hideTrackMenus, loadMedia, pause, play, playNext, playPrevious, removeSubtitleOverlay, renderLoop, runAudioIterator, scheduleProgressUpdate, seekToTime, setPlaybackSpeed, setVolume, startVideoIterator, stopAndClear, switchAudioTrack, switchSubtitleTrack, toggleLoop, togglePlay, updateNextFrame, updateSubtitlesOptimized, updateTrackMenus } from './player.js'
import { clearPlaylist, findFileByPath, handleFiles, handleFolderSelection, removeItemFromPath, updatePlaylistUIOptimized } from './playlist.js'
import { dynamicVideoUrl, escapeHTML, formatTime, guidedPanleInfo, parseTime, registerServiceWorker, updateShortcutKeysVisibility, } from './utility.js'
import { hideStatusMessage, showControlsTemporarily, showDropZoneUI, showError, showInfo, showLoading, showPlayerUI, showStatusMessage, updateProgressBarUI, updateTimeInputs } from './ui.js'

export const takeScreenshot = () => {
	if (!state.fileLoaded || !canvas) {
		showError("Cannot take screenshot: No video loaded.");
		return;
	}

	canvas.toBlob((blob) => {
		if (!blob) {
			showError("Failed to create screenshot.");
			return;
		}

		state.currentScreenshotBlob = blob;

		if (screenshotPreviewImg.src && screenshotPreviewImg.src.startsWith('blob:')) {
			URL.revokeObjectURL(screenshotPreviewImg.src);
		}

		const imageUrl = URL.createObjectURL(blob);
		screenshotPreviewImg.src = imageUrl;
		screenshotOverlay.classList.remove('hidden');
		hideTrackMenus();

	}, 'image/png');
};
// ============================================================================
// VIDEO PROCESSING & CUTTING
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
import { dynamicVideoUrl, escapeHTML, formatTime, guidedPanleInfo, parseTime, registerServiceWorker, updateShortcutKeysVisibility, } from './utility.js'
import { setupEventListeners } from './eventListeners.js'
import { checkPlaybackState, ensureSubtitleRenderer, getPlaybackTime, handleConversion, hideTrackMenus, loadMedia, pause, play, playNext, playPrevious, removeSubtitleOverlay, renderLoop, runAudioIterator, scheduleProgressUpdate, seekToTime, setPlaybackSpeed, setVolume, startVideoIterator, stopAndClear, switchAudioTrack, switchSubtitleTrack, toggleLoop, togglePlay, updateNextFrame, updateSubtitlesOptimized, updateTrackMenus } from './player.js'
import { clearPlaylist, findFileByPath, handleFiles, handleFolderSelection, removeItemFromPath, updatePlaylistUIOptimized } from './playlist.js'
import { takeScreenshot } from './screenshot.js'
import { hideStatusMessage, showControlsTemporarily, showDropZoneUI, showError, showInfo, showLoading, showPlayerUI, showStatusMessage, updateProgressBarUI, updateTimeInputs } from './ui.js'

export const handleCutAction = async () => {
	if (!state.fileLoaded) return;
	if (state.playing) pause();

	const start = parseTime(startTimeInput.value);
	const end = parseTime(endTimeInput.value);

	if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end > state.totalDuration) {
		showError("Invalid start or end time for cutting.");
		return;
	}
	hideTrackMenus();
	guidedPanleInfo('Creating clip...');
	let input;
	let processCanvas = null;
	let processCtx = null;

	try {
		const source = (state.currentPlayingFile instanceof File) ? new BlobSource(state.currentPlayingFile) : new UrlSource(state.currentPlayingFile);
		input = new Input({ source, formats: ALL_FORMATS });
		const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
		const conversionOptions = { input, output, trim: { start, end } };
		let cropFuncToReset = null;

		if (state.panKeyframes.length > 1 && state.panRectSize) {
			cropFuncToReset = togglePanning;

			// =================== START OF NEW SMOOTHING LOGIC ===================
			// If the smooth path option is checked, preprocess the keyframes.
			if (state.smoothPath || state.dynamicCropMode == 'none') {
				guidedPanleInfo('Smoothing path...');
				// Replace the jerky keyframes with the new, smoothed version.
				state.panKeyframes = smoothPathWithMovingAverage(state.panKeyframes, 15);
			}
			guidedPanleInfo('Processing... and will be added to playlist');
			// =================== END OF NEW SMOOTHING LOGIC =====================
			const videoTrack = await input.getPrimaryVideoTrack();
			if (!videoTrack) throw new Error("No video track found for dynamic cropping.");

			// --- THE LOGIC IS NOW DRIVEN BY THE DYNAMIC CROP MODE ---

			if (state.dynamicCropMode === 'spotlight') {
				const outputWidth = videoTrack.codedWidth;
				const outputHeight = videoTrack.codedHeight;
				conversionOptions.video = {
					track: videoTrack, codec: 'avc', bitrate: QUALITY_HIGH, processedWidth: outputWidth, processedHeight: outputHeight, forceTranscode: true,
					process: (sample) => {
						const cropRect = getInterpolatedCropRect(sample.timestamp); if (!cropRect) return sample;
						const safeCropRect = clampRectToVideoBounds(cropRect); if (safeCropRect.width <= 0 || safeCropRect.height <= 0) return sample;
						if (!processCanvas) { processCanvas = new OffscreenCanvas(outputWidth, outputHeight); processCtx = processCanvas.getContext('2d', { alpha: false }); }
						const videoFrame = sample._data || sample;

						if (state.useBlurBackground) {
							processCtx.drawImage(videoFrame, 0, 0, outputWidth, outputHeight);
							processCtx.filter = `blur(${state.blurAmount}px)`; processCtx.drawImage(processCanvas, 0, 0); processCtx.filter = 'none';
						} else {
							processCtx.fillStyle = 'black'; processCtx.fillRect(0, 0, outputWidth, outputHeight);
						}
						processCtx.drawImage(videoFrame, Math.round(safeCropRect.x), Math.round(safeCropRect.y), Math.round(safeCropRect.width), Math.round(safeCropRect.height), Math.round(safeCropRect.x), Math.round(safeCropRect.y), Math.round(safeCropRect.width), Math.round(safeCropRect.height));
						return processCanvas;
					}
				};

			} else { // This block handles both 'max-size' and 'none' (Default)
				let outputWidth, outputHeight;

				if (state.dynamicCropMode === 'max-size') {
					const maxWidth = Math.max(...state.panKeyframes.map(kf => kf.rect.width)); const maxHeight = Math.max(...state.panKeyframes.map(kf => kf.rect.height));
					outputWidth = Math.round(maxWidth / 2) * 2; outputHeight = Math.round(maxHeight / 2) * 2;
				} else { // This is the 'none' or Default case
					outputWidth = Math.round(state.panRectSize.width / 2) * 2; outputHeight = Math.round(state.panRectSize.height / 2) * 2;
				}

				conversionOptions.video = {
					track: videoTrack, codec: 'avc', bitrate: QUALITY_HIGH, processedWidth: outputWidth, processedHeight: outputHeight, forceTranscode: true,
					process: (sample) => {
						const cropRect = getInterpolatedCropRect(sample.timestamp); if (!cropRect) return sample;
						const safeCropRect = clampRectToVideoBounds(cropRect); if (safeCropRect.width <= 0 || safeCropRect.height <= 0) return sample;
						if (!processCanvas) { processCanvas = new OffscreenCanvas(outputWidth, outputHeight); processCtx = processCanvas.getContext('2d', { alpha: false }); }
						const videoFrame = sample._data || sample;

						if (state.dynamicCropMode === 'max-size' && state.useBlurBackground) {
							processCtx.drawImage(videoFrame, 0, 0, outputWidth, outputHeight);
							processCtx.filter = 'blur(15px)'; processCtx.drawImage(processCanvas, 0, 0); processCtx.filter = 'none';
						} else {
							processCtx.fillStyle = 'black'; processCtx.fillRect(0, 0, outputWidth, outputHeight);
						}

						let destX, destY, destWidth, destHeight;
						if (state.dynamicCropMode == 'none' || (state.dynamicCropMode === 'max-size' && state.scaleWithRatio)) {
							const sourceAspectRatio = safeCropRect.width / safeCropRect.height; const outputAspectRatio = outputWidth / outputHeight;
							if (sourceAspectRatio > outputAspectRatio) { destWidth = outputWidth; destHeight = destWidth / sourceAspectRatio; } else { destHeight = outputHeight; destWidth = destHeight * sourceAspectRatio; }
							destX = (outputWidth - destWidth) / 2; destY = (outputHeight - destHeight) / 2;
						} else {
							destWidth = safeCropRect.width; destHeight = safeCropRect.height;
							destX = (outputWidth - destWidth) / 2; destY = (outputHeight - destHeight) / 2;
						}
						processCtx.drawImage(videoFrame, Math.round(safeCropRect.x), Math.round(safeCropRect.y), Math.round(safeCropRect.width), Math.round(safeCropRect.height), destX, destY, destWidth, destHeight);
						return processCanvas;
					}
				};
			}
		} else if (state.cropRect && state.cropRect.width > 0) { // Static crop remains unchanged
			cropFuncToReset = toggleStaticCrop;
			const evenWidth = Math.round(state.cropRect.width / 2) * 2; const evenHeight = Math.round(state.cropRect.height / 2) * 2;
			conversionOptions.video = { crop: { left: Math.round(state.cropRect.x), top: Math.round(state.cropRect.y), width: evenWidth, height: evenHeight } };
		}

		const conversion = await Conversion.init(conversionOptions);
		if (!conversion.isValid) throw new Error('Could not create a valid conversion for cutting.');
		conversion.onProgress = (progress) => showStatusMessage(`Creating clip... (${Math.round(progress * 100)}%)`);
		await conversion.execute();
		const originalName = (state.currentPlayingFile.name || 'video').split('.').slice(0, -1).join('.');
		const clipName = `${originalName}_${new Date().getTime()}_${formatTime(start)}-${formatTime(end)}_edited.mp4`.replace(/:/g, '_');
		const cutClipFile = new File([output.target.buffer], clipName, { type: 'video/mp4' });
		state.playlist.push({ type: 'file', name: clipName, file: cutClipFile, isCutClip: true });
		updatePlaylistUIOptimized();
		// if (cropFuncToReset) cropFuncToReset(null, true);
		showStatusMessage('Clip adding to playlist!');
		guidedPanleInfo('Clip adding to playlist!');
		setTimeout(hideStatusMessage, 2000);
	} catch (error) {
		console.error("Error during cutting:", error);
		showError(`Failed to cut the clip: ${error.message}`);
		hideStatusMessage();
	} finally {
		if (input) input.dispose();
		guidedPanleInfo("");
		resetAllConfigs();
	}
};
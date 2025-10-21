// ============================================================================
// STATIC CROP FUNCTIONALITY
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
import { dynamicVideoUrl, escapeHTML, formatTime, guidedPanleInfo, parseTime, registerServiceWorker, updateShortcutKeysVisibility, } from './utility.js'
import { handleCutAction } from './editing.js'
import { setupEventListeners } from './eventListeners.js'
import { checkPlaybackState, ensureSubtitleRenderer, getPlaybackTime, handleConversion, hideTrackMenus, loadMedia, pause, play, playNext, playPrevious, removeSubtitleOverlay, renderLoop, runAudioIterator, scheduleProgressUpdate, seekToTime, setPlaybackSpeed, setVolume, startVideoIterator, stopAndClear, switchAudioTrack, switchSubtitleTrack, toggleLoop, togglePlay, updateNextFrame, updateSubtitlesOptimized, updateTrackMenus } from './player.js'
import { clearPlaylist, findFileByPath, handleFiles, handleFolderSelection, removeItemFromPath, updatePlaylistUIOptimized } from './playlist.js'
import { takeScreenshot } from './screenshot.js'
import { hideStatusMessage, showControlsTemporarily, showDropZoneUI, showError, showInfo, showLoading, showPlayerUI, showStatusMessage, updateProgressBarUI, updateTimeInputs } from './ui.js'

export const toggleStaticCrop = (e, reset = false) => {
	state.isCropping = !reset && !state.isCropping;
	state.isPanning = false; // Ensure panning is off

	panScanBtn.textContent = 'Dynamic ✂️';
	cropBtn.textContent = state.isCropping ? 'Cropping...' : '✂️';

	cropCanvas.classList.toggle('hidden', !state.isCropping);
	panScanBtn.classList.toggle('hover_highlight', state.isPanning);
	cropBtn.classList.toggle('hover_highlight');
	if (reset) cropBtn.classList.remove('hover_highlight');

	if (state.isCropping) {
		// Position the crop canvas when entering crop mode
		state.cropCanvasDimensions = positionCropCanvas();
		state.isCropFixed = false; // Reset fixed state
		updateFixSizeButton();
	} else {
		cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
		state.cropRect = null;
		state.cropCanvasDimensions = null;
		state.isCropFixed = false;
		updateFixSizeButton();
	}
};

export const positionCropCanvas = () => {
	if (!canvas.width || !canvas.height) {
		console.warn('Video dimensions not available yet');
		return null;
	}

	const container = videoContainer;
	const containerRect = container.getBoundingClientRect();

	// Get video dimensions
	const videoWidth = canvas.width;
	const videoHeight = canvas.height;

	// Calculate aspect ratios
	const videoAspect = videoWidth / videoHeight;
	const containerAspect = containerRect.width / containerRect.height;

	let renderWidth, renderHeight, offsetX, offsetY;

	// Calculate actual rendered video dimensions (object-fit: contain behavior)
	if (containerAspect > videoAspect) {
		// Container is wider - video is constrained by height
		renderHeight = containerRect.height;
		renderWidth = renderHeight * videoAspect;
		offsetX = (containerRect.width - renderWidth) / 2;
		offsetY = 0;
	} else {
		// Container is taller - video is constrained by width
		renderWidth = containerRect.width;
		renderHeight = renderWidth / videoAspect;
		offsetX = 0;
		offsetY = (containerRect.height - renderHeight) / 2;
	}

	// Position and size the crop canvas to match the video
	cropCanvas.style.left = `${offsetX}px`;
	cropCanvas.style.top = `${offsetY}px`;
	cropCanvas.style.width = `${renderWidth}px`;
	cropCanvas.style.height = `${renderHeight}px`;

	// Keep the canvas internal resolution at video resolution for accuracy
	// (We already set cropCanvas.width/height to match canvas.width/height elsewhere)

	return {
		renderWidth,
		renderHeight,
		offsetX,
		offsetY,
		videoWidth,
		videoHeight,
		scaleX: videoWidth / renderWidth,
		scaleY: videoHeight / renderHeight
	};
};

export const getScaledCoordinates = (e) => {
	const rect = cropCanvas.getBoundingClientRect();

	// Get canvas internal resolution
	const canvasWidth = cropCanvas.width;
	const canvasHeight = cropCanvas.height;

	// Get displayed size
	const displayWidth = rect.width;
	const displayHeight = rect.height;

	// Calculate scale factors
	const scaleX = canvasWidth / displayWidth;
	const scaleY = canvasHeight / displayHeight;

	// Calculate mouse position relative to canvas
	const x = (e.clientX - rect.left) * scaleX;
	const y = (e.clientY - rect.top) * scaleY;

	return { x, y };
};

export const drawCropOverlay = () => {
	// Clear the previous frame
	cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);

	// Calculate dimensions, ensuring width and height are not negative
	const x = Math.min(state.cropStart.x, state.cropEnd.x);
	const y = Math.min(state.cropStart.y, state.cropEnd.y);
	const width = Math.abs(state.cropStart.x - state.cropEnd.x);
	const height = Math.abs(state.cropStart.y - state.cropEnd.y);

	if (width > 0 || height > 0) {
		// Draw the semi-transparent shade over the entire canvas
		cropCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
		cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

		// "Punch a hole" in the shade where the crop area is
		cropCtx.clearRect(x, y, width, height);

		// Add a light border around the clear area for better visibility
		cropCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
		cropCtx.lineWidth = 1;
		cropCtx.strokeRect(x, y, width, height);
	}
};

// ============================================================================
// DYNAMIC CROP (Pan/Scan) FUNCTIONALITY
// ============================================================================

export const togglePanning = (e, reset = false) => {
	state.isPanning = !reset && !state.isPanning;
	state.isCropping = false; // Ensure static cropping is off

	cropBtn.textContent = '✂️';
	panScanBtn.textContent = state.isPanning ? 'Cropping...' : 'Dynamic ✂️';

	cropCanvas.classList.toggle('hidden', !state.isPanning);
	cropBtn.classList.toggle('hover_highlight', state.isCropping);
	panScanBtn.classList.toggle('hover_highlight');
	if (reset) panScanBtn.classList.remove('hover_highlight');

	state.panKeyframes = [];
	state.panRectSize = null;

	if (state.isPanning) {
		// Position the crop canvas when entering panning mode
		state.cropCanvasDimensions = positionCropCanvas();
		state.isCropFixed = false; // Reset fixed state
		updateFixSizeButton();
		guidedPanleInfo("Click and drag on the video to draw your crop area.");
	} else {
		cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
		state.cropCanvasDimensions = null;
		state.isCropFixed = false;
		updateFixSizeButton();
	}
};

export const getInterpolatedCropRect = (timestamp) => {
	if (!state.panKeyframes || state.panKeyframes.length === 0) return null;

	// Find the two keyframes that surround the current timestamp
	let prevKey = state.panKeyframes[0];
	let nextKey = null;

	for (let i = 1; i < state.panKeyframes.length; i++) {
		if (state.panKeyframes[i].timestamp > timestamp) {
			nextKey = state.panKeyframes[i];
			break;
		}
		prevKey = state.panKeyframes[i];
	}

	if (!nextKey) {
		return prevKey.rect;
	}

	// Linear Interpolation
	const timeDiff = nextKey.timestamp - prevKey.timestamp;
	if (timeDiff <= 0) return prevKey.rect;

	const t = (timestamp - prevKey.timestamp) / timeDiff;

	const interpolatedX = prevKey.rect.x + (nextKey.rect.x - prevKey.rect.x) * t;
	const interpolatedY = prevKey.rect.y + (nextKey.rect.y - prevKey.rect.y) * t;

	// CLAMP the rectangle to video bounds
	const clampedRect = clampRectToVideoBounds({
		x: interpolatedX,
		y: interpolatedY,
		width: prevKey.rect.width,
		height: prevKey.rect.height,
	});

	return clampedRect;
};

export const clampRectToVideoBounds = (rect) => {
	if (!canvas.width || !canvas.height) return rect;

	const videoWidth = canvas.width;
	const videoHeight = canvas.height;

	let { x, y, width, height } = rect;

	// Clamp x to be within [0, videoWidth - width]
	x = Math.max(0, Math.min(x, videoWidth - width));

	// Clamp y to be within [0, videoHeight - height]
	y = Math.max(0, Math.min(y, videoHeight - height));

	// Ensure width and height don't exceed video bounds
	width = Math.min(width, videoWidth - x);
	height = Math.min(height, videoHeight - y);

	return { x, y, width, height };
};

export const smoothPathWithMovingAverage = (keyframes, windowSize = 15) => {
	if (keyframes.length < windowSize) {
		return keyframes; // Not enough data to smooth
	}

	const smoothedKeyframes = [];
	const halfWindow = Math.floor(windowSize / 2);

	for (let i = 0; i < keyframes.length; i++) {
		// Define the bounds for the moving window, clamping at the edges
		const start = Math.max(0, i - halfWindow);
		const end = Math.min(keyframes.length - 1, i + halfWindow);

		let sumX = 0, sumY = 0, sumWidth = 0, sumHeight = 0;

		// Sum the properties of the keyframes within the window
		for (let j = start; j <= end; j++) {
			sumX += keyframes[j].rect.x;
			sumY += keyframes[j].rect.y;
			sumWidth += keyframes[j].rect.width;
			sumHeight += keyframes[j].rect.height;
		}

		const count = (end - start) + 1;

		// Create the new smoothed keyframe
		const newKeyframe = {
			timestamp: keyframes[i].timestamp, // Keep original timestamp
			rect: {
				x: sumX / count,
				y: sumY / count,
				width: sumWidth / count,
				height: sumHeight / count,
			}
		};

		smoothedKeyframes.push(newKeyframe);
	}

	return smoothedKeyframes;
};

// ============================================================================
// CROP MANIPULATION (Resize/Move/Draw)
// ============================================================================

export const drawCropWithHandles = (rect) => {
	if (!rect || rect.width <= 0 || rect.height <= 0) return;

	cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);

	// Draw semi-transparent overlay
	const overlayColor = state.isPanning ? 'rgba(0, 50, 100, 0.6)' : 'rgba(0, 0, 0, 0.6)';
	cropCtx.fillStyle = overlayColor;
	cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

	// Clear the crop area
	cropCtx.clearRect(rect.x, rect.y, rect.width, rect.height);

	// Draw border
	const borderColor = state.isPanning ? 'rgba(50, 150, 255, 0.9)' : 'rgba(255, 255, 255, 0.8)';
	cropCtx.strokeStyle = borderColor;
	cropCtx.lineWidth = 2;
	cropCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);

	// Draw resize handles if crop is not fixed
	if (!state.isCropFixed) {
		guidedPanleInfo("Adjust the rectangle to your desired size. When ready, press 'L' to lock the size and begin recording.")
		cropCtx.fillStyle = '#00ffff';
		cropCtx.strokeStyle = '#ffffff';
		cropCtx.lineWidth = 1;

		// Corner handles
		const corners = [
			{ x: rect.x, y: rect.y, cursor: 'nw' },
			{ x: rect.x + rect.width, y: rect.y, cursor: 'ne' },
			{ x: rect.x, y: rect.y + rect.height, cursor: 'sw' },
			{ x: rect.x + rect.width, y: rect.y + rect.height, cursor: 'se' }
		];

		corners.forEach(corner => {
			cropCtx.fillRect(
				corner.x - HANDLE_HALF,
				corner.y - HANDLE_HALF,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
			cropCtx.strokeRect(
				corner.x - HANDLE_HALF,
				corner.y - HANDLE_HALF,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
		});

		// Edge handles
		const edges = [
			{ x: rect.x + rect.width / 2, y: rect.y, cursor: 'n' }, // top
			{ x: rect.x + rect.width / 2, y: rect.y + rect.height, cursor: 's' }, // bottom
			{ x: rect.x, y: rect.y + rect.height / 2, cursor: 'w' }, // left
			{ x: rect.x + rect.width, y: rect.y + rect.height / 2, cursor: 'e' } // right
		];

		edges.forEach(edge => {
			cropCtx.fillRect(
				edge.x - HANDLE_HALF,
				edge.y - HANDLE_HALF,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
			cropCtx.strokeRect(
				edge.x - HANDLE_HALF,
				edge.y - HANDLE_HALF,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
		});
	}
};

export const getResizeHandle = (x, y, rect) => {
	if (!rect || state.isCropFixed) return null;

	const handles = [
		{ name: 'nw', x: rect.x, y: rect.y },
		{ name: 'ne', x: rect.x + rect.width, y: rect.y },
		{ name: 'sw', x: rect.x, y: rect.y + rect.height },
		{ name: 'se', x: rect.x + rect.width, y: rect.y + rect.height },
		{ name: 'n', x: rect.x + rect.width / 2, y: rect.y },
		{ name: 's', x: rect.x + rect.width / 2, y: rect.y + rect.height },
		{ name: 'w', x: rect.x, y: rect.y + rect.height / 2 },
		{ name: 'e', x: rect.x + rect.width, y: rect.y + rect.height / 2 }
	];

	for (const handle of handles) {
		const dist = Math.sqrt(
			Math.pow(x - handle.x, 2) + Math.pow(y - handle.y, 2)
		);
		if (dist <= HANDLE_SIZE) {
			return handle.name;
		}
	}

	return null;
};

export const isInsideCropRect = (x, y, rect) => {
	if (!rect) return false;
	return x >= rect.x && x <= rect.x + rect.width &&
		y >= rect.y && y <= rect.y + rect.height;
};

export const getCursorForHandle = (handle) => {
	const cursors = {
		'nw': 'nw-resize',
		'ne': 'ne-resize',
		'sw': 'sw-resize',
		'se': 'se-resize',
		'n': 'n-resize',
		's': 's-resize',
		'w': 'w-resize',
		'e': 'e-resize',
		'move': 'move'
	};
	return cursors[handle] || 'crosshair';
};

export const applyResize = (handle, deltaX, deltaY, originalRect) => {
	let newRect = { ...originalRect };

	switch (handle) {
		case 'nw':
			newRect.x = originalRect.x + deltaX;
			newRect.y = originalRect.y + deltaY;
			newRect.width = originalRect.width - deltaX;
			newRect.height = originalRect.height - deltaY;
			break;
		case 'ne':
			newRect.y = originalRect.y + deltaY;
			newRect.width = originalRect.width + deltaX;
			newRect.height = originalRect.height - deltaY;
			break;
		case 'sw':
			newRect.x = originalRect.x + deltaX;
			newRect.width = originalRect.width - deltaX;
			newRect.height = originalRect.height + deltaY;
			break;
		case 'se':
			newRect.width = originalRect.width + deltaX;
			newRect.height = originalRect.height + deltaY;
			break;
		case 'n':
			newRect.y = originalRect.y + deltaY;
			newRect.height = originalRect.height - deltaY;
			break;
		case 's':
			newRect.height = originalRect.height + deltaY;
			break;
		case 'w':
			newRect.x = originalRect.x + deltaX;
			newRect.width = originalRect.width - deltaX;
			break;
		case 'e':
			newRect.width = originalRect.width + deltaX;
			break;
	}

	// Ensure minimum size
	if (newRect.width < 20) {
		newRect.width = 20;
		if (handle.includes('w')) newRect.x = originalRect.x + originalRect.width - 20;
	}
	if (newRect.height < 20) {
		newRect.height = 20;
		if (handle.includes('n')) newRect.y = originalRect.y + originalRect.height - 20;
	}

	// Clamp to canvas bounds
	return clampRectToVideoBounds(newRect);
};

export const toggleCropFixed = () => {
	state.isCropFixed = !state.isCropFixed;
	updateFixSizeButton();

	if (state.isCropFixed) {
		// When fixing, ensure even dimensions for video processing
		if (state.isCropping && state.cropRect) {
			state.cropRect.width = Math.round(state.cropRect.width / 2) * 2;
			state.cropRect.height = Math.round(state.cropRect.height / 2) * 2;
			state.cropRect = clampRectToVideoBounds(state.cropRect);
			drawCropWithHandles(state.cropRect);
		} else if (state.isPanning && state.panRectSize) {
			state.panRectSize.width = Math.round(state.panRectSize.width / 2) * 2;
			state.panRectSize.height = Math.round(state.panRectSize.height / 2) * 2;
			// Update the last keyframe with even dimensions
			if (state.panKeyframes.length > 0) {
				const lastFrame = state.panKeyframes[state.panKeyframes.length - 1];
				lastFrame.rect.width = state.panRectSize.width;
				lastFrame.rect.height = state.panRectSize.height;
				lastFrame.rect = clampRectToVideoBounds(lastFrame.rect);
			}
		}
		guidedPanleInfo("Size Locked! Now, play the video and move the box to record the camera path. Use SHIFT + scroll up/down to perform zooming effect. Press 'R' when you're done.");
	} else {
		// Redraw with handles
		if (state.isCropping && state.cropRect) {
			drawCropWithHandles(state.cropRect);
		} else if (state.isPanning && state.panKeyframes.length > 0) {
			const lastFrame = state.panKeyframes[state.panKeyframes.length - 1];
			if (lastFrame) {
				drawCropWithHandles(lastFrame.rect);
			}
		}
	}
};

export const updateFixSizeButton = () => {
	const fixSizeBtn = document.getElementById('fixSizeBtn');
	if (!fixSizeBtn) return;

	const shouldShow = (state.isCropping || state.isPanning) &&
		(state.cropRect || state.panRectSize);

	if (shouldShow) {
		fixSizeBtn.style.display = 'inline-block';
		fixSizeBtn.textContent = state.isCropFixed ? 'Resize' : 'Fix Size';
		if (state.isCropFixed) {
			fixSizeBtn.classList.add('hover_highlight');
		} else {
			fixSizeBtn.classList.remove('hover_highlight');
		}
	} else {
		fixSizeBtn.style.display = 'none';
	}
};

fixSizeBtn.onclick = (e) => {
	e.stopPropagation();
	toggleCropFixed();
};

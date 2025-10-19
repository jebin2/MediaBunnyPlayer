import * as constant from './js/constants.js';
import {state, updateState} from './js/state.js';
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

const MEDIABUNNY_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.23.0/+esm';

const $ = document.getElementById.bind(document);
const playerArea = $('playerArea'),
	videoContainer = $('videoContainer'),
	canvas = $('videoCanvas'),
	dropZone = $('dropZone'),
	loading = $('loading');
const playBtn = $('playBtn'),
	timeDisplay = $('timeDisplay'),
	progressContainer = $('progressContainer');
const progressBar = $('progressBar'),
	volumeSlider = $('volumeSlider'),
	muteBtn = $('muteBtn'),
	fullscreenBtn = $('fullscreenBtn');
const sidebar = $('sidebar'),
	playlistContent = $('playlistContent'),
	videoControls = $('videoControls');
const progressHandle = $('progressHandle');
const startTimeInput = $('startTime');
const endTimeInput = $('endTime');
const settingsCtrlBtn = $('settingsCtrlBtn');
const settingsMenu = $('settingsMenu');
const loopBtn = $('loopBtn');
const cutBtn = $('cutBtn');
const screenshotBtn = $('screenshotBtn');
const screenshotOverlay = $('screenshotOverlay');
const screenshotPreviewImg = $('screenshotPreviewImg');
const closeScreenshotBtn = $('closeScreenshotBtn');
const copyScreenshotBtn = $('copyScreenshotBtn');
const downloadScreenshotBtn = $('downloadScreenshotBtn');
let currentScreenshotBlob = null;
const playbackSpeedInput = $('playbackSpeedInput');
let currentPlaybackRate = 1.0;
const autoplayToggle = $('autoplayToggle');
let isAutoplayEnabled = true;
const urlModal = $('urlModal');
const urlInput = $('urlInput');
const loadUrlBtn = $('loadUrlBtn');
const cancelUrlBtn = $('cancelUrlBtn');
const showMessage = document.querySelector('.showMessage');
const ctx = constant.canvas.getContext('2d', {
	alpha: false,
	desynchronized: true
});

let playlist = [],
	currentPlayingFile = null,
	fileLoaded = false;
let audioContext, gainNode, videoSink, audioSink;
let totalDuration = 0,
	playing = false,
	isSeeking = false;
let audioContextStartTime = 0,
	playbackTimeAtStart = 0;
let videoFrameIterator, audioBufferIterator, nextFrame = null;
const queuedAudioNodes = new Set();
let asyncId = 0;
let hideControlsTimeout;
let availableAudioTracks = [];
let availableSubtitleTracks = [];
let currentAudioTrack = null;
let currentSubtitleTrack = null;
let subtitleRenderer = null;
let isLooping = false;
let loopStartTime = 0;
let loopEndTime = 0;
let playbackLogicInterval = null;
const prevBtn = $('prevBtn');
const nextBtn = $('nextBtn');

const cropBtn = $('cropBtn');
const cropCanvas = $('cropCanvas');
const cropCtx = constant.cropCanvas.getContext('2d');

let isCropping = false;
let isDrawingCrop = false;
let cropStart = { x: 0, y: 0 };
let cropEnd = { x: 0, y: 0 };
let cropRect = null; // Will store the final crop dimensions

// ... after your other element selectors
const panScanBtn = $('panScanBtn');

// ... after your other state variables
let isPanning = false; // Are we in "Dynamic Crop" recording mode?
let panKeyframes = []; // Stores the recorded path: [{ timestamp, rect }, ...]
let panRectSize = null; // Stores the locked size of the panning rectangle
// let useMaxSize = false;
let scaleWithRatio = false;
// let useSpotlightEffect = false;
let useBlurBackground = false;
let smoothPath = false;
let currentOpenFileAction = 'open-file';
let blurAmount = 15;
let dynamicCropMode = 'none'; // Can be 'none', 'spotlight', or 'max-size'
let isShiftPressed = false;

// === PERFORMANCE OPTIMIZATION: Cache DOM elements for playlist ===
let playlistElementCache = new Map(); // Maps path -> DOM element
let lastRenderedPlaylist = null; // For deep equality check

// === PERFORMANCE OPTIMIZATION: Subtitle overlay caching ===
let subtitleOverlayElement = null;
let lastSubtitleText = null;

// === PERFORMANCE OPTIMIZATION: Debounced progress update ===
let progressUpdateScheduled = false;

let SubtitleRendererConstructor = null;
const ensureSubtitleRenderer = async () => {
	if (!state.SubtitleRendererConstructor) {
		try {
			const module = await import(constant.MEDIABUNNY_URL);
			state.SubtitleRendererConstructor = module.SubtitleRenderer;
		} catch (e) {
			console.error("Failed to load SubtitleRenderer module:", e);
			showError("Failed to load subtitle support.");
			throw e;
		}
	}
	return state.SubtitleRendererConstructor;
};

const showStatusMessage = (msg) => {
	const statusEl = $('statusMessage');
	if (statusEl) {
		statusEl.textContent = msg;
		statusEl.style.display = 'block';
	}
	showLoading(true);
};

const hideStatusMessage = () => {
	const statusEl = $('statusMessage');
	if (statusEl) {
		statusEl.textContent = '';
		statusEl.style.display = 'none';
	}
	showLoading(false);
};

const handleConversion = async (source, fileName) => {
	showStatusMessage('Unsupported format. Converting to MP4...');
	let conversionInput;
	try {
		conversionInput = new Input({
			source,
			formats: ALL_FORMATS
		});

		const output = new Output({
			format: new Mp4OutputFormat({
				fastStart: 'in-memory'
			}),
			target: new BufferTarget(),
		});

		const conversion = await Conversion.init({
			input: conversionInput,
			output
		});

		if (!conversion.isValid) {
			console.error('Conversion is not valid. Discarded tracks:', conversion.discardedTracks);
			let reason = 'the file contains no convertible tracks.';
			if (conversion.discardedTracks.length > 0) {
				const firstReason = conversion.discardedTracks[0].reason;
				if (firstReason === 'undecodable_source_codec') {
					reason = 'its video or audio codec is not supported by this browser for conversion.';
				} else {
					reason = `of an internal error (${firstReason}).`;
				}
			}
			throw new Error(`Could not prepare conversion because ${reason}`);
		}

		conversion.onProgress = (progress) => {
			showStatusMessage(`Converting to MP4... (${Math.round(progress * 100)}%)`);
		};

		await conversion.execute();
		showStatusMessage('Conversion complete. Loading video...');

		const blob = new Blob([output.target.buffer], {
			type: 'video/mp4'
		});
		const convertedFile = new File(
			[blob],
			(fileName.split('.').slice(0, -1).join('.') || 'converted') + '.mp4', {
			type: 'video/mp4'
		}
		);

		await loadMedia(convertedFile, true);

	} catch (error) {
		showError(`Conversion Failed: This file format appears to be incompatible with the in-browser converter. (${error.message})`);
		console.error('Conversion error:', error);
		showDropZoneUI();
	} finally {
		if (conversionInput) conversionInput.dispose();
		hideStatusMessage();
	}
};

const getPlaybackTime = () => {
	if (!state.playing) {
		return state.playbackTimeAtStart;
	}
	const elapsedTime = state.audioContext.currentTime - state.audioContextStartTime;
	return state.playbackTimeAtStart + (elapsedTime * state.currentPlaybackRate);
};

const startVideoIterator = async () => {
	if (!state.videoSink) return;
	const currentAsyncId = state.asyncId;

	try {
		await state.videoFrameIterator?.return();
		state.videoFrameIterator = state.videoSink.canvases(getPlaybackTime());

		const firstResult = await state.videoFrameIterator.next();
		if (currentAsyncId !== state.asyncId) return;

		const firstFrame = firstResult.value ?? null;
		if (firstFrame) {
			constant.ctx.drawImage(firstFrame.canvas, 0, 0, constant.canvas.width, constant.canvas.height);
			updateNextFrame();
		} else {
			state.nextFrame = null;
		}
	} catch (e) {
		if (currentAsyncId === state.asyncId) console.error("Error starting video iteration:", e);
	}
};

const updateNextFrame = async () => {
	if (!state.videoFrameIterator) return;
	const currentAsyncId = state.asyncId;
	try {
		const result = await state.videoFrameIterator.next();
		if (currentAsyncId !== state.asyncId || result.done) {
			state.nextFrame = null;
			return;
		}
		state.nextFrame = result.value;
	} catch (e) {
		if (currentAsyncId === state.asyncId) console.error("Error decoding video frame:", e);
		state.nextFrame = null;
	}
};

const checkPlaybackState = () => {
	if (!state.playing || !state.fileLoaded) return;

	const currentTime = getPlaybackTime();

	// 1. Handle looping
	if (state.isLooping && currentTime >= state.loopEndTime) {
		seekToTime(state.loopStartTime);
		return; // Important: return here to prevent the next check from running immediately
	}

	// 2. Handle end-of-track and autoplay
	if (currentTime >= state.totalDuration && state.totalDuration > 0 && !state.isLooping) {
		pause();
		if (state.isAutoplayEnabled) {
			playNext();
		} else {
			state.playbackTimeAtStart = state.totalDuration;
			scheduleProgressUpdate(state.totalDuration);
		}
	}
};

const renderLoop = () => {
	if (state.fileLoaded) {
		const currentTime = getPlaybackTime();

		if (state.playing) {
			if (state.nextFrame && state.nextFrame.timestamp <= currentTime) {
				constant.ctx.drawImage(state.nextFrame.canvas, 0, 0, constant.canvas.width, constant.canvas.height);
				state.nextFrame = null;
				updateNextFrame();
			}
		}
		updateSubtitlesOptimized(currentTime);
		if (!state.isSeeking) scheduleProgressUpdate(currentTime);
	}
	requestAnimationFrame(renderLoop);
};

// === PERFORMANCE OPTIMIZATION: Debounced progress update ===
const scheduleProgressUpdate = (time) => {
	if (state.progressUpdateScheduled) return;
	state.progressUpdateScheduled = true;
	requestAnimationFrame(() => {
		updateProgressBarUI(time);
		state.progressUpdateScheduled = false;
	});
};

const takeScreenshot = () => {
	if (!state.fileLoaded || !constant.canvas) {
		showError("Cannot take screenshot: No video loaded.");
		return;
	}

	constant.canvas.toBlob((blob) => {
		if (!blob) {
			showError("Failed to create screenshot.");
			return;
		}

		state.currentScreenshotBlob = blob;

		if (constant.screenshotPreviewImg.src && constant.screenshotPreviewImg.src.startsWith('blob:')) {
			URL.revokeObjectURL(constant.screenshotPreviewImg.src);
		}

		const imageUrl = URL.createObjectURL(blob);
		constant.screenshotPreviewImg.src = imageUrl;
		constant.screenshotOverlay.classList.remove('hidden');
		hideTrackMenus();

	}, 'image/png');
};

const runAudioIterator = async () => {
	if (!state.audioSink || !state.audioBufferIterator) return;
	const currentAsyncId = state.asyncId;

	try {
		for await (const {
			buffer,
			timestamp
		} of state.audioBufferIterator) {
			if (currentAsyncId !== state.asyncId) break;

			const node = state.audioContext.createBufferSource();
			node.buffer = buffer;
			node.connect(state.gainNode);
			node.playbackRate.value = state.currentPlaybackRate;

			const absolutePlayTime = state.audioContextStartTime + ((timestamp - state.playbackTimeAtStart) / state.currentPlaybackRate);

			if (absolutePlayTime >= state.audioContext.currentTime) {
				node.start(absolutePlayTime);
			} else {
				const offset = (state.audioContext.currentTime - absolutePlayTime) * state.currentPlaybackRate;
				if (offset < buffer.duration) {
					node.start(state.audioContext.currentTime, offset);
				}
			}

			state.queuedAudioNodes.add(node);
			node.onended = () => state.queuedAudioNodes.delete(node);

			if (timestamp - getPlaybackTime() >= 1.5) {
				while (state.playing && currentAsyncId === state.asyncId && (timestamp - getPlaybackTime() >= 0.5)) {
					await new Promise(r => setTimeout(r, 100));
				}
			}
		}
	} catch (e) {
		if (currentAsyncId === state.asyncId) console.error("Error during audio iteration:", e);
	}
};

const play = async () => {
	if (state.playing || !state.audioContext) return;
	if (state.audioContext.state === 'suspended') await state.audioContext.resume();

	if (state.totalDuration > 0 && Math.abs(getPlaybackTime() - state.totalDuration) < 0.1) {
		const time = state.isLooping ? state.loopStartTime : 0;
		state.playbackTimeAtStart = time;
		await seekToTime(time);
	}

	state.audioContextStartTime = state.audioContext.currentTime;
	state.playing = true;

	// Add these two lines to start the interval
	if (state.playbackLogicInterval) clearInterval(state.playbackLogicInterval);
	state.playbackLogicInterval = setInterval(checkPlaybackState, 100); // Check 10 times a second

	if (state.audioSink) {
		const currentAsyncId = state.asyncId;
		await state.audioBufferIterator?.return();
		if (currentAsyncId !== state.asyncId) return;

		const iteratorStartTime = getPlaybackTime();
		state.audioBufferIterator = state.audioSink.buffers(iteratorStartTime);
		runAudioIterator();
	}

	constant.playBtn.textContent = '⏸';
	showControlsTemporarily();
};

const pause = () => {
	if (!state.playing) return;
	state.playbackTimeAtStart = getPlaybackTime();
	state.playing = false;
	state.asyncId++;

	// Add these two lines to stop the interval
	clearInterval(state.playbackLogicInterval);
	state.playbackLogicInterval = null;

	state.audioBufferIterator?.return().catch(() => { });
	state.audioBufferIterator = null;

	state.queuedAudioNodes.forEach(node => {
		try {
			node.stop();
		} catch (e) { }
	});
	state.queuedAudioNodes.clear();

	constant.playBtn.textContent = '▶';
	constant.videoContainer.classList.remove('hide-cursor');
	clearTimeout(state.hideControlsTimeout);
	constant.videoControls.classList.add('show');
};

const togglePlay = () => state.playing ? pause() : play();

const seekToTime = async (seconds) => {
	const wasPlaying = state.playing;
	if (wasPlaying) pause();

	seconds = Math.max(0, Math.min(seconds, state.totalDuration));
	state.playbackTimeAtStart = seconds;
	updateProgressBarUI(seconds);
	updateTimeInputs(seconds);

	await startVideoIterator();

	if (wasPlaying && state.playbackTimeAtStart < state.totalDuration) {
		await play();
	}
};

const toggleLoop = () => {
	constant.loopBtn.classList.toggle('hover_highlight');
	if (state.isLooping) {
		state.isLooping = false;
		constant.loopBtn.textContent = 'Loop';
	} else {
		const start = parseTime(constant.startTimeInput.value);
		const end = parseTime(constant.endTimeInput.value);

		if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end > state.totalDuration) {
			showError("Invalid start or end time for looping.");
			return;
		}

		state.isLooping = true;
		state.loopStartTime = start;
		state.loopEndTime = end;
		constant.loopBtn.textContent = 'Looping...';

		const currentTime = getPlaybackTime();
		if (currentTime < start || currentTime > end) {
			seekToTime(start);
		}

		if (!state.playing) {
			play();
		}
	}
};

// Helper function to get the interpolated crop rectangle for a specific timestamp
const getInterpolatedCropRect = (timestamp) => {
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

// NEW HELPER FUNCTION: Clamp rectangle to video dimensions
const clampRectToVideoBounds = (rect) => {
	if (!constant.canvas.width || !constant.canvas.height) return rect;

	const videoWidth = constant.canvas.width;
	const videoHeight = constant.canvas.height;

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
// --- Replace your entire handleCutAction function with this final version ---

const handleCutAction = async () => {
	if (!state.fileLoaded) return;
	if (state.playing) pause();

	const start = parseTime(constant.startTimeInput.value);
	const end = parseTime(constant.endTimeInput.value);

	if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end > state.totalDuration) {
		showError("Invalid start or end time for cutting.");
		return;
	}
	hideTrackMenus();
	showStatusMessage('Cutting clip...');
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
			if (state.smoothPath) {
				showStatusMessage('Smoothing path...'); // Optional feedback for the user
				// Replace the jerky keyframes with the new, smoothed version.
				state.panKeyframes = smoothPathWithMovingAverage(state.panKeyframes, 15);
			}
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
							processCtx.filter = 'blur(15px)'; processCtx.drawImage(processCanvas, 0, 0); processCtx.filter = 'none';
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
						if (state.dynamicCropMode === 'max-size' && state.scaleWithRatio) {
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
		conversion.onProgress = (progress) => showStatusMessage(`Cutting clip... (${Math.round(progress * 100)}%)`);
		await conversion.execute();
		const originalName = (state.currentPlayingFile.name || 'video').split('.').slice(0, -1).join('.');
		const clipName = `${originalName}_${new Date().getTime()}_${formatTime(start)}-${formatTime(end)}_edited.mp4`.replace(/:/g, '_');
		const cutClipFile = new File([output.target.buffer], clipName, { type: 'video/mp4' });
		state.playlist.push({ type: 'file', name: clipName, file: cutClipFile, isCutClip: true });
		updatePlaylistUIOptimized();
		// if (cropFuncToReset) cropFuncToReset(null, true);
		showStatusMessage('Clip added to playlist!');
		setTimeout(hideStatusMessage, 2000);
	} catch (error) {
		console.error("Error during cutting:", error);
		showError(`Failed to cut the clip: ${error.message}`);
		hideStatusMessage();
	} finally {
		if (input) input.dispose();
	}
};

const positionCropCanvas = () => {
	if (!constant.canvas.width || !constant.canvas.height) {
		console.warn('Video dimensions not available yet');
		return null;
	}

	const container = constant.videoContainer;
	const containerRect = container.getBoundingClientRect();

	// Get video dimensions
	const videoWidth = constant.canvas.width;
	const videoHeight = constant.canvas.height;

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
	constant.cropCanvas.style.left = `${offsetX}px`;
	constant.cropCanvas.style.top = `${offsetY}px`;
	constant.cropCanvas.style.width = `${renderWidth}px`;
	constant.cropCanvas.style.height = `${renderHeight}px`;

	// Keep the canvas internal resolution at video resolution for accuracy
	// (We already set cropCanvas.width/height to match constant.canvas.width/height elsewhere)

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

/**
 * Stores the current crop canvas dimensions for coordinate conversion
 */
let cropCanvasDimensions = null;

const getScaledCoordinates = (e) => {
	const rect = constant.cropCanvas.getBoundingClientRect();

	// Get canvas internal resolution
	const canvasWidth = constant.cropCanvas.width;
	const canvasHeight = constant.cropCanvas.height;

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

// --- New Function: To draw the shaded overlay ---
const drawCropOverlay = () => {
	// Clear the previous frame
	constant.cropCtx.clearRect(0, 0, constant.cropCanvas.width, constant.cropCanvas.height);

	// Calculate dimensions, ensuring width and height are not negative
	const x = Math.min(state.cropStart.x, state.cropEnd.x);
	const y = Math.min(state.cropStart.y, state.cropEnd.y);
	const width = Math.abs(state.cropStart.x - state.cropEnd.x);
	const height = Math.abs(state.cropStart.y - state.cropEnd.y);

	if (width > 0 || height > 0) {
		// Draw the semi-transparent shade over the entire canvas
		constant.cropCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
		constant.cropCtx.fillRect(0, 0, constant.cropCanvas.width, constant.cropCanvas.height);

		// "Punch a hole" in the shade where the crop area is
		constant.cropCtx.clearRect(x, y, width, height);

		// Add a light border around the clear area for better visibility
		constant.cropCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
		constant.cropCtx.lineWidth = 1;
		constant.cropCtx.strokeRect(x, y, width, height);
	}
};

const stopAndClear = async () => {
	if (state.playing) pause();
	state.fileLoaded = false;
	state.isLooping = false;
	constant.loopBtn.textContent = 'Loop';
	state.currentPlaybackRate = 1.0;
	constant.playbackSpeedInput.value = '1';
	state.asyncId++;

	try {
		await state.videoFrameIterator?.return();
	} catch (e) { }
	try {
		await state.audioBufferIterator?.return();
	} catch (e) { }

	state.nextFrame = null;
	state.videoSink = null;
	state.audioSink = null;
	state.subtitleRenderer = null;
	removeSubtitleOverlay();

	state.availableAudioTracks = [];
	state.availableSubtitleTracks = [];
	state.currentAudioTrack = null;
	state.currentSubtitleTrack = null;

	constant.ctx.clearRect(0, 0, constant.canvas.width, constant.canvas.height);

	if (state.audioContext && state.audioContext.state === 'running') {
		await state.audioContext.suspend();
	}
};

const loadMedia = async (resource, isConversionAttempt = false) => {
	showLoading(true);
	let input;
	try {
		await stopAndClear();

		let source;
		let resourceName;

		if (resource instanceof Blob) {
			source = new BlobSource(resource);
			resourceName = resource.name;
		} else if (typeof resource === 'string') {
			source = new UrlSource(resource);
			resourceName = resource.split('/').pop() || 'video_from_url.mp4';
			if (!state.playlist.some(item => item.file === resource)) {
				state.playlist.push({
					type: 'file',
					name: resourceName,
					file: resource
				});
			}
		} else {
			throw new Error('Invalid media resource provided.');
		}

		input = new Input({
			source,
			formats: ALL_FORMATS
		});

		const videoTrack = await input.getPrimaryVideoTrack();
		const audioTracks = await input.getAudioTracks();
		const firstAudioTrack = audioTracks.length > 0 ? audioTracks[0] : null;

		const isVideoDecodable = videoTrack ? await videoTrack.canDecode() : false;
		const isAudioDecodable = firstAudioTrack ? await firstAudioTrack.canDecode() : false;

		const isPlayable = (videoTrack && isVideoDecodable) || (!videoTrack && firstAudioTrack && isAudioDecodable);

		if (!isPlayable && !isConversionAttempt) {
			console.log("Media not directly playable, attempting conversion.");
			await handleConversion(source, resourceName);
			return;
		}

		if (!isPlayable && isConversionAttempt) {
			throw new Error('Converted file is not playable. Its codecs may be unsupported by this browser.');
		}

		state.currentPlayingFile = resource;
		state.totalDuration = await input.computeDuration();
		state.playbackTimeAtStart = 0;

		constant.startTimeInput.value = formatTime(0);
		constant.endTimeInput.value = formatTime(state.totalDuration);

		state.availableAudioTracks = audioTracks;
		const allTracks = await input.getTracks();
		state.availableSubtitleTracks = allTracks.filter(track => track.type === 'subtitle');

		state.currentAudioTrack = state.availableAudioTracks.length > 0 ? state.availableAudioTracks[0] : null;
		state.currentSubtitleTrack = null;

		if (!videoTrack && !state.currentAudioTrack) {
			throw new Error('No valid audio or video tracks found.');
		}

		if (!state.audioContext) {
			state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
		}
		if (state.audioContext.state === 'suspended') await state.audioContext.resume();

		state.gainNode = state.audioContext.createGain();
		state.gainNode.connect(state.audioContext.destination);
		setVolume(constant.volumeSlider.value);

		if (videoTrack) {
			state.videoSink = new CanvasSink(videoTrack, {
				poolSize: 2
			});
			constant.canvas.width = videoTrack.displayWidth || videoTrack.codedWidth || 1280;
			constant.canvas.height = videoTrack.displayHeight || videoTrack.codedHeight || 720;

			// Resize the crop canvas as well
			constant.cropCanvas.width = constant.canvas.width;
			constant.cropCanvas.height = constant.canvas.height;
		}

		if (state.currentAudioTrack) {
			state.audioSink = new AudioBufferSink(state.currentAudioTrack);
		}

		updateTrackMenus();
		updatePlaylistUIOptimized();
		state.fileLoaded = true;
		showPlayerUI();
		updateProgressBarUI(0);

		await startVideoIterator();
		await play();

	} catch (error) {
		showError(`Failed to load media: ${error.message}`);
		console.error('Error loading media:', error);
		if (input) input.dispose();
		state.currentPlayingFile = null;
		showDropZoneUI();
	} finally {
		showLoading(false);
	}
};

const updateTrackMenus = () => {
	const audioTrackList = $('audioTrackList');
	audioTrackList.innerHTML = '';

	state.availableAudioTracks.forEach((track, index) => {
		const li = document.createElement('li');
		li.className = `track-item ${track === state.currentAudioTrack ? 'active' : ''}`;
		const langCode = track.languageCode;
		const label = (langCode && langCode !== 'und') ? langCode : `Audio ${index + 1}`;
		li.innerHTML = `<span>${label}</span>`;
		li.onclick = () => switchAudioTrack(index);
		audioTrackList.appendChild(li);
	});

	const subtitleTrackList = $('subtitleTrackList');
	const noneOption = document.createElement('li');
	noneOption.className = `track-item ${!state.currentSubtitleTrack ? 'active' : ''}`;
	noneOption.innerHTML = `<span>Off</span>`;
	noneOption.onclick = () => switchSubtitleTrack('none');
	subtitleTrackList.innerHTML = '';
	subtitleTrackList.appendChild(noneOption);

	state.availableSubtitleTracks.forEach((track, index) => {
		const li = document.createElement('li');
		li.className = `track-item ${track === state.currentSubtitleTrack ? 'active' : ''}`;
		const langCode = track.languageCode;
		const label = (langCode && langCode !== 'und') ? langCode : `Subtitle ${index + 1}`;
		li.innerHTML = `<span>${label}</span>`;
		li.onclick = () => switchSubtitleTrack(index);
		subtitleTrackList.appendChild(li);
	});
};

const switchAudioTrack = async (trackIndex) => {
	if (!state.availableAudioTracks[trackIndex] || state.availableAudioTracks[trackIndex] === state.currentAudioTrack) return;

	showLoading(true);
	const wasPlaying = state.playing;
	if (wasPlaying) pause();

	state.currentAudioTrack = state.availableAudioTracks[trackIndex];

	try {
		if (await state.currentAudioTrack.canDecode()) {
			state.audioSink = new AudioBufferSink(state.currentAudioTrack);
		} else {
			showError("Selected audio track cannot be decoded.");
			state.audioSink = null;
		}
	} catch (e) {
		console.error("Error switching audio track:", e);
		state.audioSink = null;
	}

	updateTrackMenus();
	hideTrackMenus();
	showLoading(false);

	if (wasPlaying && state.playbackTimeAtStart < state.totalDuration) {
		await play();
	}
};

const switchSubtitleTrack = async (trackIndex) => {
	removeSubtitleOverlay();

	if (trackIndex === 'none') {
		state.currentSubtitleTrack = null;
		state.subtitleRenderer = null;
	} else if (state.availableSubtitleTracks[trackIndex] && state.availableSubtitleTracks[trackIndex] !== state.currentSubtitleTrack) {
		state.currentSubtitleTrack = state.availableSubtitleTracks[trackIndex];
		try {
			const Renderer = await ensureSubtitleRenderer();
			state.subtitleRenderer = new Renderer(state.currentSubtitleTrack);
		} catch (e) {
			console.error("Error initializing subtitle renderer:", e);
			showError("Failed to load subtitles.");
			state.currentSubtitleTrack = null;
			state.subtitleRenderer = null;
		}
	}

	updateTrackMenus();
	hideTrackMenus();
};

const removeSubtitleOverlay = () => {
	if (state.subtitleOverlayElement) {
		state.subtitleOverlayElement.textContent = '';
		state.subtitleOverlayElement.style.display = 'none';
	}
	state.lastSubtitleText = null;
};

// === PERFORMANCE OPTIMIZATION: Reuse subtitle overlay element ===
const updateSubtitlesOptimized = (currentTime) => {
	if (!state.subtitleRenderer) {
		if (state.subtitleOverlayElement && state.subtitleOverlayElement.style.display !== 'none') {
			removeSubtitleOverlay();
		}
		return;
	}

	try {
		const subtitle = state.subtitleRenderer.getSubtitleAt(currentTime);
		const newText = subtitle?.text || '';

		// Only update DOM if text changed
		if (newText !== state.lastSubtitleText) {
			if (!newText) {
				removeSubtitleOverlay();
			} else {
				if (!state.subtitleOverlayElement) {
					state.subtitleOverlayElement = document.createElement('div');
					state.subtitleOverlayElement.className = 'subtitle-overlay';
					constant.videoContainer.appendChild(state.subtitleOverlayElement);
				}
				state.subtitleOverlayElement.textContent = newText;
				state.subtitleOverlayElement.style.display = 'block';
			}
			state.lastSubtitleText = newText;
		}
	} catch (e) {
		console.error("Error rendering subtitle:", e);
	}
};

const hideTrackMenus = () => {
	$('audioTrackMenu').classList.add('hidden');
	$('subtitleTrackMenu').classList.add('hidden');
	$('settingsMenu').classList.add('hidden');
};

const playNext = () => {
	if (!state.currentPlayingFile || state.playlist.length <= 1) return;

	const flatten = (nodes) => {
		let flat = [];
		nodes.forEach(node => {
			if (node.type === 'file') flat.push(node);
			if (node.type === 'folder') flat = flat.concat(flatten(node.children));
		});
		return flat;
	};

	const flatList = flatten(state.playlist);
	const currentIndex = flatList.findIndex(item => item.file === state.currentPlayingFile);

	if (currentIndex !== -1 && currentIndex < flatList.length - 1) {
		loadMedia(flatList[currentIndex + 1].file);
	}
};

const playPrevious = () => {
	if (!state.currentPlayingFile || state.playlist.length <= 1) return;

	const flatten = (nodes) => {
		let flat = [];
		nodes.forEach(node => {
			if (node.type === 'file') flat.push(node);
			if (node.type === 'folder') flat = flat.concat(flatten(node.children));
		});
		return flat;
	};

	const flatList = flatten(state.playlist);
	const currentIndex = flatList.findIndex(item => item.file === state.currentPlayingFile);

	if (currentIndex > 0) {
		loadMedia(flatList[currentIndex - 1].file);
	} else {
		// Loop back to the last track
		loadMedia(flatList[flatList.length - 1].file);
	}
};

const parseTime = (timeStr) => {
	const parts = timeStr.split(':').map(Number);
	if (parts.some(isNaN)) return NaN;
	let seconds = 0;
	if (parts.length === 2) {
		seconds = parts[0] * 60 + parts[1];
	} else if (parts.length === 1) {
		seconds = parts[0];
	} else {
		return NaN;
	}
	return seconds;
};

const formatTime = s => {
	if (!isFinite(s) || s < 0) return '00:00';
	const minutes = Math.floor(s / 60);
	const seconds = Math.floor(s % 60);
	return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const showLoading = show => constant.loading.classList.toggle('hidden', !show);

const showError = msg => {
	constant.showMessage.innerHTML = "";
	constant.showMessage.className = "showMessage error-message"

	const el = document.createElement('div');
	el.textContent = msg;
	constant.showMessage.appendChild(el);
	setTimeout(() => {
		constant.showMessage.innerHTML = ""
		constant.showMessage.className = "showMessage hidden"
	}, 4000);
};
const showInfo = msg => {
	constant.showMessage.innerHTML = "";
	constant.showMessage.className = "showMessage"

	const el = document.createElement('div');
	el.textContent = msg;
	constant.showMessage.appendChild(el);
	setTimeout(() => {
		constant.showMessage.innerHTML = ""
		constant.showMessage.className = "showMessage hidden"
	}, 4000);
};

const showPlayerUI = () => {
	constant.dropZone.style.display = 'none';
	constant.videoContainer.style.display = 'block';
};

const showDropZoneUI = () => {
	constant.dropZone.style.display = 'flex';
	constant.videoContainer.style.display = 'none';
	updateProgressBarUI(0);
	state.totalDuration = 0;
};

const updateTimeInputs = (time) => {
	const currentFocused = document.activeElement;
	if (currentFocused !== constant.startTimeInput && currentFocused !== constant.endTimeInput) {
		// Optionally update inputs here if needed
	}
};

const updateProgressBarUI = (time) => {
	const displayTime = Math.max(0, Math.min(time, state.totalDuration));
	constant.timeDisplay.textContent = `${formatTime(displayTime)} / ${formatTime(state.totalDuration)}`;
	const percent = state.totalDuration > 0 ? (displayTime / state.totalDuration) * 100 : 0;
	constant.progressBar.style.width = `${percent}%`;
	constant.progressHandle.style.left = `${percent}%`;

	if (state.playing) updateTimeInputs(time);
};

const findFileByPath = (nodes, path) => {
	const pathParts = path.split('/').filter(Boolean);
	if (pathParts.length === 0) return null;

	const itemName = pathParts[0];
	const node = nodes.find(n => n.name === itemName);

	if (!node) return null;
	if (pathParts.length === 1 && node.type === 'file') return node.file;
	if (node.type === 'folder' && pathParts.length > 1) {
		return findFileByPath(node.children, pathParts.slice(1).join('/'));
	}
	return null;
};

const handleFiles = (files) => {
	if (files.length === 0) return;

	const validFiles = Array.from(files).filter(file =>
		file.type.startsWith('video/') ||
		file.type.startsWith('audio/') ||
		file.name.match(/\.(mp4|webm|mkv|mov|mp3|wav|aac|flac|ogg|avi|flv|wmv)$/i)
	);

	if (validFiles.length === 0) {
		showError("No supported media files found.");
		return;
	}

	const fileEntries = validFiles.map(file => ({
		file,
		path: file.name
	}));
	const newTree = buildTreeFromPaths(fileEntries);
	state.playlist = mergeTrees(state.playlist, newTree);
	updatePlaylistUIOptimized();

	if (!state.fileLoaded && fileEntries.length > 0) {
		loadMedia(fileEntries[0].file);
	}
};

const handleFolderSelection = (event) => {
	const files = event.target.files;
	if (!files.length) return;
	showLoading(true);

	const fileEntries = Array.from(files)
		.filter(file =>
			file.type.startsWith('video/') ||
			file.type.startsWith('audio/') ||
			file.name.match(/\.(mp4|webm|mkv|mov|mp3|wav|aac|flac|ogg|avi|flv|wmv)$/i)
		)
		.map(file => ({
			file,
			path: file.webkitRelativePath || file.name
		}));

	if (fileEntries.length > 0) {
		const newTree = buildTreeFromPaths(fileEntries);
		state.playlist = mergeTrees(state.playlist, newTree);
		updatePlaylistUIOptimized();
		if (!state.fileLoaded) loadMedia(fileEntries[0].file);
	} else {
		showError("No supported media files found in directory.");
	}
	showLoading(false);
	event.target.value = '';
};

const mergeTrees = (mainTree, newTree) => {
	newTree.forEach(newItem => {
		const existingItem = mainTree.find(item => item.name === newItem.name && item.type === newItem.type);
		if (existingItem && existingItem.type === 'folder') {
			existingItem.children = mergeTrees(existingItem.children, newItem.children);
		} else if (!existingItem) {
			mainTree.push(newItem);
		}
	});
	return mainTree;
};

const removeItemFromPath = (nodes, path) => {
	const pathParts = path.split('/').filter(Boolean);
	if (pathParts.length === 0) return;

	const itemName = pathParts[0];
	for (let i = 0; i < nodes.length; i++) {
		if (nodes[i].name === itemName) {
			if (pathParts.length === 1) {
				nodes.splice(i, 1);
				return true;
			} else if (nodes[i].type === 'folder') {
				const removed = removeItemFromPath(nodes[i].children, pathParts.slice(1).join('/'));
				if (removed && nodes[i].children.length === 0) {
					nodes.splice(i, 1);
				}
				return removed;
			}
		}
	}
	return false;
};

const clearPlaylist = () => {
	stopAndClear();
	state.playlist = [];
	state.playlistElementCache.clear();
	state.lastRenderedPlaylist = null;
	updatePlaylistUIOptimized();
};

const buildTreeFromPaths = (files) => {
	const tree = [];
	files.forEach(fileInfo => {
		const pathParts = fileInfo.path.split('/').filter(Boolean);
		let currentLevel = tree;

		pathParts.forEach((part, i) => {
			if (i === pathParts.length - 1) {
				if (!currentLevel.some(item => item.type === 'file' && item.name === part)) {
					currentLevel.push({
						type: 'file',
						name: part,
						file: fileInfo.file
					});
				}
			} else {
				let existingNode = currentLevel.find(item => item.type === 'folder' && item.name === part);
				if (!existingNode) {
					existingNode = {
						type: 'folder',
						name: part,
						children: []
					};
					currentLevel.push(existingNode);
				}
				currentLevel = existingNode.children;
			}
		});
	});
	return tree;
};

const escapeHTML = str => str.replace(/[&<>'"]/g,
	tag => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		"'": '&#39;',
		'"': '&quot;'
	}[tag]));

// === PERFORMANCE OPTIMIZATION: Incremental DOM updates ===
const createPlaylistElement = (node, currentPath = '') => {
	const safeName = escapeHTML(node.name);
	const nodePath = currentPath ? `${currentPath}/${node.name}` : node.name;
	const safePath = escapeHTML(nodePath);

	if (node.type === 'folder') {
		const li = document.createElement('li');
		li.className = 'playlist-folder';
		li.dataset.path = safePath;

		const details = document.createElement('details');
		details.open = true;

		const summary = document.createElement('summary');
		const folderName = document.createElement('span');
		folderName.className = 'playlist-folder-name';
		folderName.title = safeName;
		folderName.textContent = safeName;

		const removeBtn = document.createElement('span');
		removeBtn.className = 'remove-item';
		removeBtn.dataset.path = safePath;
		removeBtn.textContent = '×';

		summary.appendChild(folderName);
		summary.appendChild(removeBtn);
		details.appendChild(summary);

		const ul = document.createElement('ul');
		ul.className = 'playlist-tree';
		node.children.forEach(child => {
			ul.appendChild(createPlaylistElement(child, nodePath));
		});
		details.appendChild(ul);
		li.appendChild(details);

		return li;
	} else {
		const li = document.createElement('li');
		const isActive = (state.currentPlayingFile === node.file);
		li.className = `playlist-file ${node.isCutClip ? 'cut-clip' : ''} ${isActive ? 'active' : ''}`;
		li.dataset.path = safePath;
		li.title = safeName;

		const fileName = document.createElement('span');
		fileName.className = 'playlist-file-name';
		fileName.title = safeName;
		fileName.textContent = safeName;
		li.appendChild(fileName);

		if (node.isCutClip) {
			const clipActions = document.createElement('div');
			clipActions.className = 'clip-actions';

			const downloadBtn = document.createElement('button');
			downloadBtn.className = 'clip-action-btn';
			downloadBtn.dataset.action = 'download';
			downloadBtn.dataset.path = safePath;
			downloadBtn.textContent = '📥';

			const copyBtn = document.createElement('button');
			copyBtn.className = 'clip-action-btn';
			copyBtn.dataset.action = 'copy';
			copyBtn.dataset.path = safePath;
			copyBtn.textContent = '📋';

			clipActions.appendChild(downloadBtn);
			clipActions.appendChild(copyBtn);
			li.appendChild(clipActions);
		}

		const removeBtn = document.createElement('span');
		removeBtn.className = 'remove-item';
		removeBtn.dataset.path = safePath;
		removeBtn.textContent = '×';
		li.appendChild(removeBtn);

		return li;
	}
};

// === PERFORMANCE OPTIMIZATION: Smart playlist updates ===
const updatePlaylistUIOptimized = () => {
	if (state.playlist.length === 0) {
		constant.playlistContent.innerHTML = '<p style="padding:1rem; opacity:0.7; text-align:center;">No files.</p>';
		state.playlistElementCache.clear();
		state.lastRenderedPlaylist = null;
		showDropZoneUI();
		return;
	}

	// Check if we need a full rebuild
	const playlistChanged = JSON.stringify(state.playlist) !== state.lastRenderedPlaylist;

	if (!playlistChanged) {
		// Just update active states
		updateActiveStates();
		return;
	}

	// Full rebuild needed
	const fragment = document.createDocumentFragment();
	const ul = document.createElement('ul');
	ul.className = 'playlist-tree';

	state.playlist.forEach(node => {
		ul.appendChild(createPlaylistElement(node));
	});

	fragment.appendChild(ul);
	constant.playlistContent.innerHTML = '';
	constant.playlistContent.appendChild(fragment);

	state.lastRenderedPlaylist = JSON.stringify(state.playlist);
};

// === PERFORMANCE OPTIMIZATION: Update only active states ===
const updateActiveStates = () => {
	const allFiles = constant.playlistContent.querySelectorAll('.playlist-file');
	allFiles.forEach(fileEl => {
		const path = fileEl.dataset.path;
		const file = findFileByPath(state.playlist, path);
		const isActive = (file === state.currentPlayingFile);
		fileEl.classList.toggle('active', isActive);
	});
};

const setVolume = val => {
	const vol = parseFloat(val);
	if (state.gainNode) state.gainNode.gain.value = vol * vol;
	constant.muteBtn.textContent = vol > 0 ? '🔊' : '🔇';
};

const showControlsTemporarily = () => {
	clearTimeout(state.hideControlsTimeout);
	constant.videoControls.classList.add('show');
	constant.videoContainer.classList.remove('hide-cursor');

	if (state.playing) {
		state.hideControlsTimeout = setTimeout(() => {
			if (state.playing && !state.isSeeking && !constant.videoControls.matches(':hover') && !document.querySelector('.control-group:hover')) {
				constant.videoControls.classList.remove('show');
				constant.videoContainer.classList.add('hide-cursor');
				hideTrackMenus();
			}
		}, 3000);
	}
};

const setPlaybackSpeed = (newSpeed) => {
	if (!state.playing) {
		state.currentPlaybackRate = newSpeed;
		return;
	}

	if (newSpeed === state.currentPlaybackRate) {
		return;
	}

	const currentTime = getPlaybackTime();

	state.asyncId++;
	state.audioBufferIterator?.return().catch(() => { });
	state.queuedAudioNodes.forEach(node => {
		try {
			node.stop();
		} catch (e) { }
	});
	state.queuedAudioNodes.clear();

	state.currentPlaybackRate = newSpeed;

	state.playbackTimeAtStart = currentTime;
	state.audioContextStartTime = state.audioContext.currentTime;

	if (state.audioSink) {
		state.audioBufferIterator = state.audioSink.buffers(currentTime);
		runAudioIterator();
	}

	startVideoIterator();
};

const updateShortcutKeysVisibility = () => {
    const panel = $('shortcutKeysPanel');
    if (!panel) return;
    
    // The panel should be visible if either static or dynamic cropping is active.
    const shouldBeVisible = state.isCropping || state.isPanning;
    panel.classList.toggle('hidden', !shouldBeVisible);
};

// Function to enter/exit Static Cropping mode
const toggleStaticCrop = (e, reset = false) => {
	state.isCropping = !reset && !state.isCropping;
	state.isPanning = false; // Ensure panning is off

	constant.panScanBtn.textContent = 'Dynamic ✂️';
	constant.cropBtn.textContent = state.isCropping ? 'Cropping...' : '✂️';

	constant.cropCanvas.classList.toggle('hidden', !state.isCropping);
	constant.panScanBtn.classList.toggle('hover_highlight', state.isPanning);
	constant.cropBtn.classList.toggle('hover_highlight');
	if (reset) constant.cropBtn.classList.remove('hover_highlight');

	updateShortcutKeysVisibility();

	if (state.isCropping) {
		// Position the crop canvas when entering crop mode
		cropCanvasDimensions = positionCropCanvas();
		isCropFixed = false; // Reset fixed state
		updateFixSizeButton();
	} else {
		constant.cropCtx.clearRect(0, 0, constant.cropCanvas.width, constant.cropCanvas.height);
		state.cropRect = null;
		cropCanvasDimensions = null;
		isCropFixed = false;
		updateFixSizeButton();
	}
};

// Function to enter/exit Dynamic Pan/Crop mode
const togglePanning = (e, reset = false) => {
	state.isPanning = !reset && !state.isPanning;
	state.isCropping = false; // Ensure static cropping is off

	constant.cropBtn.textContent = '✂️';
	constant.panScanBtn.textContent = state.isPanning ? 'Recording... (Press l to lock)' : 'Dynamic ✂️';

	constant.cropCanvas.classList.toggle('hidden', !state.isPanning);
	constant.cropBtn.classList.toggle('hover_highlight', state.isCropping);
	constant.panScanBtn.classList.toggle('hover_highlight');
	if (reset) constant.panScanBtn.classList.remove('hover_highlight');

	updateShortcutKeysVisibility();

	state.panKeyframes = [];
	state.panRectSize = null;

	if (state.isPanning) {
		// Position the crop canvas when entering panning mode
		cropCanvasDimensions = positionCropCanvas();
		isCropFixed = false; // Reset fixed state
		updateFixSizeButton();
	} else {
		constant.cropCtx.clearRect(0, 0, constant.cropCanvas.width, constant.cropCanvas.height);
		cropCanvasDimensions = null;
		isCropFixed = false;
		updateFixSizeButton();
	}
};

// ============================================================================
// ADD NEW VARIABLES for crop resize/move functionality
// ============================================================================

let isCropFixed = false; // Is the crop size locked?
let isDraggingCrop = false; // Are we moving the crop?
let isResizingCrop = false; // Are we resizing the crop?
let resizeHandle = null; // Which corner/edge is being resized
let dragStartPos = { x: 0, y: 0 }; // Starting position for drag
let originalCropRect = null; // Original crop rect before drag/resize

// Resize handle size in pixels
const HANDLE_SIZE = 12;
const HANDLE_HALF = HANDLE_SIZE / 2;

// ============================================================================
// NEW FUNCTION: Draw crop rectangle with resize handles
// ============================================================================

const drawCropWithHandles = (rect) => {
	if (!rect || rect.width <= 0 || rect.height <= 0) return;

	constant.cropCtx.clearRect(0, 0, constant.cropCanvas.width, constant.cropCanvas.height);

	// Draw semi-transparent overlay
	const overlayColor = state.isPanning ? 'rgba(0, 50, 100, 0.6)' : 'rgba(0, 0, 0, 0.6)';
	constant.cropCtx.fillStyle = overlayColor;
	constant.cropCtx.fillRect(0, 0, constant.cropCanvas.width, constant.cropCanvas.height);

	// Clear the crop area
	constant.cropCtx.clearRect(rect.x, rect.y, rect.width, rect.height);

	// Draw border
	const borderColor = state.isPanning ? 'rgba(50, 150, 255, 0.9)' : 'rgba(255, 255, 255, 0.8)';
	constant.cropCtx.strokeStyle = borderColor;
	constant.cropCtx.lineWidth = 2;
	constant.cropCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);

	// Draw resize handles if crop is not fixed
	if (!isCropFixed) {
		constant.cropCtx.fillStyle = '#00ffff';
		constant.cropCtx.strokeStyle = '#ffffff';
		constant.cropCtx.lineWidth = 1;

		// Corner handles
		const corners = [
			{ x: rect.x, y: rect.y, cursor: 'nw' },
			{ x: rect.x + rect.width, y: rect.y, cursor: 'ne' },
			{ x: rect.x, y: rect.y + rect.height, cursor: 'sw' },
			{ x: rect.x + rect.width, y: rect.y + rect.height, cursor: 'se' }
		];

		corners.forEach(corner => {
			constant.cropCtx.fillRect(
				corner.x - HANDLE_HALF,
				corner.y - HANDLE_HALF,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
			constant.cropCtx.strokeRect(
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
			constant.cropCtx.fillRect(
				edge.x - HANDLE_HALF,
				edge.y - HANDLE_HALF,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
			constant.cropCtx.strokeRect(
				edge.x - HANDLE_HALF,
				edge.y - HANDLE_HALF,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
		});
	}
};

// ============================================================================
// NEW FUNCTION: Get resize handle at position
// ============================================================================

const getResizeHandle = (x, y, rect) => {
	if (!rect || isCropFixed) return null;

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

// ============================================================================
// NEW FUNCTION: Check if point is inside crop rect
// ============================================================================

const isInsideCropRect = (x, y, rect) => {
	if (!rect) return false;
	return x >= rect.x && x <= rect.x + rect.width &&
		y >= rect.y && y <= rect.y + rect.height;
};

// ============================================================================
// NEW FUNCTION: Get cursor style for handle
// ============================================================================

const getCursorForHandle = (handle) => {
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

// ============================================================================
// NEW FUNCTION: Apply resize based on handle
// ============================================================================

const applyResize = (handle, deltaX, deltaY, originalRect) => {
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

// ============================================================================
// MODIFY toggleStaticCrop to reset fixed state
// ============================================================================

// ============================================================================
// NEW FUNCTION: Update Fix Size button visibility and state
// ============================================================================

const updateFixSizeButton = () => {
	const fixSizeBtn = document.getElementById('fixSizeBtn');
	if (!fixSizeBtn) return;

	const shouldShow = (state.isCropping || state.isPanning) &&
		(state.cropRect || state.panRectSize);

	if (shouldShow) {
		fixSizeBtn.style.display = 'inline-block';
		fixSizeBtn.textContent = isCropFixed ? 'Resize' : 'Fix Size';
		if (isCropFixed) {
			fixSizeBtn.classList.add('hover_highlight');
		} else {
			fixSizeBtn.classList.remove('hover_highlight');
		}
	} else {
		fixSizeBtn.style.display = 'none';
	}
};

// ============================================================================
// NEW FUNCTION: Toggle crop fixed state
// ============================================================================

const toggleCropFixed = () => {
	isCropFixed = !isCropFixed;
	updateFixSizeButton();

	if (isCropFixed) {
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
		showInfo(state.isPanning ?
			"Size locked! Move the crop area with your cursor during playback." :
			"Size locked! The crop is now fixed.");
	} else {
		showInfo("You can now resize or move the crop area.");
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

/**
 * Smooths a path of keyframes using a Simple Moving Average.
 * @param {Array} keyframes The original panKeyframes.
 * @param {number} windowSize The number of frames to average (must be an odd number).
 * @returns {Array} A new array of smoothed keyframes.
 */
const smoothPathWithMovingAverage = (keyframes, windowSize = 15) => {
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

/**
 * Resets all user-configurable editing states to their default values.
 */
const resetAllConfigs = () => {
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
    blurAmount = 15;

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
        constant.startTimeInput.value = formatTime(0);
        constant.endTimeInput.value = formatTime(state.totalDuration);
    }

    // 6. Reset the looping state and UI
    state.isLooping = false;
    state.loopStartTime = 0;
    state.loopEndTime = 0;
    constant.loopBtn.textContent = 'Loop';
    constant.loopBtn.classList.remove('hover_highlight');

    // 7. Give user feedback
    showInfo("All configurations have been reset.");
};

const setupEventListeners = () => {
	$('clearPlaylistBtn').onclick = clearPlaylist;
	$('chooseFileBtn').onclick = () => {
		state.fileLoaded = false;
		$('fileInput').click();
	};
	$('togglePlaylistBtn').onclick = () => constant.playerArea.classList.toggle('playlist-visible');

	$('fileInput').onclick = (e) => e.target.value = null;
	$('fileInput').onchange = (e) => handleFiles(e.target.files);

	$('folderInput').onclick = (e) => e.target.value = null;
	$('folderInput').onchange = handleFolderSelection;

	constant.playBtn.onclick = (e) => {
		e.stopPropagation();
		togglePlay();
	};
	constant.prevBtn.onclick = (e) => {
		e.stopPropagation();
		playPrevious();
	};

	constant.nextBtn.onclick = (e) => {
		e.stopPropagation();
		playNext();
	};
	constant.muteBtn.onclick = (e) => {
		e.stopPropagation();
		if (parseFloat(constant.volumeSlider.value) > 0) {
			constant.volumeSlider.dataset.lastVolume = constant.volumeSlider.value;
			constant.volumeSlider.value = 0;
		} else {
			constant.volumeSlider.value = constant.volumeSlider.dataset.lastVolume || 1;
		}
		setVolume(constant.volumeSlider.value);
	};

	const mainActionBtn = $('mainActionBtn');
	const dropdownActionBtn = $('dropdownActionBtn');
	const actionDropdownMenu = $('actionDropdownMenu');

	// Helper function to execute the chosen action
	const executeOpenFileAction = (action) => {
		switch (action) {
			case 'open-url':
				constant.urlModal.classList.remove('hidden');
				constant.urlInput.focus();
				break;
			case 'open-file':
				state.fileLoaded = false;
				$('fileInput').click();
				break;
			case 'add-file':
				$('fileInput').click();
				break;
			case 'add-folder':
				$('folderInput').click();
				break;
		}
	};

	// 1. Main button executes the currently selected action
	if (constant.mainActionBtn) {
		constant.mainActionBtn.onclick = () => {
			executeOpenFileAction(state.currentOpenFileAction);
		};
	}

	// 2. Dropdown button shows/hides the menu
	if (constant.dropdownActionBtn) {
		constant.dropdownActionBtn.onclick = (e) => {
			e.stopPropagation();
			constant.actionDropdownMenu.classList.toggle('hidden');
		};
	}

	// 3. Clicks inside the dropdown menu set the action and execute it
	if (constant.actionDropdownMenu) {
		constant.actionDropdownMenu.addEventListener('click', (e) => {
			const target = e.target.closest('button[data-action]');
			if (!target) return;

			const action = target.dataset.action;

			// Update state
			state.currentOpenFileAction = action;

			// Update UI
			constant.mainActionBtn.textContent = target.textContent;

			// Hide menu and execute
			constant.actionDropdownMenu.classList.add('hidden');
			executeOpenFileAction(action);
		});
	}
	$('audioTrackCtrlBtn').onclick = (e) => {
		e.stopPropagation();
		const menu = $('audioTrackMenu');
		const isHidden = menu.classList.contains('hidden');
		hideTrackMenus();
		if (isHidden) menu.classList.remove('hidden');
	};

	$('subtitleTrackCtrlBtn').onclick = (e) => {
		e.stopPropagation();
		const menu = $('subtitleTrackMenu');
		const isHidden = menu.classList.contains('hidden');
		hideTrackMenus();
		if (isHidden) menu.classList.remove('hidden');
	};

	// $('editMenuBtn').onclick = (e) => {
	// 	e.stopPropagation();
	// 	const menu = $('settingsMenu');
	// 	const isHidden = menu.classList.contains('hidden');
	// 	hideTrackMenus();
	// 	if (isHidden) menu.classList.remove('hidden');
	// };

	// === PERFORMANCE OPTIMIZATION: Event delegation for playlist ===
	document.addEventListener('click', (e) => {
		// Find the existing listener and add a check for our new container
		if (!e.target.closest('.track-menu') && !e.target.closest('.control-btn') && !e.target.closest('.split-action-btn')) {
			hideTrackMenus();
			if (constant.actionDropdownMenu) constant.actionDropdownMenu.classList.add('hidden'); // Also hide the action menu
		}
	});

	constant.volumeSlider.onclick = (e) => e.stopPropagation();
	constant.volumeSlider.oninput = (e) => setVolume(e.target.value);

	constant.fullscreenBtn.onclick = (e) => {
		e.stopPropagation();
		if (document.fullscreenElement) document.exitFullscreen();
		else if (constant.videoContainer.requestFullscreen) constant.videoContainer.requestFullscreen();
	};

	const handleSeekLine = (e) => {
		const rect = constant.progressContainer.getBoundingClientRect();
		const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		return percent * state.totalDuration;
	};

	constant.progressContainer.onpointerdown = (e) => {
		if (!state.fileLoaded) return;
		e.preventDefault();
		state.isSeeking = true;
		constant.progressContainer.setPointerCapture(e.pointerId);
		const seekTime = handleSeekLine(e);
		updateProgressBarUI(seekTime);
		updateTimeInputs(seekTime);
	};

	constant.progressContainer.onpointermove = (e) => {
		if (!state.isSeeking) {
			showControlsTemporarily();
			return;
		}
		const seekTime = handleSeekLine(e);
		updateProgressBarUI(seekTime);
		updateTimeInputs(seekTime);
	};

	constant.progressContainer.onpointerup = (e) => {
		if (!state.isSeeking) return;
		state.isSeeking = false;
		constant.progressContainer.releasePointerCapture(e.pointerId);

		const finalSeekTime = handleSeekLine(e);
		if (state.isLooping && (finalSeekTime < state.loopStartTime || finalSeekTime > state.loopEndTime)) {
			state.isLooping = false;
			constant.loopBtn.textContent = 'Loop';
		}
		seekToTime(finalSeekTime);
	};

	const ddEvents = ['dragenter', 'dragover', 'dragleave', 'drop'];
	ddEvents.forEach(name => document.body.addEventListener(name, p => p.preventDefault()));

	constant.dropZone.ondragenter = () => constant.dropZone.classList.add('dragover');
	constant.dropZone.ondragover = () => constant.dropZone.classList.add('dragover');
	constant.dropZone.ondragleave = (e) => {
		if (e.target === constant.dropZone) constant.dropZone.classList.remove('dragover');
	};
	constant.dropZone.ondrop = (e) => {
		constant.dropZone.classList.remove('dragover');
		handleFiles(e.dataTransfer.files);
	};

	// === PERFORMANCE OPTIMIZATION: Event delegation for playlist clicks ===
	constant.playlistContent.addEventListener('click', (e) => {
		const removeButton = e.target.closest('.remove-item');
		if (removeButton) {
			e.stopPropagation();
			const pathToRemove = removeButton.dataset.path;
			const fileToRemove = findFileByPath(state.playlist, pathToRemove);

			let isPlayingFile = false;
			if (fileToRemove && state.currentPlayingFile) {
				isPlayingFile = (fileToRemove instanceof File && state.currentPlayingFile instanceof File) ?
					fileToRemove === state.currentPlayingFile :
					fileToRemove === state.currentPlayingFile;
			}

			removeItemFromPath(state.playlist, pathToRemove);
			updatePlaylistUIOptimized();

			if (isPlayingFile) {
				stopAndClear();
				state.currentPlayingFile = null;
				showDropZoneUI();
			}
			return;
		}

		const actionButton = e.target.closest('.clip-action-btn');
		if (actionButton) {
			e.stopPropagation();
			const path = actionButton.dataset.path;
			const blob = findFileByPath(state.playlist, path);
			if (blob instanceof Blob) {
				if (actionButton.dataset.action === 'download') {
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = path.split('/').pop();
					a.click();
					URL.revokeObjectURL(url);
				} else if (actionButton.dataset.action === 'copy') {
					navigator.clipboard.write([new ClipboardItem({
						[blob.type]: blob
					})]).then(() => {
						showError('Clip copied to clipboard!');
					}, (err) => {
						showError('Copy failed. Browser may not support it.');
						console.error('Copy failed:', err);
					});
				}
			}
			return;
		}

		const fileElement = e.target.closest('.playlist-file');
		if (fileElement && (e.target.classList.contains('playlist-file-name') || e.target === fileElement)) {
			const path = fileElement.dataset.path;
			const fileToPlay = findFileByPath(state.playlist, path);
			if (fileToPlay && fileToPlay !== state.currentPlayingFile) {
				loadMedia(fileToPlay);
			}
		}
	});

	document.onkeydown = (e) => {
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || !state.fileLoaded) return;
		const actions = {
			'Space': () => togglePlay(),
			'KeyK': () => togglePlay(),
			'KeyF': () => constant.fullscreenBtn.click(),
			'KeyM': () => constant.muteBtn.click(),
			'ArrowLeft': () => seekToTime(getPlaybackTime() - 5),
			'ArrowRight': () => seekToTime(getPlaybackTime() + 5),
			'ArrowUp': () => {
				constant.volumeSlider.value = Math.min(1, parseFloat(constant.volumeSlider.value) + 0.1);
				setVolume(constant.volumeSlider.value);
			},
			'ArrowDown': () => {
				constant.volumeSlider.value = Math.max(0, parseFloat(constant.volumeSlider.value) - 0.1);
				setVolume(constant.volumeSlider.value);
			}
		};
		if (actions[e.code]) {
			e.preventDefault();
			actions[e.code]();
			showControlsTemporarily();
		}
	};

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible' && state.playing && state.fileLoaded) {
			const now = getPlaybackTime();
			const videoTime = state.nextFrame ? state.nextFrame.timestamp : now;

			if (now - videoTime > 0.25) {
				startVideoIterator();
			}
		}
	});

	constant.canvas.onclick = () => {
		if (state.audioContext && state.audioContext.state === 'suspended') state.audioContext.resume();
		togglePlay();
	};

	constant.videoContainer.onpointermove = showControlsTemporarily;
	constant.videoContainer.onmouseleave = () => {
		if (state.playing && !state.isSeeking) {
			constant.videoControls.classList.remove('show');
			hideTrackMenus();
		}
	};

	constant.settingsCtrlBtn.onclick = (e) => {
		e.stopPropagation();
		const isHidden = constant.settingsMenu.classList.contains('hidden');
		hideTrackMenus();
		if (isHidden) {
			constant.settingsMenu.classList.remove('hidden');
		}
	};

	constant.loopBtn.onclick = toggleLoop;
	constant.cutBtn.onclick = handleCutAction;
	constant.screenshotBtn.onclick = takeScreenshot;

	const closeScreenshotModal = () => {
		constant.screenshotOverlay.classList.add('hidden');
		if (constant.screenshotPreviewImg.src && constant.screenshotPreviewImg.src.startsWith('blob:')) {
			URL.revokeObjectURL(constant.screenshotPreviewImg.src);
		}
		state.currentScreenshotBlob = null;
	};

	constant.closeScreenshotBtn.onclick = closeScreenshotModal;
	constant.screenshotOverlay.onclick = (e) => {
		if (e.target === constant.screenshotOverlay) {
			closeScreenshotModal();
		}
	};

	constant.downloadScreenshotBtn.onclick = () => {
		if (!state.currentScreenshotBlob) return;

		const timestamp = formatTime(getPlaybackTime()).replace(/:/g, '-');
		const originalName = (state.currentPlayingFile.name || 'video').split('.').slice(0, -1).join('.');
		const filename = `${originalName}_${timestamp}.png`;

		const a = document.createElement('a');
		a.href = constant.screenshotPreviewImg.src;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	};

	constant.copyScreenshotBtn.onclick = () => {
		if (!state.currentScreenshotBlob) return;

		navigator.clipboard.write([
			new ClipboardItem({
				'image/png': state.currentScreenshotBlob
			})
		]).then(() => {
			showError("Screenshot copied to clipboard!");
		}).catch(err => {
			console.error("Copy failed:", err);
			showError("Copy failed. Your browser may not support this feature.");
		});
	};

	constant.playbackSpeedInput.oninput = () => {
		let speed = parseFloat(constant.playbackSpeedInput.value);
		if (isNaN(speed)) speed = 1;
		if (!isNaN(speed) && speed >= 0.25 && speed <= 4) {
			setPlaybackSpeed(speed);
		}
	};

	constant.autoplayToggle.onchange = () => {
		state.isAutoplayEnabled = constant.autoplayToggle.checked;
	};
	// --- Add URL Modal Logic Here ---

	const hideUrlModal = () => {
		constant.urlModal.classList.add('hidden');
	};

	constant.cancelUrlBtn.onclick = hideUrlModal;

	// Hide the modal if the user clicks on the background
	constant.urlModal.onclick = (e) => {
		if (e.target === constant.urlModal) {
			hideUrlModal();
		}
	};

	// Handle loading the URL
	constant.loadUrlBtn.onclick = () => {
		const url = constant.urlInput.value.trim();
		if (url) {
			// The existing loadMedia function already supports URLs!
			loadMedia(url);
			hideUrlModal();
		} else {
			showError("Please enter a valid URL.");
		}
	};

	// Add keyboard shortcuts for the modal
	constant.urlInput.onkeydown = (e) => {
		if (e.key === 'Enter') {
			e.preventDefault(); // Prevent form submission
			constant.loadUrlBtn.click();
		} else if (e.key === 'Escape') {
			hideUrlModal();
		}
	};
	// --- End of URL Modal Logic ---
	constant.cropBtn.onclick = toggleStaticCrop;
	constant.panScanBtn.onclick = togglePanning;

	constant.cropCanvas.onpointerdown = (e) => {
		// This logic now applies to both modes
		if (!state.isCropping && !state.isPanning) return;
		e.preventDefault();
		constant.cropCanvas.setPointerCapture(e.pointerId);

		state.isDrawingCrop = true;
		const coords = getScaledCoordinates(e);
		state.cropStart = coords;
		state.cropEnd = coords;
	};

	constant.cropCanvas.onpointerdown = (e) => {
		if (!state.isCropping && !state.isPanning) return;
		e.preventDefault();
		constant.cropCanvas.setPointerCapture(e.pointerId);

		const coords = getScaledCoordinates(e);

		// If we have an existing crop rect
		const currentRect = state.isCropping ? state.cropRect :
			(state.panKeyframes.length > 0 ? state.panKeyframes[state.panKeyframes.length - 1].rect : null);

		if (currentRect && !isCropFixed) {
			// Check if clicking on a resize handle
			resizeHandle = getResizeHandle(coords.x, coords.y, currentRect);

			if (resizeHandle) {
				isResizingCrop = true;
				originalCropRect = { ...currentRect };
				dragStartPos = coords;
			} else if (isInsideCropRect(coords.x, coords.y, currentRect)) {
				// Clicking inside crop area - start dragging
				isDraggingCrop = true;
				originalCropRect = { ...currentRect };
				dragStartPos = coords;
			} else {
				// Clicking outside - start drawing new rect
				state.isDrawingCrop = true;
				state.cropStart = coords;
				state.cropEnd = coords;
			}
		} else if (currentRect && isCropFixed && state.isPanning) {
			// In panning mode with fixed size, any click starts recording movement
			isDraggingCrop = true;
			dragStartPos = coords;
		} else {
			// No existing rect - start drawing
			state.isDrawingCrop = true;
			state.cropStart = coords;
			state.cropEnd = coords;
		}
	};

	constant.cropCanvas.onpointermove = (e) => {
		const coords = getScaledCoordinates(e);

		// Update cursor based on position
		if (!state.isDrawingCrop && !isDraggingCrop && !isResizingCrop) {
			const currentRect = state.isCropping ? state.cropRect :
				(state.panKeyframes.length > 0 ? state.panKeyframes[state.panKeyframes.length - 1].rect : null);

			if (currentRect && !isCropFixed) {
				const handle = getResizeHandle(coords.x, coords.y, currentRect);
				if (handle) {
					constant.cropCanvas.style.cursor = getCursorForHandle(handle);
				} else if (isInsideCropRect(coords.x, coords.y, currentRect)) {
					constant.cropCanvas.style.cursor = 'move';
				} else {
					constant.cropCanvas.style.cursor = 'crosshair';
				}
			} else if (state.isPanning && state.panRectSize && isCropFixed) {
				// Live panning with fixed size
				const lastRectSize = state.panKeyframes.length > 0
					? { width: state.panKeyframes[state.panKeyframes.length - 1].rect.width, height: state.panKeyframes[state.panKeyframes.length - 1].rect.height }
					: state.panRectSize;
				let currentRect = {
					x: coords.x - lastRectSize.width / 2,
					y: coords.y - lastRectSize.height / 2,
					width: lastRectSize.width,
					height: lastRectSize.height
				};
				currentRect = clampRectToVideoBounds(currentRect);
				state.panKeyframes.push({ timestamp: getPlaybackTime(), rect: currentRect });
				drawCropWithHandles(currentRect);
				return;
			}
		}

		// Handle drawing new rect
		if (state.isDrawingCrop) {
			e.preventDefault();
			state.cropEnd = coords;

			const rect = {
				x: Math.min(state.cropStart.x, state.cropEnd.x),
				y: Math.min(state.cropStart.y, state.cropEnd.y),
				width: Math.abs(state.cropStart.x - state.cropEnd.x),
				height: Math.abs(state.cropStart.y - state.cropEnd.y)
			};
			drawCropWithHandles(rect);
			return;
		}

		// Handle resizing
		if (isResizingCrop && originalCropRect) {
			e.preventDefault();
			const deltaX = coords.x - dragStartPos.x;
			const deltaY = coords.y - dragStartPos.y;

			const newRect = applyResize(resizeHandle, deltaX, deltaY, originalCropRect);

			if (state.isCropping) {
				state.cropRect = newRect;
			} else if (state.isPanning && state.panKeyframes.length > 0) {
				state.panKeyframes[state.panKeyframes.length - 1].rect = newRect;
				state.panRectSize = { width: newRect.width, height: newRect.height };
			}

			drawCropWithHandles(newRect);
			return;
		}

		// Handle dragging/moving
		if (isDraggingCrop && originalCropRect) {
			e.preventDefault();
			const deltaX = coords.x - dragStartPos.x;
			const deltaY = coords.y - dragStartPos.y;

			let newRect = {
				x: originalCropRect.x + deltaX,
				y: originalCropRect.y + deltaY,
				width: originalCropRect.width,
				height: originalCropRect.height
			};

			newRect = clampRectToVideoBounds(newRect);

			if (state.isCropping) {
				state.cropRect = newRect;
			} else if (state.isPanning) {
				if (isCropFixed) {
					// Record keyframe while dragging in fixed mode
					state.panKeyframes.push({ timestamp: getPlaybackTime(), rect: newRect });
				} else if (state.panKeyframes.length > 0) {
					state.panKeyframes[state.panKeyframes.length - 1].rect = newRect;
				}
			}

			drawCropWithHandles(newRect);
			return;
		}
	};

	constant.cropCanvas.onpointerup = (e) => {
		if (!state.isDrawingCrop && !isDraggingCrop && !isResizingCrop) return;
		e.preventDefault();
		constant.cropCanvas.releasePointerCapture(e.pointerId);

		// Finalize drawing new rect
		if (state.isDrawingCrop) {
			const finalRect = {
				x: Math.min(state.cropStart.x, state.cropEnd.x),
				y: Math.min(state.cropStart.y, state.cropEnd.y),
				width: Math.abs(state.cropStart.x - state.cropEnd.x),
				height: Math.abs(state.cropStart.y - state.cropEnd.y)
			};

			if (finalRect.width < 10 || finalRect.height < 10) {
				state.cropRect = null;
				state.panRectSize = null;
				constant.cropCtx.clearRect(0, 0, constant.cropCanvas.width, constant.cropCanvas.height);
			} else {
				if (state.isPanning) {
					state.panRectSize = { width: finalRect.width, height: finalRect.height };
					state.panKeyframes.push({ timestamp: getPlaybackTime(), rect: finalRect });
				} else if (state.isCropping) {
					state.cropRect = finalRect;
				}
				drawCropWithHandles(finalRect);
			}
		}

		state.isDrawingCrop = false;
		isDraggingCrop = false;
		isResizingCrop = false;
		resizeHandle = null;
		originalCropRect = null;
		constant.cropCanvas.style.cursor = 'crosshair';

		updateFixSizeButton();
	};

	// 2. Add the wheel event listener for zooming
	constant.cropCanvas.addEventListener('wheel', (e) => {
		if (!state.isPanning || !state.isShiftPressed || !state.panRectSize) return;
		e.preventDefault();

		const lastKeyframe = state.panKeyframes[state.panKeyframes.length - 1];
		if (!lastKeyframe) return;

		// === NEW: GET MOUSE POSITION FOR CENTERED ZOOM ===
		const coords = getScaledCoordinates(e);
		const ZOOM_SPEED = 0.05;

		const currentRect = lastKeyframe.rect;
		const zoomFactor = e.deltaY < 0 ? (1 - ZOOM_SPEED) : (1 + ZOOM_SPEED);
		const aspectRatio = state.panRectSize.width / state.panRectSize.height;

		// === NEW: CALCULATE MOUSE POSITION AS A RATIO WITHIN THE RECTANGLE ===
		// This ensures the point under the cursor stays in the same relative position after zoom.
		const ratioX = (coords.x - currentRect.x) / currentRect.width;
		const ratioY = (coords.y - currentRect.y) / currentRect.height;

		let newWidth = currentRect.width * zoomFactor;
		let newHeight = newWidth / aspectRatio;

		// === NEW: CALCULATE NEW TOP-LEFT CORNER BASED ON MOUSE POSITION ===
		let newX = coords.x - (newWidth * ratioX);
		let newY = coords.y - (newHeight * ratioY);

		let newZoomedRect = { x: newX, y: newY, width: newWidth, height: newHeight };
		newZoomedRect = clampRectToVideoBounds(newZoomedRect);

		// === CRITICAL SMOOTHNESS FIX ===
		// Instead of pushing a new keyframe, we UPDATE the last one.
		// This prevents keyframe overload and makes the zoom feel smooth.
		lastKeyframe.rect = newZoomedRect;

		drawCropWithHandles(newZoomedRect);

	}, { passive: false }); // { passive: false } is needed for preventDefault() to work reliably

	// 1. Add global listeners to track the Shift key state
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Shift') {
			state.isShiftPressed = true;
		}
	});

	document.addEventListener('keyup', (e) => {
		if (e.key === 'Shift') {
			state.isShiftPressed = false;
			// When Shift is released, the next mouse move will automatically
			// record a normal, un-zoomed keyframe, effectively "snapping back".
		}
	});
	document.addEventListener('keydown', (e) => {
		if (state.isPanning && state.panRectSize && e.key.toLowerCase() === 'r') {
			e.preventDefault();
			// Add one last keyframe at the release point
			const lastKeyframe = state.panKeyframes[state.panKeyframes.length - 1];
			if (lastKeyframe) {
				state.panKeyframes.push({ timestamp: getPlaybackTime(), rect: lastKeyframe.rect });
			}

			// Exit panning mode
			state.isPanning = false; // Stop listening to mouse moves
			constant.panScanBtn.textContent = 'Path Recorded!';
			showInfo("Panning path recorded. The crop will now remain fixed. You can now use 'Cut Clip'.");
		}
	});

	const cropModeRadios = document.querySelectorAll('input[name="cropMode"]');
	const scaleOptionContainer = $('scaleOptionContainer');
	const scaleWithRatioToggle = $('scaleWithRatioToggle');
	const blurOptionContainer = $('blurOptionContainer');
	const smoothOptionContainer = $('smoothOptionContainer');
	const smoothPathToggle = $('smoothPathToggle');
	const blurBackgroundToggle = $('blurBackgroundToggle');
	const blurAmountInput = $('blurAmountInput');

	// Helper function to update the visibility of sub-options based on the selected mode
	const updateDynamicCropOptionsUI = () => {
		scaleOptionContainer.style.display = (state.dynamicCropMode === 'max-size') ? 'flex' : 'none';
		blurOptionContainer.style.display = (state.dynamicCropMode === 'spotlight' || state.dynamicCropMode === 'max-size') ? 'flex' : 'none';
		// Show the smooth option for ANY dynamic mode
		smoothOptionContainer.style.display = (state.dynamicCropMode !== 'none') ? 'flex' : 'none';
	};

    // Trigger the UI visibility update
    if(cropModeRadios.length > 0) {
        // Find the event listener's helper function to call it directly
        // Note: This assumes updateDynamicCropOptionsUI is available in this scope.
        // It's better to define it outside the event listener if it's not.
        updateDynamicCropOptionsUI(); 
    }

	if (smoothPathToggle) {
		smoothPathToggle.onchange = (e) => {
			state.smoothPath = e.target.checked;
		};
	}

	// Listen for changes on any of the radio buttons
	cropModeRadios.forEach(radio => {
		radio.addEventListener('change', (e) => {
			// Update the main state variable with the new mode
			state.dynamicCropMode = e.target.value;

			// Reset sub-options when the mode changes to prevent leftover state
			if (scaleWithRatioToggle) {
				scaleWithRatioToggle.checked = false;
				state.scaleWithRatio = false;
			}
			if (smoothPathToggle) {
				smoothPathToggle.checked = false;
				state.smoothPath = false;
			}
			if (blurBackgroundToggle) {
				blurBackgroundToggle.checked = false;
				state.useBlurBackground = false;
				blurAmountInput.value = 15; // And reset its value
				blurAmount = 15;
			}

			// Update the UI to show the correct sub-options
			updateDynamicCropOptionsUI();
		});
	});

	// Independent listeners for the sub-options
	if (scaleWithRatioToggle) {
		scaleWithRatioToggle.onchange = (e) => {
			state.scaleWithRatio = e.target.checked;
		};
	}
	if (blurBackgroundToggle && blurAmountInput) {
		blurBackgroundToggle.onchange = (e) => {
			state.useBlurBackground = e.target.checked;
		};

		blurAmountInput.oninput = (e) => {
			// Update the state with the user's chosen blur amount
			const amount = parseInt(e.target.value, 10);
			if (!isNaN(amount)) {
				blurAmount = Math.max(1, Math.min(100, amount)); // Clamp value between 1 and 100
			}
		};
	}
	const resetAllBtn = $('resetAllBtn'); // Find our new button ID
	if (resetAllBtn) {
        resetAllBtn.onclick = resetAllConfigs; // Simply call our powerful new function
    }
	updateDynamicCropOptionsUI();

	document.getElementById('settingsMenu').addEventListener('mouseleave', () => {
		if (state.isCropping || state.isPanning || state.isLooping) {
			constant.settingsMenu.classList.add('hidden');
		}
	});
};

// document.addEventListener('DOMContentLoaded', () => {
	setupEventListeners();
	renderLoop();

	const urlParams = new URLSearchParams(window.location.search);
	const videoUrl = urlParams.get('video_url');

	if (videoUrl) {
		try {
			const decodedUrl = decodeURIComponent(videoUrl);
			const urlPlayOverlay = $('urlPlayOverlay');
			if (urlPlayOverlay) {
				urlPlayOverlay.classList.remove('hidden');
				const startBtn = urlPlayOverlay.querySelector('button') || urlPlayOverlay;
				startBtn.addEventListener('click', () => {
					urlPlayOverlay.classList.add('hidden');
					loadMedia(decodedUrl);
				}, {
					once: true
				});
			} else {
				loadMedia(decodedUrl);
			}
		} catch (e) {
			console.error("Error parsing video_url:", e);
		}
	}

	updatePlaylistUIOptimized();

	if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
		navigator.serviceWorker.register('service-worker.js')
			.catch(err => console.log('ServiceWorker registration failed:', err));
	}

	let resizeTimeout;
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimeout);
		resizeTimeout = setTimeout(() => {
			if ((state.isCropping || state.isPanning) && !constant.cropCanvas.classList.contains('hidden')) {
				cropCanvasDimensions = positionCropCanvas();
				// Redraw current crop
				const currentRect = state.isCropping ? state.cropRect :
					(state.panKeyframes.length > 0 ? state.panKeyframes[state.panKeyframes.length - 1].rect : null);
				if (currentRect) {
					drawCropWithHandles(currentRect);
				}
			}
		}, 100);
	});

	// Fix Size button handler
	const fixSizeBtn = document.getElementById('fixSizeBtn');
	if (fixSizeBtn) {
		fixSizeBtn.onclick = (e) => {
			e.stopPropagation();
			toggleCropFixed();
		};
		// Update the 'R' key handler for panning mode
		document.addEventListener('keydown', (e) => {
			if (e.key.toLowerCase() === 'l') {
				e.stopPropagation();
				toggleCropFixed();
			}
		});
	}

	// Update the 'R' key handler for panning mode
	document.addEventListener('keydown', (e) => {
		if (state.isPanning && state.panRectSize && e.key.toLowerCase() === 'r' && !isCropFixed) {
			e.preventDefault();
			toggleCropFixed();
			if (isCropFixed && !state.playing) {
				play(); // Auto-start playback when fixing size in pan mode
			}
		} else if (e.key.toLowerCase() === 's') {
			e.preventDefault();
			takeScreenshot()
		} else if (e.key.toLowerCase() === 'c') {
			e.preventDefault();
			handleCutAction()
		} else if (e.key.toLowerCase() === 'escape') {
			e.preventDefault();
			resetAllConfigs()
		}
	});
// });
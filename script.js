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
	BufferTarget
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.23.0/+esm';

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
const trimMenuBtn = $('trimMenuBtn');
const trimMenu = $('trimMenu');
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
const ctx = canvas.getContext('2d', {
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
	if (!SubtitleRendererConstructor) {
		try {
			const module = await import(MEDIABUNNY_URL);
			SubtitleRendererConstructor = module.SubtitleRenderer;
		} catch (e) {
			console.error("Failed to load SubtitleRenderer module:", e);
			showError("Failed to load subtitle support.");
			throw e;
		}
	}
	return SubtitleRendererConstructor;
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
	if (!playing) {
		return playbackTimeAtStart;
	}
	const elapsedTime = audioContext.currentTime - audioContextStartTime;
	return playbackTimeAtStart + (elapsedTime * currentPlaybackRate);
};

const startVideoIterator = async () => {
	if (!videoSink) return;
	const currentAsyncId = asyncId;

	try {
		await videoFrameIterator?.return();
		videoFrameIterator = videoSink.canvases(getPlaybackTime());

		const firstResult = await videoFrameIterator.next();
		if (currentAsyncId !== asyncId) return;

		const firstFrame = firstResult.value ?? null;
		if (firstFrame) {
			ctx.drawImage(firstFrame.canvas, 0, 0, canvas.width, canvas.height);
			updateNextFrame();
		} else {
			nextFrame = null;
		}
	} catch (e) {
		if (currentAsyncId === asyncId) console.error("Error starting video iteration:", e);
	}
};

const updateNextFrame = async () => {
	if (!videoFrameIterator) return;
	const currentAsyncId = asyncId;
	try {
		const result = await videoFrameIterator.next();
		if (currentAsyncId !== asyncId || result.done) {
			nextFrame = null;
			return;
		}
		nextFrame = result.value;
	} catch (e) {
		if (currentAsyncId === asyncId) console.error("Error decoding video frame:", e);
		nextFrame = null;
	}
};

const checkPlaybackState = () => {
    if (!playing || !fileLoaded) return;

    const currentTime = getPlaybackTime();

    // 1. Handle looping
    if (isLooping && currentTime >= loopEndTime) {
        seekToTime(loopStartTime);
        return; // Important: return here to prevent the next check from running immediately
    }

    // 2. Handle end-of-track and autoplay
    if (currentTime >= totalDuration && totalDuration > 0 && !isLooping) {
        if (isAutoplayEnabled) {
            playNext();
        } else {
            pause();
            playbackTimeAtStart = totalDuration;
            scheduleProgressUpdate(totalDuration);
        }
    }
};

const renderLoop = () => {
	if (fileLoaded) {
		const currentTime = getPlaybackTime();

		if (playing) {
			if (nextFrame && nextFrame.timestamp <= currentTime) {
				ctx.drawImage(nextFrame.canvas, 0, 0, canvas.width, canvas.height);
				nextFrame = null;
				updateNextFrame();
			}
		}
		updateSubtitlesOptimized(currentTime);
		if (!isSeeking) scheduleProgressUpdate(currentTime);
	}
	requestAnimationFrame(renderLoop);
};

// === PERFORMANCE OPTIMIZATION: Debounced progress update ===
const scheduleProgressUpdate = (time) => {
	if (progressUpdateScheduled) return;
	progressUpdateScheduled = true;
	requestAnimationFrame(() => {
		updateProgressBarUI(time);
		progressUpdateScheduled = false;
	});
};

const takeScreenshot = () => {
	if (!fileLoaded || !canvas) {
		showError("Cannot take screenshot: No video loaded.");
		return;
	}

	canvas.toBlob((blob) => {
		if (!blob) {
			showError("Failed to create screenshot.");
			return;
		}

		currentScreenshotBlob = blob;

		if (screenshotPreviewImg.src && screenshotPreviewImg.src.startsWith('blob:')) {
			URL.revokeObjectURL(screenshotPreviewImg.src);
		}

		const imageUrl = URL.createObjectURL(blob);
		screenshotPreviewImg.src = imageUrl;
		screenshotOverlay.classList.remove('hidden');
		hideTrackMenus();

	}, 'image/png');
};

const runAudioIterator = async () => {
	if (!audioSink || !audioBufferIterator) return;
	const currentAsyncId = asyncId;

	try {
		for await (const {
			buffer,
			timestamp
		} of audioBufferIterator) {
			if (currentAsyncId !== asyncId) break;

			const node = audioContext.createBufferSource();
			node.buffer = buffer;
			node.connect(gainNode);
			node.playbackRate.value = currentPlaybackRate;

			const absolutePlayTime = audioContextStartTime + ((timestamp - playbackTimeAtStart) / currentPlaybackRate);

			if (absolutePlayTime >= audioContext.currentTime) {
				node.start(absolutePlayTime);
			} else {
				const offset = (audioContext.currentTime - absolutePlayTime) * currentPlaybackRate;
				if (offset < buffer.duration) {
					node.start(audioContext.currentTime, offset);
				}
			}

			queuedAudioNodes.add(node);
			node.onended = () => queuedAudioNodes.delete(node);

			if (timestamp - getPlaybackTime() >= 1.5) {
				while (playing && currentAsyncId === asyncId && (timestamp - getPlaybackTime() >= 0.5)) {
					await new Promise(r => setTimeout(r, 100));
				}
			}
		}
	} catch (e) {
		if (currentAsyncId === asyncId) console.error("Error during audio iteration:", e);
	}
};

const play = async () => {
	if (playing || !audioContext) return;
	if (audioContext.state === 'suspended') await audioContext.resume();

	if (totalDuration > 0 && Math.abs(getPlaybackTime() - totalDuration) < 0.1) {
		const time = isLooping ? loopStartTime : 0;
		playbackTimeAtStart = time;
		await seekToTime(time);
	}

	audioContextStartTime = audioContext.currentTime;
	playing = true;

    // Add these two lines to start the interval
    if (playbackLogicInterval) clearInterval(playbackLogicInterval);
	playbackLogicInterval = setInterval(checkPlaybackState, 100); // Check 10 times a second

	if (audioSink) {
		const currentAsyncId = asyncId;
		await audioBufferIterator?.return();
		if (currentAsyncId !== asyncId) return;

		const iteratorStartTime = getPlaybackTime();
		audioBufferIterator = audioSink.buffers(iteratorStartTime);
		runAudioIterator();
	}

	playBtn.textContent = '⏸';
	showControlsTemporarily();
};

const pause = () => {
	if (!playing) return;
	playbackTimeAtStart = getPlaybackTime();
	playing = false;
	asyncId++;

    // Add these two lines to stop the interval
    clearInterval(playbackLogicInterval);
    playbackLogicInterval = null;

	audioBufferIterator?.return().catch(() => { });
	audioBufferIterator = null;

	queuedAudioNodes.forEach(node => {
		try {
			node.stop();
		} catch (e) { }
	});
	queuedAudioNodes.clear();

	playBtn.textContent = '▶';
	videoContainer.classList.remove('hide-cursor');
	clearTimeout(hideControlsTimeout);
	videoControls.classList.add('show');
};

const togglePlay = () => playing ? pause() : play();

const seekToTime = async (seconds) => {
	const wasPlaying = playing;
	if (wasPlaying) pause();

	seconds = Math.max(0, Math.min(seconds, totalDuration));
	playbackTimeAtStart = seconds;
	updateProgressBarUI(seconds);
	updateTimeInputs(seconds);

	await startVideoIterator();

	if (wasPlaying && playbackTimeAtStart < totalDuration) {
		await play();
	}
};

const toggleLoop = () => {
	if (isLooping) {
		isLooping = false;
		loopBtn.textContent = 'Loop';
	} else {
		const start = parseTime(startTimeInput.value);
		const end = parseTime(endTimeInput.value);

		if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end > totalDuration) {
			showError("Invalid start or end time for looping.");
			return;
		}

		isLooping = true;
		loopStartTime = start;
		loopEndTime = end;
		loopBtn.textContent = 'Looping...';

		const currentTime = getPlaybackTime();
		if (currentTime < start || currentTime > end) {
			seekToTime(start);
		}

		if (!playing) {
			play();
		}
	}
};

const handleCutAction = async () => {
	if (!fileLoaded) return;
	if (playing) pause();

	const start = parseTime(startTimeInput.value);
	const end = parseTime(endTimeInput.value);

	if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end > totalDuration) {
		showError("Invalid start or end time for cutting.");
		return;
	}
	hideTrackMenus();
	showStatusMessage('Cutting clip...');
	let input;
	try {
		const source = (currentPlayingFile instanceof File) ?
			new BlobSource(currentPlayingFile) :
			new UrlSource(currentPlayingFile);

		input = new Input({
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
			input,
			output,
			trim: {
				start,
				end
			},
		});

		if (!conversion.isValid) {
			throw new Error('Could not create a valid conversion for cutting.');
		}
		await conversion.execute();

		const originalName = (currentPlayingFile.name || 'video').split('.').slice(0, -1).join('.');
		const clipName = `${originalName}_${formatTime(start)}-${formatTime(end)}.mp4`.replace(/:/g, '_');

		const cutClipFile = new File([output.target.buffer], clipName, {
			type: 'video/mp4'
		});

		playlist.push({
			type: 'file',
			name: clipName,
			file: cutClipFile,
			isCutClip: true
		});
		updatePlaylistUIOptimized();
		showStatusMessage('Clip added to playlist!');
		setTimeout(hideStatusMessage, 2000);

	} catch (error) {
		console.error("Error during cutting:", error);
		showError("Failed to cut the clip.");
		hideStatusMessage();
	} finally {
		if (input) input.dispose();
	}
};

const stopAndClear = async () => {
	if (playing) pause();
	fileLoaded = false;
	isLooping = false;
	loopBtn.textContent = 'Loop';
	currentPlaybackRate = 1.0;
	playbackSpeedInput.value = '1';
	asyncId++;

	try {
		await videoFrameIterator?.return();
	} catch (e) { }
	try {
		await audioBufferIterator?.return();
	} catch (e) { }

	nextFrame = null;
	videoSink = null;
	audioSink = null;
	subtitleRenderer = null;
	removeSubtitleOverlay();

	availableAudioTracks = [];
	availableSubtitleTracks = [];
	currentAudioTrack = null;
	currentSubtitleTrack = null;

	ctx.clearRect(0, 0, canvas.width, canvas.height);

	if (audioContext && audioContext.state === 'running') {
		await audioContext.suspend();
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
			if (!playlist.some(item => item.file === resource)) {
				playlist.push({
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

		currentPlayingFile = resource;
		totalDuration = await input.computeDuration();
		playbackTimeAtStart = 0;

		startTimeInput.value = formatTime(0);
		endTimeInput.value = formatTime(totalDuration);

		availableAudioTracks = audioTracks;
		const allTracks = await input.getTracks();
		availableSubtitleTracks = allTracks.filter(track => track.type === 'subtitle');

		currentAudioTrack = availableAudioTracks.length > 0 ? availableAudioTracks[0] : null;
		currentSubtitleTrack = null;

		if (!videoTrack && !currentAudioTrack) {
			throw new Error('No valid audio or video tracks found.');
		}

		if (!audioContext) {
			audioContext = new (window.AudioContext || window.webkitAudioContext)();
		}
		if (audioContext.state === 'suspended') await audioContext.resume();

		gainNode = audioContext.createGain();
		gainNode.connect(audioContext.destination);
		setVolume(volumeSlider.value);

		if (videoTrack) {
			videoSink = new CanvasSink(videoTrack, {
				poolSize: 2
			});
			canvas.width = videoTrack.displayWidth || videoTrack.codedWidth || 1280;
			canvas.height = videoTrack.displayHeight || videoTrack.codedHeight || 720;
		}

		if (currentAudioTrack) {
			audioSink = new AudioBufferSink(currentAudioTrack);
		}

		updateTrackMenus();
		updatePlaylistUIOptimized();
		fileLoaded = true;
		showPlayerUI();
		updateProgressBarUI(0);

		await startVideoIterator();
		await play();

	} catch (error) {
		showError(`Failed to load media: ${error.message}`);
		console.error('Error loading media:', error);
		if (input) input.dispose();
		currentPlayingFile = null;
		showDropZoneUI();
	} finally {
		showLoading(false);
	}
};

const updateTrackMenus = () => {
	const audioTrackList = $('audioTrackList');
	audioTrackList.innerHTML = '';

	availableAudioTracks.forEach((track, index) => {
		const li = document.createElement('li');
		li.className = `track-item ${track === currentAudioTrack ? 'active' : ''}`;
		const langCode = track.languageCode;
		const label = (langCode && langCode !== 'und') ? langCode : `Audio ${index + 1}`;
		li.innerHTML = `<span>${label}</span>`;
		li.onclick = () => switchAudioTrack(index);
		audioTrackList.appendChild(li);
	});

	const subtitleTrackList = $('subtitleTrackList');
	const noneOption = document.createElement('li');
	noneOption.className = `track-item ${!currentSubtitleTrack ? 'active' : ''}`;
	noneOption.innerHTML = `<span>Off</span>`;
	noneOption.onclick = () => switchSubtitleTrack('none');
	subtitleTrackList.innerHTML = '';
	subtitleTrackList.appendChild(noneOption);

	availableSubtitleTracks.forEach((track, index) => {
		const li = document.createElement('li');
		li.className = `track-item ${track === currentSubtitleTrack ? 'active' : ''}`;
		const langCode = track.languageCode;
		const label = (langCode && langCode !== 'und') ? langCode : `Subtitle ${index + 1}`;
		li.innerHTML = `<span>${label}</span>`;
		li.onclick = () => switchSubtitleTrack(index);
		subtitleTrackList.appendChild(li);
	});
};

const switchAudioTrack = async (trackIndex) => {
	if (!availableAudioTracks[trackIndex] || availableAudioTracks[trackIndex] === currentAudioTrack) return;

	showLoading(true);
	const wasPlaying = playing;
	if (wasPlaying) pause();

	currentAudioTrack = availableAudioTracks[trackIndex];

	try {
		if (await currentAudioTrack.canDecode()) {
			audioSink = new AudioBufferSink(currentAudioTrack);
		} else {
			showError("Selected audio track cannot be decoded.");
			audioSink = null;
		}
	} catch (e) {
		console.error("Error switching audio track:", e);
		audioSink = null;
	}

	updateTrackMenus();
	hideTrackMenus();
	showLoading(false);

	if (wasPlaying && playbackTimeAtStart < totalDuration) {
		await play();
	}
};

const switchSubtitleTrack = async (trackIndex) => {
	removeSubtitleOverlay();

	if (trackIndex === 'none') {
		currentSubtitleTrack = null;
		subtitleRenderer = null;
	} else if (availableSubtitleTracks[trackIndex] && availableSubtitleTracks[trackIndex] !== currentSubtitleTrack) {
		currentSubtitleTrack = availableSubtitleTracks[trackIndex];
		try {
			const Renderer = await ensureSubtitleRenderer();
			subtitleRenderer = new Renderer(currentSubtitleTrack);
		} catch (e) {
			console.error("Error initializing subtitle renderer:", e);
			showError("Failed to load subtitles.");
			currentSubtitleTrack = null;
			subtitleRenderer = null;
		}
	}

	updateTrackMenus();
	hideTrackMenus();
};

const removeSubtitleOverlay = () => {
	if (subtitleOverlayElement) {
		subtitleOverlayElement.textContent = '';
		subtitleOverlayElement.style.display = 'none';
	}
	lastSubtitleText = null;
};

// === PERFORMANCE OPTIMIZATION: Reuse subtitle overlay element ===
const updateSubtitlesOptimized = (currentTime) => {
	if (!subtitleRenderer) {
		if (subtitleOverlayElement && subtitleOverlayElement.style.display !== 'none') {
			removeSubtitleOverlay();
		}
		return;
	}

	try {
		const subtitle = subtitleRenderer.getSubtitleAt(currentTime);
		const newText = subtitle?.text || '';

		// Only update DOM if text changed
		if (newText !== lastSubtitleText) {
			if (!newText) {
				removeSubtitleOverlay();
			} else {
				if (!subtitleOverlayElement) {
					subtitleOverlayElement = document.createElement('div');
					subtitleOverlayElement.className = 'subtitle-overlay';
					videoContainer.appendChild(subtitleOverlayElement);
				}
				subtitleOverlayElement.textContent = newText;
				subtitleOverlayElement.style.display = 'block';
			}
			lastSubtitleText = newText;
		}
	} catch (e) {
		console.error("Error rendering subtitle:", e);
	}
};

const hideTrackMenus = () => {
	$('audioTrackMenu').classList.add('hidden');
	$('subtitleTrackMenu').classList.add('hidden');
	$('trimMenu').classList.add('hidden');
};

const playNext = () => {
	if (!currentPlayingFile || playlist.length <= 1) return;

	const flatten = (nodes) => {
		let flat = [];
		nodes.forEach(node => {
			if (node.type === 'file') flat.push(node);
			if (node.type === 'folder') flat = flat.concat(flatten(node.children));
		});
		return flat;
	};

	const flatList = flatten(playlist);
	const currentIndex = flatList.findIndex(item => item.file === currentPlayingFile);

	if (currentIndex !== -1 && currentIndex < flatList.length - 1) {
		loadMedia(flatList[currentIndex + 1].file);
	}
};

const playPrevious = () => {
    if (!currentPlayingFile || playlist.length <= 1) return;

    const flatten = (nodes) => {
        let flat = [];
        nodes.forEach(node => {
            if (node.type === 'file') flat.push(node);
            if (node.type === 'folder') flat = flat.concat(flatten(node.children));
        });
        return flat;
    };

    const flatList = flatten(playlist);
    const currentIndex = flatList.findIndex(item => item.file === currentPlayingFile);

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

const showLoading = show => loading.classList.toggle('hidden', !show);

const showError = msg => {
	if (document.querySelector('.error-message')) return;

	const el = document.createElement('div');
	el.className = 'error-message';
	el.textContent = msg;
	el.style.cssText = "position:fixed; top:20px; right:20px; background:rgba(200,0,0,0.8); color:white; padding:10px; border-radius:4px; z-index:10000;";
	document.body.appendChild(el);
	setTimeout(() => el.remove(), 4000);
};

const showPlayerUI = () => {
	dropZone.style.display = 'none';
	videoContainer.style.display = 'block';
};

const showDropZoneUI = () => {
	dropZone.style.display = 'flex';
	videoContainer.style.display = 'none';
	updateProgressBarUI(0);
	totalDuration = 0;
};

const updateTimeInputs = (time) => {
	const currentFocused = document.activeElement;
	if (currentFocused !== startTimeInput && currentFocused !== endTimeInput) {
		// Optionally update inputs here if needed
	}
};

const updateProgressBarUI = (time) => {
	const displayTime = Math.max(0, Math.min(time, totalDuration));
	timeDisplay.textContent = `${formatTime(displayTime)} / ${formatTime(totalDuration)}`;
	const percent = totalDuration > 0 ? (displayTime / totalDuration) * 100 : 0;
	progressBar.style.width = `${percent}%`;
	progressHandle.style.left = `${percent}%`;

	if (playing) updateTimeInputs(time);
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
	playlist = mergeTrees(playlist, newTree);
	updatePlaylistUIOptimized();

	if (!fileLoaded && fileEntries.length > 0) {
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
		playlist = mergeTrees(playlist, newTree);
		updatePlaylistUIOptimized();
		if (!fileLoaded) loadMedia(fileEntries[0].file);
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
	playlist = [];
	playlistElementCache.clear();
	lastRenderedPlaylist = null;
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
		const isActive = (currentPlayingFile === node.file);
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
	if (playlist.length === 0) {
		playlistContent.innerHTML = '<p style="padding:1rem; opacity:0.7; text-align:center;">No files.</p>';
		playlistElementCache.clear();
		lastRenderedPlaylist = null;
		showDropZoneUI();
		return;
	}

	// Check if we need a full rebuild
	const playlistChanged = JSON.stringify(playlist) !== lastRenderedPlaylist;

	if (!playlistChanged) {
		// Just update active states
		updateActiveStates();
		return;
	}

	// Full rebuild needed
	const fragment = document.createDocumentFragment();
	const ul = document.createElement('ul');
	ul.className = 'playlist-tree';

	playlist.forEach(node => {
		ul.appendChild(createPlaylistElement(node));
	});

	fragment.appendChild(ul);
	playlistContent.innerHTML = '';
	playlistContent.appendChild(fragment);

	lastRenderedPlaylist = JSON.stringify(playlist);
};

// === PERFORMANCE OPTIMIZATION: Update only active states ===
const updateActiveStates = () => {
	const allFiles = playlistContent.querySelectorAll('.playlist-file');
	allFiles.forEach(fileEl => {
		const path = fileEl.dataset.path;
		const file = findFileByPath(playlist, path);
		const isActive = (file === currentPlayingFile);
		fileEl.classList.toggle('active', isActive);
	});
};

const setVolume = val => {
	const vol = parseFloat(val);
	if (gainNode) gainNode.gain.value = vol * vol;
	muteBtn.textContent = vol > 0 ? '🔊' : '🔇';
};

const showControlsTemporarily = () => {
	clearTimeout(hideControlsTimeout);
	videoControls.classList.add('show');
	videoContainer.classList.remove('hide-cursor');

	if (playing) {
		hideControlsTimeout = setTimeout(() => {
			if (playing && !isSeeking && !videoControls.matches(':hover') && !document.querySelector('.control-group:hover')) {
				videoControls.classList.remove('show');
				videoContainer.classList.add('hide-cursor');
				hideTrackMenus();
			}
		}, 3000);
	}
};

const setPlaybackSpeed = (newSpeed) => {
	if (!playing) {
		currentPlaybackRate = newSpeed;
		return;
	}

	if (newSpeed === currentPlaybackRate) {
		return;
	}

	const currentTime = getPlaybackTime();

	asyncId++;
	audioBufferIterator?.return().catch(() => { });
	queuedAudioNodes.forEach(node => {
		try {
			node.stop();
		} catch (e) { }
	});
	queuedAudioNodes.clear();

	currentPlaybackRate = newSpeed;

	playbackTimeAtStart = currentTime;
	audioContextStartTime = audioContext.currentTime;

	if (audioSink) {
		audioBufferIterator = audioSink.buffers(currentTime);
		runAudioIterator();
	}

	startVideoIterator();
};

const setupEventListeners = () => {
	$('addFileBtn').onclick = () => $('fileInput').click();
	$('addFolderBtn').onclick = () => $('folderInput').click();
	$('clearPlaylistBtn').onclick = clearPlaylist;
	$('chooseFileBtn').onclick = () => {
		fileLoaded = false;
		$('fileInput').click();
	};
	$('openFileBtn').onclick = () => {
		fileLoaded = false;
		$('fileInput').click();
	};
	$('togglePlaylistBtn').onclick = () => playerArea.classList.toggle('playlist-visible');

	$('fileInput').onclick = (e) => e.target.value = null;
	$('fileInput').onchange = (e) => handleFiles(e.target.files);

	$('folderInput').onclick = (e) => e.target.value = null;
	$('folderInput').onchange = handleFolderSelection;

	playBtn.onclick = (e) => {
		e.stopPropagation();
		togglePlay();
	};
	prevBtn.onclick = (e) => {
		e.stopPropagation();
		playPrevious();
	};

	nextBtn.onclick = (e) => {
		e.stopPropagation();
		playNext();
	};
	muteBtn.onclick = (e) => {
		e.stopPropagation();
		if (parseFloat(volumeSlider.value) > 0) {
			volumeSlider.dataset.lastVolume = volumeSlider.value;
			volumeSlider.value = 0;
		} else {
			volumeSlider.value = volumeSlider.dataset.lastVolume || 1;
		}
		setVolume(volumeSlider.value);
	};

	$('audioTrackBtn').onclick = (e) => {
		e.stopPropagation();
		const menu = $('audioTrackMenu');
		const isHidden = menu.classList.contains('hidden');
		hideTrackMenus();
		if (isHidden) menu.classList.remove('hidden');
	};

	$('subtitleTrackBtn').onclick = (e) => {
		e.stopPropagation();
		const menu = $('subtitleTrackMenu');
		const isHidden = menu.classList.contains('hidden');
		hideTrackMenus();
		if (isHidden) menu.classList.remove('hidden');
	};

	// === PERFORMANCE OPTIMIZATION: Event delegation for playlist ===
	document.addEventListener('click', (e) => {
		if (!e.target.closest('.track-menu') && !e.target.closest('.track-controls')) {
			hideTrackMenus();
		}
	});

	volumeSlider.onclick = (e) => e.stopPropagation();
	volumeSlider.oninput = (e) => setVolume(e.target.value);

	fullscreenBtn.onclick = (e) => {
		e.stopPropagation();
		if (document.fullscreenElement) document.exitFullscreen();
		else if (videoContainer.requestFullscreen) videoContainer.requestFullscreen();
	};

	const handleSeekLine = (e) => {
		const rect = progressContainer.getBoundingClientRect();
		const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		return percent * totalDuration;
	};

	progressContainer.onpointerdown = (e) => {
		if (!fileLoaded) return;
		e.preventDefault();
		isSeeking = true;
		progressContainer.setPointerCapture(e.pointerId);
		const seekTime = handleSeekLine(e);
		updateProgressBarUI(seekTime);
		updateTimeInputs(seekTime);
	};

	progressContainer.onpointermove = (e) => {
		if (!isSeeking) {
			showControlsTemporarily();
			return;
		}
		const seekTime = handleSeekLine(e);
		updateProgressBarUI(seekTime);
		updateTimeInputs(seekTime);
	};

	progressContainer.onpointerup = (e) => {
		if (!isSeeking) return;
		isSeeking = false;
		progressContainer.releasePointerCapture(e.pointerId);

		const finalSeekTime = handleSeekLine(e);
		if (isLooping && (finalSeekTime < loopStartTime || finalSeekTime > loopEndTime)) {
			isLooping = false;
			loopBtn.textContent = 'Loop';
		}
		seekToTime(finalSeekTime);
	};

	const ddEvents = ['dragenter', 'dragover', 'dragleave', 'drop'];
	ddEvents.forEach(name => document.body.addEventListener(name, p => p.preventDefault()));

	dropZone.ondragenter = () => dropZone.classList.add('dragover');
	dropZone.ondragover = () => dropZone.classList.add('dragover');
	dropZone.ondragleave = (e) => {
		if (e.target === dropZone) dropZone.classList.remove('dragover');
	};
	dropZone.ondrop = (e) => {
		dropZone.classList.remove('dragover');
		handleFiles(e.dataTransfer.files);
	};

	// === PERFORMANCE OPTIMIZATION: Event delegation for playlist clicks ===
	playlistContent.addEventListener('click', (e) => {
		const removeButton = e.target.closest('.remove-item');
		if (removeButton) {
			e.stopPropagation();
			const pathToRemove = removeButton.dataset.path;
			const fileToRemove = findFileByPath(playlist, pathToRemove);

			let isPlayingFile = false;
			if (fileToRemove && currentPlayingFile) {
				isPlayingFile = (fileToRemove instanceof File && currentPlayingFile instanceof File) ?
					fileToRemove === currentPlayingFile :
					fileToRemove === currentPlayingFile;
			}

			removeItemFromPath(playlist, pathToRemove);
			updatePlaylistUIOptimized();

			if (isPlayingFile) {
				stopAndClear();
				currentPlayingFile = null;
				showDropZoneUI();
			}
			return;
		}

		const actionButton = e.target.closest('.clip-action-btn');
		if (actionButton) {
			e.stopPropagation();
			const path = actionButton.dataset.path;
			const blob = findFileByPath(playlist, path);
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
			const fileToPlay = findFileByPath(playlist, path);
			if (fileToPlay && fileToPlay !== currentPlayingFile) {
				loadMedia(fileToPlay);
			}
		}
	});

	document.onkeydown = (e) => {
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || !fileLoaded) return;
		const actions = {
			'Space': () => togglePlay(),
			'KeyK': () => togglePlay(),
			'KeyF': () => fullscreenBtn.click(),
			'KeyM': () => muteBtn.click(),
			'ArrowLeft': () => seekToTime(getPlaybackTime() - 5),
			'ArrowRight': () => seekToTime(getPlaybackTime() + 5),
			'ArrowUp': () => {
				volumeSlider.value = Math.min(1, parseFloat(volumeSlider.value) + 0.1);
				setVolume(volumeSlider.value);
			},
			'ArrowDown': () => {
				volumeSlider.value = Math.max(0, parseFloat(volumeSlider.value) - 0.1);
				setVolume(volumeSlider.value);
			}
		};
		if (actions[e.code]) {
			e.preventDefault();
			actions[e.code]();
			showControlsTemporarily();
		}
	};

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible' && playing && fileLoaded) {
			const now = getPlaybackTime();
			const videoTime = nextFrame ? nextFrame.timestamp : now;

			if (now - videoTime > 0.25) {
				startVideoIterator();
			}
		}
	});

	canvas.onclick = () => {
		if (audioContext && audioContext.state === 'suspended') audioContext.resume();
		togglePlay();
	};

	videoContainer.onpointermove = showControlsTemporarily;
	videoContainer.onmouseleave = () => {
		if (playing && !isSeeking) {
			videoControls.classList.remove('show');
			hideTrackMenus();
		}
	};

	trimMenuBtn.onclick = (e) => {
		e.stopPropagation();
		const isHidden = trimMenu.classList.contains('hidden');
		hideTrackMenus();
		if (isHidden) {
			trimMenu.classList.remove('hidden');
		}
	};

	loopBtn.onclick = toggleLoop;
	cutBtn.onclick = handleCutAction;
	screenshotBtn.onclick = takeScreenshot;

	const closeScreenshotModal = () => {
		screenshotOverlay.classList.add('hidden');
		if (screenshotPreviewImg.src && screenshotPreviewImg.src.startsWith('blob:')) {
			URL.revokeObjectURL(screenshotPreviewImg.src);
		}
		currentScreenshotBlob = null;
	};

	closeScreenshotBtn.onclick = closeScreenshotModal;
	screenshotOverlay.onclick = (e) => {
		if (e.target === screenshotOverlay) {
			closeScreenshotModal();
		}
	};

	downloadScreenshotBtn.onclick = () => {
		if (!currentScreenshotBlob) return;

		const timestamp = formatTime(getPlaybackTime()).replace(/:/g, '-');
		const originalName = (currentPlayingFile.name || 'video').split('.').slice(0, -1).join('.');
		const filename = `${originalName}_${timestamp}.png`;

		const a = document.createElement('a');
		a.href = screenshotPreviewImg.src;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	};

	copyScreenshotBtn.onclick = () => {
		if (!currentScreenshotBlob) return;

		navigator.clipboard.write([
			new ClipboardItem({
				'image/png': currentScreenshotBlob
			})
		]).then(() => {
			showError("Screenshot copied to clipboard!");
		}).catch(err => {
			console.error("Copy failed:", err);
			showError("Copy failed. Your browser may not support this feature.");
		});
	};

	playbackSpeedInput.oninput = () => {
		let speed = parseFloat(playbackSpeedInput.value);
		if (isNaN(speed)) speed = 1;
		if (!isNaN(speed) && speed >= 0.25 && speed <= 4) {
			setPlaybackSpeed(speed);
		}
	};

	autoplayToggle.onchange = () => {
		isAutoplayEnabled = autoplayToggle.checked;
	};
};

document.addEventListener('DOMContentLoaded', () => {
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
});
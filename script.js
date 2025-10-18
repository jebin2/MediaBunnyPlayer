import {
	Input,
	ALL_FORMATS,
	BlobSource,
	UrlSource,
	AudioBufferSink,
	CanvasSink,
	// --- ADDED FOR CONVERSION ---
	Conversion,
	Output,
	Mp4OutputFormat,
	// --- CHANGED FOR CUTTING ---
	BufferTarget
	// --- END CHANGED ---
	//} from 'https://cdn.skypack.dev/mediabunny@latest';
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.23.0/+esm';


// Define source URL for dynamic imports to keep versions consistent
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
// === NEW: Get references to new trim controls ===
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
let currentScreenshotBlob = null; // To hold the image data for copy/download
const playbackSpeedInput = $('playbackSpeedInput');
let currentPlaybackRate = 1.0;
const autoplayToggle = $('autoplayToggle');
let isAutoplayEnabled = true; // Default to ON
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

// === NEW: State for looping ===
let isLooping = false;
let loopStartTime = 0;
let loopEndTime = 0;


// Optimization: Cache SubtitleRenderer constructor
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

// --- Helper functions for conversion status messages ---
const showStatusMessage = (msg) => {
	const statusEl = $('statusMessage');
	if (statusEl) {
		statusEl.textContent = msg;
		statusEl.style.display = 'block';
	}
	showLoading(true); // Also show the main spinner
};

const hideStatusMessage = () => {
	const statusEl = $('statusMessage');
	if (statusEl) {
		statusEl.textContent = '';
		statusEl.style.display = 'none';
	}
	showLoading(false);
};

// --- Conversion handling function ---
const handleConversion = async (source, fileName) => {
	showStatusMessage('Unsupported format. Converting to MP4...');
	let conversionInput;
	try {
		// Create a new input instance specifically for the conversion process
		conversionInput = new Input({
			source,
			formats: ALL_FORMATS
		});

		// Setup the output to write to an in-memory blob
		// === CHANGED TO BufferTarget for simplicity ===
		const output = new Output({
			format: new Mp4OutputFormat({
				fastStart: 'in-memory'
			}),
			target: new BufferTarget(),
		});


		// Initialize the conversion
		const conversion = await Conversion.init({
			input: conversionInput,
			output
		});

		if (!conversion.isValid) {
			console.error('Conversion is not valid. Discarded tracks:', conversion.discardedTracks);
			// --- IMPROVED ERROR ---
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

		// Show conversion progress
		conversion.onProgress = (progress) => {
			showStatusMessage(`Converting to MP4... (${Math.round(progress * 100)}%)`);
		};

		await conversion.execute();
		showStatusMessage('Conversion complete. Loading video...');

		// Create a new File object from the resulting data
		const blob = new Blob([output.target.buffer], {
			type: 'video/mp4'
		});
		const convertedFile = new File(
			[blob],
			(fileName.split('.').slice(0, -1).join('.') || 'converted') + '.mp4', {
				type: 'video/mp4'
			}
		);

		// Load the newly created file, marking it as a conversion result
		await loadMedia(convertedFile, true);

	} catch (error) {
		// --- IMPROVED ERROR ---
		showError(`Conversion Failed: This file format appears to be incompatible with the in-browser converter. (${error.message})`);
		console.error('Conversion error:', error);
		showDropZoneUI();
	} finally {
		if (conversionInput) conversionInput.dispose();
		hideStatusMessage();
	}
};

// --- Core Player Logic ---
const getPlaybackTime = () => {
    if (!playing) {
        return playbackTimeAtStart;
    }
    // The elapsed real time is multiplied by the playback rate to get the media time
    const elapsedTime = audioContext.currentTime - audioContextStartTime;
    return playbackTimeAtStart + (elapsedTime * currentPlaybackRate);
};

const startVideoIterator = async () => {
	if (!videoSink) return;
	// This function should not cancel other processes like the audio loop.
	// It uses the *current* asyncId to ensure its own operations are valid.
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

const renderLoop = () => {
	if (fileLoaded) {
		const currentTime = getPlaybackTime();

		// === NEW: Handle looping ===
		if (playing && isLooping && currentTime >= loopEndTime) {
			seekToTime(loopStartTime);
			// Skip the rest of this frame's logic to avoid issues after seeking
			requestAnimationFrame(renderLoop);
			return;
		}

		if (playing) {
			if (currentTime >= totalDuration && totalDuration > 0 && !isLooping && isAutoplayEnabled) {
				pause();
				playbackTimeAtStart = totalDuration;
				updateProgressBarUI(totalDuration);
				playNext();
			} else if (currentTime >= totalDuration && totalDuration > 0 && !isLooping && !isAutoplayEnabled) {
				// If autoplay is off, just pause at the end
				pause();
				playbackTimeAtStart = totalDuration;
				updateProgressBarUI(totalDuration);
			} else if (nextFrame && nextFrame.timestamp <= currentTime) {
				ctx.drawImage(nextFrame.canvas, 0, 0, canvas.width, canvas.height);
				nextFrame = null;
				updateNextFrame();
			}
		}
		updateSubtitles(currentTime);
		if (!isSeeking) updateProgressBarUI(currentTime);
	}
	requestAnimationFrame(renderLoop);
};
// === NEW: Function to handle taking and showing a screenshot ===
const takeScreenshot = () => {
    if (!fileLoaded || !canvas) {
        showError("Cannot take screenshot: No video loaded.");
        return;
    }

    // Use canvas.toBlob for better performance and compatibility with Clipboard API
    canvas.toBlob((blob) => {
        if (!blob) {
            showError("Failed to create screenshot.");
            return;
        }

        currentScreenshotBlob = blob;

        // Revoke the previous object URL if it exists, to prevent memory leaks
        if (screenshotPreviewImg.src) {
            URL.revokeObjectURL(screenshotPreviewImg.src);
        }

        const imageUrl = URL.createObjectURL(blob);
        screenshotPreviewImg.src = imageUrl;
        screenshotOverlay.classList.remove('hidden');
        hideTrackMenus(); // Close the config menu

    }, 'image/png'); // You can change to 'image/jpeg' if preferred
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

	audioBufferIterator?.return().catch(() => {});
	audioBufferIterator = null;

	queuedAudioNodes.forEach(node => {
		try {
			node.stop();
		} catch (e) {}
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
	updateTimeInputs(seconds); // === NEW: Update inputs on seek

	await startVideoIterator();

	if (wasPlaying && playbackTimeAtStart < totalDuration) {
		await play();
	}
};

const toggleLoop = () => {
    if (isLooping) {
        // Logic to turn looping OFF
        isLooping = false;
        loopBtn.textContent = 'Loop';
    } else {
        // Logic to turn looping ON
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

        // If currently outside the loop range, jump to the start
        const currentTime = getPlaybackTime();
        if (currentTime < start || currentTime > end) {
            seekToTime(start);
        }

        // === ADDED LOGIC FOR PAUSED STATE ===
        // If the video is not already playing, start it.
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
    hideTrackMenus(); // Close the menu after cutting
    showStatusMessage('Cutting clip...');
    let input;
    try {
        const source = (currentPlayingFile instanceof File) 
            ? new BlobSource(currentPlayingFile) 
            : new UrlSource(currentPlayingFile);

        input = new Input({ source, formats: ALL_FORMATS });

        const output = new Output({
            format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
            target: new BufferTarget(),
        });

        const conversion = await Conversion.init({
            input,
            output,
            trim: { start, end },
        });

        if (!conversion.isValid) {
            throw new Error('Could not create a valid conversion for cutting.');
        }
        await conversion.execute();

        const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
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
        updatePlaylistUI();
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
	isLooping = false; // === Reset looping state
    loopBtn.textContent = 'Loop'; // === Reset button text
    currentPlaybackRate = 1.0;
    playbackSpeedInput.value = '1';
	asyncId++;

	try {
		await videoFrameIterator?.return();
	} catch (e) {}
	try {
		await audioBufferIterator?.return();
	} catch (e) {}

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

		// === NEW: Reset and set default trim times
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
			audioContext = new(window.AudioContext || window.webkitAudioContext)();
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
		updatePlaylistUI();
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
	const existingOverlay = document.querySelector('.subtitle-overlay');
	if (existingOverlay) existingOverlay.remove();
};

const updateSubtitles = (currentTime) => {
	removeSubtitleOverlay();
	if (!subtitleRenderer) return;

	try {
		const subtitle = subtitleRenderer.getSubtitleAt(currentTime);
		if (subtitle && subtitle.text) {
			const overlay = document.createElement('div');
			overlay.className = 'subtitle-overlay';
			overlay.textContent = subtitle.text;
			videoContainer.appendChild(overlay);
		}
	} catch (e) {
		console.error("Error rendering subtitle:", e);
	}
};

const hideTrackMenus = () => {
	$('audioTrackMenu').classList.add('hidden');
	$('subtitleTrackMenu').classList.add('hidden');
	$('trimMenu').classList.add('hidden'); // === ADD THIS LINE ===
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
	
	// Find the current index using a direct reference check. This works for
	// File objects, Blobs, and URL strings. It's the most reliable way.
	const currentIndex = flatList.findIndex(item => item.file === currentPlayingFile);

	// If the item was found and it's not the last one in the list...
	if (currentIndex !== -1 && currentIndex < flatList.length - 1) {
		// ...play the very next item.
		loadMedia(flatList[currentIndex + 1].file);
	}
};

// === NEW: Helper to parse time string (e.g., "01:23") into seconds ===
const parseTime = (timeStr) => {
	const parts = timeStr.split(':').map(Number);
	if (parts.some(isNaN)) return NaN;
	let seconds = 0;
	if (parts.length === 2) { // MM:SS
		seconds = parts[0] * 60 + parts[1];
	} else if (parts.length === 1) { // SS
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

// === NEW: Function to update time inputs based on current playback time ===
const updateTimeInputs = (time) => {
	const currentFocused = document.activeElement;
	if (currentFocused !== startTimeInput && currentFocused !== endTimeInput) {
		// startTimeInput.value = formatTime(time);
	}
};

const updateProgressBarUI = (time) => {
	const displayTime = Math.max(0, Math.min(time, totalDuration));
	timeDisplay.textContent = `${formatTime(displayTime)} / ${formatTime(totalDuration)}`;
	const percent = totalDuration > 0 ? (displayTime / totalDuration) * 100 : 0;
	progressBar.style.width = `${percent}%`;
	progressHandle.style.left = `${percent}%`;

	// === NEW: Update time inputs while playing
	if (playing) updateTimeInputs(time);
};

// --- Playlist Utility Functions ---
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
	updatePlaylistUI();

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
		updatePlaylistUI();
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
	updatePlaylistUI();
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
	} [tag]));

const renderTree = (nodes, currentPath = '') => {
	let html = '<ul class="playlist-tree">';
	nodes.forEach(node => {
		const safeName = escapeHTML(node.name);
		const nodePath = currentPath ? `${currentPath}/${node.name}` : node.name;
		const safePath = escapeHTML(nodePath);

		if (node.type === 'folder') {
			html += `<li class="playlist-folder">
                        <details open>
                            <summary>
                                <span class="playlist-folder-name" title="${safeName}">${safeName}</span>
                                <span class="remove-item" data-path="${safePath}">&times;</span>
                            </summary>
                            ${renderTree(node.children, nodePath)}
                        </details>
                    </li>`;
		} else {
			const isActive = (currentPlayingFile === node.file);
			// === NEW: Handle rendering for cut clips
			if (node.isCutClip) {
				html += `<li class="playlist-file cut-clip ${isActive ? 'active' : ''}" data-path="${safePath}" title="${safeName}">
                            <span class="playlist-file-name">${safeName}</span>
                            <div class="clip-actions">
                                <button class="clip-action-btn" data-action="download" data-path="${safePath}">📥</button>
                                <button class="clip-action-btn" data-action="copy" data-path="${safePath}">📋</button>
                            </div>
                            <span class="remove-item" data-path="${safePath}">&times;</span>
                        </li>`;
			} else {
				html += `<li class="playlist-file ${isActive ? 'active' : ''}" data-path="${safePath}" title="${safeName}">
                            <span class="playlist-file-name" title="${safeName}">${safeName}</span>
                            <span class="remove-item" data-path="${safePath}">&times;</span>
                        </li>`;
			}
		}
	});
	html += '</ul>';
	return html;
};


const updatePlaylistUI = () => {
	if (playlist.length === 0) {
		playlistContent.innerHTML = '<p style="padding:1rem; opacity:0.7; text-align:center;">No files.</p>';
		showDropZoneUI();
		return;
	}
	playlistContent.innerHTML = renderTree(playlist);
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

// === REVISED HIGH-PERFORMANCE FUNCTION ===
const setPlaybackSpeed = (newSpeed) => {
    // If paused, just set the rate. It will be picked up when play is pressed.
    if (!playing) {
        currentPlaybackRate = newSpeed;
        return;
    }
    
    // If playing but the speed is unchanged, do nothing.
    if (newSpeed === currentPlaybackRate) {
        return;
    }

    // --- Start the live update process ---

    // 1. Get the current media time BEFORE changing the rate.
    const currentTime = getPlaybackTime();

    // 2. Stop and clear the current audio pipeline.
    asyncId++; // Invalidate any ongoing audio fetching loops
    audioBufferIterator?.return().catch(() => {}); // Gracefully stop the iterator
    queuedAudioNodes.forEach(node => {
        try { node.stop(); } catch (e) {}
    });
    queuedAudioNodes.clear();

    // 3. Apply the new speed.
    currentPlaybackRate = newSpeed;

    // 4. Recalibrate the timing anchors for a seamless transition.
    playbackTimeAtStart = currentTime;
    audioContextStartTime = audioContext.currentTime;

    // 5. Restart the audio pipeline from the current time.
    if (audioSink) {
        audioBufferIterator = audioSink.buffers(currentTime);
        runAudioIterator();
    }

    // 6. === THIS IS THE NEW, CRUCIAL STEP ===
    // Restart the video pipeline from the current time as well.
    // This forces it to discard any buffered frames and immediately seek to the correct one.
    startVideoIterator();
};

const setupEventListeners = () => {
	$('addFileBtn').onclick = () => $('fileInput').click();
	$('addFolderBtn').onclick = () => $('folderInput').click();
	$('clearPlaylistBtn').onclick = clearPlaylist;
	$('chooseFileBtn').onclick = () => {
		fileLoaded = false
		$('fileInput').click();
	}
	$('openFileBtn').onclick = () => {
		fileLoaded = false
		$('fileInput').click();
	}
	$('togglePlaylistBtn').onclick = () => playerArea.classList.toggle('playlist-visible');

	$('fileInput').onclick = (e) => e.target.value = null;
	$('fileInput').onchange = (e) => handleFiles(e.target.files);

	$('folderInput').onclick = (e) => e.target.value = null;
	$('folderInput').onchange = handleFolderSelection;

	playBtn.onclick = (e) => {
		e.stopPropagation();
		togglePlay();
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

	document.addEventListener('click', (e) => {
		// If the click is NOT inside a menu AND also NOT on one of the control buttons that opens a menu...
		if (!e.target.closest('.track-menu') && !e.target.closest('.track-controls')) {
			// ...then hide all the menus.
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
		updateTimeInputs(seekTime); // === NEW: Update on seek start
	};

	progressContainer.onpointermove = (e) => {
		if (!isSeeking) {
			showControlsTemporarily();
			return;
		}
		const seekTime = handleSeekLine(e);
		updateProgressBarUI(seekTime);
		updateTimeInputs(seekTime); // === NEW: Update on seek move
	};


	progressContainer.onpointerup = (e) => {
		if (!isSeeking) return;
		isSeeking = false;
		progressContainer.releasePointerCapture(e.pointerId);
    
		const finalSeekTime = handleSeekLine(e);
		if (isLooping && (finalSeekTime < loopStartTime || finalSeekTime > loopEndTime)) {
			isLooping = false;
			loopBtn.textContent = 'Loop';
			console.log("Loop disabled due to manual seek outside range.");
		}
		seekToTime(handleSeekLine(e));
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

	playlistContent.onclick = (e) => {
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
			updatePlaylistUI();

			if (isPlayingFile) {
				stopAndClear();
				currentPlayingFile = null;
				showDropZoneUI();
			}
			return;
		}

		// === NEW: Handle cut clip actions ===
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
						showError('Clip copied to clipboard!'); // Using showError for quick feedback
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
				loadMedia(fileToPlay); // This will now work for Blobs (cut clips) too
			}
		}
	};

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
				console.log(`Resyncing video from ${videoTime.toFixed(2)}s to ${now.toFixed(2)}s.`);
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
		hideTrackMenus(); // Close all other menus first
		if (isHidden) {
			trimMenu.classList.remove('hidden');
		}
	};
    
    loopBtn.onclick = toggleLoop;
    cutBtn.onclick = handleCutAction;
    screenshotBtn.onclick = takeScreenshot;

    const closeScreenshotModal = () => {
        screenshotOverlay.classList.add('hidden');
        // Clean up the created object URL to free memory
        if (screenshotPreviewImg.src) {
            URL.revokeObjectURL(screenshotPreviewImg.src);
        }
        currentScreenshotBlob = null;
    };

    closeScreenshotBtn.onclick = closeScreenshotModal;
    screenshotOverlay.onclick = (e) => {
        // Close modal only if the dark overlay background is clicked
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
        a.href = screenshotPreviewImg.src; // Use the existing Object URL
        a.download = filename;
        document.body.appendChild(a); // Required for Firefox
        a.click();
        document.body.removeChild(a);
    };

    copyScreenshotBtn.onclick = () => {
        if (!currentScreenshotBlob) return;

        navigator.clipboard.write([
            new ClipboardItem({ 'image/png': currentScreenshotBlob })
        ]).then(() => {
            showError("Screenshot copied to clipboard!"); // Use showError for quick feedback
        }).catch(err => {
            console.error("Copy failed:", err);
            showError("Copy failed. Your browser may not support this feature.");
        });
    };
    playbackSpeedInput.oninput = () => {
        const speed = parseFloat(playbackSpeedInput.value);
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

	updatePlaylistUI();

	if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
		navigator.serviceWorker.register('service-worker.js')
			.catch(err => console.log('ServiceWorker registration failed:', err));
	}
});
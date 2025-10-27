// ============================================================================
// CORE PLAYER STATE & INITIALIZATION
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
	BufferTarget
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.2/+esm';

import { $, MEDIABUNNY_URL, videoContainer, canvas, playBtn, volumeSlider, muteBtn, videoControls, startTimeInput, endTimeInput, loopBtn, playbackSpeedInput, cropCanvas, queuedAudioNodes, ctx, fullscreenBtn } from './constants.js';
import { state } from './state.js';
import { formatTime, parseTime, } from './utility.js'
import { hideStatusMessage, showControlsTemporarily, showDropZoneUI, showError, showLoading, showPlayerUI, showStatusMessage, updateProgressBarUI, updateTimeInputs } from './ui.js'

export const setupPlayerListener = () => {
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
	muteBtn.onclick = async (e) => {
		e.stopPropagation();

		// Determine if we need to initialize the audio for the first time.
		const isAudioUninitialized = !state.audioContext || state.audioContext.state === 'suspended';

		// First, handle the user's immediate intent: toggling the volume.
		const isCurrentlyMuted = parseFloat(volumeSlider.value) === 0;
		if (isCurrentlyMuted) {
			// Unmuting
			volumeSlider.value = volumeSlider.dataset.lastVolume || 1;
		} else {
			// Muting
			volumeSlider.dataset.lastVolume = volumeSlider.value;
			volumeSlider.value = 0;
		}
		setVolume(volumeSlider.value); // Apply the volume change to the UI/gain node

		// NOW, if we just unmuted and audio has never been started,
		// perform the seamless re-sync.
		if (isCurrentlyMuted && isAudioUninitialized) {
			const wasPlaying = state.playing;
			if (wasPlaying) pause(); // Capture the current time accurately

			// The play() function will now create the AudioContext and start all
			// iterators from the time we just captured.
			await play();
		}
	};
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
		return percent * state.totalDuration;
	};

	progressContainer.onpointerdown = (e) => {
		if (!state.fileLoaded) return;
		e.preventDefault();
		state.isSeeking = true;
		progressContainer.setPointerCapture(e.pointerId);
		const seekTime = handleSeekLine(e);
		updateProgressBarUI(seekTime);
		updateTimeInputs(seekTime);
	};

	progressContainer.onpointermove = (e) => {
		if (!state.isSeeking) {
			showControlsTemporarily();
			return;
		}
		const seekTime = handleSeekLine(e);
		updateProgressBarUI(seekTime);
		updateTimeInputs(seekTime);
	};

	progressContainer.onpointerup = (e) => {
		if (!state.isSeeking) return;
		state.isSeeking = false;
		progressContainer.releasePointerCapture(e.pointerId);

		const finalSeekTime = handleSeekLine(e);
		if (state.isLooping && (finalSeekTime < state.loopStartTime || finalSeekTime > state.loopEndTime)) {
			state.isLooping = false;
			loopBtn.textContent = 'Loop';
		}
		seekToTime(finalSeekTime);
	};
	document.onkeydown = (e) => {
		const actions = {
			'Space': () => togglePlay()
		};
		if (actions[e.code]) {
			e.preventDefault();
			actions[e.code]();
			showControlsTemporarily();
		}
	};
	canvas.onclick = () => {
		if (state.audioContext && state.audioContext.state === 'suspended') state.audioContext.resume();
		togglePlay();
	};
	videoContainer.onpointermove = showControlsTemporarily;
	videoContainer.onmouseleave = () => {
		if (state.playing && !state.isSeeking) {
			videoControls.classList.remove('show');
			hideTrackMenus();
		}
	};
}

/**
 * Allows other modules to register a function to be called on every frame.
 * @param {Function} callback - The function to call during the render loop.
 */
export const registerOnFrameRender = (callback) => {
	if (typeof callback === 'function' && !state.onFrameRenderCallbacks.includes(callback)) {
		state.onFrameRenderCallbacks.push(callback);
	}
};

/**
 * Removes a previously registered render loop callback.
 * @param {Function} callback - The function to remove.
 */
export const unregisterOnFrameRender = (callback) => {
	state.onFrameRenderCallbacks = state.onFrameRenderCallbacks.filter(cb => cb !== callback);
};

export const getPlaybackTime = () => {
	if (!state.playing) {
		return state.playbackTimeAtStart;
	}

	let elapsedTime;
	// If the AudioContext has been created, use its highly accurate timer.
	if (state.audioContext) {
		elapsedTime = state.audioContext.currentTime - state.audioContextStartTime;
	} else {
		// FALLBACK: Before user interaction, use performance.now() for silent playback timing.
		// We need to initialize state.playbackWallClockStartTime for this to work.
		const wallClockTime = state.playbackWallClockStartTime || 0;
		elapsedTime = (performance.now() - wallClockTime) / 1000.0; // Convert milliseconds to seconds
	}
	return state.playbackTimeAtStart + (elapsedTime * state.currentPlaybackRate);
};

export const startVideoIterator = async () => {
	if (!state.videoSink) return;
	const currentAsyncId = state.asyncId;

	try {
		await state.videoFrameIterator?.return();
		state.videoFrameIterator = state.videoSink.canvases(getPlaybackTime());

		const firstResult = await state.videoFrameIterator.next();
		if (currentAsyncId !== state.asyncId) return;

		const firstFrame = firstResult.value ?? null;
		if (firstFrame) {
			document.getElementById("urlPlayOverlay").classList.add('hidden');
			document.getElementById("entryloading").classList.add('hidden');
			ctx.drawImage(firstFrame.canvas, 0, 0, canvas.width, canvas.height);
			updateNextFrame();
		} else {
			state.nextFrame = null;
		}
	} catch (e) {
		if (currentAsyncId === state.asyncId) console.error("Error starting video iteration:", e);
	}
};

export const updateNextFrame = async () => {
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

export const checkPlaybackState = () => {
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

export const renderLoop = () => {
	if (state.fileLoaded) {
		const currentTime = getPlaybackTime();

		if (state.playing) {
			if (state.nextFrame && state.nextFrame.timestamp <= currentTime) {
				ctx.drawImage(state.nextFrame.canvas, 0, 0, canvas.width, canvas.height);
				state.nextFrame = null;
				updateNextFrame();
			}
		}
		updateSubtitlesOptimized(currentTime);
		if (!state.isSeeking) scheduleProgressUpdate(currentTime);
		if (state.onFrameRenderCallbacks.length > 0) state.onFrameRenderCallbacks.forEach(cb => cb(currentTime));
	}
	requestAnimationFrame(renderLoop);
};

export const scheduleProgressUpdate = (time) => {
	if (state.progressUpdateScheduled) return;
	state.progressUpdateScheduled = true;
	requestAnimationFrame(() => {
		updateProgressBarUI(time);
		state.progressUpdateScheduled = false;
	});
};

export const play = async () => {
	if (state.playing) return;

	// === LAZY-INITIALIZE AUDIOCONTEXT ON USER GESTURE ===
	if (!state.audioContext) {
		try {
			state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
			state.gainNode = state.audioContext.createGain();
			state.gainNode.connect(state.audioContext.destination);
			setVolume(volumeSlider.value); // Apply volume when created
		} catch (e) {
			console.error("Failed to create AudioContext:", e);
			showError("Could not initialize audio playback.");
			return; // Exit if audio can't be started
		}
	} else if (state.audioContext.state === 'suspended') {
		await state.audioContext.resume();
	}
	// === END OF AUDIO INITIALIZATION ===

	if (state.totalDuration > 0 && Math.abs(getPlaybackTime() - state.totalDuration) < 0.1) {
		const time = state.isLooping ? state.loopStartTime : 0;
		state.playbackTimeAtStart = time;
		await seekToTime(time, true); // seekToTime will handle pausing/playing
		return; // Exit here as seekToTime will call play if it needs to
	}

	state.audioContextStartTime = state.audioContext.currentTime;
	state.playing = true;
	setAudioOnlyUI();
	if (state.playbackLogicInterval) clearInterval(state.playbackLogicInterval);
	state.playbackLogicInterval = setInterval(checkPlaybackState, 100);

	if (state.audioSink) {
		const currentAsyncId = state.asyncId;
		await state.audioBufferIterator?.return();
		if (currentAsyncId !== state.asyncId) return;

		const iteratorStartTime = getPlaybackTime();
		state.audioBufferIterator = state.audioSink.buffers(iteratorStartTime);
		runAudioIterator(); // Now we can safely start the audio
	}

	playBtn.textContent = '⏸';
	showControlsTemporarily();
};

export const pause = () => {
	if (!state.playing) return;
	state.playbackTimeAtStart = getPlaybackTime();
	state.playing = false;
	state.asyncId++;
	setAudioOnlyUI();

	// Add these two lines to stop the interval
	clearInterval(state.playbackLogicInterval);
	state.playbackLogicInterval = null;

	state.audioBufferIterator?.return().catch(() => { });
	state.audioBufferIterator = null;

	queuedAudioNodes.forEach(node => {
		try {
			node.stop();
		} catch (e) { }
	});
	queuedAudioNodes.clear();

	playBtn.textContent = '▶';
	videoContainer.classList.remove('hide-cursor');
	clearTimeout(state.hideControlsTimeout);
	videoControls.classList.add('show');
};

export const togglePlay = () => state.playing ? pause() : play();

export const seekToTime = async (seconds, forcePlay = false) => {
	const wasPlaying = state.playing;
	if (wasPlaying) pause();

	seconds = Math.max(0, Math.min(seconds, state.totalDuration));
	state.playbackTimeAtStart = seconds;
	updateProgressBarUI(seconds);
	updateTimeInputs(seconds);

	await startVideoIterator();

	if ((forcePlay || wasPlaying) && state.playbackTimeAtStart < state.totalDuration) {
		await play();
	}
};

export const setPlaybackSpeed = (newSpeed) => {
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
	queuedAudioNodes.forEach(node => {
		try {
			node.stop();
		} catch (e) { }
	});
	queuedAudioNodes.clear();

	state.currentPlaybackRate = newSpeed;

	state.playbackTimeAtStart = currentTime;
	state.audioContextStartTime = state.audioContext.currentTime;

	if (state.audioSink) {
		state.audioBufferIterator = state.audioSink.buffers(currentTime);
		runAudioIterator();
	}

	startVideoIterator();
};

export const stopAndClear = async () => {
	if (state.playing) pause();
	state.fileLoaded = false;
	state.isLooping = false;
	loopBtn.textContent = 'Loop';
	state.currentPlaybackRate = 1.0;
	playbackSpeedInput.value = '1';
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
	state.videoTrack = null; // Reset video track info
	removeSubtitleOverlay();

	state.availableAudioTracks = [];
	state.availableSubtitleTracks = [];
	state.currentAudioTrack = null;
	state.currentSubtitleTrack = null;

	ctx.clearRect(0, 0, canvas.width, canvas.height);

	if (state.audioContext && state.audioContext.state === 'running') {
		await state.audioContext.suspend();
	}
};

// ============================================================================
// MEDIA LOADING & CONVERSION
// ============================================================================

export const handleConversion = async (source, fileName) => {
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

export const loadMedia = async (resource, isConversionAttempt = false, muted = false) => {
	showStatusMessage();
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

		state.videoTrack = await input.getPrimaryVideoTrack(); // Assign to global videoTrack
		const audioTracks = await input.getAudioTracks();
		const firstAudioTrack = audioTracks.length > 0 ? audioTracks[0] : null;

		const isVideoDecodable = state.videoTrack ? await state.videoTrack.canDecode() : false;
		const isAudioDecodable = firstAudioTrack ? await firstAudioTrack.canDecode() : false;

		const isPlayable = (state.videoTrack && isVideoDecodable) || (!state.videoTrack && firstAudioTrack && isAudioDecodable);

		if (!isPlayable && !isConversionAttempt) {
			console.log("Media not directly playable, attempting conversion.");
			await handleConversion(source, resourceName);
			return;
		}

		if (!isPlayable && isConversionAttempt) {
			throw new Error('Converted file is not playable. Its codecs may be unsupported.');
		}

		state.currentPlayingFile = resource;
		state.totalDuration = await input.computeDuration();
		state.playbackTimeAtStart = 0;

		startTimeInput.value = formatTime(0);
		endTimeInput.value = formatTime(state.totalDuration);

		state.availableAudioTracks = audioTracks;
		const allTracks = await input.getTracks();
		state.availableSubtitleTracks = allTracks.filter(track => track.type === 'subtitle');

		state.currentAudioTrack = state.availableAudioTracks.length > 0 ? state.availableAudioTracks[0] : null;
		state.currentSubtitleTrack = null;

		if (!state.videoTrack && !state.currentAudioTrack) {
			throw new Error('No valid audio or video tracks found.');
		}

		// Mute if requested
		if (muted) {
			volumeSlider.value = 0; // Just update the UI
			muteBtn.textContent = '🔇';
		}

		if (state.videoTrack) {
			const packetStats = await state.videoTrack.computePacketStats();
			state.videoTrack.frameRate = packetStats.averagePacketRate;
			state.videoSink = new CanvasSink(state.videoTrack, {
				poolSize: 2
			});
			canvas.width = state.videoTrack.displayWidth || state.videoTrack.codedWidth || 1280;
			canvas.height = state.videoTrack.displayHeight || state.videoTrack.codedHeight || 720;

			// Resize the crop canvas as well
			cropCanvas.width = canvas.width;
			cropCanvas.height = canvas.height;
		}

		if (state.currentAudioTrack) {
			state.audioSink = new AudioBufferSink(state.currentAudioTrack);
		}

		updateTrackMenus();
		state.fileLoaded = true;
		showPlayerUI();
		setAudioOnlyUI()
		updateProgressBarUI(0);

		// === START SILENT AUTOPLAY ===
		await startVideoIterator();
		if (muted) {
			state.playing = true;
			state.playbackTimeAtStart = 0; // Explicitly set start time
			state.playbackWallClockStartTime = performance.now(); // ✅ START the fallback timer
			playBtn.textContent = '⏸';
			showControlsTemporarily();
		} else {
			await play(muted);
		}

		// Start the logic interval for looping/ending checks
		if (state.playbackLogicInterval) clearInterval(state.playbackLogicInterval);
		state.playbackLogicInterval = setInterval(checkPlaybackState, 100);

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

export const ensureSubtitleRenderer = async () => {
	if (!state.SubtitleRendererConstructor) {
		try {
			const module = await import(MEDIABUNNY_URL);
			state.SubtitleRendererConstructor = module.SubtitleRenderer;
		} catch (e) {
			console.error("Failed to load SubtitleRenderer module:", e);
			showError("Failed to load subtitle support.");
			throw e;
		}
	}
	return state.SubtitleRendererConstructor;
};

// ============================================================================
// AUDIO MANAGEMENT
// ============================================================================

export const runAudioIterator = async () => {
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

			queuedAudioNodes.add(node);
			node.onended = () => queuedAudioNodes.delete(node);

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

export const setVolume = val => {
	const vol = parseFloat(val);
	if (state.gainNode) state.gainNode.gain.value = vol * vol;
	muteBtn.textContent = vol > 0 ? '🔊' : '🔇';
};

// ============================================================================
// TRACK MANAGEMENT (Audio & Subtitles)
// ============================================================================

export const updateTrackMenus = () => {
	const audioTrackList = $('audioTrackList');
	audioTrackList.innerHTML = '';

	state.availableAudioTracks.forEach((track, index) => {
		const li = document.createElement('li');
		li.className = `playlist-file ${track === state.currentAudioTrack ? 'active' : ''}`;

		// Clickable area for switching the track
		const trackInfo = document.createElement('div');
		trackInfo.className = 'playlist-file-name track-info';
		trackInfo.dataset.trackIndex = index;
		const langCode = track.languageCode;
		const label = (langCode && langCode !== 'und') ? langCode : `Audio ${index + 1}`;
		trackInfo.innerHTML = `<span>${label}</span>`;
		trackInfo.title = `Switch to ${label}`;

		// Download button
		const downloadBtn = document.createElement('button');
		downloadBtn.className = 'clip-action-btn download-btn';
		downloadBtn.dataset.trackIndex = index;
		downloadBtn.textContent = '⬇️';
		downloadBtn.title = 'Download this audio track';

		li.appendChild(trackInfo);
		li.appendChild(downloadBtn);
		audioTrackList.appendChild(li);
	});

	const subtitleTrackList = $('subtitleTrackList');
	const noneOption = document.createElement('li');
	noneOption.className = `playlist-file ${!state.currentSubtitleTrack ? 'active' : ''}`;
	noneOption.innerHTML = `<span>Off</span>`;
	noneOption.onclick = () => switchSubtitleTrack('none');
	subtitleTrackList.innerHTML = '';
	subtitleTrackList.appendChild(noneOption);

	state.availableSubtitleTracks.forEach((track, index) => {
		const li = document.createElement('li');
		li.className = `playlist-file ${track === state.currentSubtitleTrack ? 'active' : ''}`;
		const langCode = track.languageCode;
		const label = (langCode && langCode !== 'und') ? langCode : `Subtitle ${index + 1}`;
		li.innerHTML = `<span>${label}</span>`;
		li.onclick = () => switchSubtitleTrack(index);
		subtitleTrackList.appendChild(li);
	});
};

export const switchAudioTrack = async (trackIndex) => {
	if (!state.availableAudioTracks[trackIndex] || state.availableAudioTracks[trackIndex] === state.currentAudioTrack) return;

	showStatusMessage();
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

export const switchSubtitleTrack = async (trackIndex) => {
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

export const removeSubtitleOverlay = () => {
	if (state.subtitleOverlayElement) {
		state.subtitleOverlayElement.textContent = '';
		state.subtitleOverlayElement.style.display = 'none';
	}
	state.lastSubtitleText = null;
};

export const updateSubtitlesOptimized = (currentTime) => {
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
					videoContainer.appendChild(state.subtitleOverlayElement);
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

export const hideTrackMenus = () => {
	$('audioTrackMenu').classList.add('hidden');
	$('subtitleTrackMenu').classList.add('hidden');
};

// ============================================================================
// PLAYBACK CONTROLS
// ============================================================================

export const playNext = () => {
	if (!state.currentPlayingFile) return;

	const flatten = (nodes) => {
		let flat = [];
		nodes.forEach(node => {
			if (node.type === 'file') flat.push(node);
			if (node.type === 'folder') flat = flat.concat(flatten(node.children));
		});
		return flat;
	};

	const flatList = flatten(state.playlist);
	if (flatList.length <= 1) return;
	const currentIndex = flatList.findIndex(item => item.file === state.currentPlayingFile);

	if (currentIndex !== -1 && currentIndex < flatList.length - 1) {
		loadMedia(flatList[currentIndex + 1].file);
	}
};

export const playPrevious = () => {
	if (!state.currentPlayingFile) return;

	const flatten = (nodes) => {
		let flat = [];
		nodes.forEach(node => {
			if (node.type === 'file') flat.push(node);
			if (node.type === 'folder') flat = flat.concat(flatten(node.children));
		});
		return flat;
	};

	const flatList = flatten(state.playlist);
	if (flatList.length <= 1) return;
	const currentIndex = flatList.findIndex(item => item.file === state.currentPlayingFile);

	if (currentIndex > 0) {
		loadMedia(flatList[currentIndex - 1].file);
	} else {
		// Loop back to the last track
		loadMedia(flatList[flatList.length - 1].file);
	}
};

export const toggleLoop = () => {
	if (state.isLooping) {
		loopBtn.classList.toggle('hover_highlight');
		state.isLooping = false;
		loopBtn.textContent = 'Loop';
	} else {
		const start = parseTime(startTimeInput.value);
		const end = parseTime(endTimeInput.value);

		if (!state.fileLoaded) {
			showError("Cannot loop: No video loaded.");
			return;
		}
		if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end > state.totalDuration) {
			showError("Invalid start or end time for looping.");
			return;
		}
		loopBtn.classList.toggle('hover_highlight');

		state.isLooping = true;
		state.loopStartTime = start;
		state.loopEndTime = end;
		loopBtn.textContent = 'Looping...';

		const currentTime = getPlaybackTime();
		if (currentTime < start || currentTime > end) {
			seekToTime(start);
		}

		if (!state.playing) {
			play();
		}
	}
};

const setAudioOnlyUI = () => {
	state.isAudioOnly = !!state.currentAudioTrack && !state.videoTrack;
	const visualizer = $('audioVisualizer');
	if (state.isAudioOnly) {
		canvas.style.display = 'none';
		visualizer.classList.remove('hidden');
	} else {
		canvas.style.display = 'block';
		visualizer.classList.add('hidden');
	}
	if (state.playing) {
		visualizer.classList.remove('removeAnimation');
	} else {
		visualizer.classList.add('removeAnimation');
	}
}
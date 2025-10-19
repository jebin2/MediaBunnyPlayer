// js/player.js

import { Input, ALL_FORMATS, BlobSource, UrlSource, AudioBufferSink, CanvasSink } from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';
import * as C from './constants.js';
import { state, updateState } from './state.js';
import { formatTime } from './utils.js';
import * as UI from './ui.js';
import { handleConversion } from './editing.js';

export const getPlaybackTime = () => {
	if (!state.playing || !state.audioContext) return state.playbackTimeAtStart;
	const elapsedTime = state.audioContext.currentTime - state.audioContextStartTime;
	return state.playbackTimeAtStart + (elapsedTime * state.currentPlaybackRate);
};

const updateNextFrame = async () => {
	if (!state.videoFrameIterator) return;
	const currentAsyncId = state.asyncId;
	try {
		const result = await state.videoFrameIterator.next();
		if (currentAsyncId !== state.asyncId || result.done) {
			updateState({ nextFrame: null });
			return;
		}
		updateState({ nextFrame: result.value });
	} catch (e) {
		if (currentAsyncId === state.asyncId) console.error("Error decoding video frame:", e);
		updateState({ nextFrame: null });
	}
};

const startVideoIterator = async () => {
	if (!state.videoSink) return;
	const currentAsyncId = state.asyncId;
	try {
		await state.videoFrameIterator?.return();
		const iterator = state.videoSink.canvases(getPlaybackTime());
        updateState({ videoFrameIterator: iterator });
		const firstResult = await iterator.next();
		if (currentAsyncId !== state.asyncId) return;
		const firstFrame = firstResult.value ?? null;
		if (firstFrame) {
			C.ctx.drawImage(firstFrame.canvas, 0, 0, C.canvas.width, C.canvas.height);
			updateNextFrame();
		} else {
			updateState({ nextFrame: null });
		}
	} catch (e) {
		if (currentAsyncId === state.asyncId) console.error("Error starting video iteration:", e);
	}
};

const runAudioIterator = async () => {
	if (!state.audioSink || !state.audioBufferIterator) return;
	const currentAsyncId = state.asyncId;
	try {
		for await (const { buffer, timestamp } of state.audioBufferIterator) {
			if (currentAsyncId !== state.asyncId) break;
			const node = state.audioContext.createBufferSource();
			node.buffer = buffer; node.connect(state.gainNode);
			node.playbackRate.value = state.currentPlaybackRate;
			const absolutePlayTime = state.audioContextStartTime + ((timestamp - state.playbackTimeAtStart) / state.currentPlaybackRate);
			if (absolutePlayTime >= state.audioContext.currentTime) {
				node.start(absolutePlayTime);
			} else {
				const offset = (state.audioContext.currentTime - absolutePlayTime) * state.currentPlaybackRate;
				if (offset < buffer.duration) node.start(state.audioContext.currentTime, offset);
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

const checkPlaybackState = () => {
	if (!state.playing || !state.fileLoaded) return;
	const currentTime = getPlaybackTime();
	if (state.isLooping && currentTime >= state.loopEndTime) {
		seekToTime(state.loopStartTime);
		return;
	}
	if (currentTime >= state.totalDuration && state.totalDuration > 0 && !state.isLooping) {
		pause();
		if (state.isAutoplayEnabled) playNext();
		else updateState({ playbackTimeAtStart: state.totalDuration });
	}
};

export const renderLoop = () => {
	if (state.fileLoaded) {
		const currentTime = getPlaybackTime();
		if (state.playing) {
			if (state.nextFrame && state.nextFrame.timestamp <= currentTime) {
				C.ctx.drawImage(state.nextFrame.canvas, 0, 0, C.canvas.width, C.canvas.height);
				updateState({ nextFrame: null });
				updateNextFrame();
			}
		}
		updateSubtitlesOptimized(currentTime);
		if (!state.isSeeking) UI.updateProgressBarUI(currentTime);
	}
	requestAnimationFrame(renderLoop);
};

export const seekToTime = async (seconds) => {
	const wasPlaying = state.playing;
	if (wasPlaying) pause();
	seconds = Math.max(0, Math.min(seconds, state.totalDuration));
	updateState({ playbackTimeAtStart: seconds });
	UI.updateProgressBarUI(seconds);
	await startVideoIterator();
	if (wasPlaying && state.playbackTimeAtStart < state.totalDuration) await play();
};

export const play = async () => {
	if (state.playing || !state.audioContext) return;
	if (state.audioContext.state === 'suspended') await state.audioContext.resume();
	if (state.totalDuration > 0 && Math.abs(getPlaybackTime() - state.totalDuration) < 0.01) {
		await seekToTime(state.isLooping ? state.loopStartTime : 0);
	}
	updateState({ audioContextStartTime: state.audioContext.currentTime, playing: true });
	if (state.playbackLogicInterval) clearInterval(state.playbackLogicInterval);
	const interval = setInterval(checkPlaybackState, 100);
    updateState({ playbackLogicInterval: interval });
	if (state.audioSink) {
		const currentAsyncId = state.asyncId;
		await state.audioBufferIterator?.return();
		if (currentAsyncId !== state.asyncId) return;
		const iterator = state.audioSink.buffers(getPlaybackTime());
        updateState({ audioBufferIterator: iterator });
		runAudioIterator();
	}
	C.playBtn.textContent = '⏸';
	UI.showControlsTemporarily();
};

export const pause = () => {
	if (!state.playing) return;
	updateState({ playbackTimeAtStart: getPlaybackTime(), playing: false, asyncId: state.asyncId + 1 });
	clearInterval(state.playbackLogicInterval);
    updateState({ playbackLogicInterval: null });
	state.audioBufferIterator?.return().catch(() => {});
	updateState({ audioBufferIterator: null });
	state.queuedAudioNodes.forEach(node => { try { node.stop(); } catch (e) {} });
	state.queuedAudioNodes.clear();
	C.playBtn.textContent = '▶';
	C.videoContainer.classList.remove('hide-cursor');
	clearTimeout(state.hideControlsTimeout);
	C.videoControls.classList.add('show');
};

export const togglePlay = () => state.playing ? pause() : play();

export const stopAndClear = async () => {
	if (state.playing) pause();
	updateState({
        fileLoaded: false, isLooping: false, currentPlaybackRate: 1.0, asyncId: state.asyncId + 1,
        nextFrame: null, videoSink: null, audioSink: null, subtitleRenderer: null,
        availableAudioTracks: [], availableSubtitleTracks: [],
        currentAudioTrack: null, currentSubtitleTrack: null,
    });
    C.loopBtn.textContent = 'Loop'; C.loopBtn.classList.remove('hover_highlight');
	C.playbackSpeedInput.value = '1';
	try { await state.videoFrameIterator?.return(); } catch (e) {}
	try { await state.audioBufferIterator?.return(); } catch (e) {}
	removeSubtitleOverlay();
	C.ctx.clearRect(0, 0, C.canvas.width, C.canvas.height);
	if (state.audioContext?.state === 'running') await state.audioContext.suspend();
};

export const loadMedia = async (resource, isConversionAttempt = false) => {
	UI.showLoading(true);
	let input;
	try {
		await stopAndClear();
		let source, resourceName;
		if (resource instanceof Blob) {
			source = new BlobSource(resource); resourceName = resource.name;
		} else if (typeof resource === 'string') {
			source = new UrlSource(resource);
			resourceName = resource.split('/').pop() || 'video.mp4';
			if (!state.playlist.some(item => item.file === resource)) {
				state.playlist.push({ type: 'file', name: resourceName, file: resource });
			}
		} else throw new Error('Invalid media resource.');
		input = new Input({ source, formats: ALL_FORMATS });
		const videoTrack = await input.getPrimaryVideoTrack();
		const audioTracks = await input.getAudioTracks();
		const firstAudioTrack = audioTracks[0] || null;
		const isPlayable = (videoTrack && await videoTrack.canDecode()) || (!videoTrack && firstAudioTrack && await firstAudioTrack.canDecode());
		if (!isPlayable && !isConversionAttempt) return await handleConversion(source, resourceName);
		if (!isPlayable && isConversionAttempt) throw new Error('Converted file is not playable.');
		const duration = await input.computeDuration();
		C.startTimeInput.value = formatTime(0); C.endTimeInput.value = formatTime(duration);
		updateState({
			currentPlayingFile: resource, totalDuration: duration, playbackTimeAtStart: 0,
			availableAudioTracks: audioTracks, availableSubtitleTracks: (await input.getTracks()).filter(t => t.type === 'subtitle'),
			currentAudioTrack: firstAudioTrack, currentSubtitleTrack: null,
		});
		if (!videoTrack && !firstAudioTrack) throw new Error('No valid tracks found.');
		if (!state.audioContext) updateState({ audioContext: new (window.AudioContext || window.webkitAudioContext)() });
		if (state.audioContext.state === 'suspended') await state.audioContext.resume();
		const gainNode = state.audioContext.createGain();
		gainNode.connect(state.audioContext.destination);
        updateState({ gainNode }); setVolume(C.volumeSlider.value);
		if (videoTrack) {
			C.canvas.width = videoTrack.displayWidth || videoTrack.codedWidth || 1280;
			C.canvas.height = videoTrack.displayHeight || videoTrack.codedHeight || 720;
			C.cropCanvas.width = C.canvas.width; C.cropCanvas.height = C.canvas.height;
            updateState({ videoSink: new CanvasSink(videoTrack, { poolSize: 2 }) });
		}
		if (firstAudioTrack) updateState({ audioSink: new AudioBufferSink(firstAudioTrack) });
		UI.updateTrackMenus(); UI.updatePlaylistUIOptimized();
		updateState({ fileLoaded: true });
		UI.showPlayerUI(); UI.updateProgressBarUI(0);
		await startVideoIterator(); await play();
	} catch (error) {
		UI.showError(`Failed to load media: ${error.message}`); console.error('Load error:', error);
		if (input) input.dispose();
		updateState({ currentPlayingFile: null }); UI.showDropZoneUI();
	} finally {
		UI.showLoading(false);
	}
};

export const playNext = () => {
	if (!state.currentPlayingFile || state.playlist.length <= 1) return;
	const flatten = (nodes) => nodes.reduce((acc, node) => acc.concat(node.type === 'file' ? node : flatten(node.children)), []);
	const flatList = flatten(state.playlist);
	const currentIndex = flatList.findIndex(item => item.file === state.currentPlayingFile);
	if (currentIndex > -1 && currentIndex < flatList.length - 1) loadMedia(flatList[currentIndex + 1].file);
};

export const playPrevious = () => {
	if (!state.currentPlayingFile || state.playlist.length <= 1) return;
	const flatten = (nodes) => nodes.reduce((acc, node) => acc.concat(node.type === 'file' ? node : flatten(node.children)), []);
	const flatList = flatten(state.playlist);
	const currentIndex = flatList.findIndex(item => item.file === state.currentPlayingFile);
	if (currentIndex > 0) loadMedia(flatList[currentIndex - 1].file);
    else loadMedia(flatList[flatList.length - 1].file);
};

export const setVolume = val => {
	const vol = parseFloat(val);
	if (state.gainNode) state.gainNode.gain.value = vol * vol;
	C.muteBtn.textContent = vol > 0 ? '🔊' : '🔇';
};

export const setPlaybackSpeed = (newSpeed) => {
	if (newSpeed === state.currentPlaybackRate) return;
	const wasPlaying = state.playing;
	if (wasPlaying) pause();
	updateState({ currentPlaybackRate: newSpeed });
	if (wasPlaying) play();
};

const ensureSubtitleRenderer = async () => {
	if (!state.SubtitleRendererConstructor) {
		try {
			const { SubtitleRenderer } = await import(C.MEDIABUNNY_URL.replace('@1.23.0', '@1.24.0'));
			updateState({ SubtitleRendererConstructor: SubtitleRenderer });
		} catch (e) { UI.showError("Failed to load subtitle support."); throw e; }
	}
	return state.SubtitleRendererConstructor;
};

const removeSubtitleOverlay = () => {
	if (state.subtitleOverlayElement) state.subtitleOverlayElement.style.display = 'none';
	updateState({ lastSubtitleText: null });
};

const updateSubtitlesOptimized = (currentTime) => {
	if (!state.subtitleRenderer) { if (state.subtitleOverlayElement) removeSubtitleOverlay(); return; }
	try {
		const newText = state.subtitleRenderer.getSubtitleAt(currentTime)?.text || '';
		if (newText !== state.lastSubtitleText) {
			if (!state.subtitleOverlayElement) {
				const el = document.createElement('div'); el.className = 'subtitle-overlay';
				C.videoContainer.appendChild(el); updateState({ subtitleOverlayElement: el });
			}
			state.subtitleOverlayElement.textContent = newText;
			state.subtitleOverlayElement.style.display = newText ? 'block' : 'none';
			updateState({ lastSubtitleText: newText });
		}
	} catch (e) { console.error("Error rendering subtitle:", e); }
};

export const switchAudioTrack = async (trackIndex) => {
	const track = state.availableAudioTracks[trackIndex];
	if (!track || track === state.currentAudioTrack) return;
	const wasPlaying = state.playing;
	if(wasPlaying) pause();
	updateState({ currentAudioTrack: track });
	try {
		if (await track.canDecode()) updateState({ audioSink: new AudioBufferSink(track) });
		else { UI.showError("Selected audio track cannot be decoded."); updateState({ audioSink: null }); }
	} catch (e) { console.error("Error switching audio track:", e); updateState({ audioSink: null }); }
	UI.updateTrackMenus(); UI.hideTrackMenus();
	if (wasPlaying) await play();
};

export const switchSubtitleTrack = async (trackIndex) => {
	removeSubtitleOverlay();
	if (trackIndex === 'none') {
		updateState({ currentSubtitleTrack: null, subtitleRenderer: null });
	} else {
		const track = state.availableSubtitleTracks[trackIndex];
		if (track && track !== state.currentSubtitleTrack) {
			try {
				const Renderer = await ensureSubtitleRenderer();
				updateState({ currentSubtitleTrack: track, subtitleRenderer: new Renderer(track) });
			} catch (e) {
				UI.showError("Failed to load subtitles.");
				updateState({ currentSubtitleTrack: null, subtitleRenderer: null });
			}
		}
	}
	UI.updateTrackMenus(); UI.hideTrackMenus();
};
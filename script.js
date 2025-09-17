import { Input, ALL_FORMATS, BlobSource, AudioBufferSink, CanvasSink } from 'https://cdn.skypack.dev/mediabunny@latest';

const $ = document.getElementById.bind(document);
const playerArea = $('playerArea'), videoContainer = $('videoContainer'), canvas = $('videoCanvas'), dropZone = $('dropZone'), loading = $('loading');
const playBtn = $('playBtn'), timeDisplay = $('timeDisplay'), progressContainer = $('progressContainer');
const progressBar = $('progressBar'), volumeSlider = $('volumeSlider'), muteBtn = $('muteBtn'), fullscreenBtn = $('fullscreenBtn');
const sidebar = $('sidebar'), playlistContent = $('playlistContent'), videoControls = $('videoControls');
const progressHandle = $('progressHandle');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

let playlist = [], currentPlaylistIndex = -1, fileLoaded = false;
let audioContext, gainNode, videoSink, audioSink;
let totalDuration = 0, playing = false, isSeeking = false;
let audioContextStartTime = 0, playbackTimeAtStart = 0;
let videoFrameIterator, audioBufferIterator, nextFrame = null;
const queuedAudioNodes = new Set();
let asyncId = 0;
let hideControlsTimeout;

const getPlaybackTime = () => playing
	? audioContext.currentTime - audioContextStartTime + playbackTimeAtStart
	: playbackTimeAtStart;

const startVideoIterator = async () => {
	if (!videoSink) return;
	asyncId++;
	await videoFrameIterator?.return();
	videoFrameIterator = videoSink.canvases(getPlaybackTime());
	const firstFrame = (await videoFrameIterator.next()).value ?? null;
	nextFrame = (await videoFrameIterator.next()).value ?? null;
	if (firstFrame) {
		ctx.drawImage(firstFrame.canvas, 0, 0);
	}
};

const updateNextFrame = async () => {
	if (!videoFrameIterator) return;
	const currentAsyncId = asyncId;
	while (true) {
		const newNextFrame = (await videoFrameIterator.next()).value ?? null;
		if (!newNextFrame || currentAsyncId !== asyncId) break;
		if (newNextFrame.timestamp <= getPlaybackTime()) {
			ctx.drawImage(newNextFrame.canvas, 0, 0);
		} else {
			nextFrame = newNextFrame;
			break;
		}
	}
};

const renderLoop = () => {
	if (fileLoaded) {
		const currentTime = getPlaybackTime();
		if (playing) {
			if (currentTime >= totalDuration) {
				pause();
				playbackTimeAtStart = totalDuration;
				playNext();
			}
			if (nextFrame && nextFrame.timestamp <= currentTime) {
				ctx.drawImage(nextFrame.canvas, 0, 0);
				nextFrame = null;
				updateNextFrame();
			}
		}
		if (!isSeeking) updateProgressBarUI(currentTime);
	}
	requestAnimationFrame(renderLoop);
};

const runAudioIterator = async () => {
	if (!audioSink || !audioBufferIterator) return;
	for await (const { buffer, timestamp } of audioBufferIterator) {
		const node = audioContext.createBufferSource();
		node.buffer = buffer;
		node.connect(gainNode);
		const startTimestamp = audioContextStartTime + timestamp - playbackTimeAtStart;
		if (startTimestamp >= audioContext.currentTime) {
			node.start(startTimestamp);
		} else {
			node.start(audioContext.currentTime, audioContext.currentTime - startTimestamp);
		}
		queuedAudioNodes.add(node);
		node.onended = () => queuedAudioNodes.delete(node);
		if (timestamp - getPlaybackTime() >= 1) {
			await new Promise(r => setTimeout(r, 100));
		}
	}
};

const play = async () => {
	if (playing || !audioContext) return;
	if (audioContext.state === 'suspended') await audioContext.resume();
	if (getPlaybackTime() >= totalDuration) {
		await seekToTime(0);
	}
	audioContextStartTime = audioContext.currentTime;
	playing = true;
	if (audioSink) {
		await audioBufferIterator?.return();
		audioBufferIterator = audioSink.buffers(getPlaybackTime());
		runAudioIterator();
	}
	playBtn.textContent = '⏸';
	showControlsTemporarily();
};

const pause = () => {
	if (!playing) return;
	playbackTimeAtStart = getPlaybackTime();
	playing = false;
	audioBufferIterator?.return();
	audioBufferIterator = null;
	queuedAudioNodes.forEach(node => node.stop());
	queuedAudioNodes.clear();
	playBtn.textContent = '▶';
	videoContainer.classList.remove('hide-cursor');
};

const togglePlay = () => playing ? pause() : play();

const seekToTime = async (seconds) => {
	const wasPlaying = playing;
	if (wasPlaying) pause();
	playbackTimeAtStart = seconds;
	await startVideoIterator();
	if (wasPlaying && playbackTimeAtStart < totalDuration) {
		await play();
	}
};

const stopAndClear = async () => {
	if (playing) pause();
	fileLoaded = false;
	asyncId++;
	await videoFrameIterator?.return();
	await audioBufferIterator?.return();
	nextFrame = null;
	videoSink = null;
	audioSink = null;
	await audioContext?.close();
}

const loadMedia = async (file, index) => {
	showLoading(true);
	try {
		await stopAndClear();
		const source = new BlobSource(file);
		const input = new Input({ source, formats: ALL_FORMATS });
		playbackTimeAtStart = 0;
		totalDuration = await input.computeDuration();
		const videoTrack = await input.getPrimaryVideoTrack();
		const audioTrack = await input.getPrimaryAudioTrack();
		if (!videoTrack && !audioTrack) throw new Error('No valid audio or video tracks found.');
		const AudioContext = window.AudioContext || window.webkitAudioContext;
		audioContext = new AudioContext({ sampleRate: audioTrack?.sampleRate });
		gainNode = audioContext.createGain();
		gainNode.connect(audioContext.destination);
		setVolume(volumeSlider.value);
		videoSink = videoTrack && await videoTrack.canDecode() ? new CanvasSink(videoTrack, { poolSize: 2, fit: 'contain' }) : null;
		audioSink = audioTrack && await audioTrack.canDecode() ? new AudioBufferSink(audioTrack) : null;
		if (videoSink) {
			canvas.width = videoTrack.displayWidth;
			canvas.height = videoTrack.displayHeight;
		}
		currentPlaylistIndex = index;
		updatePlaylistUI();
		fileLoaded = true;
		showPlayerUI();
		await startVideoIterator();
		updateProgressBarUI(0);
		await play();
	} catch (error) {
		showError(`Failed to load media: ${error.message}`);
		console.error('Error loading media:', error);
		showDropZoneUI();
	} finally {
		showLoading(false);
	}
};

const handleFiles = (files) => {
	if (files.length === 0) return;
	playlist = Array.from(files).map(file => ({ file, name: file.name }));
	updatePlaylistUI();
	if (playlist.length > 0) loadMedia(playlist[0].file, 0);
};

const playNext = () => {
	if (currentPlaylistIndex < playlist.length - 1) {
		loadMedia(playlist[currentPlaylistIndex + 1].file, currentPlaylistIndex + 1);
	}
};

const formatTime = s => s ? `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}` : '00:00';
const showLoading = show => loading.classList.toggle('hidden', !show);
const showError = msg => { const el = document.createElement('div'); el.className = 'error-message'; el.textContent = msg; document.body.appendChild(el); setTimeout(() => el.remove(), 5000); };
const showPlayerUI = () => { dropZone.style.display = 'none'; videoContainer.style.display = 'block'; };
const showDropZoneUI = () => { dropZone.style.display = 'flex'; videoContainer.style.display = 'none'; };

const updateProgressBarUI = (time) => {
	timeDisplay.textContent = `${formatTime(time)} / ${formatTime(totalDuration)}`;
	const percent = totalDuration > 0 ? (time / totalDuration) * 100 : 0;
	progressBar.style.width = `${percent}%`;
	progressHandle.style.left = `${percent}%`;
};

const updatePlaylistUI = () => {
	playlistContent.innerHTML = playlist.length === 0 ? '<p style="padding:1rem; opacity:0.7;">No files.</p>' :
		playlist.map((item, index) => `<div class="playlist-item ${index === currentPlaylistIndex ? 'active' : ''}" data-index="${index}"><div class="playlist-item-name">${item.name}</div></div>`).join('');
};

const setVolume = val => { if (gainNode) gainNode.gain.value = val ** 2; muteBtn.textContent = val > 0 ? '🔊' : '🔇'; };

const showControlsTemporarily = () => {
	if (!videoSink) return;
	videoControls.classList.add('show');
	videoContainer.classList.remove('hide-cursor');
	clearTimeout(hideControlsTimeout);
	hideControlsTimeout = setTimeout(() => {
		if (!playing || isSeeking) return;
		videoControls.classList.remove('show');
		videoContainer.classList.add('hide-cursor');
	}, 2500);
};

const setupEventListeners = () => {
	$('openFileBtn').onclick = () => $('fileInput').click();
	$('chooseFileBtn').onclick = () => $('fileInput').click();
	$('togglePlaylistBtn').onclick = () => playerArea.classList.toggle('playlist-visible');
	$('fileInput').onchange = (e) => handleFiles(e.target.files);
	playBtn.onclick = togglePlay;
	muteBtn.onclick = () => { volumeSlider.value = volumeSlider.value > 0 ? 0 : 0.7; setVolume(volumeSlider.value); };
	volumeSlider.oninput = (e) => setVolume(e.target.value);
	fullscreenBtn.onclick = () => document.fullscreenElement ? document.exitFullscreen() : videoContainer.requestFullscreen();
	progressContainer.onpointerdown = (e) => { isSeeking = true; showControlsTemporarily(); };
	document.onpointermove = (e) => {
		if (!isSeeking) return;
		const rect = progressContainer.getBoundingClientRect();
		const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		updateProgressBarUI(percent * totalDuration);
	};
	document.onpointerup = (e) => {
		if (!isSeeking) return;
		const rect = progressContainer.getBoundingClientRect();
		const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		seekToTime(percent * totalDuration).then(() => { isSeeking = false; });
	};
	const ddEvents = ['dragover', 'drop'];
	ddEvents.forEach(name => document.body.addEventListener(name, p => p.preventDefault()));
	dropZone.ondragover = () => dropZone.classList.add('dragover');
	dropZone.ondragleave = () => dropZone.classList.remove('dragover');
	dropZone.ondrop = (e) => { dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); };
	playlistContent.onclick = (e) => {
		const item = e.target.closest('.playlist-item');
		if (item) loadMedia(playlist[item.dataset.index].file, parseInt(item.dataset.index));
	};
	document.onkeydown = (e) => {
		if (e.target.tagName === 'INPUT' || !fileLoaded) return;
		switch (e.code) {
			case 'Space': case 'KeyK': e.preventDefault(); togglePlay(); break;
			case 'KeyF': fullscreenBtn.click(); break;
			case 'KeyM': muteBtn.click(); break;
			case 'ArrowLeft': e.preventDefault(); seekToTime(Math.max(getPlaybackTime() - 5, 0)); break;
			case 'ArrowRight': e.preventDefault(); seekToTime(Math.min(getPlaybackTime() + 5, totalDuration)); break;
			case 'ArrowUp':
				e.preventDefault();
				const newVolumeUp = Math.min(1, parseFloat(volumeSlider.value) + 0.1);
				volumeSlider.value = newVolumeUp;
				setVolume(newVolumeUp);
				break;
			case 'ArrowDown':
				e.preventDefault();
				const newVolumeDown = Math.max(0, parseFloat(volumeSlider.value) - 0.1);
				volumeSlider.value = newVolumeDown;
				setVolume(newVolumeDown);
				break;
		}
	};
	videoContainer.onclick = togglePlay;
	videoControls.onclick = (e) => e.stopPropagation();
	videoContainer.onpointermove = showControlsTemporarily;
};

document.addEventListener('DOMContentLoaded', () => {
	setupEventListeners();
	renderLoop();
	if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
		navigator.serviceWorker.register('service-worker.js')
			.then(() => console.log('ServiceWorker registered.'))
			.catch(err => console.error('ServiceWorker registration failed:', err));
	}
});
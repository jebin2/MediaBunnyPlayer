import {
	Input,
	ALL_FORMATS,
	BlobSource,
	UrlSource,
	AudioBufferSink,
	CanvasSink
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

// --- Core Player Logic ---
const getPlaybackTime = () => playing ? audioContext.currentTime - audioContextStartTime + playbackTimeAtStart : playbackTimeAtStart;

// Optimization: Simplified video iterator logic and added error handling
const startVideoIterator = async () => {
	if (!videoSink) return;
	const currentAsyncId = ++asyncId;

	try {
		await videoFrameIterator?.return();
		// Seek to current time
		videoFrameIterator = videoSink.canvases(getPlaybackTime());

		// Get the immediate frame for instant seek feedback
		const firstResult = await videoFrameIterator.next();
		if (currentAsyncId !== asyncId) return; // Cancelled

		const firstFrame = firstResult.value ?? null;

		if (firstFrame) {
			ctx.drawImage(firstFrame.canvas, 0, 0);
			// Prepare the next frame for the render loop
			updateNextFrame();
		} else {
			nextFrame = null;
		}
	} catch (e) {
		if (currentAsyncId !== asyncId) return;
		console.error("Error starting video iteration:", e);
	}
};

// Optimization: Removed while loop, relying on renderLoop for timing. Added error handling.
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
		if (currentAsyncId !== asyncId) return;
		console.error("Error decoding video frame:", e);
		nextFrame = null;
	}
};

const renderLoop = () => {
	if (fileLoaded) {
		const currentTime = getPlaybackTime();
		if (playing) {
			if (currentTime >= totalDuration && totalDuration > 0) {
				pause();
				playbackTimeAtStart = totalDuration;
				// Ensure UI updates to end
				updateProgressBarUI(totalDuration);
				playNext();
			} else if (nextFrame && nextFrame.timestamp <= currentTime) {
				// Frame is due, draw it
				ctx.drawImage(nextFrame.canvas, 0, 0);

				// Optimization: WrappedCanvas is managed by pool, 
				// but if poolSize is low, might need manual closing if not using pool.
				// With poolSize: 2 in config, it's handled automatically when reused.

				nextFrame = null;
				// Fetch next frame asynchronously
				updateNextFrame();
			}
		}

		// Update subtitles
		updateSubtitles(currentTime);

		if (!isSeeking) updateProgressBarUI(currentTime);
	}
	requestAnimationFrame(renderLoop);
};

// Optimization: Added error handling for audio stream
const runAudioIterator = async () => {
	if (!audioSink || !audioBufferIterator) return;
	const currentAsyncId = asyncId;

	try {
		for await (const { buffer, timestamp } of audioBufferIterator) {
			if (currentAsyncId !== asyncId) break; // Stop if seeked/paused

			const node = audioContext.createBufferSource();
			node.buffer = buffer;
			node.connect(gainNode);

			// Calculate when this specific buffer should play relative to audioContext
			const absolutePlayTime = audioContextStartTime + (timestamp - playbackTimeAtStart);

			if (absolutePlayTime >= audioContext.currentTime) {
				node.start(absolutePlayTime);
			} else {
				// If we are late, play immediately with offset
				const offset = audioContext.currentTime - absolutePlayTime;
				// Ensure offset doesn't exceed buffer duration
				if (offset < buffer.duration) {
					node.start(audioContext.currentTime, offset);
				}
			}

			queuedAudioNodes.add(node);
			node.onended = () => queuedAudioNodes.delete(node);

			// Simple throttling to prevent decoding too far ahead
			if (timestamp - getPlaybackTime() >= 1.5) {
				// Wait until playback catches up a bit
				while (playing && currentAsyncId === asyncId && (timestamp - getPlaybackTime() >= 0.5)) {
					await new Promise(r => setTimeout(r, 100));
				}
			}
		}
	} catch (e) {
		if (currentAsyncId !== asyncId) return;
		console.error("Error during audio iteration:", e);
		showError("Audio playback error.");
	}
};

const play = async () => {
	if (playing || !audioContext) return;
	if (audioContext.state === 'suspended') await audioContext.resume();

	// Handle replay case
	if (totalDuration > 0 && Math.abs(getPlaybackTime() - totalDuration) < 0.1) {
		playbackTimeAtStart = 0;
		await seekToTime(0);
	}

	audioContextStartTime = audioContext.currentTime;
	playing = true;

	if (audioSink) {
		const currentAsyncId = asyncId;
		await audioBufferIterator?.return();
		if (currentAsyncId !== asyncId) return; // Interrupted

		audioBufferIterator = audioSink.buffers(getPlaybackTime());
		runAudioIterator(); // Run without awaiting to not block UI
	}

	playBtn.textContent = '⏸';
	showControlsTemporarily();
};

const pause = () => {
	if (!playing) return;
	playbackTimeAtStart = getPlaybackTime();
	playing = false;
	asyncId++; // Invalidates running iterators

	audioBufferIterator?.return().catch(() => { });
	audioBufferIterator = null;

	queuedAudioNodes.forEach(node => {
		try { node.stop(); } catch (e) { }
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

	// Clamp time
	seconds = Math.max(0, Math.min(seconds, totalDuration));
	playbackTimeAtStart = seconds;
	updateProgressBarUI(seconds); // Immediate UI update

	await startVideoIterator();

	if (wasPlaying && playbackTimeAtStart < totalDuration) {
		await play();
	}
};

const stopAndClear = async () => {
	if (playing) pause();
	fileLoaded = false;
	asyncId++;

	// Cleanup sinks and iterators
	try { await videoFrameIterator?.return(); } catch (e) { }
	try { await audioBufferIterator?.return(); } catch (e) { }

	if (nextFrame && nextFrame.canvas) {
		// Explicitly close if it's an OffscreenCanvas/VideoFrame wrapper, 
		// though CanvasSink with pool handles this mostly.
	}

	nextFrame = null;
	videoSink = null;
	audioSink = null;
	subtitleRenderer = null;
	removeSubtitleOverlay();

	availableAudioTracks = [];
	availableSubtitleTracks = [];
	currentAudioTrack = null;
	currentSubtitleTrack = null;

	// Clear canvas
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	// Don't close audioContext entirely, just suspend or leave it
	// Closing necessitates recreating it for the next file, which some browsers dislike if not user-initiated.
	if (audioContext && audioContext.state === 'running') {
		await audioContext.suspend();
	}
};

const loadMedia = async (resource) => {
	showLoading(true);
	try {
		await stopAndClear();

		let source;
		let resourceName;

		if (resource instanceof File) {
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

		currentPlayingFile = resource;

		// Use 'using' if supported for auto-cleanup, otherwise manual
		const input = new Input({
			source,
			formats: ALL_FORMATS
		});

		totalDuration = await input.computeDuration();
		playbackTimeAtStart = 0;

		// Get tracks
		const videoTrack = await input.getPrimaryVideoTrack();
		availableAudioTracks = await input.getAudioTracks();
		const allTracks = await input.getTracks();
		availableSubtitleTracks = allTracks.filter(track => track.type === 'subtitle');

		// Set current tracks
		currentAudioTrack = availableAudioTracks.length > 0 ? availableAudioTracks[0] : null;
		currentSubtitleTrack = null;

		if (!videoTrack && !currentAudioTrack) {
			throw new Error('No valid audio or video tracks found (undecodable or missing).');
		}

		// Setup Audio Context
		if (!audioContext) {
			const AudioContext = window.AudioContext || window.webkitAudioContext;
			audioContext = new AudioContext();
		}

		// Some browsers require resuming context after creation
		if (audioContext.state === 'suspended') {
			await audioContext.resume();
		}

		gainNode = audioContext.createGain();
		gainNode.connect(audioContext.destination);
		setVolume(volumeSlider.value);

		// Initialize Sinks
		if (videoTrack && await videoTrack.canDecode()) {
			videoSink = new CanvasSink(videoTrack, { poolSize: 2, fit: 'contain' });
			// Update canvas size to match video aspect ratio
			canvas.width = videoTrack.displayWidth || videoTrack.codedWidth || 1280;
			canvas.height = videoTrack.displayHeight || videoTrack.codedHeight || 720;
		}

		if (currentAudioTrack && await currentAudioTrack.canDecode()) {
			audioSink = new AudioBufferSink(currentAudioTrack);
		}

		// Update UI
		updateTrackMenus();
		updatePlaylistUI();
		fileLoaded = true;
		showPlayerUI();
		updateProgressBarUI(0);

		// Buffer first frame and start
		await startVideoIterator();
		await play();

	} catch (error) {
		showError(`Failed to load media: ${error.message}`);
		console.error('Error loading media:', error);
		currentPlayingFile = null;
		showDropZoneUI();
	} finally {
		showLoading(false);
	}
};

const updateTrackMenus = () => {
	// Update audio track menu
	const audioTrackList = $('audioTrackList');
	audioTrackList.innerHTML = '';

	availableAudioTracks.forEach((track, index) => {
		const li = document.createElement('li');
		li.className = `track-item ${track === currentAudioTrack ? 'active' : ''}`;

		// Optimization: Use languageCode and check for 'und'
		const langCode = track.languageCode;
		const label = (langCode && langCode !== 'und') ? langCode : `Audio ${index + 1}`;

		li.innerHTML = `<span>${label}</span>`;
		li.onclick = () => switchAudioTrack(index);
		audioTrackList.appendChild(li);
	});

	// Update subtitle track menu
	const subtitleTrackList = $('subtitleTrackList');
	const noneOption = subtitleTrackList.querySelector('[data-track-id="none"]');
	subtitleTrackList.innerHTML = '';
	subtitleTrackList.appendChild(noneOption);

	noneOption.className = `track-item ${!currentSubtitleTrack ? 'active' : ''}`;

	availableSubtitleTracks.forEach((track, index) => {
		const li = document.createElement('li');
		li.className = `track-item ${track === currentSubtitleTrack ? 'active' : ''}`;

		// Optimization: Use languageCode and check for 'und'
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

		// Optimization: Use cached constructor
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
	if (existingOverlay) {
		existingOverlay.remove();
	}
};

const updateSubtitles = (currentTime) => {
	// Simple optimization: don't manipulate DOM if text hasn't changed
	// Requires storing last rendered text, implemented simply here just by removing/adding
	removeSubtitleOverlay();

	if (!subtitleRenderer) return;

	// Need try-catch here as internal parsing might fail on bad files
	try {
		const subtitle = subtitleRenderer.getSubtitleAt(currentTime);
		if (subtitle && subtitle.text) {
			const overlay = document.createElement('div');
			overlay.className = 'subtitle-overlay';
			// Use innerText for security vs innerHTML if text contains tags, 
			// depends on WebVTT parsing implementation of MediaBunny. 
			// Assuming textContent is safe based on library.
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
};

const playNext = () => {
	if (!currentPlayingFile || playlist.length <= 1) return;

	// Flatten tree to find current index
	const flatten = (nodes) => {
		let flat = [];
		nodes.forEach(node => {
			if (node.type === 'file') flat.push(node);
			if (node.type === 'folder') flat = flat.concat(flatten(node.children));
		});
		return flat;
	};

	const flatList = flatten(playlist);

	// Simple comparison to find current file in list
	let currentIndex = -1;
	for (let i = 0; i < flatList.length; i++) {
		const item = flatList[i];
		if (currentPlayingFile instanceof File && item.file instanceof File) {
			if (currentPlayingFile.name === item.file.name && currentPlayingFile.size === item.file.size) {
				currentIndex = i;
				break;
			}
		} else if (typeof currentPlayingFile === 'string' && typeof item.file === 'string') {
			if (currentPlayingFile === item.file) {
				currentIndex = i;
				break;
			}
		}
	}

	if (currentIndex !== -1 && currentIndex < flatList.length - 1) {
		loadMedia(flatList[currentIndex + 1].file);
	}
};

const formatTime = s => {
	if (!isFinite(s) || s < 0) return '00:00';
	const minutes = Math.floor(s / 60);
	const seconds = Math.floor(s % 60);
	return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const showLoading = show => loading.classList.toggle('hidden', !show);

const showError = msg => {
	// Avoid stacking multiple error messages
	if (document.querySelector('.error-message')) return;

	const el = document.createElement('div');
	el.className = 'error-message';
	el.textContent = msg;
	// Basic styling injection just in case CSS isn't there
	el.style.cssText = "position:fixed; top:20px; right:20px; background:rgba(200,0,0,0.8); color:white; padding:10px; border-radius:4px; z-index:1000;";
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

const updateProgressBarUI = (time) => {
	// Clamp time for UI
	const displayTime = Math.max(0, Math.min(time, totalDuration));
	timeDisplay.textContent = `${formatTime(displayTime)} / ${formatTime(totalDuration)}`;
	const percent = totalDuration > 0 ? (displayTime / totalDuration) * 100 : 0;
	progressBar.style.width = `${percent}%`;
	progressHandle.style.left = `${percent}%`;
};

// --- Playlist Utility Functions ---
const findFileByPath = (nodes, path) => {
	const pathParts = path.split('/').filter(Boolean);
	if (pathParts.length === 0) return null;

	const itemName = pathParts[0];
	const node = nodes.find(n => n.name === itemName);

	if (!node) return null;

	if (pathParts.length === 1 && node.type === 'file') {
		return node.file;
	}

	if (node.type === 'folder' && pathParts.length > 1) {
		return findFileByPath(node.children, pathParts.slice(1).join('/'));
	}
	return null;
};

const handleFiles = (files) => {
	if (files.length === 0) return;

	// Filter for likely video/audio types
	const validFiles = Array.from(files).filter(file =>
		file.type.startsWith('video/') ||
		file.type.startsWith('audio/') ||
		file.name.match(/\.(mp4|webm|mkv|mov|mp3|wav|aac|flac|ogg)$/i)
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
			file.name.match(/\.(mp4|webm|mkv|mov|mp3|wav|aac|flac|ogg)$/i)
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
	event.target.value = ''; // Reset input
};

const mergeTrees = (mainTree, newTree) => {
	newTree.forEach(newItem => {
		const existingItem = mainTree.find(item => item.name === newItem.name && item.type === newItem.type);
		if (existingItem && existingItem.type === 'folder') {
			existingItem.children = mergeTrees(existingItem.children, newItem.children);
		} else if (!existingItem) {
			mainTree.push(newItem);
		}
		// If file with same name exists, we currently skip it. 
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
				return true; // Item found and removed
			} else if (nodes[i].type === 'folder') {
				const removed = removeItemFromPath(nodes[i].children, pathParts.slice(1).join('/'));
				// Remove empty folders
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
				// It's a file
				if (!currentLevel.some(item => item.type === 'file' && item.name === part)) {
					currentLevel.push({
						type: 'file',
						name: part,
						file: fileInfo.file
					});
				}
			} else {
				// It's a folder
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

// Escaping HTML to prevent injection via filenames
const escapeHTML = str => str.replace(/[&<>'"]/g,
	tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));

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
			let isActive = false;
			if (currentPlayingFile) {
				if (node.file instanceof File && currentPlayingFile instanceof File) {
					isActive = currentPlayingFile === node.file; // Assuming object reference holds
				} else if (typeof node.file === 'string' && typeof currentPlayingFile === 'string') {
					isActive = currentPlayingFile === node.file;
				}
			}
			html += `<li class="playlist-file ${isActive ? 'active' : ''}" data-path="${safePath}" title="${safeName}">
                        <span class="playlist-file-name" title="${safeName}">${safeName}</span>
                        <span class="remove-item" data-path="${safePath}">&times;</span>
                    </li>`;
		}
	});
	html += '</ul>';
	return html;
};

const updatePlaylistUI = () => {
	if (playlist.length === 0) {
		playlistContent.innerHTML = '<p style="padding:1rem; opacity:0.7; text-align:center;">No files.</p>';
		showDropZoneUI(); // Ensure dropzone is shown if playlist empty
		return;
	}
	playlistContent.innerHTML = renderTree(playlist);
};

const setVolume = val => {
	const vol = parseFloat(val);
	if (gainNode) {
		// Use exponential taper for better perceived volume control
		gainNode.gain.value = vol * vol;
	}
	muteBtn.textContent = vol > 0 ? '🔊' : '🔇';
};

const showControlsTemporarily = () => {
	clearTimeout(hideControlsTimeout);
	videoControls.classList.add('show');
	videoContainer.classList.remove('hide-cursor');

	if (playing) {
		hideControlsTimeout = setTimeout(() => {
			if (playing && !isSeeking && !videoControls.matches(':hover')) {
				videoControls.classList.remove('show');
				videoContainer.classList.add('hide-cursor');
				hideTrackMenus(); // Also hide menus
			}
		}, 3000);
	}
};

const setupEventListeners = () => {
	$('openFileBtn').onclick = () => $('fileInput').click();
	$('openFolderBtn').onclick = () => $('folderInput').click();
	$('clearPlaylistBtn').onclick = clearPlaylist;
	$('chooseFileBtn').onclick = () => $('fileInput').click();
	$('togglePlaylistBtn').onclick = () => playerArea.classList.toggle('playlist-visible');

	// Reset values to allow selecting same file again
	$('fileInput').onclick = (e) => e.target.value = null;
	$('fileInput').onchange = (e) => handleFiles(e.target.files);

	$('folderInput').onclick = (e) => e.target.value = null;
	$('folderInput').onchange = handleFolderSelection;

	playBtn.onclick = (e) => { e.stopPropagation(); togglePlay(); };

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

	// Track menu event listeners
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

	// Close track menus when clicking elsewhere
	document.addEventListener('click', (e) => {
		if (!e.target.closest('.control-group')) {
			hideTrackMenus();
		}
	});

	volumeSlider.onclick = (e) => e.stopPropagation();
	volumeSlider.oninput = (e) => setVolume(e.target.value);

	fullscreenBtn.onclick = (e) => {
		e.stopPropagation();
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else if (videoContainer.requestFullscreen) {
			videoContainer.requestFullscreen();
		}
	};

	// Seeking logic
	const handleSeekLine = (e) => {
		const rect = progressContainer.getBoundingClientRect();
		// Clamp between 0 and 1
		const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		return percent * totalDuration;
	};

	progressContainer.onpointerdown = (e) => {
		if (!fileLoaded) return;
		e.preventDefault(); // Prevent text selection
		isSeeking = true;
		progressContainer.setPointerCapture(e.pointerId);
		const seekTime = handleSeekLine(e);
		updateProgressBarUI(seekTime);
	};

	progressContainer.onpointermove = (e) => {
		if (!isSeeking) {
			showControlsTemporarily(); // Show controls on hover
			return;
		}
		const seekTime = handleSeekLine(e);
		updateProgressBarUI(seekTime);

		// Optional: Live seeking (might be performance intensive)
		// videoSink.getCanvas(seekTime).then(f => f && ctx.drawImage(f.canvas, 0, 0));
	};

	progressContainer.onpointerup = (e) => {
		if (!isSeeking) return;
		isSeeking = false;
		progressContainer.releasePointerCapture(e.pointerId);
		const seekTime = handleSeekLine(e);
		seekToTime(seekTime);
	};

	// Drag and Drop
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

	// Playlist Interactions
	playlistContent.onclick = (e) => {
		const removeButton = e.target.closest('.remove-item');
		if (removeButton) {
			e.stopPropagation();
			const pathToRemove = removeButton.dataset.path;
			const fileToRemove = findFileByPath(playlist, pathToRemove);

			let isPlayingFile = false;
			if (fileToRemove && currentPlayingFile) {
				if (fileToRemove instanceof File && currentPlayingFile instanceof File) {
					isPlayingFile = fileToRemove === currentPlayingFile;
				} else {
					isPlayingFile = fileToRemove === currentPlayingFile;
				}
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

		const fileElement = e.target.closest('.playlist-file');
		if (fileElement) {
			// Handle filename click to play
			if (e.target.classList.contains('playlist-file-name') || e.target === fileElement) {
				const path = fileElement.dataset.path;
				const fileToPlay = findFileByPath(playlist, path);
				if (fileToPlay && fileToPlay !== currentPlayingFile) {
					loadMedia(fileToPlay);
				}
			}
		}
	};

	// Keyboard Shortcuts
	document.onkeydown = (e) => {
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
		if (!fileLoaded) return;

		switch (e.code) {
			case 'Space':
			case 'KeyK':
				e.preventDefault();
				togglePlay();
				showControlsTemporarily();
				break;
			case 'KeyF':
				e.preventDefault();
				fullscreenBtn.click();
				break;
			case 'KeyM':
				e.preventDefault();
				muteBtn.click();
				showControlsTemporarily();
				break;
			case 'ArrowLeft':
				e.preventDefault();
				seekToTime(getPlaybackTime() - 5);
				showControlsTemporarily();
				break;
			case 'ArrowRight':
				e.preventDefault();
				seekToTime(getPlaybackTime() + 5);
				showControlsTemporarily();
				break;
			case 'ArrowUp':
				e.preventDefault();
				volumeSlider.value = Math.min(1, parseFloat(volumeSlider.value) + 0.1);
				setVolume(volumeSlider.value);
				showControlsTemporarily();
				break;
			case 'ArrowDown':
				e.preventDefault();
				volumeSlider.value = Math.max(0, parseFloat(volumeSlider.value) - 0.1);
				setVolume(volumeSlider.value);
				showControlsTemporarily();
				break;
		}
	};

	// --- Control visibility ---
	// Click on canvas toggles play
	canvas.onclick = (e) => {
		// User interaction required to resume AudioContext if suspended
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
};

// --- Initial Load ---
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
				}, { once: true });
			} else {
				loadMedia(decodedUrl);
			}
		} catch (e) {
			console.error("Error parsing video_url:", e);
		}
	}

	updatePlaylistUI(); // Initialize empty state

	if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
		navigator.serviceWorker.register('service-worker.js')
			.catch(err => console.log('ServiceWorker registration failed (expected if file missing):', err));
	}
});
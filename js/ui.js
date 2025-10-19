// js/ui.js

import * as C from './constants.js';
import { state, updateState } from './state.js';
import { findFileByPath } from './playlist.js';
import { formatTime, escapeHTML } from './utils.js';
import { switchAudioTrack, switchSubtitleTrack } from './player.js';

export const showLoading = show => C.loading.classList.toggle('hidden', !show);

const showMessageUtil = (msg, isError) => {
    C.showMessage.innerHTML = "";
	C.showMessage.className = isError ? "showMessage error-message" : "showMessage";
	const el = document.createElement('div');
	el.textContent = msg;
	C.showMessage.appendChild(el);
	setTimeout(() => {
		C.showMessage.innerHTML = "";
		C.showMessage.className = "showMessage hidden";
	}, 4000);
}
export const showError = msg => showMessageUtil(msg, true);
export const showInfo = msg => showMessageUtil(msg, false);

export const showStatusMessage = (msg) => {
	const statusEl = C.$('statusMessage');
	if (statusEl) {
		statusEl.textContent = msg;
		statusEl.style.display = 'block';
	}
	showLoading(true);
};

export const hideStatusMessage = () => {
	const statusEl = C.$('statusMessage');
	if (statusEl) {
		statusEl.textContent = '';
		statusEl.style.display = 'none';
	}
	showLoading(false);
};

export const showPlayerUI = () => {
	C.dropZone.style.display = 'none';
	C.playerArea.style.display = 'flex';
};

export const showDropZoneUI = () => {
	C.dropZone.style.display = 'flex';
	C.playerArea.style.display = 'none';
	updateProgressBarUI(0);
    updateState({ totalDuration: 0 });
};

export const updateProgressBarUI = (time) => {
	const displayTime = Math.max(0, Math.min(time, state.totalDuration));
	C.timeDisplay.textContent = `${formatTime(displayTime)} / ${formatTime(state.totalDuration)}`;
	const percent = state.totalDuration > 0 ? (displayTime / state.totalDuration) * 100 : 0;
	C.progressBar.style.width = `${percent}%`;
	C.progressHandle.style.left = `${percent}%`;
};

export const showControlsTemporarily = () => {
	clearTimeout(state.hideControlsTimeout);
	C.videoControls.classList.add('show');
	C.videoContainer.classList.remove('hide-cursor');

	if (state.playing) {
		const timeout = setTimeout(() => {
			if (state.playing && !state.isSeeking && !C.videoControls.matches(':hover') && !document.querySelector('.control-group:hover')) {
				C.videoControls.classList.remove('show');
				C.videoContainer.classList.add('hide-cursor');
				hideTrackMenus();
			}
		}, 3000);
        updateState({ hideControlsTimeout: timeout });
	}
};

const createPlaylistElement = (node, currentPath = '') => {
	const safeName = escapeHTML(node.name);
	const nodePath = currentPath ? `${currentPath}/${node.name}` : node.name;
	const safePath = escapeHTML(nodePath);

	if (node.type === 'folder') {
		const li = document.createElement('li');
		li.className = 'playlist-folder'; li.dataset.path = safePath;
		const details = document.createElement('details'); details.open = true;
		const summary = document.createElement('summary');
		const folderName = document.createElement('span');
		folderName.className = 'playlist-folder-name'; folderName.title = safeName; folderName.textContent = safeName;
		const removeBtn = document.createElement('span');
		removeBtn.className = 'remove-item'; removeBtn.dataset.path = safePath; removeBtn.textContent = '×';
		summary.append(folderName, removeBtn);
		details.appendChild(summary);
		const ul = document.createElement('ul'); ul.className = 'playlist-tree';
		node.children.forEach(child => ul.appendChild(createPlaylistElement(child, nodePath)));
		details.appendChild(ul); li.appendChild(details);
		return li;
	} else {
		const li = document.createElement('li');
		const isActive = (state.currentPlayingFile === node.file);
		li.className = `playlist-file ${node.isCutClip ? 'cut-clip' : ''} ${isActive ? 'active' : ''}`;
		li.dataset.path = safePath; li.title = safeName;
		const fileName = document.createElement('span');
		fileName.className = 'playlist-file-name'; fileName.title = safeName; fileName.textContent = safeName;
		li.appendChild(fileName);
		if (node.isCutClip) {
			const clipActions = document.createElement('div'); clipActions.className = 'clip-actions';
			const downloadBtn = document.createElement('button');
			downloadBtn.className = 'clip-action-btn'; downloadBtn.dataset.action = 'download'; downloadBtn.dataset.path = safePath; downloadBtn.textContent = '📥';
			const copyBtn = document.createElement('button');
			copyBtn.className = 'clip-action-btn'; copyBtn.dataset.action = 'copy'; copyBtn.dataset.path = safePath; copyBtn.textContent = '📋';
			clipActions.append(downloadBtn, copyBtn);
			li.appendChild(clipActions);
		}
		const removeBtn = document.createElement('span');
		removeBtn.className = 'remove-item'; removeBtn.dataset.path = safePath; removeBtn.textContent = '×';
		li.appendChild(removeBtn);
		return li;
	}
};

const updateActiveStates = () => {
	C.playlistContent.querySelectorAll('.playlist-file').forEach(fileEl => {
		const path = fileEl.dataset.path;
		const file = findFileByPath(state.playlist, path);
		fileEl.classList.toggle('active', file && file === state.currentPlayingFile);
	});
};

export const updatePlaylistUIOptimized = () => {
	if (state.playlist.length === 0) {
		C.playlistContent.innerHTML = '<p style="padding:1rem; opacity:0.7; text-align:center;">No files.</p>';
		state.playlistElementCache.clear();
		updateState({ lastRenderedPlaylist: null });
		if (!state.fileLoaded) showDropZoneUI();
		return;
	}
	const playlistString = JSON.stringify(state.playlist.map(p => p.name));
	if (playlistString === state.lastRenderedPlaylist) {
		updateActiveStates();
		return;
	}
	const fragment = document.createDocumentFragment();
	const ul = document.createElement('ul'); ul.className = 'playlist-tree';
	state.playlist.forEach(node => ul.appendChild(createPlaylistElement(node)));
	fragment.appendChild(ul);
	C.playlistContent.innerHTML = '';
	C.playlistContent.appendChild(fragment);
	updateState({ lastRenderedPlaylist: playlistString });
};

export const hideTrackMenus = () => {
	C.audioTrackMenu.classList.add('hidden');
	C.subtitleTrackMenu.classList.add('hidden');
	C.settingsMenu.classList.add('hidden');
};

export const updateTrackMenus = () => {
	C.audioTrackList.innerHTML = '';
	state.availableAudioTracks.forEach((track, index) => {
		const li = document.createElement('li');
		li.className = `track-item ${track === state.currentAudioTrack ? 'active' : ''}`;
		const label = (track.languageCode && track.languageCode !== 'und') ? track.languageCode : `Audio ${index + 1}`;
		li.innerHTML = `<span>${label}</span>`;
		li.onclick = () => switchAudioTrack(index);
		C.audioTrackList.appendChild(li);
	});

	C.subtitleTrackList.innerHTML = '';
	const noneOption = document.createElement('li');
	noneOption.className = `track-item ${!state.currentSubtitleTrack ? 'active' : ''}`;
	noneOption.innerHTML = `<span>Off</span>`;
	noneOption.onclick = () => switchSubtitleTrack('none');
	C.subtitleTrackList.appendChild(noneOption);

	state.availableSubtitleTracks.forEach((track, index) => {
		const li = document.createElement('li');
		li.className = `track-item ${track === state.currentSubtitleTrack ? 'active' : ''}`;
		const label = (track.languageCode && track.languageCode !== 'und') ? track.languageCode : `Subtitle ${index + 1}`;
		li.innerHTML = `<span>${label}</span>`;
		li.onclick = () => switchSubtitleTrack(index);
		C.subtitleTrackList.appendChild(li);
	});
};

export const positionCropCanvas = () => {
	if (!C.canvas.width || !C.canvas.height) return null;
	const containerRect = C.videoContainer.getBoundingClientRect();
	const { width: videoWidth, height: videoHeight } = C.canvas;
	const videoAspect = videoWidth / videoHeight;
	const containerAspect = containerRect.width / containerRect.height;
	let renderWidth, renderHeight, offsetX, offsetY;
	if (containerAspect > videoAspect) {
		renderHeight = containerRect.height; renderWidth = renderHeight * videoAspect;
		offsetX = (containerRect.width - renderWidth) / 2; offsetY = 0;
	} else {
		renderWidth = containerRect.width; renderHeight = renderWidth / videoAspect;
		offsetX = 0; offsetY = (containerRect.height - renderHeight) / 2;
	}
	C.cropCanvas.style.left = `${offsetX}px`; C.cropCanvas.style.top = `${offsetY}px`;
	C.cropCanvas.style.width = `${renderWidth}px`; C.cropCanvas.style.height = `${renderHeight}px`;
	return { renderWidth, renderHeight, offsetX, offsetY, videoWidth, videoHeight, scaleX: videoWidth / renderWidth, scaleY: videoHeight / renderHeight };
};

export const drawCropWithHandles = (rect) => {
	C.cropCtx.clearRect(0, 0, C.cropCanvas.width, C.cropCanvas.height);
	if (!rect || rect.width <= 0 || rect.height <= 0) return;
	const overlayColor = state.isPanning ? 'rgba(0, 50, 100, 0.6)' : 'rgba(0, 0, 0, 0.6)';
	C.cropCtx.fillStyle = overlayColor;
	C.cropCtx.fillRect(0, 0, C.cropCanvas.width, C.cropCanvas.height);
	C.cropCtx.clearRect(rect.x, rect.y, rect.width, rect.height);
	const borderColor = state.isPanning ? 'rgba(50, 150, 255, 0.9)' : 'rgba(255, 255, 255, 0.8)';
	C.cropCtx.strokeStyle = borderColor; C.cropCtx.lineWidth = 2;
	C.cropCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
	if (!state.isCropFixed) {
        const HANDLE_SIZE = 12, HANDLE_HALF = HANDLE_SIZE / 2;
		C.cropCtx.fillStyle = '#00ffff'; C.cropCtx.strokeStyle = '#ffffff'; C.cropCtx.lineWidth = 1;
		const corners = [
			{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
			{ x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }];
		corners.forEach(c => C.cropCtx.strokeRect(c.x - HANDLE_HALF, c.y - HANDLE_HALF, HANDLE_SIZE, HANDLE_SIZE));
	}
};

export const updateFixSizeButton = () => {
	if (!C.fixSizeBtn) return;
	const shouldShow = (state.isCropping || state.isPanning) && (state.cropRect || state.panRectSize);
	C.fixSizeBtn.style.display = shouldShow ? 'inline-block' : 'none';
	if (shouldShow) {
		C.fixSizeBtn.textContent = state.isCropFixed ? 'Resize' : 'Fix Size';
		C.fixSizeBtn.classList.toggle('hover_highlight', state.isCropFixed);
	}
};

export const updateShortcutKeysVisibility = () => {
    if (!C.shortcutKeysPanel) return;
    C.shortcutKeysPanel.classList.toggle('hidden', !state.isCropping && !state.isPanning);
};

export const updateDynamicCropOptionsUI = () => {
    C.scaleOptionContainer.style.display = (state.dynamicCropMode === 'max-size') ? 'flex' : 'none';
    C.blurOptionContainer.style.display = (state.dynamicCropMode === 'spotlight' || state.dynamicCropMode === 'max-size') ? 'flex' : 'none';
    C.smoothOptionContainer.style.display = (state.dynamicCropMode !== 'none') ? 'flex' : 'none';
};
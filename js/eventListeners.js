// js/eventListeners.js

import * as C from './constants.js';
import { state, updateState } from './state.js';
import * as UI from './ui.js';
import {
	togglePlay, seekToTime, getPlaybackTime, playPrevious, playNext, setVolume,
	setPlaybackSpeed, loadMedia, stopAndClear, play
} from './player.js';
import { handleFiles, findFileByPath, removeItemFromPath, clearPlaylist } from './playlist.js';
import {
	toggleStaticCrop, togglePanning, handleCutAction, takeScreenshot, resetAllConfigs,
	toggleCropFixed, getScaledCoordinates, getResizeHandle, isInsideCropRect,
	getCursorForHandle, applyResize, clampRectToVideoBounds
} from './editing.js';
import { parseTime, formatTime } from './utils.js';

export function setupEventListeners() {
    // --- File & Playlist ---
    C.clearPlaylistBtn.onclick = clearPlaylist;
    C.togglePlaylistBtn.onclick = () => C.playerArea.classList.toggle('playlist-visible');
    const setupInput = (input, isFolder) => {
        input.onclick = (e) => e.target.value = null;
        input.onchange = (e) => handleFiles(e.target.files);
    };
    setupInput(C.fileInput, false);
    setupInput(C.folderInput, true);
	C.playlistContent.addEventListener('click', (e) => {
		const fileEl = e.target.closest('.playlist-file');
		const removeBtn = e.target.closest('.remove-item');
        const actionBtn = e.target.closest('.clip-action-btn');
		if (removeBtn) {
			e.stopPropagation();
			const path = removeBtn.dataset.path;
			if (findFileByPath(state.playlist, path) === state.currentPlayingFile) stopAndClear();
			removeItemFromPath(state.playlist, path);
			UI.updatePlaylistUIOptimized();
		} else if (actionBtn) {
            e.stopPropagation();
			const file = findFileByPath(state.playlist, actionBtn.dataset.path);
			if (file instanceof Blob) {
				if (actionBtn.dataset.action === 'download') {
					const url = URL.createObjectURL(file); const a = document.createElement('a');
					a.href = url; a.download = file.name; a.click(); URL.revokeObjectURL(url);
				} else if (actionBtn.dataset.action === 'copy') {
					navigator.clipboard.write([new ClipboardItem({ [file.type]: file })])
                        .then(() => UI.showInfo('Clip copied!'), () => UI.showError('Copy failed.'));
				}
			}
        } else if (fileEl) {
			const fileToPlay = findFileByPath(state.playlist, fileEl.dataset.path);
			if (fileToPlay && fileToPlay !== state.currentPlayingFile) loadMedia(fileToPlay);
		}
	});

    // --- Player Controls ---
    C.playBtn.onclick = (e) => { e.stopPropagation(); togglePlay(); };
    C.prevBtn.onclick = (e) => { e.stopPropagation(); playPrevious(); };
    C.nextBtn.onclick = (e) => { e.stopPropagation(); playNext(); };
    C.muteBtn.onclick = (e) => {
		e.stopPropagation();
		C.volumeSlider.value = parseFloat(C.volumeSlider.value) > 0 ? 0 : (C.volumeSlider.dataset.lastVolume || 1);
		setVolume(C.volumeSlider.value);
	};
    C.volumeSlider.oninput = (e) => { C.volumeSlider.dataset.lastVolume = e.target.value; setVolume(e.target.value); };
    C.fullscreenBtn.onclick = (e) => {
		e.stopPropagation();
		if (document.fullscreenElement) document.exitFullscreen();
		else C.playerArea.requestFullscreen();
	};
    C.playbackSpeedInput.oninput = () => setPlaybackSpeed(parseFloat(C.playbackSpeedInput.value) || 1.0);
    C.autoplayToggle.onchange = () => updateState({ isAutoplayEnabled: C.autoplayToggle.checked });
    C.canvas.onclick = () => { if (state.audioContext?.state === 'suspended') state.audioContext.resume(); togglePlay(); };

    // --- Seeking ---
	const handleSeekLine = (e) => (Math.max(0, Math.min(1, (e.clientX - C.progressContainer.getBoundingClientRect().left) / C.progressContainer.clientWidth))) * state.totalDuration;
	C.progressContainer.onpointerdown = (e) => {
		if (!state.fileLoaded) return;
		e.preventDefault(); updateState({ isSeeking: true });
		C.progressContainer.setPointerCapture(e.pointerId);
		UI.updateProgressBarUI(handleSeekLine(e));
	};
	C.progressContainer.onpointermove = (e) => {
		if (state.isSeeking) UI.updateProgressBarUI(handleSeekLine(e));
        else UI.showControlsTemporarily();
	};
	C.progressContainer.onpointerup = (e) => {
		if (!state.isSeeking) return;
		updateState({ isSeeking: false });
		C.progressContainer.releasePointerCapture(e.pointerId);
		seekToTime(handleSeekLine(e));
	};

    // --- Menus ---
    const setupMenuToggle = (btn, menu) => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const isHidden = menu.classList.contains('hidden');
            UI.hideTrackMenus();
            if(isHidden) menu.classList.remove('hidden');
        };
    };
    setupMenuToggle(C.audioTrackCtrlBtn, C.audioTrackMenu);
    setupMenuToggle(C.subtitleTrackCtrlBtn, C.subtitleTrackMenu);
    setupMenuToggle(C.settingsCtrlBtn, C.settingsMenu);
    document.addEventListener('click', (e) => { if (!e.target.closest('.track-menu, .control-btn, .split-action-btn')) UI.hideTrackMenus(); });

    // --- Editing & Settings ---
    C.loopBtn.onclick = () => {
        if (state.isLooping) { updateState({ isLooping: false }); }
        else {
            const start = parseTime(C.startTimeInput.value), end = parseTime(C.endTimeInput.value);
            if (isNaN(start) || isNaN(end) || start >= end) return UI.showError("Invalid loop times.");
            updateState({ isLooping: true, loopStartTime: start, loopEndTime: end });
            const currentTime = getPlaybackTime();
            if (currentTime < start || currentTime > end) seekToTime(start);
            if (!state.playing) play();
        }
        C.loopBtn.classList.toggle('hover_highlight', state.isLooping);
        C.loopBtn.textContent = state.isLooping ? 'Looping...' : 'Loop';
    };
    C.cutBtn.onclick = handleCutAction;
    C.screenshotBtn.onclick = takeScreenshot;
    C.cropBtn.onclick = toggleStaticCrop;
	C.panScanBtn.onclick = togglePanning;
    if (C.fixSizeBtn) C.fixSizeBtn.onclick = (e) => { e.stopPropagation(); toggleCropFixed(); };
    if (C.resetAllBtn) C.resetAllBtn.onclick = resetAllConfigs;

    // --- Crop Canvas ---
    C.cropCanvas.onpointerdown = (e) => {
        if (!state.isCropping && !state.isPanning) return;
		e.preventDefault(); C.cropCanvas.setPointerCapture(e.pointerId);
		const coords = getScaledCoordinates(e);
		const currentRect = state.isCropping ? state.cropRect : state.panKeyframes.at(-1)?.rect;
		if (currentRect && !state.isCropFixed) {
			const handle = getResizeHandle(coords.x, coords.y, currentRect);
			if (handle) updateState({ isResizingCrop: true, originalCropRect: { ...currentRect }, dragStartPos: coords, resizeHandle: handle });
			else if (isInsideCropRect(coords.x, coords.y, currentRect)) updateState({ isDraggingCrop: true, originalCropRect: { ...currentRect }, dragStartPos: coords });
			else updateState({ isDrawingCrop: true, cropStart: coords, cropEnd: coords, cropRect: null });
		} else if (currentRect && state.isCropFixed && state.isPanning) {
			updateState({ isDraggingCrop: true, dragStartPos: coords });
		} else {
			updateState({ isDrawingCrop: true, cropStart: coords, cropEnd: coords, cropRect: null });
		}
    };
    C.cropCanvas.onpointermove = (e) => {
        const coords = getScaledCoordinates(e);
        const currentRect = state.isCropping ? state.cropRect : state.panKeyframes.at(-1)?.rect;
        if (!state.isDrawingCrop && !state.isDraggingCrop && !state.isResizingCrop) {
            if (currentRect && !state.isCropFixed) {
                const handle = getResizeHandle(coords.x, coords.y, currentRect);
                C.cropCanvas.style.cursor = getCursorForHandle(handle || (isInsideCropRect(coords.x, coords.y, currentRect) ? 'move' : null));
            } else if (state.isPanning && state.panRectSize && state.isCropFixed) {
                let rect = { ...state.panRectSize, x: coords.x - state.panRectSize.width / 2, y: coords.y - state.panRectSize.height / 2 };
                rect = clampRectToVideoBounds(rect); state.panKeyframes.push({ timestamp: getPlaybackTime(), rect });
                UI.drawCropWithHandles(rect);
            }
            return;
        }
        e.preventDefault();
        let newRect;
        if (state.isDrawingCrop) {
            newRect = { x: Math.min(state.cropStart.x, coords.x), y: Math.min(state.cropStart.y, coords.y), width: Math.abs(state.cropStart.x - coords.x), height: Math.abs(state.cropStart.y - coords.y) };
            updateState({ cropRect: newRect });
        } else if (state.isResizingCrop) {
            newRect = applyResize(state.resizeHandle, coords.x - state.dragStartPos.x, coords.y - state.dragStartPos.y, state.originalCropRect);
            if (state.isCropping) updateState({ cropRect: newRect });
            else if (state.isPanning) { state.panKeyframes.at(-1).rect = newRect; updateState({ panRectSize: { width: newRect.width, height: newRect.height } }); }
        } else if (state.isDraggingCrop) {
            newRect = { ...state.originalCropRect, x: state.originalCropRect.x + (coords.x - state.dragStartPos.x), y: state.originalCropRect.y + (coords.y - state.dragStartPos.y) };
            newRect = clampRectToVideoBounds(newRect);
            if (state.isCropping) updateState({ cropRect: newRect });
            else if (state.isPanning) {
                if (state.isCropFixed) state.panKeyframes.push({ timestamp: getPlaybackTime(), rect: newRect });
                else state.panKeyframes.at(-1).rect = newRect;
            }
        }
        UI.drawCropWithHandles(newRect || state.cropRect);
    };
    C.cropCanvas.onpointerup = (e) => {
        if (!state.isDrawingCrop && !state.isDraggingCrop && !state.isResizingCrop) return;
        e.preventDefault(); C.cropCanvas.releasePointerCapture(e.pointerId);
        if (state.isDrawingCrop) {
            if (state.cropRect.width < 10 || state.cropRect.height < 10) updateState({ cropRect: null });
            else if (state.isPanning) {
                updateState({ panRectSize: { width: state.cropRect.width, height: state.cropRect.height } });
                state.panKeyframes.push({ timestamp: getPlaybackTime(), rect: state.cropRect });
            }
        }
        updateState({ isDrawingCrop: false, isDraggingCrop: false, isResizingCrop: false, resizeHandle: null, originalCropRect: null });
        C.cropCanvas.style.cursor = 'crosshair';
        UI.updateFixSizeButton();
    };
    C.cropCanvas.addEventListener('wheel', (e) => {
        if (!state.isPanning || !state.isShiftPressed || !state.panRectSize) return;
		e.preventDefault();
		const lastKeyframe = state.panKeyframes.at(-1); if (!lastKeyframe) return;
		const coords = getScaledCoordinates(e);
		const zoomFactor = e.deltaY < 0 ? 0.95 : 1.05;
		const { width, height, x, y } = lastKeyframe.rect;
		const newWidth = width * zoomFactor; const newHeight = height * zoomFactor;
		lastKeyframe.rect = clampRectToVideoBounds({
            width: newWidth, height: newHeight,
            x: coords.x - (newWidth * ((coords.x - x) / width)),
            y: coords.y - (newHeight * ((coords.y - y) / height))
        });
		UI.drawCropWithHandles(lastKeyframe.rect);
    }, { passive: false });

    // --- Keyboard & Global Listeners ---
    document.onkeydown = (e) => {
        if (e.target.tagName === 'INPUT' || !state.fileLoaded) return;
        const actions = { ' ': togglePlay, 'k': togglePlay, 'f': () => C.fullscreenBtn.click(), 'm': () => C.muteBtn.click(), 'ArrowLeft': () => seekToTime(getPlaybackTime() - 5), 'ArrowRight': () => seekToTime(getPlaybackTime() + 5), 'l': () => { if (state.isPanning) toggleCropFixed() }, 's': takeScreenshot, 'c': handleCutAction, 'Escape': resetAllConfigs };
        if (actions[e.key]) { e.preventDefault(); actions[e.key](); UI.showControlsTemporarily(); }
    };
    document.addEventListener('keydown', (e) => { if (e.key === 'Shift') updateState({ isShiftPressed: true }); });
    document.addEventListener('keyup', (e) => { if (e.key === 'Shift') updateState({ isShiftPressed: false }); });
    window.addEventListener('resize', () => { if (state.isCropping || state.isPanning) UI.positionCropCanvas(); });
}
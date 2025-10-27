// ============================================================================
// EVENT LISTENERS & HANDLERS
// ============================================================================


import { $, videoContainer, canvas, dropZone, progressContainer, volumeSlider, muteBtn, fullscreenBtn, videoControls, loopBtn, cutBtn, screenshotBtn, screenshotOverlay, screenshotPreviewImg, closeScreenshotBtn, copyScreenshotBtn, downloadScreenshotBtn, playbackSpeedInput, autoplayToggle, urlModal, urlInput, loadUrlBtn, cancelUrlBtn, panScanBtn } from './constants.js';
import { state } from './state.js';
import { resetAllConfigs } from './settings.js'
import { handleCutAction } from './editing.js'
import { formatTime, guidedPanleInfo, updateShortcutKeysVisibility, } from './utility.js'
import { getPlaybackTime, loadMedia, seekToTime, setPlaybackSpeed, setVolume, startVideoIterator, toggleLoop, togglePlay, setupPlayerListener } from './player.js'
import { handleFiles, handleFolderSelection, setupPlaylistEventListeners } from './playlist.js'
import { takeScreenshot } from './screenshot.js'
import { showControlsTemporarily, showError } from './ui.js'
import { audioEventlistener } from './audio.js';
import { setupSettingsListeners } from './settings.js';
import { lenvetlistener } from './recording.js'
import { toggleCropFixed, setupCropListener } from './crop.js';
import { setupCaptionListeners } from './caption.js';
import {
	setupBlurListeners
} from './blur.js';
export const setupEventListeners = () => {
	$('chooseFileBtn').onclick = () => {
		state.fileLoaded = false;
		$('fileInput').click();
	};

	$('fileInput').onclick = (e) => e.target.value = null;
	$('fileInput').onchange = (e) => handleFiles(e.target.files);

	$('folderInput').onclick = (e) => e.target.value = null;
	$('folderInput').onchange = handleFolderSelection;

	const mainActionBtn = $('mainActionBtn');
	const dropdownActionBtn = $('dropdownActionBtn');
	const actionDropdownMenu = $('actionDropdownMenu');

	// Helper function to execute the chosen action
	const executeOpenFileAction = (action) => {
		if (!state.playing) {
			state.fileLoaded = false;
		}
		switch (action) {
			case 'open-url':
				urlModal.classList.remove('hidden');
				urlInput.focus();
				break;
			case 'open-file':
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
	if (mainActionBtn) {
		mainActionBtn.onclick = () => {
			executeOpenFileAction(state.currentOpenFileAction);
		};
	}

	// 2. Dropdown button shows/hides the menu
	if (dropdownActionBtn) {
		dropdownActionBtn.onclick = (e) => {
			e.stopPropagation();
			actionDropdownMenu.classList.toggle('hidden');
		};
	}

	// 3. Clicks inside the dropdown menu set the action and execute it
	if (actionDropdownMenu) {
		actionDropdownMenu.addEventListener('click', (e) => {
			const target = e.target.closest('button[data-action]');
			if (!target) return;

			const action = target.dataset.action;

			// Update state
			state.currentOpenFileAction = action;

			// Update UI
			mainActionBtn.textContent = target.textContent;

			// Hide menu and execute
			actionDropdownMenu.classList.add('hidden');
			executeOpenFileAction(action);
		});
	}

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

	setupPlaylistEventListeners();
	audioEventlistener();
	setupSettingsListeners();
	setupCropListener();
	setupPlayerListener();
	setupCaptionListeners();
	setupBlurListeners();

	document.onkeydown = (e) => {
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || !state.fileLoaded) return;

		// Handle frame-by-frame seeking when paused
		if (!state.playing && state.videoTrack && state.videoTrack.frameRate > 0) {
			if (e.code === 'KeyN') { // 'n' for next frame
				e.preventDefault();
				const newTime = getPlaybackTime() + (1 / state.videoTrack.frameRate);
				seekToTime(newTime);
				showControlsTemporarily();
				return; // Stop further execution for this key press
			}
			if (e.code === 'KeyP') { // 'p' for previous frame
				e.preventDefault();
				const newTime = getPlaybackTime() - (1 / state.videoTrack.frameRate);
				seekToTime(newTime);
				showControlsTemporarily();
				return; // Stop further execution for this key press
			}
		}

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
		if (document.visibilityState === 'visible' && state.playing && state.fileLoaded) {
			const now = getPlaybackTime();
			const videoTime = state.nextFrame ? state.nextFrame.timestamp : now;

			if (now - videoTime > 0.25) {
				startVideoIterator();
			}
		}
	});

	loopBtn.onclick = toggleLoop;
	cutBtn.onclick = handleCutAction;
	screenshotBtn.onclick = takeScreenshot;

	const closeScreenshotModal = () => {
		screenshotOverlay.classList.add('hidden');
		if (screenshotPreviewImg.src && screenshotPreviewImg.src.startsWith('blob:')) {
			URL.revokeObjectURL(screenshotPreviewImg.src);
		}
		state.currentScreenshotBlob = null;
	};

	closeScreenshotBtn.onclick = closeScreenshotModal;
	screenshotOverlay.onclick = (e) => {
		if (e.target === screenshotOverlay) {
			closeScreenshotModal();
		}
	};

	downloadScreenshotBtn.onclick = () => {
		if (!state.currentScreenshotBlob) return;

		const timestamp = formatTime(getPlaybackTime()).replace(/:/g, '-');
		const originalName = (state.currentPlayingFile.name || 'video').split('.').slice(0, -1).join('.');
		const filename = `${originalName}_${timestamp}.png`;

		const a = document.createElement('a');
		a.href = screenshotPreviewImg.src;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	};

	copyScreenshotBtn.onclick = () => {
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

	playbackSpeedInput.oninput = () => {
		let speed = parseFloat(playbackSpeedInput.value);
		if (isNaN(speed)) speed = 1;
		if (!isNaN(speed) && speed >= 0.25 && speed <= 4) {
			setPlaybackSpeed(speed);
		}
	};

	autoplayToggle.onchange = () => {
		state.isAutoplayEnabled = autoplayToggle.checked;
	};
	// --- Add URL Modal Logic Here ---

	const hideUrlModal = () => {
		urlModal.classList.add('hidden');
	};

	cancelUrlBtn.onclick = hideUrlModal;

	// Hide the modal if the user clicks on the background
	urlModal.onclick = (e) => {
		if (e.target === urlModal) {
			hideUrlModal();
		}
	};

	// Handle loading the URL
	loadUrlBtn.onclick = () => {
		const url = urlInput.value.trim();
		if (url) {
			// The existing loadMedia function already supports URLs!
			loadMedia(url);
			hideUrlModal();
		} else {
			showError("Please enter a valid URL.");
		}
	};

	// Add keyboard shortcuts for the modal
	urlInput.onkeydown = (e) => {
		if (e.key === 'Enter') {
			e.preventDefault(); // Prevent form submission
			loadUrlBtn.click();
		} else if (e.key === 'Escape') {
			hideUrlModal();
		}
	};
	// --- End of URL Modal Logic ---

	// 1. Add global listeners to track the Shift key state
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Shift') {
			state.isShiftPressed = true;
		}
		if (e.key === 'Alt') {
			e.preventDefault();
			state.isAltPressed = true;
		}
	});

	document.addEventListener('keyup', (e) => {
		if (e.key === 'Shift') {
			state.isShiftPressed = false;
		}
		if (e.key === 'Alt') {
			e.preventDefault();
			state.isAltPressed = false;
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
			panScanBtn.textContent = 'Path Recorded!';
			guidedPanleInfo("Path recorded. The crop will now remain fixed. You can now use 'Process Clip' or Press 'c' to create a clip.");
		}
	});
	const resetAllBtn = $('resetAllBtn'); // Find our new button ID
	if (resetAllBtn) {
		resetAllBtn.onclick = resetAllConfigs; // Simply call our powerful new function
	}
	document.getElementById("guideInfoCloseBtn").click = () => {
		document.getElementById("guide_panel").classList.add('hidden');
	}
};



document.addEventListener('keydown', (e) => {
	// Ignore key handling if user is typing in an input, textarea, or content-editable
	const activeElement = document.activeElement;
	const isInput =
		activeElement instanceof HTMLInputElement ||
		activeElement instanceof HTMLTextAreaElement ||
		activeElement?.hasAttribute('contenteditable');

	if (isInput || (!state.screenrecording && !state.fileLoaded)) {
		// Allow normal typing; do not intercept
		return;
	}
	if (e.key.toLowerCase() === 's') {
		e.preventDefault();
		takeScreenshot()
	} else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
		e.preventDefault();
		handleCutAction();
	} else if (e.key.toLowerCase() === 'escape') {
		e.preventDefault();
		resetAllConfigs();
	} else if (e.key === 'Backspace') {
		state.buffer = state.buffer.slice(0, -1);
	} else if (e.key.toLowerCase() === 'l') {
		e.stopPropagation();
		if (state.screenrecording) {
			lenvetlistener();
		} else {
			toggleCropFixed();
		}
	} else if (e.key.length === 1) {
		state.buffer += e.key;

		// Keep only last 2 characters
		if (state.buffer.length > 2) state.buffer = state.buffer.slice(-2);

		// Check for double slash
		if (state.buffer === '//') {
			updateShortcutKeysVisibility();
			state.buffer = ''; // reset buffer after trigger
		}
	}
});
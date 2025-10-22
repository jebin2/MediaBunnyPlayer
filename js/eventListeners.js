// ============================================================================
// EVENT LISTENERS & HANDLERS
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
	BufferTarget,
	QUALITY_HIGH
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';

import { $, MEDIABUNNY_URL, playerArea, videoContainer, canvas, dropZone, loading, playBtn, timeDisplay, progressContainer, progressBar, volumeSlider, muteBtn, fullscreenBtn, sidebar, videoControls, progressHandle, startTimeInput, endTimeInput, settingsCtrlBtn, settingsMenu, loopBtn, cutBtn, screenshotBtn, screenshotOverlay, screenshotPreviewImg, closeScreenshotBtn, copyScreenshotBtn, downloadScreenshotBtn, playbackSpeedInput, autoplayToggle, urlModal, urlInput, loadUrlBtn, cancelUrlBtn, showMessage, cropModeRadios, scaleOptionContainer, scaleWithRatioToggle, blurOptionContainer, smoothOptionContainer, smoothPathToggle, blurBackgroundToggle, blurAmountInput, HANDLE_SIZE, HANDLE_HALF, fixSizeBtn, prevBtn, nextBtn, cropBtn, cropCanvas, cropCtx, queuedAudioNodes, panScanBtn, ctx } from './constants.js';
import { state } from './state.js';
import { resetAllConfigs, updateDynamicCropOptionsUI } from './config.js'
import { applyResize, clampRectToVideoBounds, drawCropOverlay,drawCropWithHandles, getCursorForHandle, getInterpolatedCropRect, getResizeHandle, getScaledCoordinates, isInsideCropRect, positionCropCanvas, smoothPathWithMovingAverage, toggleCropFixed, togglePanning, toggleStaticCrop, updateFixSizeButton } from './crop.js'
import { handleCutAction } from './editing.js'
import { dynamicVideoUrl, escapeHTML, formatTime, guidedPanleInfo, parseTime, registerServiceWorker, updateShortcutKeysVisibility, } from './utility.js'
import { checkPlaybackState, ensureSubtitleRenderer, getPlaybackTime, handleConversion, hideTrackMenus, loadMedia, pause, play, playNext, playPrevious, removeSubtitleOverlay, renderLoop, runAudioIterator, scheduleProgressUpdate, seekToTime, setPlaybackSpeed, setVolume, startVideoIterator, stopAndClear, switchAudioTrack, switchSubtitleTrack, toggleLoop, togglePlay, updateNextFrame, updateSubtitlesOptimized, updateTrackMenus } from './player.js'
import { clearPlaylist, findFileByPath, handleFiles, handleFolderSelection, removeItemFromPath, updatePlaylistUIOptimized, setupPlaylistEventListeners } from './playlist.js'
import { takeScreenshot } from './screenshot.js'
import { hideStatusMessage, showControlsTemporarily, showDropZoneUI, showError, showInfo, showLoading, showPlayerUI, showStatusMessage, updateProgressBarUI, updateTimeInputs } from './ui.js'
import { audioEventlistener } from './audio.js';

export const setupEventListeners = () => {
	$('clearPlaylistBtn').onclick = clearPlaylist;
	$('chooseFileBtn').onclick = () => {
		state.fileLoaded = false;
		$('fileInput').click();
	};
	$('togglePlaylistBtn').onclick = () => {
		playerArea.classList.toggle('playlist-visible');
		setTimeout(() => {
			state.cropCanvasDimensions = positionCropCanvas();
		}, 200);
	}

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

	const mainActionBtn = $('mainActionBtn');
	const dropdownActionBtn = $('dropdownActionBtn');
	const actionDropdownMenu = $('actionDropdownMenu');

	// Helper function to execute the chosen action
	const executeOpenFileAction = (action) => {
		switch (action) {
			case 'open-url':
				urlModal.classList.remove('hidden');
				urlInput.focus();
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
			if (actionDropdownMenu) actionDropdownMenu.classList.add('hidden'); // Also hide the action menu
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
	setupPlaylistEventListeners();
	audioEventlistener();

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

	settingsCtrlBtn.onclick = (e) => {
		e.stopPropagation();
		const isHidden = settingsMenu.classList.contains('hidden');
		hideTrackMenus();
		if (isHidden) {
			settingsMenu.classList.remove('hidden');
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
	cropBtn.onclick = toggleStaticCrop;
	panScanBtn.onclick = togglePanning;

	cropCanvas.onpointerdown = (e) => {
		// This logic now applies to both modes
		if (!state.isCropping && !state.isPanning) return;
		e.preventDefault();
		cropCanvas.setPointerCapture(e.pointerId);

		state.isDrawingCrop = true;
		const coords = getScaledCoordinates(e);
		state.cropStart = coords;
		state.cropEnd = coords;
	};

	cropCanvas.onpointerdown = (e) => {
		if (!state.isCropping && !state.isPanning) return;
		e.preventDefault();
		cropCanvas.setPointerCapture(e.pointerId);

		const coords = getScaledCoordinates(e);

		// If we have an existing crop rect
		const currentRect = state.isCropping ? state.cropRect :
			(state.panKeyframes.length > 0 ? state.panKeyframes[state.panKeyframes.length - 1].rect : null);

		if (currentRect && !state.isCropFixed) {
			// Check if clicking on a resize handle
			state.resizeHandle = getResizeHandle(coords.x, coords.y, currentRect);

			if (state.resizeHandle) {
				state.isResizingCrop = true;
				state.originalCropRect = { ...currentRect };
				state.dragStartPos = coords;
			} else if (isInsideCropRect(coords.x, coords.y, currentRect)) {
				// Clicking inside crop area - start dragging
				state.isDraggingCrop = true;
				state.originalCropRect = { ...currentRect };
				state.dragStartPos = coords;
			} else {
				// Clicking outside - start drawing new rect
				state.isDrawingCrop = true;
				state.cropStart = coords;
				state.cropEnd = coords;
			}
		} else if (currentRect && state.isCropFixed && state.isPanning) {
			// In panning mode with fixed size, any click starts recording movement
			state.isDraggingCrop = true;
			state.dragStartPos = coords;
		} else {
			// No existing rect - start drawing
			state.isDrawingCrop = true;
			state.cropStart = coords;
			state.cropEnd = coords;
		}
	};

	cropCanvas.onpointermove = (e) => {
		const coords = getScaledCoordinates(e);

		// Update cursor based on position
		if (!state.isDrawingCrop && !state.isDraggingCrop && !state.isResizingCrop) {
			const currentRect = state.isCropping ? state.cropRect :
				(state.panKeyframes.length > 0 ? state.panKeyframes[state.panKeyframes.length - 1].rect : null);

			if (currentRect && !state.isCropFixed) {
				const handle = getResizeHandle(coords.x, coords.y, currentRect);
				if (handle) {
					cropCanvas.style.cursor = getCursorForHandle(handle);
				} else if (isInsideCropRect(coords.x, coords.y, currentRect)) {
					cropCanvas.style.cursor = 'move';
				} else {
					cropCanvas.style.cursor = 'crosshair';
				}
			} else if (state.isPanning && state.panRectSize && state.isCropFixed) {
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
		if (state.isResizingCrop && state.originalCropRect) {
			e.preventDefault();
			const deltaX = coords.x - state.dragStartPos.x;
			const deltaY = coords.y - state.dragStartPos.y;

			const newRect = applyResize(state.resizeHandle, deltaX, deltaY, state.originalCropRect);

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
		if (state.isDraggingCrop && state.originalCropRect) {
			e.preventDefault();
			const deltaX = coords.x - state.dragStartPos.x;
			const deltaY = coords.y - state.dragStartPos.y;

			let newRect = {
				x: state.originalCropRect.x + deltaX,
				y: state.originalCropRect.y + deltaY,
				width: state.originalCropRect.width,
				height: state.originalCropRect.height
			};

			newRect = clampRectToVideoBounds(newRect);

			if (state.isCropping) {
				state.cropRect = newRect;
			} else if (state.isPanning) {
				if (state.isCropFixed) {
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

	cropCanvas.onpointerup = (e) => {
		if (!state.isDrawingCrop && !state.isDraggingCrop && !state.isResizingCrop) return;
		e.preventDefault();
		cropCanvas.releasePointerCapture(e.pointerId);

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
				cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
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
		state.isDraggingCrop = false;
		state.isResizingCrop = false;
		state.resizeHandle = null;
		state.originalCropRect = null;
		cropCanvas.style.cursor = 'crosshair';

		updateFixSizeButton();
	};

	// 2. Add the wheel event listener for zooming
	cropCanvas.addEventListener('wheel', (e) => {
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
			panScanBtn.textContent = 'Path Recorded!';
			guidedPanleInfo("Path recorded. The crop will now remain fixed. You can now use 'Process Clip' or Press 'c' to create a clip.");
		}
	});

	// Trigger the UI visibility update
	if (cropModeRadios.length > 0) {
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
				smoothPathToggle.checked = true;
				state.smoothPath = true;
			}
			if (blurBackgroundToggle) {
				blurBackgroundToggle.checked = false;
				state.useBlurBackground = false;
				blurAmountInput.value = 15; // And reset its value
				state.blurAmount = 15;
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
				state.blurAmount = Math.max(1, Math.min(100, amount)); // Clamp value between 1 and 100
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
			settingsMenu.classList.add('hidden');
		}
	});
};

window.addEventListener('resize', () => {
    clearTimeout(state.resizeTimeout);
    state.resizeTimeout = setTimeout(() => {
        if ((state.isCropping || state.isPanning) && !cropCanvas.classList.contains('hidden')) {
            state.cropCanvasDimensions = positionCropCanvas();
            // Redraw current crop
            const currentRect = state.isCropping ? state.cropRect :
                (state.panKeyframes.length > 0 ? state.panKeyframes[state.panKeyframes.length - 1].rect : null);
            if (currentRect) {
                drawCropWithHandles(currentRect);
            }
        }
    }, 100);
});

document.addEventListener('keydown', (e) => {
	if (state.isPanning && state.panRectSize && e.key.toLowerCase() === 'r' && !state.isCropFixed) {
		e.preventDefault();
		toggleCropFixed();
		if (state.isCropFixed && !state.playing) {
			play(); // Auto-start playback when fixing size in pan mode
		}
	} else if (e.key.toLowerCase() === 's') {
		e.preventDefault();
		takeScreenshot()
	} else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
		e.preventDefault();
		handleCutAction()
	} else if (e.key.toLowerCase() === 'escape') {
		e.preventDefault();
		resetAllConfigs();
	} else if (e.key === 'Backspace') {
		state.buffer = state.buffer.slice(0, -1);
	} else if (e.key.toLowerCase() === 'l') {
		e.stopPropagation();
		toggleCropFixed();
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
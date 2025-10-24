// ============================================================================
// STATIC CROP FUNCTIONALITY
// ============================================================================

import { videoContainer, canvas, HANDLE_SIZE, HANDLE_HALF, fixSizeBtn, cropBtn, cropCanvas, cropCtx, panScanBtn, cropModeRadios, scaleWithRatioToggle, smoothPathToggle, blurBackgroundToggle, blurAmountInput } from './constants.js';
import { state } from './state.js';
import { updateDynamicCropOptionsUI } from './settings.js'
import { guidedPanleInfo, } from './utility.js'
import { getPlaybackTime, play } from './player.js'

export const setupCropListener = () => {
	cropBtn.onclick = toggleStaticCrop;
	panScanBtn.onclick = togglePanning;

	cropCanvas.onpointerdown = (e) => {
		if (!state.isCropping && !state.isPanning) return;
		e.preventDefault();
		cropCanvas.setPointerCapture(e.pointerId);

		const coords = getScaledCoordinates(e);

		// Get current rect
		const currentRect = state.isCropping ? state.cropRect :
			(state.panKeyframes.length > 0 ? state.panKeyframes[state.panKeyframes.length - 1].rect : null);

		// NEW: For fixed aspect ratios, use maxRatioRect as the current rect if no rect exists yet
		const activeRect = currentRect || (state.aspectRatioLocked ? state.maxRatioRect : null);

		if (activeRect && !state.isCropFixed) {
			// Check if clicking on a resize handle
			state.resizeHandle = getResizeHandle(coords.x, coords.y, activeRect);

			if (state.resizeHandle) {
				state.isResizingCrop = true;
				state.originalCropRect = { ...activeRect };
				state.dragStartPos = coords;
			} else if (isInsideCropRect(coords.x, coords.y, activeRect)) {
				// Clicking inside crop area - start dragging
				state.isDraggingCrop = true;
				state.originalCropRect = { ...activeRect };
				state.dragStartPos = coords;
			} else if (!state.aspectRatioLocked) {
				// NEW: Only allow drawing new rect if NOT in fixed ratio mode
				state.isDrawingCrop = true;
				state.cropStart = coords;
				state.cropEnd = coords;
			}
			// NEW: If aspectRatioLocked and clicking outside, do nothing (ignore the click)
		} else if (activeRect && state.isCropFixed && state.isPanning) {
			// In panning mode with fixed size, any click starts recording movement
			state.isDraggingCrop = true;
			state.dragStartPos = coords;
		} else if (!state.aspectRatioLocked) {
			// NEW: Only allow drawing if NOT in fixed ratio mode
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

		if (state.isDrawingCrop) {
			let finalRect = {
				x: Math.min(state.cropStart.x, state.cropEnd.x),
				y: Math.min(state.cropStart.y, state.cropEnd.y),
				width: Math.abs(state.cropStart.x - state.cropEnd.x),
				height: Math.abs(state.cropStart.y - state.cropEnd.y)
			};

			// NEW: Apply ratio constraints if locked
			if (state.aspectRatioLocked && state.maxRatioRect) {
				const [ratioW, ratioH] = state.aspectRatioMode === '16:9' ? [16, 9] : [9, 16];
				finalRect = constrainToRatio(finalRect, state.maxRatioRect, ratioW / ratioH);
			}

			if (finalRect.width < 10 || finalRect.height < 10) {
				state.cropRect = null;
				state.panRectSize = null;
				cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);

				// Redraw max rect if ratio locked
				if (state.aspectRatioLocked && state.maxRatioRect) {
					drawCropWithHandles(state.maxRatioRect);
				}
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

		// === GET MOUSE POSITION FOR CENTERED ZOOM ===
		const coords = getScaledCoordinates(e);
		const ZOOM_SPEED = 0.05;

		const currentRect = lastKeyframe.rect;
		const zoomFactor = e.deltaY < 0 ? (1 - ZOOM_SPEED) : (1 + ZOOM_SPEED); // Corrected zoom direction

		const aspectRatio = state.aspectRatioLocked && state.aspectRatioMode !== 'custom'
			? (state.aspectRatioMode === '16:9' ? 16 / 9 : 9 / 16)
			: (state.panRectSize.width / state.panRectSize.height);

		// === 1. PRE-CALCULATE AND CONSTRAIN THE NEW SIZE ===
		let newWidth = currentRect.width * zoomFactor;

		// Apply size constraints (min and max)
		const minSize = 20; // Set a reasonable minimum size
		if (newWidth < minSize) {
			newWidth = minSize;
		}
		if (state.aspectRatioLocked && state.maxRatioRect && newWidth > state.maxRatioRect.width) {
			newWidth = state.maxRatioRect.width;
		}
		let newHeight = newWidth / aspectRatio;


		// === 2. CALCULATE NEW POSITION BASED ON THE FINAL SIZE ===
		const ratioX = (coords.x - currentRect.x) / currentRect.width;
		const ratioY = (coords.y - currentRect.y) / currentRect.height;

		let newX = coords.x - (newWidth * ratioX);
		let newY = coords.y - (newHeight * ratioY);

		// === 3. CREATE AND CLAMP THE FINAL RECTANGLE ===
		let newZoomedRect = { x: newX, y: newY, width: newWidth, height: newHeight };

		// Use the robust clampRectToVideoBounds instead of constrainToRatio for positioning
		newZoomedRect = clampRectToVideoBounds(newZoomedRect);


		// === CRITICAL SMOOTHNESS FIX ===
		// Update the last keyframe instead of pushing a new one
		lastKeyframe.rect = newZoomedRect;

		drawCropWithHandles(newZoomedRect);

	}, { passive: false });

	// ADD THIS NEW CODE for the segmented control
	const cropModeButtons = document.querySelectorAll('#cropModeBtnGroup .btn');
	const hiddenCropModeRadios = document.querySelectorAll('input[name="cropMode"]');

	cropModeButtons.forEach(button => {
		button.addEventListener('click', (e) => {
			e.preventDefault();
			const clickedBtn = e.currentTarget;
			const newValue = clickedBtn.dataset.value;

			// Update state and UI
			state.dynamicCropMode = newValue;

			cropModeButtons.forEach(btn => btn.classList.remove('active'));
			clickedBtn.classList.add('active');

			// Update the hidden radio button for compatibility if needed elsewhere
			const radioToSelect = Array.from(hiddenCropModeRadios).find(r => r.value === newValue);
			if (radioToSelect) radioToSelect.checked = true;

			// Reset sub-options when the mode changes
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
				blurAmountInput.value = 15;
				state.blurAmount = 15;
			}

			// Update the UI to show/hide the correct sub-options
			updateDynamicCropOptionsUI();
		});
	});

	if (scaleWithRatioToggle) {
		scaleWithRatioToggle.onchange = (e) => {
			state.scaleWithRatio = e.target.checked;
		};
	}
	if (smoothPathToggle) {
		smoothPathToggle.onchange = (e) => {
			state.smoothPath = e.target.checked;
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
	updateDynamicCropOptionsUI();

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
		}
	});
	// ADD THIS NEW CODE
	const aspectRatioButtons = document.querySelectorAll('.aspect-ratio-btn');
	aspectRatioButtons.forEach(button => {
		button.addEventListener('click', (e) => {
			e.preventDefault();
			const clickedBtn = e.currentTarget;
			const newValue = clickedBtn.dataset.value;

			// Do nothing if the active button is clicked again
			if (state.aspectRatioMode === newValue) {
				return;
			}

			// Update state
			state.aspectRatioMode = newValue;

			// Update UI
			aspectRatioButtons.forEach(btn => btn.classList.remove('active'));
			clickedBtn.classList.add('active');

			// If currently in panning mode, restart to apply the new ratio
			if (state.isPanning) {
				togglePanning(null, true); // Reset
				setTimeout(() => togglePanning(), 50); // Restart with new ratio
			}
		});
	});
}

export const toggleStaticCrop = (e, reset = false) => {
	state.isCropping = !reset && !state.isCropping;
	state.isPanning = false; // Ensure panning is off

	panScanBtn.textContent = 'Dynamic ✂️';
	cropBtn.textContent = state.isCropping ? 'Cropping...' : '✂️';

	cropCanvas.classList.toggle('hidden', !state.isCropping);
	panScanBtn.classList.toggle('hover_highlight', state.isPanning);
	cropBtn.classList.toggle('hover_highlight');
	if (reset) cropBtn.classList.remove('hover_highlight');

	if (state.isCropping) {
		// Position the crop canvas when entering crop mode
		state.cropCanvasDimensions = positionCropCanvas();
		state.isCropFixed = false; // Reset fixed state
		updateFixSizeButton();
	} else {
		cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
		state.cropRect = null;
		state.cropCanvasDimensions = null;
		state.isCropFixed = false;
		updateFixSizeButton();
	}
};

export const positionCropCanvas = () => {
	if (!canvas.width || !canvas.height) {
		console.warn('Video dimensions not available yet');
		return null;
	}

	const container = videoContainer;
	const containerRect = container.getBoundingClientRect();

	// Get video dimensions
	const videoWidth = canvas.width;
	const videoHeight = canvas.height;

	// Calculate aspect ratios
	const videoAspect = videoWidth / videoHeight;
	const containerAspect = containerRect.width / containerRect.height;

	let renderWidth, renderHeight, offsetX, offsetY;

	// Calculate actual rendered video dimensions (object-fit: contain behavior)
	if (containerAspect > videoAspect) {
		// Container is wider - video is constrained by height
		renderHeight = containerRect.height;
		renderWidth = renderHeight * videoAspect;
		offsetX = (containerRect.width - renderWidth) / 2;
		offsetY = 0;
	} else {
		// Container is taller - video is constrained by width
		renderWidth = containerRect.width;
		renderHeight = renderWidth / videoAspect;
		offsetX = 0;
		offsetY = (containerRect.height - renderHeight) / 2;
	}

	// Position and size the crop canvas to match the video
	cropCanvas.style.left = `${offsetX}px`;
	cropCanvas.style.top = `${offsetY}px`;
	cropCanvas.style.width = `${renderWidth}px`;
	cropCanvas.style.height = `${renderHeight}px`;

	// Keep the canvas internal resolution at video resolution for accuracy
	// (We already set cropCanvas.width/height to match canvas.width/height elsewhere)

	return {
		renderWidth,
		renderHeight,
		offsetX,
		offsetY,
		videoWidth,
		videoHeight,
		scaleX: videoWidth / renderWidth,
		scaleY: videoHeight / renderHeight
	};
};

export const getScaledCoordinates = (e) => {
	const rect = cropCanvas.getBoundingClientRect();

	// Get canvas internal resolution
	const canvasWidth = cropCanvas.width;
	const canvasHeight = cropCanvas.height;

	// Get displayed size
	const displayWidth = rect.width;
	const displayHeight = rect.height;

	// Calculate scale factors
	const scaleX = canvasWidth / displayWidth;
	const scaleY = canvasHeight / displayHeight;

	// Calculate mouse position relative to canvas
	const x = (e.clientX - rect.left) * scaleX;
	const y = (e.clientY - rect.top) * scaleY;

	return { x, y };
};

export const drawCropOverlay = () => {
	// Clear the previous frame
	cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);

	// Calculate dimensions, ensuring width and height are not negative
	const x = Math.min(state.cropStart.x, state.cropEnd.x);
	const y = Math.min(state.cropStart.y, state.cropEnd.y);
	const width = Math.abs(state.cropStart.x - state.cropEnd.x);
	const height = Math.abs(state.cropStart.y - state.cropEnd.y);

	if (width > 0 || height > 0) {
		// Draw the semi-transparent shade over the entire canvas
		cropCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
		cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

		// "Punch a hole" in the shade where the crop area is
		cropCtx.clearRect(x, y, width, height);

		// Add a light border around the clear area for better visibility
		cropCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
		cropCtx.lineWidth = 1;
		cropCtx.strokeRect(x, y, width, height);
	}
};

// ============================================================================
// DYNAMIC CROP (Pan/Scan) FUNCTIONALITY
// ============================================================================

export const togglePanning = (e, reset = false) => {
	state.isPanning = !reset && !state.isPanning;
	state.isCropping = false;

	cropBtn.textContent = '✂️';
	panScanBtn.textContent = state.isPanning ? 'Cropping...' : 'Dynamic ✂️';

	cropCanvas.classList.toggle('hidden', !state.isPanning);
	cropBtn.classList.toggle('hover_highlight', state.isCropping);
	panScanBtn.classList.toggle('hover_highlight');
	if (reset) panScanBtn.classList.remove('hover_highlight');

	state.panKeyframes = [];
	state.panRectSize = null;

	if (state.isPanning) {
		state.cropCanvasDimensions = positionCropCanvas();
		state.isCropFixed = false;
		updateFixSizeButton();

		// NEW: Calculate max ratio rect if using fixed aspect ratio
		if (state.aspectRatioMode !== 'custom' && canvas.width && canvas.height) {
			const [ratioW, ratioH] = state.aspectRatioMode === '16:9' ? [16, 9] : [9, 16];
			state.maxRatioRect = calculateMaxRatioRect(canvas.width, canvas.height, ratioW, ratioH);
			state.aspectRatioLocked = true;

			// NEW: Initialize with max ratio rect and add first keyframe
			state.panRectSize = { width: state.maxRatioRect.width, height: state.maxRatioRect.height };
			state.panKeyframes.push({ timestamp: getPlaybackTime(), rect: { ...state.maxRatioRect } });

			// Draw the max ratio rectangle immediately
			drawCropWithHandles(state.maxRatioRect);

			guidedPanleInfo(`Resize or move the ${state.aspectRatioMode} crop area. The aspect ratio will be maintained.`);
		} else {
			state.maxRatioRect = null;
			state.aspectRatioLocked = false;
			guidedPanleInfo("Click and drag on the video to draw your crop area.");
		}
	} else {
		cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
		state.cropCanvasDimensions = null;
		state.isCropFixed = false;
		state.maxRatioRect = null;
		state.aspectRatioLocked = false;
		updateFixSizeButton();
	}
};

export const getInterpolatedCropRect = (timestamp) => {
	if (!state.panKeyframes || state.panKeyframes.length === 0) return null;

	// Find the two keyframes that surround the current timestamp
	let prevKey = state.panKeyframes[0];
	let nextKey = null;

	for (let i = 1; i < state.panKeyframes.length; i++) {
		if (state.panKeyframes[i].timestamp > timestamp) {
			nextKey = state.panKeyframes[i];
			break;
		}
		prevKey = state.panKeyframes[i];
	}

	if (!nextKey) {
		return prevKey.rect;
	}

	// Linear Interpolation
	const timeDiff = nextKey.timestamp - prevKey.timestamp;
	if (timeDiff <= 0) return prevKey.rect;

	const t = (timestamp - prevKey.timestamp) / timeDiff;

	const interpolatedX = prevKey.rect.x + (nextKey.rect.x - prevKey.rect.x) * t;
	const interpolatedY = prevKey.rect.y + (nextKey.rect.y - prevKey.rect.y) * t;

	// CLAMP the rectangle to video bounds
	const clampedRect = clampRectToVideoBounds({
		x: interpolatedX,
		y: interpolatedY,
		width: prevKey.rect.width,
		height: prevKey.rect.height,
	});

	return clampedRect;
};

export const clampRectToVideoBounds = (rect) => {
	if (!canvas.width || !canvas.height) return rect;

	const videoWidth = canvas.width;
	const videoHeight = canvas.height;

	let { x, y, width, height } = rect;

	// Clamp x to be within [0, videoWidth - width]
	x = Math.max(0, Math.min(x, videoWidth - width));

	// Clamp y to be within [0, videoHeight - height]
	y = Math.max(0, Math.min(y, videoHeight - height));

	// Ensure width and height don't exceed video bounds
	width = Math.min(width, videoWidth - x);
	height = Math.min(height, videoHeight - y);

	return { x, y, width, height };
};

export const smoothPathWithMovingAverage = (keyframes, windowSize = 15) => {
	if (keyframes.length < windowSize) {
		return keyframes; // Not enough data to smooth
	}

	const smoothedKeyframes = [];
	const halfWindow = Math.floor(windowSize / 2);

	for (let i = 0; i < keyframes.length; i++) {
		// Define the bounds for the moving window, clamping at the edges
		const start = Math.max(0, i - halfWindow);
		const end = Math.min(keyframes.length - 1, i + halfWindow);

		let sumX = 0, sumY = 0, sumWidth = 0, sumHeight = 0;

		// Sum the properties of the keyframes within the window
		for (let j = start; j <= end; j++) {
			sumX += keyframes[j].rect.x;
			sumY += keyframes[j].rect.y;
			sumWidth += keyframes[j].rect.width;
			sumHeight += keyframes[j].rect.height;
		}

		const count = (end - start) + 1;

		// Create the new smoothed keyframe
		const newKeyframe = {
			timestamp: keyframes[i].timestamp, // Keep original timestamp
			rect: {
				x: sumX / count,
				y: sumY / count,
				width: sumWidth / count,
				height: sumHeight / count,
			}
		};

		smoothedKeyframes.push(newKeyframe);
	}

	return smoothedKeyframes;
};

// ============================================================================
// CROP MANIPULATION (Resize/Move/Draw)
// ============================================================================

export const drawCropWithHandles = (rect) => {
	if (!rect || rect.width <= 0 || rect.height <= 0) return;

	cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);

	// Draw semi-transparent overlay
	const overlayColor = state.isPanning ? 'rgba(0, 50, 100, 0.6)' : 'rgba(0, 0, 0, 0.6)';
	cropCtx.fillStyle = overlayColor;
	cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

	// Clear the crop area
	cropCtx.clearRect(rect.x, rect.y, rect.width, rect.height);

	// Draw border
	const borderColor = state.isPanning ? 'rgba(50, 150, 255, 0.9)' : 'rgba(255, 255, 255, 0.8)';
	cropCtx.strokeStyle = borderColor;
	cropCtx.lineWidth = 2;
	cropCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);

	// Draw resize handles if crop is not fixed
	if (!state.isCropFixed) {
		guidedPanleInfo("Adjust the rectangle to your desired size. When ready, press 'L' to lock the size and begin recording.")
		cropCtx.fillStyle = '#00ffff';
		cropCtx.strokeStyle = '#ffffff';
		cropCtx.lineWidth = 1;

		// Corner handles
		const corners = [
			{ x: rect.x, y: rect.y, cursor: 'nw' },
			{ x: rect.x + rect.width, y: rect.y, cursor: 'ne' },
			{ x: rect.x, y: rect.y + rect.height, cursor: 'sw' },
			{ x: rect.x + rect.width, y: rect.y + rect.height, cursor: 'se' }
		];

		corners.forEach(corner => {
			cropCtx.fillRect(
				corner.x - HANDLE_HALF,
				corner.y - HANDLE_HALF,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
			cropCtx.strokeRect(
				corner.x - HANDLE_HALF,
				corner.y - HANDLE_HALF,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
		});

		// Edge handles
		const edges = [
			{ x: rect.x + rect.width / 2, y: rect.y, cursor: 'n' }, // top
			{ x: rect.x + rect.width / 2, y: rect.y + rect.height, cursor: 's' }, // bottom
			{ x: rect.x, y: rect.y + rect.height / 2, cursor: 'w' }, // left
			{ x: rect.x + rect.width, y: rect.y + rect.height / 2, cursor: 'e' } // right
		];

		edges.forEach(edge => {
			cropCtx.fillRect(
				edge.x - HANDLE_HALF,
				edge.y - HANDLE_HALF,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
			cropCtx.strokeRect(
				edge.x - HANDLE_HALF,
				edge.y - HANDLE_HALF,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
		});
	}
};

export const getResizeHandle = (x, y, rect) => {
	if (!rect || state.isCropFixed) return null;

	const handles = [
		{ name: 'nw', x: rect.x, y: rect.y },
		{ name: 'ne', x: rect.x + rect.width, y: rect.y },
		{ name: 'sw', x: rect.x, y: rect.y + rect.height },
		{ name: 'se', x: rect.x + rect.width, y: rect.y + rect.height },
		{ name: 'n', x: rect.x + rect.width / 2, y: rect.y },
		{ name: 's', x: rect.x + rect.width / 2, y: rect.y + rect.height },
		{ name: 'w', x: rect.x, y: rect.y + rect.height / 2 },
		{ name: 'e', x: rect.x + rect.width, y: rect.y + rect.height / 2 }
	];

	for (const handle of handles) {
		const dist = Math.sqrt(
			Math.pow(x - handle.x, 2) + Math.pow(y - handle.y, 2)
		);
		if (dist <= HANDLE_SIZE) {
			return handle.name;
		}
	}

	return null;
};

export const isInsideCropRect = (x, y, rect) => {
	if (!rect) return false;
	return x >= rect.x && x <= rect.x + rect.width &&
		y >= rect.y && y <= rect.y + rect.height;
};

export const getCursorForHandle = (handle) => {
	const cursors = {
		'nw': 'nw-resize',
		'ne': 'ne-resize',
		'sw': 'sw-resize',
		'se': 'se-resize',
		'n': 'n-resize',
		's': 's-resize',
		'w': 'w-resize',
		'e': 'e-resize',
		'move': 'move'
	};
	return cursors[handle] || 'crosshair';
};

export const applyResize = (handle, deltaX, deltaY, originalRect) => {
	let newRect = { ...originalRect };

	// NEW: If aspect ratio is locked, we need to maintain it during resize
	if (state.aspectRatioLocked && state.maxRatioRect) {
		const aspectRatio = state.aspectRatioMode === '16:9' ? 16 / 9 : 9 / 16;
		let potentialWidth;

		// Determine potential new width based on handle and mouse movement
		if (handle.includes('e')) {
			potentialWidth = originalRect.width + deltaX;
		} else if (handle.includes('w')) {
			potentialWidth = originalRect.width - deltaX;
		} else { // Handle 'n' or 's'
			let potentialHeight = originalRect.height + (handle.includes('n') ? -deltaY : deltaY);
			potentialWidth = potentialHeight * aspectRatio;
		}

		// For corner handles, let the dominant mouse movement dictate the size
		if (['nw', 'ne', 'sw', 'se'].includes(handle)) {
			const widthChange = Math.abs(originalRect.width - (originalRect.width + (handle.includes('w') ? -deltaX : deltaX)));
			const heightChange = Math.abs(originalRect.height - (originalRect.height + (handle.includes('n') ? -deltaY : deltaY)));
			if (widthChange > heightChange) {
				potentialWidth = originalRect.width + (handle.includes('w') ? -deltaX : deltaX);
			} else {
				let potentialHeight = originalRect.height + (handle.includes('n') ? -deltaY : deltaY);
				potentialWidth = potentialHeight * aspectRatio;
			}
		}

		// --- Apply Size Constraints ---
		const minSize = 20;
		if (potentialWidth < minSize) potentialWidth = minSize;
		if (potentialWidth > state.maxRatioRect.width) potentialWidth = state.maxRatioRect.width;

		newRect.width = potentialWidth;
		newRect.height = newRect.width / aspectRatio;

		// --- Adjust Position (Anchor the opposite side) ---
		if (handle.includes('n')) {
			newRect.y = originalRect.y + originalRect.height - newRect.height;
		}
		if (handle.includes('w')) {
			newRect.x = originalRect.x + originalRect.width - newRect.width;
		}
		// Center position for side handles
		if (handle === 'n' || handle === 's') {
			newRect.x = originalRect.x + (originalRect.width - newRect.width) / 2;
		}
		if (handle === 'e' || handle === 'w') {
			newRect.y = originalRect.y + (originalRect.height - newRect.height) / 2;
		}

		// Use the global video bounds clamp, not the problematic constrainToRatio
		return clampRectToVideoBounds(newRect);

	} else {
		// Original resize logic for custom mode
		switch (handle) {
			case 'nw':
				newRect.x = originalRect.x + deltaX;
				newRect.y = originalRect.y + deltaY;
				newRect.width = originalRect.width - deltaX;
				newRect.height = originalRect.height - deltaY;
				break;
			case 'ne':
				newRect.y = originalRect.y + deltaY;
				newRect.width = originalRect.width + deltaX;
				newRect.height = originalRect.height - deltaY;
				break;
			case 'sw':
				newRect.x = originalRect.x + deltaX;
				newRect.width = originalRect.width - deltaX;
				newRect.height = originalRect.height + deltaY;
				break;
			case 'se':
				newRect.width = originalRect.width + deltaX;
				newRect.height = originalRect.height + deltaY;
				break;
			case 'n':
				newRect.y = originalRect.y + deltaY;
				newRect.height = originalRect.height - deltaY;
				break;
			case 's':
				newRect.height = originalRect.height + deltaY;
				break;
			case 'w':
				newRect.x = originalRect.x + deltaX;
				newRect.width = originalRect.width - deltaX;
				break;
			case 'e':
				newRect.width = originalRect.width + deltaX;
				break;
		}

		// Ensure minimum size
		if (newRect.width < 20) {
			newRect.width = 20;
			if (handle.includes('w')) newRect.x = originalRect.x + originalRect.width - 20;
		}
		if (newRect.height < 20) {
			newRect.height = 20;
			if (handle.includes('n')) newRect.y = originalRect.y + originalRect.height - 20;
		}

		// Clamp to canvas bounds
		return clampRectToVideoBounds(newRect);
	}
};

export const toggleCropFixed = () => {
	state.isCropFixed = !state.isCropFixed;
	updateFixSizeButton();

	if (state.isCropFixed) {
		// When fixing, ensure even dimensions for video processing
		if (state.isCropping && state.cropRect) {
			state.cropRect.width = Math.round(state.cropRect.width / 2) * 2;
			state.cropRect.height = Math.round(state.cropRect.height / 2) * 2;
			state.cropRect = clampRectToVideoBounds(state.cropRect);
			drawCropWithHandles(state.cropRect);
		} else if (state.isPanning && state.panRectSize) {
			state.panRectSize.width = Math.round(state.panRectSize.width / 2) * 2;
			state.panRectSize.height = Math.round(state.panRectSize.height / 2) * 2;
			// Update the last keyframe with even dimensions
			if (state.panKeyframes.length > 0) {
				const lastFrame = state.panKeyframes[state.panKeyframes.length - 1];
				lastFrame.rect.width = state.panRectSize.width;
				lastFrame.rect.height = state.panRectSize.height;
				lastFrame.rect = clampRectToVideoBounds(lastFrame.rect);
			}
		}
		guidedPanleInfo("Size Locked! Now, play the video and move the box to record the camera path. Use SHIFT + scroll up/down to perform zooming effect. Press 'L' again to resize. Press 'R' when you're done.");
	} else {
		// Redraw with handles
		if (state.isCropping && state.cropRect) {
			drawCropWithHandles(state.cropRect);
		} else if (state.isPanning && state.panKeyframes.length > 0) {
			const lastFrame = state.panKeyframes[state.panKeyframes.length - 1];
			if (lastFrame) {
				drawCropWithHandles(lastFrame.rect);
			}
		}
	}
};

export const updateFixSizeButton = () => {
	const fixSizeBtn = document.getElementById('fixSizeBtn');
	if (!fixSizeBtn) return;

	const shouldShow = (state.isCropping || state.isPanning) &&
		(state.cropRect || state.panRectSize);

	if (shouldShow) {
		fixSizeBtn.style.display = 'inline-block';
		fixSizeBtn.textContent = state.isCropFixed ? 'Resize' : 'Fix Size';
		if (state.isCropFixed) {
			fixSizeBtn.classList.add('hover_highlight');
		} else {
			fixSizeBtn.classList.remove('hover_highlight');
		}
	} else {
		fixSizeBtn.style.display = 'none';
	}
};

fixSizeBtn.onclick = (e) => {
	e.stopPropagation();
	toggleCropFixed();
};

// Calculate maximum rectangle that fits the given aspect ratio within video bounds
const calculateMaxRatioRect = (videoWidth, videoHeight, ratioW, ratioH) => {
	const videoAspect = videoWidth / videoHeight;
	const targetAspect = ratioW / ratioH;

	let width, height, x, y;

	if (videoAspect > targetAspect) {
		// Video is wider - constrain by height
		height = videoHeight;
		width = height * targetAspect;
		x = (videoWidth - width) / 2;
		y = 0;
	} else {
		// Video is taller - constrain by width
		width = videoWidth;
		height = width / targetAspect;
		x = 0;
		y = (videoHeight - height) / 2;
	}

	return { x, y, width, height };
};

// Constrain rectangle to maintain aspect ratio and max size
const constrainToRatio = (rect, maxRect, aspectRatio) => {
	let { x, y, width, height } = rect;
	const rectCenterX = x + width / 2;
	const rectCenterY = y + height / 2;

	// Adjust the drawn rectangle's dimensions to fit the aspect ratio
	// Choose the dimension that makes the new crop area smaller than the drawn one
	// to ensure it's within the user's intended area.
	if (width / height > aspectRatio) {
		// Drawn rect is wider than the target ratio; base new width on height
		width = height * aspectRatio;
	} else {
		// Drawn rect is taller or equal; base new height on width
		height = width / aspectRatio;
	}

	// Recalculate x and y to keep the new rectangle centered
	rect.x = rectCenterX - width / 2;
	rect.y = rectCenterY - height / 2;
	rect.width = width;
	rect.height = height;

	// Finally, ensure the resulting rectangle is within the video's boundaries
	return clampRectToVideoBounds(rect);
};
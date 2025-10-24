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

	// Trigger the UI visibility update
	if (cropModeRadios.length > 0) {
		// Find the event listener's helper function to call it directly
		// Note: This assumes updateDynamicCropOptionsUI is available in this scope.
		// It's better to define it outside the event listener if it's not.
		updateDynamicCropOptionsUI();
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
	state.isCropping = false; // Ensure static cropping is off

	cropBtn.textContent = '✂️';
	panScanBtn.textContent = state.isPanning ? 'Cropping...' : 'Dynamic ✂️';

	cropCanvas.classList.toggle('hidden', !state.isPanning);
	cropBtn.classList.toggle('hover_highlight', state.isCropping);
	panScanBtn.classList.toggle('hover_highlight');
	if (reset) panScanBtn.classList.remove('hover_highlight');

	state.panKeyframes = [];
	state.panRectSize = null;

	if (state.isPanning) {
		// Position the crop canvas when entering panning mode
		state.cropCanvasDimensions = positionCropCanvas();
		state.isCropFixed = false; // Reset fixed state
		updateFixSizeButton();
		guidedPanleInfo("Click and drag on the video to draw your crop area.");
	} else {
		cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
		state.cropCanvasDimensions = null;
		state.isCropFixed = false;
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

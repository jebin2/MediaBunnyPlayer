// js/blur.js

import {
    $,
    cropCanvas,
    cropCtx,
    videoContainer // Assuming you have videoContainer in constants.js
} from './constants.js';
import {
    state
} from './state.js';
import {
    getScaledCoordinates,
    positionCropCanvas
} from './crop.js'; // Re-use existing functions
import {
    getPlaybackTime,
    pause
} from './player.js';
import {
    guidedPanleInfo,
    rightPanel
} from './utility.js';
import {
    registerOnFrameRender,
    unregisterOnFrameRender
} from './player.js';

import {
    handleCutAction
} from './editing.js'
// --- Time Formatting Utilities ---

/**
 * Converts a total number of seconds into an hh:mm:ss or mm:ss string format.
 * @param {number} totalSeconds - The total seconds to format.
 * @returns {string} The formatted time string (e.g., "01:23" or "01:05:10").
 */
const formatTime = (totalSeconds) => {
    const secondsNum = parseInt(totalSeconds, 10);
    if (isNaN(secondsNum)) return "00:00";

    const hours = Math.floor(secondsNum / 3600);
    const minutes = Math.floor((secondsNum % 3600) / 60);
    const seconds = secondsNum % 60;

    const paddedMinutes = String(minutes).padStart(2, '0');
    const paddedSeconds = String(seconds).padStart(2, '0');

    if (hours > 0) {
        const paddedHours = String(hours).padStart(2, '0');
        return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
    } else {
        return `${paddedMinutes}:${paddedSeconds}`;
    }
};


/**
 * Parses an hh:mm:ss or mm:ss time string into a total number of seconds.
 * @param {string} timeString - The time string to parse (e.g., "01:23" or "01:05:10").
 * @returns {number} The total number of seconds.
 */
const parseTime = (timeString) => {
    const parts = timeString.split(':').map(parseFloat);
    let totalSeconds = 0;

    if (parts.some(isNaN)) return NaN; // Check for invalid number parts

    if (parts.length === 3) { // hh:mm:ss format
        totalSeconds = (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    } else if (parts.length === 2) { // mm:ss format
        totalSeconds = (parts[0] * 60) + parts[1];
    } else {
        return NaN; // Invalid format
    }
    return totalSeconds;
};


// --- Main Toggle Function ---
export const toggleBlurMode = () => {
    state.isBlurring = !state.isBlurring;
    const blurBtn = $('blurBtn'); // Assuming you'll add a button with id="blurBtn"

    // Turn off other modes
    if (state.isCropping) toggleStaticCrop(null, true);
    if (state.isPanning) togglePanning(null, true);

    if (state.isBlurring) {
        rightPanel('blur', true);
        if (state.playing) pause();
        blurBtn.textContent = 'Blurring...';
        blurBtn.classList.add('hover_highlight');
        cropCanvas.classList.remove('hidden');
        cropCanvas.style.cursor = 'crosshair';
        positionCropCanvas();
        guidedPanleInfo('Click and drag to draw a blur area. Double-click to finish a shape.');
        registerOnFrameRender(renderBlurPreview);
    } else {
        rightPanel('settings', true);
        blurBtn.textContent = 'Blur';
        blurBtn.classList.remove('hover_highlight');
        cropCanvas.classList.add('hidden');
        cropCanvas.style.cursor = 'default';
        state.isDrawingBlur = false;
        state.currentBlurSegment = null;
        guidedPanleInfo('');
        // unregisterOnFrameRender(renderBlurPreview);
    }
    // Redraw existing segments for the current time
    drawBlurSegments();
};

const renderBlurPreview = () => {
    if (state.showLivePreview || state.playing) {
        drawBlurSegments();
    }
};

// --- Canvas Event Handlers (to be called from your main setup) ---

export const handleBlurPointerDown = (e) => {
    if (!state.isBlurring) return;
    e.preventDefault();
    pause();
    cropCanvas.setPointerCapture(e.pointerId);

    const coords = getScaledCoordinates(e);

    if (!state.isDrawingBlur) {
        // Start a new segment
        state.isDrawingBlur = true;
        state.currentBlurSegment = {
            startTime: getPlaybackTime(),
            endTime: state.totalDuration, // Default to end of video
            points: [coords]
        };
    } else {
        // Add a point to the current segment
        state.currentBlurSegment.points.push(coords);
    }
    drawBlurSegments();
};

export const handleBlurPointerMove = (e) => {
    if (!state.isDrawingBlur || !state.currentBlurSegment) return;
    const coords = getScaledCoordinates(e);

    // Show a preview of the next point
    drawBlurSegments(coords);
};

export const handleBlurDoubleClick = (e) => {
    if (!state.isBlurring || !state.isDrawingBlur || !state.currentBlurSegment) return;
    e.preventDefault();

    // Finish the current segment
    if (state.currentBlurSegment.points.length > 2) {
        state.blurSegments.push(state.currentBlurSegment);
        updateBlurSegmentsUI(); // Update the UI list
    }

    // Reset for the next drawing
    state.isDrawingBlur = false;
    state.currentBlurSegment = null;
    drawBlurSegments(); // Redraw without the preview line
    guidedPanleInfo('Segment added! Draw another or click "Blur" to exit.');
};

// --- Drawing and UI ---

/**
 * Draws all blur segments onto the canvas.
 * @param {object} [previewPoint] - Optional. A point {x, y} to draw a preview line to.
 */
export const drawBlurSegments = (previewPoint) => {
    cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);

    // Draw all completed segments that are active at the current time
    const currentTime = getPlaybackTime();
    state.blurSegments.forEach(segment => {
        if (currentTime >= segment.startTime && currentTime <= segment.endTime) {
            drawPolygon(segment.points, 'rgba(0, 150, 255, 0.5)', 'rgba(0, 150, 255, 0.8)');
        }
    });

    // Draw the segment currently being created
    if (state.currentBlurSegment) {

        // Draw a preview line to the mouse cursor
        let previewPoints = state.currentBlurSegment.points;
        if (previewPoint && state.currentBlurSegment.points.length > 0) {
            previewPoints = [...state.currentBlurSegment.points, previewPoint];
        }
        drawPolygon(previewPoints, 'rgba(0, 150, 255, 0.5)', 'rgba(0, 150, 255, 0.8)');
    }
};

const drawPolygon = (points, fillStyle, strokeStyle) => {
    if (points.length < 2) return;

    cropCtx.fillStyle = fillStyle;
    cropCtx.strokeStyle = strokeStyle;
    cropCtx.lineWidth = 2;

    cropCtx.beginPath();
    cropCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        cropCtx.lineTo(points[i].x, points[i].y);
    }
    cropCtx.closePath();

    cropCtx.fill();
    cropCtx.stroke();
};

// This function will create and update a list of blur segments in your UI
export const updateBlurSegmentsUI = () => {
    const container = $('blurSegmentsList'); // Assuming you add a div with this ID
    if (!container) return;

    container.innerHTML = '<h4>Blur Segments</h4>';
    if (state.blurSegments.length === 0) {
        container.innerHTML = '<p>No blur segments added.</p>';
        return;
    }

    state.blurSegments.forEach((segment, index) => {
        const segmentEl = document.createElement('div');
        segmentEl.className = 'trim-menu-controls';
        segmentEl.innerHTML = `
            <input type="text" class="time-input" value="${formatTime(segment.startTime)}" data-index="${index}" data-type="start" placeholder="mm:ss" title="Start Time">
            -
            <input type="text" class="time-input" value="${formatTime(segment.endTime)}" data-index="${index}" data-type="end" placeholder="mm:ss" title="End Time">
            <button class="close-btn delete-segment-btn" data-index="${index}">×</button>
        `;
        container.appendChild(segmentEl);
    });
};

// --- Event Listener Setup (to be called from your main script) ---

export const setupBlurListeners = () => {
    $('blurBtn').onclick = toggleBlurMode;
    $('clearBlurBtn').onclick = () => {
        state.blurSegments = [];
        updateBlurSegmentsUI();
        drawBlurSegments();
    };
    $('configBlurBtn').onclick = () => {
        $('blurModal').classList.remove('hidden');
    }
    $('blurModalCloseBtn').onclick = () => {
        $('blurModal').classList.add('hidden');
    }
    $('blurConfigBackgroundToggle').onchange = (e) => {
        if (e.target.checked) {
            $('blurConfigBackgroundToggle').checked = true;
            $('blurConfigBackgroundToggleSlider').classList.add('hover_highlight');
            $('plainColorMain').classList.add('hidden');
            $('blurConfigAmountMain').classList.remove('hidden');
        } else {
            $('blurConfigBackgroundToggle').checked = false;
            $('blurConfigBackgroundToggleSlider').classList.remove('hover_highlight');
            $('plainColorMain').classList.remove('hidden');
            $('blurConfigAmountMain').classList.add('hidden');
        }
    };
    $('clearBlurBtn').onclick = () => {
        state.blurConfig = {
            isBlur: true,
            blurAmount: 15,
            plainColor: '#000000'
        }
        state.blurSegments = [];
    };
    $('cancelBlurBtn').onclick = toggleBlurMode;
    $('processBlurBtn').onclick = () => {
        handleCutAction();
        toggleBlurMode();
    }
    $('applyBlurBtn').onclick = () => {
        state.blurConfig = {
            isBlur: $('blurConfigBackgroundToggle').checked,
            blurAmount: $('blurConfigAmountInput').value,
            plainColor: $('plainColor').value
        };
        $('blurModal').classList.add('hidden');
    }
    cropCanvas.addEventListener('dblclick', handleBlurDoubleClick);

    // Add logic to handle time input changes and deletion in the UI list
    const container = $('blurSegmentsList');
    if (container) {
        container.addEventListener('change', (e) => {
            if (e.target.matches('.time-input')) {
                const index = parseInt(e.target.dataset.index, 10);
                const type = e.target.dataset.type;
                const value = parseTime(e.target.value); // Use the new parseTime helper
                if (!isNaN(index) && state.blurSegments[index] && !isNaN(value)) {
                    state.blurSegments[index][type === 'start' ? 'startTime' : 'endTime'] = value;
                } else {
                    // Revert to the old value if input is invalid
                    e.target.value = formatTime(state.blurSegments[index][type === 'start' ? 'startTime' : 'endTime']);
                }
            }
        });

        container.addEventListener('click', (e) => {
            if (e.target.matches('.delete-segment-btn')) {
                const index = parseInt(e.target.dataset.index, 10);
                if (!isNaN(index)) {
                    state.blurSegments.splice(index, 1);
                    updateBlurSegmentsUI();
                    drawBlurSegments();
                }
            }
        });
    }
};
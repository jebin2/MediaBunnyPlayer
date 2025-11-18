// ============================================================================
// MIX VIDEO FUNCTIONALITY
// ============================================================================

import {
    Input,
    ALL_FORMATS,
    BlobSource,
    UrlSource,
    Conversion,
    Output,
    Mp4OutputFormat,
    BufferTarget,
    QUALITY_HIGH,
    AudioSampleSink,
    AudioSample,
    VideoSampleSink
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.25.0/+esm';

import { state } from './state.js';
import { rightPanel, formatTime, parseTime } from './utility.js'
import { handleCutAction } from './editing.js';
import { getPlaybackTime, registerOnFrameRender, unregisterOnFrameRender } from './player.js';
import { showError, showStatusMessage, hideStatusMessage, showInfo } from './ui.js';
import { ChromaKeyApp } from './chroma_key_set.js';

let activeSegmentIndex = -1;
let activeRangeIndex = -1;

const overlayBoxes = {};

const interaction = {
    isDragging: false,
    isResizing: false,
    resizeHandle: '',
    startX: 0, startY: 0,
    startLeft: 0, startTop: 0,
    startWidth: 0, startHeight: 0,
};

// --- CORE FUNCTIONS ---

const renderOverlayPreviews = () => {
    if (state.showLivePreview || state.playing) {
        drawOverlayControls();
    }
};

const drawOverlayControls = () => {
    const currentTime = getPlaybackTime();

    state.mixVideo.forEach((segment, segmentIndex) => {
        segment.video_edit_prop.forEach((prop, rangeIndex) => {
            const box = overlayBoxes[segmentIndex]?.[rangeIndex];
            if (!box) return;

            // Show box if current time is within the range
            if (currentTime >= parseTime(prop.start) && currentTime <= parseTime(prop.end)) {
                box.style.display = 'block';
                updateOverlayBoxPosition(segmentIndex, rangeIndex);
            } else {
                box.style.display = 'none';
            }

            // Highlight active box
            if (segmentIndex === activeSegmentIndex && rangeIndex === activeRangeIndex) {
                box.classList.add('is-active');
            } else {
                box.classList.remove('is-active');
            }
        });
    });
};

const setActiveRange = (segmentIndex, rangeIndex) => {
    activeSegmentIndex = segmentIndex;
    activeRangeIndex = rangeIndex;
    updateMixVideoUI();
    // Force redraw to show the active state
    drawOverlayControls();
};

export const setupVideoListener = () => {
    document.getElementById('mixVideoBtn').onclick = () => {
        rightPanel("mixVideo", true);
        // Register the frame renderer to continuously update overlay visibility
        registerOnFrameRender(renderOverlayPreviews);
    };

    document.getElementById('uploadMixVideoBtn').onclick = () => {
        const input = document.getElementById('mixVideoFileInput');
        // Allow images and videos
        input.accept = "video/*, image/*";
        input.click();

        input.onchange = async (e) => {
            if (e.target.files && e.target.files[0]) {
                await addVideoTrackToPlaylist(e.target.files[0]);
            }
        };
    };

    document.getElementById('processMixVideoBtn').onclick = handleCutAction;

    const menu = document.getElementById('mixVideoMenu');
    menu.addEventListener('click', (e) => {
        const target = e.target;
        const dropdownButton = target.closest('.audioTypeDropdownBtn');
        const actionButton = target.closest('.audioTypeDropdownMenu button[data-action]');
        const closeTimeRangeBtn = target.closest('.time-range-close');
        const addTimeRangeBtn = target.closest('.time-range-add');
        const closeVideoTrackBtn = target.closest('.mix-audio-close');

        const timeRangeContainer = target.closest('.time-range-container');
        if (timeRangeContainer && !target.closest('button, input, .dropdown-wrapper')) {
            const segmentIndex = parseInt(timeRangeContainer.dataset.segmentIndex, 10);
            const rangeIndex = parseInt(timeRangeContainer.dataset.rangeIndex, 10);
            setActiveRange(segmentIndex, rangeIndex);
        }

        if (dropdownButton) {
            dropdownButton.nextElementSibling.classList.toggle('hidden');
            return;
        }

        if (actionButton) {
            const segmentIndex = parseInt(actionButton.dataset.index, 10);
            const rangeIndex = parseInt(actionButton.dataset.rangeIndex, 10);
            const prop = state.mixVideo[segmentIndex].video_edit_prop[rangeIndex];
            prop.action = actionButton.dataset.action;
            setActiveRange(segmentIndex, rangeIndex);
            updateMixVideoUI();
            return;
        }

        if (closeVideoTrackBtn) {
            const segmentIndex = parseInt(closeVideoTrackBtn.dataset.segmentIndex, 10);
            // Remove all overlay boxes for this segment
            Object.keys(overlayBoxes[segmentIndex] || {}).forEach(rangeIdx => {
                removeOverlayBox(segmentIndex, parseInt(rangeIdx));
            });
            delete overlayBoxes[segmentIndex];
            state.mixVideo.splice(segmentIndex, 1);
            if (activeSegmentIndex === segmentIndex) setActiveRange(-1, -1);
            updateMixVideoUI();
            return;
        }

        if (closeTimeRangeBtn) {
            const segmentIndex = parseInt(closeTimeRangeBtn.dataset.segmentIndex, 10);
            const rangeIndex = parseInt(closeTimeRangeBtn.dataset.rangeIndex, 10);
            if (state.mixVideo[segmentIndex].video_edit_prop.length > 1) {
                state.mixVideo[segmentIndex].video_edit_prop.splice(rangeIndex, 1);
                removeOverlayBox(segmentIndex, rangeIndex);
                // Re-create boxes with updated indices
                delete overlayBoxes[segmentIndex];
                state.mixVideo[segmentIndex].video_edit_prop.forEach((_, idx) => {
                    createOverlayBox(segmentIndex, idx);
                });
                if (activeSegmentIndex === segmentIndex && activeRangeIndex === rangeIndex) {
                    setActiveRange(-1, -1);
                }
                updateMixVideoUI();
            }
            return;
        }

        if (addTimeRangeBtn) {
            const segmentIndex = parseInt(addTimeRangeBtn.dataset.segmentIndex, 10);
            const currentTime = getPlaybackTime();
            const newRangeIndex = state.mixVideo[segmentIndex].video_edit_prop.length;

            state.mixVideo[segmentIndex].video_edit_prop.push({
                action: "overlay",
                start: formatTime(currentTime), // Start at current time
                end: state.totalDuration ? formatTime(state.totalDuration) : "99:00:00",
                transform: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
            });

            createOverlayBox(segmentIndex, newRangeIndex);
            setActiveRange(segmentIndex, newRangeIndex);
            updateMixVideoUI();
            return;
        }

        const chromaKeyColorConfig = target.closest('.chromaKeyColorConfig');
        if (chromaKeyColorConfig) {
            ChromaKeyApp.init(chromaKeyColorConfig.dataset.segmentIndex);
        }

    });

    menu.addEventListener('change', (e) => {
        if (e.target.matches('.time-input')) {
            const segmentIndex = parseInt(e.target.dataset.segmentIndex, 10);
            const rangeIndex = parseInt(e.target.dataset.rangeIndex, 10);
            const prop = state.mixVideo[segmentIndex]?.video_edit_prop[rangeIndex];
            if (!prop) return;

            const timeType = e.target.dataset.timeType;
            if (timeType === 'start' || timeType === 'end') {
                prop[timeType] = e.target.value;
                // Redraw to reflect time changes
                drawOverlayControls();
            }
        }
    });

    // Listen for direct numeric input on transform fields
    menu.addEventListener('input', (e) => {
        if (e.target.matches('.transform-input')) {
            const segmentIndex = parseInt(e.target.dataset.segmentIndex, 10);
            const rangeIndex = parseInt(e.target.dataset.rangeIndex, 10);
            const prop = e.target.dataset.prop;
            const transform = state.mixVideo[segmentIndex]?.video_edit_prop[rangeIndex]?.transform;

            if (transform) {
                // Update state from input, converting percentage string to relative value
                const value = parseFloat(e.target.value);
                if (!isNaN(value)) {
                    transform[prop] = Math.max(0, Math.min(100, value)) / 100;
                    // Update the visual controls on the player to match
                    updateOverlayBoxPosition(segmentIndex, rangeIndex);
                }
            }
        }
    });
};

export const addVideoTrackToPlaylist = async (file, options = {}) => {
    const isFirstVideo = state.mixVideo.length === 0;
    const currentTime = getPlaybackTime();

    // Determine Media Type
    let mediaType = 'mix_video'; // Default
    let typeLabel = 'video';

    if (file.type.startsWith('image/')) {
        if (file.type === 'image/gif') {
            mediaType = 'mix_gif';
            typeLabel = 'GIF';
        } else {
            mediaType = 'mix_image';
            typeLabel = 'image';
        }
    }

    // Show some UI feedback
    showStatusMessage(`Preparing overlay ${typeLabel}: ${file.name}...`);

    let normalizedFile = file;

    // Only attempt to normalize if it is a video. 
    // Images and GIFs do not need MP4 normalization.
    if (mediaType === 'mix_video') {
        // const normalizedFile = await normalizeVideo(file, (progress) => {
        //     showStatusMessage(`Preparing overlay: ${Math.round(progress * 100)}%`);
        // });
        normalizedFile = file; // Using original for now as normalization is commented out
    }

    hideStatusMessage();

    const videoTrack = {
        type: 'file',
        media_type: mediaType, // Assigned based on file detection
        name: normalizedFile.name,
        file: normalizedFile,
        video_edit_prop: [{
            action: isFirstVideo ? 'base' : (options.action || 'overlay'),
            start: options.start || formatTime(currentTime),
            end: options.end || formatTime(state.totalDuration),
            transform: {
                x: 0.25,
                y: 0.25,
                width: 0.5,
                height: 0.5,
            },
        }]
    };

    state.mixVideo.push(videoTrack);
    const newIndex = state.mixVideo.length - 1;

    createOverlayBox(newIndex, 0);
    setActiveRange(newIndex, 0);
    updateMixVideoUI();
};

export const updateMixVideoUI = () => {
    const container = document.getElementById('mixVideoSegmentsList');
    if (!container) return;

    container.innerHTML = '<h4>Mix Media (Video/Img/Gif)</h4>';

    if (state.mixVideo.length === 0) {
        container.innerHTML += '<p>No media added.</p>';
        return;
    }

    state.mixVideo.forEach((segment, segmentIndex) => {
        const segmentEl = document.createElement('div');
        segmentEl.className = 'caption-word-row drop-zone';

        // Small icon indicator based on type
        let typeIcon = '🎥';
        if (segment.media_type === 'mix_image') typeIcon = '🖼️';
        if (segment.media_type === 'mix_gif') typeIcon = '👾';

        segmentEl.innerHTML = `
            <div class="mix-audio-title">
                <button class="mix-audio-close close-btn" data-segment-index="${segmentIndex}" title="Remove this track">×</button>
                <span class="mix-video-name" title="${segment.media_type}">${typeIcon} ${segment.name}</span>
            </div>
            <div class="mix-audio-time-ranges">
                ${getMixVideoTimeRangeHtml(segment, segmentIndex)}
            </div>
        `;
        container.appendChild(segmentEl);
    });
};

const getMixVideoTimeRangeHtml = (segment, segmentIndex) => {
    let timeRangeHtml = "";

    segment.video_edit_prop.forEach((prop, rangeIndex) => {
        const isLastItem = rangeIndex === segment.video_edit_prop.length - 1;
        const addButtonVisibility = isLastItem ? '' : 'hidden';
        const isActive = segmentIndex === activeSegmentIndex && rangeIndex === activeRangeIndex;

        timeRangeHtml += `
        <div class="time-range-container ${isActive ? 'active-range' : ''}" data-segment-index="${segmentIndex}" data-range-index="${rangeIndex}">
            <div class="trim-menu-controls">
                <input type="text" class="time-input" value="${formatTime(parseTime(prop.start))}" data-segment-index="${segmentIndex}" data-range-index="${rangeIndex}" data-time-type="start" title="Start Time">
                <span class="time-separator">-</span>
                <input type="text" class="time-input" value="${formatTime(parseTime(prop.end))}" data-segment-index="${segmentIndex}" data-range-index="${rangeIndex}" data-time-type="end" title="End Time">

                <button class="time-range-close close-btn" data-segment-index="${segmentIndex}" data-range-index="${rangeIndex}" title="Remove time range">×</button>
                <button class="time-range-add close-btn tick-btn ${addButtonVisibility}" data-segment-index="${segmentIndex}" title="Add new time range">+</button>
            </div>
            <div class="trim-menu-actions mtop0-75">
                <div>
                    <div class="trim-menu-controls" style="width: 100%; margin-bottom: 10px;">
                    <input type="number" class="time-input transform-input" style="width: 60px;" value="${(prop.transform.x * 100).toFixed(1)}" data-segment-index="${segmentIndex}" data-range-index="${rangeIndex}" data-prop="x" title="X-axis (%)">
                    <input type="number" class="time-input transform-input" style="width: 60px;" value="${(prop.transform.y * 100).toFixed(1)}" data-segment-index="${segmentIndex}" data-range-index="${rangeIndex}" data-prop="y" title="Y-axis (%)">
                    <input type="number" class="time-input transform-input" style="width: 60px;" value="${(prop.transform.width * 100).toFixed(1)}" data-segment-index="${segmentIndex}" data-range-index="${rangeIndex}" data-prop="width" title="Width (%)">
                    <input type="number" class="time-input transform-input" style="width: 60px;" value="${(prop.transform.height * 100).toFixed(1)}" data-segment-index="${segmentIndex}" data-range-index="${rangeIndex}" data-prop="height" title="Height (%)">
                </div>
                    <button class="btn btn-dropdown audioTypeDropdownBtn">${prop.action} ▼</button>
                    <div class="dropdown audioTypeDropdownMenu hidden">
                        <button class="btn" data-action="base" data-index="${segmentIndex}" data-range-index="${rangeIndex}">Base</button>
                        <button class="btn" data-action="overlay" data-index="${segmentIndex}" data-range-index="${rangeIndex}">Overlay</button>
                    </div>
                    <button class="chromaKeyColorConfig btn ${prop.action == 'overlay' ? '' : 'hidden'}" id="chromaKeyColorConfig" data-segment-index="${segmentIndex}" data-range-index="${rangeIndex}">Config</button>
                </div>
            </div>
        </div>
        `;
    });
    return timeRangeHtml;
};


// ============================================================================
// INTERACTIVE OVERLAY BOX MANAGEMENT
// ============================================================================

function createOverlayBox(segmentIndex, rangeIndex) {
    if (!overlayBoxes[segmentIndex]) overlayBoxes[segmentIndex] = {};
    if (overlayBoxes[segmentIndex][rangeIndex]) return;

    const playerContainer = document.getElementById('videoContainer');
    const box = document.createElement('div');
    box.className = 'overlay-box';
    box.dataset.segmentIndex = segmentIndex;
    box.dataset.rangeIndex = rangeIndex;

    // Set absolute positioning
    box.style.position = 'absolute';
    box.style.border = '2px solid #00f';
    box.style.backgroundColor = 'rgba(0, 100, 255, 0.2)';
    box.style.cursor = 'move';
    box.style.zIndex = '1000';
    box.style.boxSizing = 'border-box';

    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(handle => {
        const handleEl = document.createElement('div');
        handleEl.className = `resize-handle ${handle}`;
        handleEl.dataset.handle = handle;
        handleEl.style.position = 'absolute';
        handleEl.style.width = '10px';
        handleEl.style.height = '10px';
        handleEl.style.backgroundColor = '#00f';
        handleEl.style.border = '1px solid white';

        // Position handles
        if (handle.includes('n')) handleEl.style.top = '-5px';
        if (handle.includes('s')) handleEl.style.bottom = '-5px';
        if (handle.includes('e')) handleEl.style.right = '-5px';
        if (handle.includes('w')) handleEl.style.left = '-5px';
        if (handle === 'n' || handle === 's') handleEl.style.left = 'calc(50% - 5px)';
        if (handle === 'e' || handle === 'w') handleEl.style.top = 'calc(50% - 5px)';

        // Cursor styles
        const cursorMap = {
            'n': 'ns-resize', 's': 'ns-resize',
            'e': 'ew-resize', 'w': 'ew-resize',
            'ne': 'nesw-resize', 'sw': 'nesw-resize',
            'nw': 'nwse-resize', 'se': 'nwse-resize'
        };
        handleEl.style.cursor = cursorMap[handle];

        box.appendChild(handleEl);
    });

    playerContainer.appendChild(box);
    box.addEventListener('mousedown', (e) => onInteractionStart(e, segmentIndex, rangeIndex));
    overlayBoxes[segmentIndex][rangeIndex] = box;
    updateOverlayBoxPosition(segmentIndex, rangeIndex);

    // Initially hide, will be shown by drawOverlayControls when in range
    box.style.display = 'none';
}

function removeOverlayBox(segmentIndex, rangeIndex) {
    const box = overlayBoxes[segmentIndex]?.[rangeIndex];
    if (box) {
        box.remove();
        delete overlayBoxes[segmentIndex][rangeIndex];
    }
}

function updateOverlayBoxPosition(segmentIndex, rangeIndex) {
    const box = overlayBoxes[segmentIndex]?.[rangeIndex];
    const transform = state.mixVideo[segmentIndex]?.video_edit_prop[rangeIndex]?.transform;
    const playerContainer = document.getElementById('videoContainer');

    if (box && transform && playerContainer) {
        const containerRect = playerContainer.getBoundingClientRect();

        // Calculate pixel positions based on container size
        const leftPx = transform.x * containerRect.width;
        const topPx = transform.y * containerRect.height;
        const widthPx = transform.width * containerRect.width;
        const heightPx = transform.height * containerRect.height;

        box.style.left = `${leftPx}px`;
        box.style.top = `${topPx}px`;
        box.style.width = `${widthPx}px`;
        box.style.height = `${heightPx}px`;
    }
}

function onInteractionStart(e, segmentIndex, rangeIndex) {
    e.preventDefault();
    e.stopPropagation();

    setActiveRange(segmentIndex, rangeIndex);

    const activeBox = overlayBoxes[segmentIndex]?.[rangeIndex];
    interaction.startX = e.clientX;
    interaction.startY = e.clientY;
    interaction.startLeft = activeBox.offsetLeft;
    interaction.startTop = activeBox.offsetTop;
    interaction.startWidth = activeBox.offsetWidth;
    interaction.startHeight = activeBox.offsetHeight;

    if (e.target.classList.contains('resize-handle')) {
        interaction.isResizing = true;
        interaction.resizeHandle = e.target.dataset.handle;
    } else {
        interaction.isDragging = true;
    }

    document.addEventListener('mousemove', onInteractionMove);
    document.addEventListener('mouseup', onInteractionEnd);
}

function onInteractionMove(e) {
    if ((!interaction.isDragging && !interaction.isResizing) || activeSegmentIndex < 0) return;
    e.preventDefault();
    e.stopPropagation();

    const playerContainer = document.getElementById('videoContainer').getBoundingClientRect();
    const transform = state.mixVideo[activeSegmentIndex].video_edit_prop[activeRangeIndex].transform;

    const dx = e.clientX - interaction.startX;
    const dy = e.clientY - interaction.startY;

    let newLeft = interaction.startLeft, newTop = interaction.startTop;
    let newWidth = interaction.startWidth, newHeight = interaction.startHeight;

    if (interaction.isDragging) {
        newLeft += dx;
        newTop += dy;
    } else {
        const handle = interaction.resizeHandle;
        if (handle.includes('e')) newWidth += dx;
        if (handle.includes('w')) { newWidth -= dx; newLeft += dx; }
        if (handle.includes('s')) newHeight += dy;
        if (handle.includes('n')) { newHeight -= dy; newTop += dy; }
    }

    // Clamp values between 0 and 1
    transform.x = Math.max(0, Math.min(1, newLeft / playerContainer.width));
    transform.y = Math.max(0, Math.min(1, newTop / playerContainer.height));
    transform.width = Math.max(0.05, Math.min(1, newWidth / playerContainer.width));
    transform.height = Math.max(0.05, Math.min(1, newHeight / playerContainer.height));

    // Prevent overflow
    if (transform.x + transform.width > 1) transform.width = 1 - transform.x;
    if (transform.y + transform.height > 1) transform.height = 1 - transform.y;

    // Update visual box in real-time
    updateOverlayBoxPosition(activeSegmentIndex, activeRangeIndex);

    // Update side-panel UI
    updateMixVideoUI();
}

function onInteractionEnd(e) {
    interaction.isDragging = false;
    interaction.isResizing = false;
    document.removeEventListener('mousemove', onInteractionMove);
    document.removeEventListener('mouseup', onInteractionEnd);
}

/**
 * Takes a video file and re-encodes it into a standard, highly-compatible MP4 format.
 * This is used to "normalize" user-provided videos to prevent decoder issues.
 * @param {File} originalFile The user-provided video file.
 * @param {function(number): void} [onProgress] Optional callback for progress (0 to 1).
 * @returns {Promise<File>} A new File object with the compatible video data.
 */
const normalizeVideo = async (originalFile, onProgress) => {
    console.log(`[Normalize] Starting normalization for "${originalFile.name}"...`);
    try {
        const input = new Input({
            source: new BlobSource(originalFile),
            formats: ALL_FORMATS
        });

        const output = new Output({
            format: new Mp4OutputFormat({
                video: { codec: 'avc', bitrate: QUALITY_HIGH },
                audio: { codec: 'opus', bitrate: 128e3 },
                fastStart: 'in-memory'
            }),
            target: new BufferTarget()
        });

        // We need to ensure the input has tracks to create a valid conversion
        const videoTrack = await input.getPrimaryVideoTrack();
        const audioTrack = await input.getPrimaryAudioTrack();
        if (!videoTrack) {
            throw new Error("Video track is required for normalization.");
        }

        const conversionOptions = {
            input,
            output,
            video: { track: videoTrack },
        };
        // Only include audio in the output if it exists in the input
        if (audioTrack) {
            conversionOptions.audio = { track: audioTrack };
        }


        const conversion = await Conversion.init(conversionOptions);
        if (!conversion.isValid) {
            throw new Error("Could not create a valid conversion for normalization.");
        }

        if (onProgress) {
            conversion.onProgress = onProgress;
        }

        await conversion.execute();
        await input.dispose();

        const normalizedBuffer = output.target.buffer;
        const newName = `${originalFile.name.split('.').slice(0, -1).join('.')}_normalized.mp4`;
        const normalizedFile = new File([normalizedBuffer], newName, { type: 'video/mp4' });

        console.log(`[Normalize] Normalization successful for "${originalFile.name}". New size: ${(normalizedFile.size / 1024 / 1024).toFixed(2)} MB`);
        return normalizedFile;

    } catch (error) {
        console.error(`[Normalize] Failed to normalize video "${originalFile.name}":`, error);
        // Return the original file as a fallback, though it may still cause issues.
        return originalFile;
    }
};
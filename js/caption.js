// js/caption.js

import {
    $,
    settingsMenu,
    playerArea,
    sidebar,
    addCaptionBtn
} from './constants.js';
import {
    state
} from './state.js';
import {
    showStatusMessage,
    hideStatusMessage,
    showError,
    showInfo
} from './ui.js';
import {
    pause,
} from './player.js';
import { positionCropCanvas } from './crop.js'
import {
    ALL_FORMATS,
    Input,
    BlobSource,
    UrlSource,
    Output,
    BufferTarget,
    Mp4OutputFormat,
    Conversion,
    QUALITY_HIGH
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';
import {
    updatePlaylistUIOptimized
} from './playlist.js';

// Let's keep track of the caption data in the main state
state.captionData = null;

/**
 * Renders the UI for editing caption words based on JSON data.
 * Each word gets its own row with start and end times.
 * @param {object} captionData - The parsed JSON object with caption segments.
 */
const renderCaptionUI = (captionData) => {
    const captionContent = $('captionContent');
    captionContent.innerHTML = ''; // Clear previous content

    if (!captionData || !Array.isArray(captionData.segments)) {
        captionContent.innerHTML = '<p style="padding: 1rem; text-align: center; opacity: 0.7;">Invalid or no caption data loaded.</p>';
        return;
    }

    state.captionData = captionData; // Store for later use

    // Create a container for all word rows
    const wordsList = document.createElement('div');
    wordsList.className = 'caption-words-list';

    // Loop through segments, then through words to create a row for each word
    captionData.segments.forEach((segment, segmentIndex) => {
        segment.words.forEach((word, wordIndex) => {
            const wordRow = document.createElement('div');
            wordRow.className = 'caption-word-row';

            // Create inputs for start time, end time, and the word itself
            wordRow.innerHTML = `
                <div class="trim-menu-controls">
                    <input type="text" class="time-input caption-time-input" value="${word.start.toFixed(2)}" data-segment-index="${segmentIndex}" data-word-index="${wordIndex}" data-time-type="start" title="Start Time">
                    <span class="time-separator">-</span>
                    <input type="text" class="time-input caption-time-input" value="${word.end.toFixed(2)}" data-segment-index="${segmentIndex}" data-word-index="${wordIndex}" data-time-type="end" title="End Time">
                </div>
                <input type="text" class="caption-word-input speed-input url-class" value="${word.word}" data-segment-index="${segmentIndex}" data-word-index="${wordIndex}" title="Caption Word">
                <hr class="menu-divider">
            `;
            wordsList.appendChild(wordRow);
        });
    });

    captionContent.appendChild(wordsList);
};

/**
 * Updates the state.captionData from the UI input fields.
 */
const updateCaptionDataFromUI = () => {
    if (!state.captionData) return;

    // Update word text from each row's word input
    document.querySelectorAll('.caption-word-input').forEach(input => {
        const segIdx = parseInt(input.dataset.segmentIndex, 10);
        const wordIdx = parseInt(input.dataset.wordIndex, 10);
        if (!isNaN(segIdx) && !isNaN(wordIdx)) {
            state.captionData.segments[segIdx].words[wordIdx].word = input.value;
        }
    });

    // Update word timing from each row's time inputs
    document.querySelectorAll('.caption-time-input').forEach(input => {
        const segIdx = parseInt(input.dataset.segmentIndex, 10);
        const wordIdx = parseInt(input.dataset.wordIndex, 10);
        const timeType = input.dataset.timeType;
        if (!isNaN(segIdx) && !isNaN(wordIdx) && timeType) {
            state.captionData.segments[segIdx].words[wordIdx][timeType] = parseFloat(input.value) || 0;
        }
    });

    // Reconstruct the main text for each segment after potential word changes
    state.captionData.segments.forEach(segment => {
        segment.text = segment.words.map(w => w.word).join(' ');
    });
};


/**
 * Handles the final processing of burning captions onto the video.
 * This now uses word-level timing to determine when a caption is visible.
 */
const handleProcessCaptions = async () => {
    if (!state.fileLoaded) {
        showError("No video file is loaded.");
        return;
    }
    if (!state.captionData || !state.captionData.segments) {
        showError("No caption data available to process.");
        return;
    }

    if (state.playing) pause();
    updateCaptionDataFromUI();
    showStatusMessage('Starting caption processing...');

    let input;
    try {
        const source = (state.currentPlayingFile instanceof File) ?
            new BlobSource(state.currentPlayingFile) :
            new UrlSource(state.currentPlayingFile);

        input = new Input({
            source,
            formats: ALL_FORMATS
        });
        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack) throw new Error("No video track found.");

        const output = new Output({
            format: new Mp4OutputFormat({
                fastStart: 'in-memory'
            }),
            target: new BufferTarget()
        });

        const conversionOptions = {
            input,
            output,
            video: {
                track: videoTrack,
                codec: 'avc',
                bitrate: QUALITY_HIGH,
                forceTranscode: true,
                process: (sample) => {
                    // Create a canvas to draw on
                    const canvas = new OffscreenCanvas(videoTrack.codedWidth, videoTrack.codedHeight);
                    const ctx = canvas.getContext('2d');
                    const videoFrame = sample._data || sample;
                    ctx.drawImage(videoFrame, 0, 0);

                    const currentTime = sample.timestamp;
                    let activeSegmentText = null;

                    // *** MODIFIED LOGIC: Find the active word, but get its parent segment's text ***
                    for (const segment of state.captionData.segments) {
                        for (const word of segment.words) {
                            if (currentTime >= word.start && currentTime <= word.end) {
                                activeSegmentText = word.word;
                                break; // Exit inner loop once a word is found
                            }
                        }
                        if (activeSegmentText) {
                            break; // Exit outer loop
                        }
                    }

                    if (activeSegmentText) {
                        const fontSize = Math.max(24, Math.round(videoTrack.codedHeight * 0.05));
                        ctx.font = `bold ${fontSize}px Arial`;
                        ctx.fillStyle = 'white';
                        ctx.strokeStyle = 'black';
                        ctx.lineWidth = Math.max(1, fontSize / 12);
                        ctx.textAlign = 'center';

                        const x = canvas.width / 2;
                        const y = canvas.height - (fontSize * 1.5);

                        ctx.strokeText(activeSegmentText, x, y);
                        ctx.fillText(activeSegmentText, x, y);
                    }
                    return canvas;
                }
            }
        };

        const conversion = await Conversion.init(conversionOptions);
        if (!conversion.isValid) throw new Error("Could not create a valid conversion.");

        conversion.onProgress = (p) => showStatusMessage(`Processing captions... (${Math.round(p * 100)}%)`);
        await conversion.execute();

        const originalName = (state.currentPlayingFile.name || 'video').split('.').slice(0, -1).join('.');
        const clipName = `${originalName}_captioned.mp4`;
        const captionedFile = new File([output.target.buffer], clipName, {
            type: 'video/mp4'
        });

        state.playlist.push({
            type: 'file',
            name: clipName,
            file: captionedFile,
            isCutClip: true
        });
        updatePlaylistUIOptimized();
        showInfo('Captioned video added to playlist!');

    } catch (error) {
        console.error("Caption processing error:", error);
        showError(`Failed to add captions: ${error.message}`);
    } finally {
        if (input) input.dispose();
        hideStatusMessage();
    }
};

/**
 * Initializes all event listeners related to the captioning functionality.
 */
export const setupCaptionListeners = () => {
    const captionMenu = $('captionMenu');
    const processCaptionsBtn = $('processCaptionsBtn');
    const loadCaptionsBtn = $('loadCaptionsBtn');
    const captionFileInput = $('captionFileInput');

	addCaptionBtn.onclick = (e) => {
            e.stopPropagation();
		// If settings sidebar is open, close it first
		if (playerArea.classList.contains('playlist-visible')) {
			playerArea.classList.remove('playlist-visible');
		}

		playerArea.classList.toggle('playlist-visible');
		// Toggle the settings sidebar
		sidebar.classList.add('hidden');
		settingsMenu.classList.add('hidden');
		captionMenu.classList.toggle('hidden');
		setTimeout(() => {
			state.cropCanvasDimensions = positionCropCanvas();
		}, 200);
	}

    if (processCaptionsBtn) {
        processCaptionsBtn.onclick = handleProcessCaptions;
    }

    if (loadCaptionsBtn) {
        loadCaptionsBtn.onclick = () => {
            captionFileInput.click();
        };
    }

    if (captionFileInput) {
        captionFileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file && file.type === 'application/json') {
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const jsonData = JSON.parse(event.target.result);
                        renderCaptionUI(jsonData);
                        showInfo("Caption file loaded successfully.");
                    } catch (err) {
                        console.error("Error parsing JSON:", err);
                        showError("Invalid JSON file format.");
                    }
                };
                reader.readAsText(file);
            } else {
                showError("Please select a valid .json file.");
            }
            e.target.value = null;
        };
    }

    const captionContent = $('captionContent');
    if (captionContent) {
        captionContent.addEventListener('change', (e) => {
            // Check if the target is any of the inputs within a word row
            if (e.target.closest('.caption-word-row')) {
                updateCaptionDataFromUI();
            }
        });
    }
};
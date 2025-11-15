// js/caption.js

import {
    $,
    settingsMenu,
    playerArea,
    sidebar,
    addCaptionBtn,
    canvas,
    cropCtx
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
import { drawCropWithHandles, positionCropCanvas } from './crop.js';
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
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.25.0/+esm';
import {
    updatePlaylistUIOptimized
} from './playlist.js';
import { guidedPanleInfo, rightPanel } from './utility.js';

const wordStylesBtn = $('wordStylesBtn');
const positionCaptionsBtn = $('positionCaptionsBtn');
let currentSelectedWordIndex = -1;

const normalizeCaptionData = (jsonData) => {
    if (jsonData && Array.isArray(jsonData.words)) {
        return jsonData.words;
    }
    if (jsonData && Array.isArray(jsonData.segments)) {
        return jsonData.segments.flatMap(segment => segment.words || []);
    }
    return [];
};

const renderCaptionUI = () => {
    const captionContent = $('captionContent');
    captionContent.innerHTML = '';

    if (state.allWords.length === 0) {
        captionContent.innerHTML = '<p style="padding: 1rem; text-align: center; opacity: 0.7;">No valid word data found.</p>';
        wordStylesBtn.classList.add('hidden');
        positionCaptionsBtn.classList.add('hidden');
        return;
    }

    const wordsList = document.createElement('div');
    wordsList.className = 'caption-words-list';

    state.allWords.forEach((word, index) => {
        const wordRow = document.createElement('div');
        wordRow.className = 'caption-word-row drop-zone';
        const isIgnored = word.ignore === true;
        if (isIgnored) {
            wordRow.classList.add('ignored');
        }
        wordRow.innerHTML = `
            <div class="trim-menu-controls">
                <input type="text" class="time-input caption-time-input" value="${(word.start || 0).toFixed(2)}" data-index="${index}" data-time-type="start" title="Start Time" ${isIgnored ? 'disabled' : ''}>
                <span class="time-separator">-</span>
                <input type="text" class="time-input caption-time-input" value="${(word.end || 0).toFixed(2)}" data-index="${index}" data-time-type="end" title="End Time" ${isIgnored ? 'disabled' : ''}>

                <button class="caption-word-row-close close-btn ${isIgnored ? 'hidden' : ''}" data-index="${index}">×</button>
                <button class="caption-word-row-add close-btn tick-btn ${!isIgnored ? 'hidden' : ''}" data-index="${index}">+</button>
            </div>
            <input type="text" class="caption-word-input speed-input url-class" value="${word.word || ''}" data-index="${index}" title="Caption Word" ${isIgnored ? 'hidden' : ''}>
            <div class="trim-menu-actions ${isIgnored ? 'hidden' : ''}">
                <button class="btn word-styles" data-index="${index}">Word Styles</button>
                <button class="btn word-position" data-index="${index}">Word Position</button>
            </div>
        `;
        wordsList.appendChild(wordRow);
    });

    captionContent.appendChild(wordsList);
    wordStylesBtn.classList.remove('hidden');
    positionCaptionsBtn.classList.remove('hidden');
};

/**
 * Toggles the UI elements of a caption row between an active and ignored state.
 * @param {HTMLElement} rowElement - The .caption-word-row element.
 * @param {boolean} shouldIgnore - True to hide/disable elements, false to show/enable.
 */
const toggleRowUI = (rowElement, shouldIgnore) => {
    if (!rowElement) return;

    // Find elements within the specific row
    const timeInputs = rowElement.querySelectorAll('.time-input');
    const wordInput = rowElement.querySelector('.caption-word-input');
    const actionsDiv = rowElement.querySelector('.trim-menu-actions');
    const closeBtn = rowElement.querySelector('.caption-word-row-close');
    const addBtn = rowElement.querySelector('.caption-word-row-add');

    // Toggle disabled/hidden attributes
    timeInputs.forEach(input => input.disabled = shouldIgnore);
    wordInput.classList.toggle("hidden");
    actionsDiv.classList.toggle("hidden");
    if (shouldIgnore) {
        closeBtn.classList.add("hidden");
        addBtn.classList.remove("hidden");
    } else {
        closeBtn.classList.remove("hidden");
        addBtn.classList.add("hidden");
    }

    // Toggle a class on the parent row for custom styling (e.g., opacity)
    rowElement.classList.toggle('ignored', shouldIgnore);
};

/**
 * Updates the state.allWords from the UI input fields.
 */
const updateCaptionDataFromUI = () => {
    document.querySelectorAll('.caption-word-row').forEach(row => {
        const index = parseInt(row.querySelector('.caption-word-input').dataset.index, 10);
        if (isNaN(index) || !state.allWords[index]) return;

        const wordInput = row.querySelector('.caption-word-input');
        const startInput = row.querySelector('.caption-time-input[data-time-type="start"]');
        const endInput = row.querySelector('.caption-time-input[data-time-type="end"]');

        state.allWords[index].word = wordInput.value;
        state.allWords[index].start = parseFloat(startInput.value) || 0;
        state.allWords[index].end = parseFloat(endInput.value) || 0;
    });
};


/**
 * Handles the final processing of burning captions onto the video.
 */
const handleProcessCaptions = async () => {
    if (!state.fileLoaded) return showError("No video file is loaded.");
    if (state.allWords.length === 0) return showError("No caption data available.");

    if (state.playing) pause();
    if (state.isPositioningCaptions) toggleCaptionPositioning();
    updateCaptionDataFromUI();
    showStatusMessage('Starting caption processing...');

    let input;
    try {
        const source = (state.currentPlayingFile instanceof File) ?
            new BlobSource(state.currentPlayingFile) : new UrlSource(state.currentPlayingFile);
        input = new Input({ source, formats: ALL_FORMATS });
        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack) throw new Error("No video track found.");

        const output = new Output({
            format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
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
                    const canvas = new OffscreenCanvas(videoTrack.codedWidth, videoTrack.codedHeight);
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(sample._data || sample, 0, 0);

                    const currentTime = sample.timestamp;

                    // Find the index of the word active at the current timestamp
                    const activeIndex = state.allWords.findIndex(w => w.ignore !== true && currentTime >= w.start && currentTime <= w.end);

                    if (activeIndex !== -1) {
                        // --- Apply Styles from State ---
                        currentSelectedWordIndex = activeIndex;
                        const styles = getActiveStyles();
                        currentSelectedWordIndex = -1;
                        const fontSizePx = videoTrack.codedHeight * (styles.fontSize / 100);
                        ctx.font = `bold ${fontSizePx}px Arial`;
                        ctx.textAlign = 'center';
                        ctx.strokeStyle = 'black';
                        ctx.lineWidth = Math.max(1, fontSizePx / 12);
                        const x = videoTrack.codedWidth * (styles.positionX / 100);
                        const y = videoTrack.codedHeight * (styles.positionY / 100);

                        // --- Calculate word group to display ---
                        const half = Math.floor((styles.wordGroupSize - 1) / 2);
                        let startIndex = activeIndex - half;
                        let endIndex = startIndex + styles.wordGroupSize - 1;

                        // Adjust for edges
                        if (startIndex < 0) {
                            startIndex = 0;
                            endIndex = Math.min(state.allWords.length - 1, styles.wordGroupSize - 1);
                        }
                        if (endIndex >= state.allWords.length) {
                            endIndex = state.allWords.length - 1;
                            startIndex = Math.max(0, endIndex - styles.wordGroupSize + 1);
                        }

                        const wordsToDisplay = state.allWords.slice(startIndex, endIndex + 1);
                        const fullText = wordsToDisplay.map(w => w.word).join(' ');
                        const totalWidth = ctx.measureText(fullText).width;
                        let currentX = x - totalWidth / 2;

                        // --- Draw the words ---
                        wordsToDisplay.forEach(word => {
                            const wordText = word.word; // No extra space needed here
                            const wordWidth = ctx.measureText(wordText).width;
                            const isCurrentWord = (word.word === state.allWords[activeIndex].word);

                            ctx.fillStyle = (styles.wordGroupSize > 1 && isCurrentWord) ? styles.highlightColor : styles.color;

                            // Draw each word centered on its own measured position
                            ctx.strokeText(wordText, currentX + wordWidth / 2, y);
                            ctx.fillText(wordText, currentX + wordWidth / 2, y);

                            currentX += wordWidth + ctx.measureText(' ').width; // Add width of a space
                        });
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
const captionMenu = $('captionMenu');
const processCaptionsBtn = $('processCaptionsBtn');
const loadCaptionsBtn = $('loadCaptionsBtn');
const captionFileInput = $('captionFileInput');
const wordStylesModal = $('wordStylesModal');
const closeWordStylesBtn = $('closeWordStylesBtn');
const applyWordStylesBtn = $('applyWordStylesBtn');
const captionGroupSizeInput = $('captionGroupSize');
const highlightColorContainer = $('highlightColorContainer');
export const setupCaptionListeners = () => {

    addCaptionBtn.onclick = handleCaptionBtnClick;
    processCaptionsBtn.onclick = handleProcessCaptions;
    positionCaptionsBtn.onclick = toggleCaptionPositioning;

    // --- File Loading ---
    loadCaptionsBtn.onclick = () => captionFileInput.click();
    captionFileInput.onchange = handleCaptionFileChange;

    // --- Word Styles Modal Logic ---
    wordStylesBtn.onclick = openWordStyles;

    if (closeWordStylesBtn) closeWordStylesBtn.onclick = hideStylesModal;
    if (wordStylesModal) wordStylesModal.onclick = (e) => {
        if (e.target === wordStylesModal) hideStylesModal();
    };

    if (applyWordStylesBtn) {
        applyWordStylesBtn.onclick = () => {
            if (currentSelectedWordIndex !== -1) {
                state.allWords[currentSelectedWordIndex]["captionStyles"] = {
                    fontSize: parseFloat($('captionFontSize').value).toFixed(2),
                    color: $('captionColor').value,
                    positionX: parseInt($('captionPosX').value, 10),
                    positionY: parseInt($('captionPosY').value, 10),
                    wordGroupSize: parseInt(captionGroupSizeInput.value, 10),
                    highlightColor: $('highlightColor').value,
                }
            } else {
                state.captionStyles = {
                    fontSize: parseFloat($('captionFontSize').value).toFixed(2),
                    color: $('captionColor').value,
                    positionX: parseInt($('captionPosX').value, 10),
                    positionY: parseInt($('captionPosY').value, 10),
                    wordGroupSize: parseInt(captionGroupSizeInput.value, 10),
                    highlightColor: $('highlightColor').value,
                }
            }
            showInfo("Caption styles applied!");
            hideStylesModal();
        };
    }

    // Show/hide highlight option based on group size
    if (captionGroupSizeInput) {
        captionGroupSizeInput.addEventListener('input', (e) => {
            const size = parseInt(e.target.value, 10);
            if (size > 1) {
                highlightColorContainer.classList.remove('hidden');
            } else {
                highlightColorContainer.classList.add('hidden');
            }
        });
    }

    // --- Dynamic input handling using event delegation ---
    const captionContent = $('captionContent');
    if (captionContent) {
        captionContent.addEventListener('change', (e) => {
            if (e.target.closest('.caption-word-row')) {
                updateCaptionDataFromUI();
            }
        });
        captionContent.addEventListener('click', (e) => {
            const target = e.target;
            const index = parseInt(target.dataset.index, 10);
            currentSelectedWordIndex = index;
            // Exit if the clicked element doesn't have a valid index
            if (isNaN(index) || !state.allWords[index]) return;

            const rowElement = target.closest('.caption-word-row');

            // Check if the CLOSE '×' button was clicked
            if (target.matches('.caption-word-row-close')) {
                // Update state in the JSON object
                state.allWords[index].ignore = true;
                // Update the UI for that specific row
                toggleRowUI(rowElement, true);
            }

            // Check if the ADD '+' button was clicked
            if (target.matches('.caption-word-row-add')) {
                // Update state by removing the 'ignore' property
                delete state.allWords[index].ignore;
                // Revert the UI changes for that row
                toggleRowUI(rowElement, false);
            }
            if (target.matches('.word-styles')) {
                openWordStyles();
            }
            if (target.matches('.word-position')) {
                toggleCaptionPositioning();
            }
        });
    }
};

const openWordStyles = () => {
    const styles = getActiveStyles();

    $('captionFontSize').value = styles.fontSize;
    $('captionColor').value = styles.color;
    $('captionPosX').value = styles.positionX;
    $('captionPosY').value = styles.positionY;
    $('highlightColor').value = styles.highlightColor;
    captionGroupSizeInput.value = styles.wordGroupSize;
    captionGroupSizeInput.dispatchEvent(new Event('input'));
    wordStylesModal.classList.remove('hidden');
    if (state.isPositioningCaptions) toggleCaptionPositioning();
};

const hideStylesModal = () => {
    wordStylesModal.classList.add('hidden');
    currentSelectedWordIndex = -1;
};

const handleCaptionFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/json') {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const jsonData = JSON.parse(event.target.result);
                state.allWords = normalizeCaptionData(jsonData); // Normalize and store
                renderCaptionUI(); // Render from the new flat array
                showInfo("Caption file loaded successfully.");
            } catch (err) {
                showError("Invalid JSON file format.");
            }
        };
        reader.readAsText(file);
    } else {
        showError("Please select a valid .json file.");
    }
    e.target.value = null;
};

const handleCaptionBtnClick = (e) => {
    e.stopPropagation();
    rightPanel('caption', true);
}

const toggleCaptionPositioning = () => {
    const isActivating = !state.isPositioningCaptions;
    const cropCanvas = $('cropCanvas');

    // Turn off other modes to prevent conflicts
    state.isCropping = false;
    state.isPanning = false;

    // Set the caption positioning state
    state.isPositioningCaptions = isActivating;

    if (isActivating) {
        // --- SETUP ---
        cropCanvas.classList.remove('hidden');
        positionCropCanvas();

        positionCaptionsBtn.textContent = 'Confirm Position';
        positionCaptionsBtn.classList.add('active-positioning');

        // Calculate the initial box from styles (this logic is correct)
        const styles = getActiveStyles();

        const groupSize = Math.max(1, styles.wordGroupSize);
        let sampleText = "Sample Word ".repeat(groupSize).trim();
        const fontSizePx = canvas.height * (styles.fontSize / 100);
        cropCtx.font = `bold ${fontSizePx}px Arial`;
        const textMetrics = cropCtx.measureText(sampleText);
        const boxWidth = textMetrics.width;
        const boxHeight = fontSizePx * 1.2;
        const centerX = canvas.width * (styles.positionX / 100);
        const centerY = canvas.height * (styles.positionY / 100);
        state.cropRect = {
            x: centerX - boxWidth / 2,
            y: centerY - boxHeight / 2,
            width: boxWidth,
            height: boxHeight,
        };

        // Tell crop.js to draw the initial box
        drawCropWithHandles(state.cropRect);

    } else {
        // --- TEARDOWN ---
        cropCanvas.classList.add('hidden');
        positionCaptionsBtn.textContent = 'Position Words';
        positionCaptionsBtn.classList.remove('active-positioning');
        state.cropRect = null;
        drawCropWithHandles(null); // Clear the canvas
        guidedPanleInfo("");
    }
};

/** Updates caption styles based on the state.cropRect dimensions and position. */
export const syncCaptionStylesFromRect = () => {
    const centerX = state.cropRect.x + state.cropRect.width / 2;
    const centerY = state.cropRect.y + state.cropRect.height / 2;
    const newFontSizePercent = parseFloat((state.cropRect.height / 1.2 / canvas.height) * 100).toFixed(2);
    let wordGroupSize = state.captionStyles.wordGroupSize
    if (currentSelectedWordIndex !== -1) {
        if (!state.allWords[currentSelectedWordIndex]["captionStyles"]) {
            state.allWords[currentSelectedWordIndex]["captionStyles"] = state.captionStyles;
        }
        wordGroupSize = state.allWords[currentSelectedWordIndex]["captionStyles"].wordGroupSize;
        state.allWords[currentSelectedWordIndex]["captionStyles"].positionX = parseInt((centerX / canvas.width) * 100);
        state.allWords[currentSelectedWordIndex]["captionStyles"].positionY = parseInt((centerY / canvas.height) * 100);
        state.allWords[currentSelectedWordIndex]["captionStyles"].fontSize = newFontSizePercent;
    } else {
        state.captionStyles.positionX = parseInt((centerX / canvas.width) * 100);
        state.captionStyles.positionY = parseInt((centerY / canvas.height) * 100);
        state.captionStyles.fontSize = newFontSizePercent;
    }

    // Recalculate width based on new font size to maintain text aspect ratio
    const groupSize = Math.max(1, wordGroupSize);
    let sampleText = "Sample Word ".repeat(groupSize).trim();
    const fontSizePx = canvas.height * (newFontSizePercent / 100);
    cropCtx.font = `bold ${fontSizePx}px Arial`;
    const textMetrics = cropCtx.measureText(sampleText);
    state.cropRect.width = textMetrics.width;

    // Re-center the box horizontally after width changes
    state.cropRect.x = (state.captionStyles.positionX / 100 * canvas.width) - state.cropRect.width / 2;
};

const getActiveStyles = () => {
    if (currentSelectedWordIndex !== -1 && state.allWords[currentSelectedWordIndex]) {
        return getOrCreateWordStyles();
    }
    return state.captionStyles;
};

const getOrCreateWordStyles = () => {
    if (!state.allWords[currentSelectedWordIndex].captionStyles) {
        // Clone global styles to create a new object for this word
        state.allWords[currentSelectedWordIndex].captionStyles = { ...state.captionStyles };
    }
    return state.allWords[currentSelectedWordIndex].captionStyles;
};
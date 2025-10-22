// ============================================================================
// RESIZE
// ============================================================================

import {
	Input,
	ALL_FORMATS,
	BlobSource,
	UrlSource,
	Conversion,
	Output,
	Mp4OutputFormat,
	BufferTarget
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';

import { startTimeInput, endTimeInput, settingsMenu, resizeBtn, resizeModal, resizeWidthInput, resizeHeightInput, keepRatioToggle, resizeStartTimeInput, resizeEndTimeInput, cancelResizeBtn, processResizeBtn } from './constants.js';
import { state } from './state.js';
import { guidedPanleInfo, parseTime } from './utility.js'
import { hideTrackMenus, pause } from './player.js'
import { updatePlaylistUIOptimized } from './playlist.js'
import { hideStatusMessage, showError, showStatusMessage } from './ui.js'

export const resize_define = () => {
    resizeBtn.onclick = (e) => {
        e.stopPropagation();
        if (!state.videoTrack) {
            showError("A video must be loaded to use the resize feature.");
            return;
        }

        // Store current aspect ratio
        state.videoAspectRatio = state.videoTrack.codedWidth / state.videoTrack.codedHeight;

        // Populate modal with current values
        resizeStartTimeInput.value = startTimeInput.value;
        resizeEndTimeInput.value = endTimeInput.value;
        resizeWidthInput.value = state.videoTrack.codedWidth;
        resizeHeightInput.value = state.videoTrack.codedHeight;
        keepRatioToggle.checked = true;

        // Show the modal and hide the settings menu
        resizeModal.classList.remove('hidden');
        settingsMenu.classList.add('hidden');
    };

    const hideResizeModal = () => {
        resizeModal.classList.add('hidden');
    };

    cancelResizeBtn.onclick = hideResizeModal;
    resizeModal.onclick = (e) => {
        if (e.target === resizeModal) hideResizeModal();
    };
    processResizeBtn.onclick = handleResizeAction;

    resizeWidthInput.addEventListener('input', () => {
        if (keepRatioToggle.checked) {
            const width = parseInt(resizeWidthInput.value, 10);
            if (!isNaN(width) && width > 0) {
                resizeHeightInput.value = Math.round(width / state.videoAspectRatio);
            }
        }
    });

    resizeHeightInput.addEventListener('input', () => {
        if (keepRatioToggle.checked) {
            const height = parseInt(resizeHeightInput.value, 10);
            if (!isNaN(height) && height > 0) {
                resizeWidthInput.value = Math.round(height * state.videoAspectRatio);
            }
        }
    });
}

export const handleResizeAction = async () => {
    if (!state.fileLoaded || !state.videoTrack) {
        showError("No video track loaded for resizing.");
        return;
    }
    if (state.playing) pause();

    const start = parseTime(resizeStartTimeInput.value);
    const end = parseTime(resizeEndTimeInput.value);
    const width = parseInt(resizeWidthInput.value, 10);
    const height = parseInt(resizeHeightInput.value, 10);

    if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end > state.totalDuration) {
        showError("Invalid start or end time for resizing.");
        return;
    }
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
        showError("Invalid width or height for resizing.");
        return;
    }

    // Ensure dimensions are even numbers for better compatibility
    const evenWidth = Math.round(width / 2) * 2;
    const evenHeight = Math.round(height / 2) * 2;

    hideTrackMenus();
    resizeModal.classList.add('hidden');
    guidedPanleInfo('Resizing clip...');
    let input;

    try {
        const source = (state.currentPlayingFile instanceof File) ? new BlobSource(state.currentPlayingFile) : new UrlSource(state.currentPlayingFile);
        input = new Input({ source, formats: ALL_FORMATS });

        const output = new Output({
            format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
            target: new BufferTarget()
        });

        const conversionOptions = {
            input,
            output,
            trim: { start, end },
            video: {
                width: evenWidth,
                height: evenHeight,
    			fit: 'contain',
            }
        };

        const conversion = await Conversion.init(conversionOptions);
        if (!conversion.isValid) throw new Error('Could not create a valid conversion for resizing.');

        conversion.onProgress = (progress) => showStatusMessage(`Resizing clip... (${Math.round(progress * 100)}%)`);
        await conversion.execute();

        const originalName = (state.currentPlayingFile.name || 'video').split('.').slice(0, -1).join('.');
        const clipName = `${originalName}_${evenWidth}x${evenHeight}_resized.mp4`;
        const resizedClipFile = new File([output.target.buffer], clipName, { type: 'video/mp4' });

        state.playlist.push({ type: 'file', name: clipName, file: resizedClipFile, isCutClip: true });
        updatePlaylistUIOptimized();
        showStatusMessage('Resized clip added to playlist!');
        setTimeout(hideStatusMessage, 2000);

    } catch (error) {
        console.error("Error during resizing:", error);
        showError(`Failed to resize clip: ${error.message}`);
        hideStatusMessage();
    } finally {
        if (input) input.dispose();
        guidedPanleInfo("");
    }
};
// ============================================================================
// IMAGE TO VIDEO FUNCTIONALITY
// ============================================================================

import {
    Input,
    Output,
    BufferTarget,
    Mp4OutputFormat,
    CanvasSource,
    QUALITY_HIGH
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';

import {
    imageToVideoBtn,
    imageToVideoModal,
    imageFileInput,
    selectImageBtn,
    imagePreview,
    imagePreviewContainer,
    imageDurationInput,
    closeImageToVideoBtn,
    cancelImageToVideoBtn,
    createImageVideoBtn,
    settingsMenu
} from './constants.js';
import { state } from './state.js';
import { showError, showStatusMessage, hideStatusMessage } from './ui.js';
import { updatePlaylistUIOptimized } from './playlist.js';
import { hideTrackMenus } from './player.js';
import { guidedPanleInfo } from './utility.js';

export const setupImageToVideo = () => {
    // Open modal
    imageToVideoBtn.onclick = (e) => {
        e.stopPropagation();
        imageToVideoModal.classList.remove('hidden');
        settingsMenu.classList.add('hidden');
        resetImageToVideoModal();
    };

    // Select image button
    selectImageBtn.onclick = () => {
        imageFileInput.click();
    };

    // Handle image selection
    imageFileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            state.selectedImageFile = file;

            // Show preview
            const reader = new FileReader();
            reader.onload = (event) => {
                imagePreview.src = event.target.result;
                imagePreviewContainer.style.display = 'block';
                createImageVideoBtn.disabled = false;
            };
            reader.readAsDataURL(file);
        } else {
            showError("Please select a valid image file.");
        }
    };

    // Close modal handlers
    closeImageToVideoBtn.onclick = hideImageToVideoModal;
    cancelImageToVideoBtn.onclick = hideImageToVideoModal;
    imageToVideoModal.onclick = (e) => {
        if (e.target === imageToVideoModal) {
            hideImageToVideoModal();
        }
    };

    // Create video button
    createImageVideoBtn.onclick = handleCreateImageVideo;
};

const hideImageToVideoModal = () => {
    imageToVideoModal.classList.add('hidden');
};

const resetImageToVideoModal = () => {
    imageFileInput.value = '';
    imagePreview.src = '';
    imagePreviewContainer.style.display = 'none';
    imageDurationInput.value = '5';
    createImageVideoBtn.disabled = true;
    state.selectedImageFile = null;
};

const createImageVideo = async (imageFile, duration, fps = 30) => {
    // 1. Load the image and draw it to a canvas once
    const img = new Image();
    const imageUrl = URL.createObjectURL(imageFile);
    await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = imageUrl;
    });
    URL.revokeObjectURL(imageUrl);

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0); // Draw the image just once

    // 2. Set up the mediabunny Output and CanvasSource
    const output = new Output({
        target: new BufferTarget(),
        format: new Mp4OutputFormat({ fastStart: 'in-memory' })
    });

    const canvasSource = new CanvasSource(canvas, {
        codec: 'avc', // or 'vp9', 'av1' etc.
        bitrate: QUALITY_HIGH
    });
    output.addVideoTrack(canvasSource, { frameRate: fps });

    await output.start();

    // 3. Loop and add frames directly to the mediabunny output
    const totalFrames = duration * fps;
    for (let i = 0; i < totalFrames; i++) {
        const timestamp = i / fps;
        await canvasSource.add(timestamp, 1 / fps);
    }

    // 4. Finalize the MP4 file
    await output.finalize();

    // 5. Return the final MP4 blob
    return new Blob([output.target.buffer], { type: 'video/mp4' });
};

const handleCreateImageVideo = async () => {
    if (!state.selectedImageFile) {
        showError("Please select an image first.");
        return;
    }

    const duration = parseInt(imageDurationInput.value, 10);
    if (isNaN(duration) || duration < 1 || duration > 300) {
        showError("Duration must be between 1 and 300 seconds.");
        return;
    }

    hideImageToVideoModal();
    hideTrackMenus();
    guidedPanleInfo('Creating video from image...');
    showStatusMessage('Processing image...');

    try {
        // The entire creation process is now just one function call!
        showStatusMessage('Encoding video...');
        const mp4Blob = await createImageVideo(state.selectedImageFile, duration);

        // Create filename
        const originalName = state.selectedImageFile.name.split('.').slice(0, -1).join('') || 'image';
        const fileName = `${originalName}_${duration}s_video.mp4`;

        // Create file from blob
        const videoFile = new File([mp4Blob], fileName, { type: 'video/mp4' });

        // Add to playlist
        state.playlist.push({
            type: 'file',
            name: fileName,
            file: videoFile,
            isCutClip: true
        });

        updatePlaylistUIOptimized();
        showStatusMessage('Video created and added to playlist!');
        guidedPanleInfo('Video created successfully!');

        setTimeout(() => {
            hideStatusMessage();
            guidedPanleInfo('');
        }, 2000);

    } catch (error) {
        console.error("Error creating video from image:", error);
        showError(`Failed to create video: ${error.message}`);
        hideStatusMessage();
        guidedPanleInfo('');
        resetImageToVideoModal();
    }
};
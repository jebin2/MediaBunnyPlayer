// ============================================================================
// IMAGE TO VIDEO FUNCTIONALITY
// ============================================================================

import {
    Input,
    ALL_FORMATS,
    BlobSource,
    Output,
    BufferTarget,
    Mp4OutputFormat,
    CanvasSource,
    EncodedPacketSink, // Use this to READ encoded packets
    EncodedAudioPacketSource, // Use this to WRITE encoded audio packets
    QUALITY_HIGH,
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
    imageWidthInput,
    imageHeightInput,
    keepRatioChk,
    audioInput,
    audioInputBtn,
    audioFileName
} from './constants.js';
import { state } from './state.js';
import { showError, showStatusMessage, hideStatusMessage } from './ui.js';
import { updatePlaylistUIOptimized, openPlaylist } from './playlist.js';
import { hideTrackMenus } from './player.js';

export const setupImageToVideo = () => {
    let originalAspectRatio = 1;
    // Open modal
    imageToVideoBtn.onclick = (e) => {
        e.stopPropagation();
        imageToVideoModal.classList.remove('hidden');
        resetImageToVideoModal();
    };

    audioInputBtn.onclick = (e) => {
        e.stopPropagation();
        audioInput.click();
    };

    audioInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            audioFileName.textContent = file.name;
            if (audioFileName.classList.contains("hidden")) audioFileName.classList.remove("hidden")
        } else {
            audioFileName.textContent = '';
            if (!audioFileName.classList.contains("hidden")) audioFileName.classList.add("hidden")
        }
    };

    document.getElementById('removeAudio').onclick = (e) => {
        audioInput.value = '';
        audioFileName.textContent = '';
        if (!audioFileName.classList.contains("hidden")) audioFileName.classList.add("hidden")
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
            const reader = new FileReader();
            reader.onload = (event) => {
                imagePreview.src = event.target.result;
                imagePreview.onload = () => {
                    imageWidthInput.value = imagePreview.naturalWidth;
                    imageHeightInput.value = imagePreview.naturalHeight;
                    originalAspectRatio = imagePreview.naturalWidth / imagePreview.naturalHeight;
                };
                imagePreviewContainer.style.display = 'block';
                createImageVideoBtn.disabled = false;
            };
            reader.readAsDataURL(file);
        } else {
            showError("Please select a valid image file.");
        }
    };

    imageWidthInput.addEventListener('input', () => {
        if (keepRatioChk.checked && originalAspectRatio && imageWidthInput.value) {
            imageHeightInput.value = Math.round(imageWidthInput.value / originalAspectRatio);
        }
    });

    imageHeightInput.addEventListener('input', () => {
        if (keepRatioChk.checked && originalAspectRatio && imageHeightInput.value) {
            imageWidthInput.value = Math.round(imageHeightInput.value * originalAspectRatio);
        }
    });

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
    audioInput.value = '';
    audioFileName.textContent = '';
    if (!audioFileName.classList.contains("hidden")) audioFileName.classList.add("hidden")
    imagePreview.src = '';
    imagePreviewContainer.style.display = 'none';
    imageDurationInput.value = '5';
    imageWidthInput.value = '';
    imageHeightInput.value = '';
    createImageVideoBtn.disabled = true;
    state.selectedImageFile = null;
};


// --- THIS IS THE CORRECTED CORE FUNCTION ---
const createImageVideo = async (options) => {
    const { imageFile, duration, fps = 30, dimensions, audioFile } = options;

    // 1. Load image and prepare canvas
    const img = new Image();
    const imageUrl = URL.createObjectURL(imageFile);
    await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = imageUrl;
    });
    URL.revokeObjectURL(imageUrl);

    const targetWidth = dimensions?.width || img.width;
    const targetHeight = dimensions?.height || img.height;

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    // 2. Set up the mediabunny Output
    const output = new Output({
        target: new BufferTarget(),
        format: new Mp4OutputFormat({ fastStart: 'in-memory' })
    });

    // 3. Add video track to the output
    const canvasSource = new CanvasSource(canvas, {
        codec: 'avc',
        bitrate: QUALITY_HIGH
    });
    output.addVideoTrack(canvasSource, { frameRate: fps });

    // --- PROGRESS REPORTING LOGIC ---
    let videoProgress = 0;
    let audioProgress = 0;
    let hasAudio = false; // We'll set this to true if audio is successfully added

    // This function calculates the combined progress and calls the callback
    const updateOverallProgress = () => {
        if (!onProgress) return;

        // We'll give 50% weight to video and 50% to audio if it exists
        const overallProgress = hasAudio
            ? (videoProgress * 0.5) + (audioProgress * 0.5)
            : videoProgress;

        onProgress(overallProgress);
    };
    // --- END PROGRESS LOGIC ---

    // This promise will handle piping audio data. It resolves immediately if there's no audio.
    let audioPipePromise = Promise.resolve();

    // 4. Set up and add audio track (if it exists) BEFORE starting the output
    if (audioFile) {
        const audioInput = new Input({
            source: new BlobSource(audioFile),
            formats: ALL_FORMATS
        });
        const audioTrack = await audioInput.getPrimaryAudioTrack();

        if (audioTrack) {
            hasAudio = true; // Audio track found!
            const audioDecoderConfig = await audioTrack.getDecoderConfig();
            const audioSource = new EncodedAudioPacketSource(audioTrack.codec);
            output.addAudioTrack(audioSource);

            // Define the audio processing logic. This will run after output.start()
            const pipeAudio = async () => {
                const audioDuration = await audioTrack.computeDuration();
                if (!audioDuration || audioDuration <= 0) {
                    console.warn("Audio file has zero or invalid duration. It will not be looped.");
                    const sink = new EncodedPacketSink(audioTrack);
                    let firstPacket = true;
                    for await (const packet of sink.packets()) {
                        if (packet.timestamp >= duration) break;
                        const metadata = firstPacket ? { decoderConfig: audioDecoderConfig } : undefined;
                        await audioSource.add(packet, metadata);
                        firstPacket = false;
                        // Update progress based on timestamp
                        audioProgress = Math.min(packet.timestamp / duration, 1.0);
                        updateOverallProgress();
                    }
                } else {
                    let timeOffset = 0;
                    let firstPacketEver = true;
                    while (timeOffset < duration) {
                        const sink = new EncodedPacketSink(audioTrack);
                        for await (const packet of sink.packets()) {
                            const newTimestamp = packet.timestamp + timeOffset;
                            if (newTimestamp >= duration) break;

                            const newPacket = packet.clone({ timestamp: newTimestamp });
                            const metadata = firstPacketEver ? { decoderConfig: audioDecoderConfig } : undefined;
                            await audioSource.add(newPacket, metadata);
                            firstPacketEver = false;
                        }
                        timeOffset += audioDuration;
                        // Update progress based on the time offset
                        audioProgress = Math.min(timeOffset / duration, 1.0);
                        updateOverallProgress();
                    }
                }
                audioProgress = 1.0; // Ensure it reaches 100%
                updateOverallProgress();
                audioSource.close();
            };
            audioPipePromise = pipeAudio();
        } else {
            console.warn("Could not find an audio track in the provided file.");
        }
    }

    // 5. Start the output now that all tracks are added
    await output.start();

    // 6. Start piping video and audio data concurrently
    const videoPipePromise = (async () => {
        const totalFrames = duration * fps;
        for (let i = 0; i < totalFrames; i++) {
            const timestamp = i / fps;
            await canvasSource.add(timestamp, 1 / fps);
            // Update progress based on frames processed
            videoProgress = (i + 1) / totalFrames;
            updateOverallProgress();
        }
        canvasSource.close();
    })();

    // Wait for both streams to finish
    await Promise.all([videoPipePromise, audioPipePromise]);
    onProgress(1.0);
    // 7. Finalize the MP4 file
    await output.finalize();

    // 8. Return the final MP4 blob
    return new Blob([output.target.buffer], { type: 'video/mp4' });
};

const getAudioDuration = (audioFile) => {
    return new Promise((resolve, reject) => {
        if (!audioFile || !audioFile.type.startsWith('audio/')) {
            return reject(new Error("Invalid audio file provided."));
        }

        const audio = new Audio();
        const objectUrl = URL.createObjectURL(audioFile);

        // This event fires when the browser has loaded metadata like duration.
        audio.addEventListener('loadedmetadata', () => {
            URL.revokeObjectURL(objectUrl); // Clean up the object URL to prevent memory leaks
            resolve(audio.duration);
        });

        // Handle any errors during loading
        audio.addEventListener('error', () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Failed to load audio file to determine its duration."));
        });

        // Set the source to trigger the loading process
        audio.src = objectUrl;
    });
};

const handleCreateImageVideo = async () => {
    if (!state.selectedImageFile) {
        showError("Please select an image first.");
        return;
    }
    let duration = parseFloat(imageDurationInput.value) || 0;
    const width = parseInt(imageVideoWidthInput.value) || null; // Corrected ID from your HTML
    const height = parseInt(imageVideoHeightInput.value) || null; // Corrected ID from your HTML
    const audioFile = imageVideoAudioInput.files[0] || null; // Corrected ID from your HTML

    // NEW LOGIC: If duration is 0, try to use audio duration
    if (duration <= 0) {
        if (audioFile) {
            showStatusMessage('Getting audio duration...');
            try {
                // Await the result from our new helper function
                duration = await getAudioDuration(audioFile);
            } catch (err) {
                console.error(err);
                showError("Could not read the audio file's duration. Please set a duration manually.");
                hideStatusMessage(); // Hide the status message on error
                return; // Stop the process
            }
        } else {
            // No audio file and duration is 0, so show an error
            showError("Duration must be at least 1 second, or an audio file must be provided.");
            return; // Stop the process
        }
    }

    // Final check to ensure we have a valid, positive duration before proceeding
    if (isNaN(duration) || duration <= 0) {
        showError("The final duration must be a positive number.");
        return;
    }

    hideImageToVideoModal();
    hideTrackMenus();
    showStatusMessage('Starting process...');

    try {
        showStatusMessage('Encoding video...');

        const mp4Blob = await createImageVideo({
            imageFile: state.selectedImageFile,
            duration: duration,
            dimensions: { width, height },
            audioFile: audioFile
        });

        const fileName = `${state.selectedImageFile.name.split('.')[0]}_video.mp4`;
        const videoFile = new File([mp4Blob], fileName, { type: 'video/mp4' });

        state.playlist.push({
            type: 'file',
            name: fileName,
            file: videoFile,
            isCutClip: true
        });

        updatePlaylistUIOptimized();
        showStatusMessage('Video created and added to playlist!');
        openPlaylist();

    } catch (error) {
        console.error("Error creating video from image:", error);
        showError(`Failed to create video: ${error.message}`);
    } finally {
        setTimeout(() => {
            hideStatusMessage();
        }, 2000);
        resetImageToVideoModal();
        $('togglePlaylistBtn').click();
    }
};

const onProgress = (progress) => {
    // We check for 1.0 because we'll set a "Finalizing..." message later
    if (progress < 1.0) {
        showStatusMessage(`Encoding video... (${Math.round(progress * 100)}%)`);
    }
};
// ============================================================================
// AUDIO DOWNLOAD FUNCTIONALITY
// ============================================================================

import {
    Input,
    ALL_FORMATS,
    BlobSource,
    UrlSource,
    Conversion,
    Output,
    Mp3OutputFormat,
    BufferTarget
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.25.0/+esm';

import { state } from './state.js';
import { showError, showStatusMessage, hideStatusMessage, showInfo } from './ui.js';
import { hideTrackMenus, switchAudioTrack } from './player.js';
import { audioTrack } from './constants.js'
import { rightPanel, formatTime, parseTime } from './utility.js'
import { handleCutAction } from './editing.js';

const handleAudioDownload = async (trackIndex) => {
    if (!state.fileLoaded || !state.availableAudioTracks[trackIndex]) {
        showError("No valid audio track selected for download.");
        return;
    }

    const trackToDownload = state.availableAudioTracks[trackIndex];

    try {
        const canDecode = await trackToDownload.canDecode();
        if (!canDecode) {
            showError("This audio track uses a codec that cannot be decoded by this browser, so it cannot be downloaded as MP3.");
            hideTrackMenus();
            return;
        }
    } catch (e) {
        showError("Could not verify audio track compatibility.");
        console.error("Error checking track decodability:", e);
        hideTrackMenus();
        return;
    }

    hideTrackMenus();
    showStatusMessage(`Preparing to download audio track ${trackIndex + 1}...`);

    let input;
    try {
        const source = (state.currentPlayingFile instanceof File)
            ? new BlobSource(state.currentPlayingFile)
            : new UrlSource(state.currentPlayingFile);

        input = new Input({ source, formats: ALL_FORMATS });

        const output = new Output({
            format: new Mp3OutputFormat({ bitrate: 192000 }), // 192kbps MP3
            target: new BufferTarget()
        });

        const conversionOptions = {
            input,
            output,
            audio: {
                track: trackToDownload,
                codec: 'mp3'
            },
        };

        const conversion = await Conversion.init(conversionOptions);
        if (!conversion.isValid) {
            console.error('Conversion is not valid. Discarded tracks:', conversion.discardedTracks);
            throw new Error('Could not create a valid conversion for the audio track.');
        }

        conversion.onProgress = (progress) => {
            showStatusMessage(`Downloading audio... (${Math.round(progress * 100)}%)`);
        };

        await conversion.execute();

        const originalName = (state.currentPlayingFile.name || 'audio').split('.').slice(0, -1).join('.');
        const langCode = trackToDownload.languageCode && trackToDownload.languageCode !== 'und' ? `_${trackToDownload.languageCode}` : '';
        const fileName = `${originalName}_audio_track_${trackIndex + 1}${langCode}.mp3`;

        const audioBlob = new Blob([output.target.buffer], { type: 'audio/mpeg' });
        const downloadUrl = URL.createObjectURL(audioBlob);

        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);

        showStatusMessage('Audio download complete!');
        setTimeout(hideStatusMessage, 2000);

    } catch (error) {
        console.error("Error during audio download:", error);
        showError(`Failed to download audio: ${error.message}`);
        hideStatusMessage();
    } finally {
        if (input) input.dispose();
    }
};

export const setupAudioListener = () => {
    document.getElementById('mixAudioBtn').onclick = () => {
        rightPanel("mixAudio", true);
    };
    document.getElementById('uploadMixAudioBtn').onclick = () => {
        document.getElementById('mixAudioFileInput').click();
        document.getElementById('mixAudioFileInput').onchange = (e) => {
            const file = e.target.files[0];
            addAudioTrackToPlaylist(file);
        };
    };
    document.getElementById('generateBeepBtn').onclick = generateBeepSound;
    document.getElementById('processMixAudioBtn').onclick = handleCutAction;

    audioTrack.addEventListener('click', (e) => {
        const downloadButton = e.target.closest('.download-btn');
        if (downloadButton) {
            e.stopPropagation();
            const trackIndex = parseInt(downloadButton.dataset.trackIndex, 10);
            if (!isNaN(trackIndex)) {
                handleAudioDownload(trackIndex);
            }
            return;
        }

        const trackInfo = e.target.closest('.track-info');
        if (trackInfo) {
            e.stopPropagation();
            const trackIndex = parseInt(trackInfo.dataset.trackIndex, 10);
            if (!isNaN(trackIndex)) {
                switchAudioTrack(trackIndex);
            }
            return;
        }
    });
    // --- REVISED EVENT LISTENER FOR THE MIX AUDIO PANEL ---
    document.getElementById('mixAudioMenu').addEventListener('click', (e) => {
        const target = e.target;
        const dropdownButton = target.closest('.audioTypeDropdownBtn');
        const actionButton = target.closest('.audioTypeDropdownMenu button[data-action]');
        const closeTimeRangeBtn = target.closest('.time-range-close');
        const addTimeRangeBtn = target.closest('.time-range-add');
        const closeAudioTrackBtn = target.closest('.mix-audio-close');


        if (dropdownButton) {
            const menu = dropdownButton.nextElementSibling;
            if (menu && menu.classList.contains('audioTypeDropdownMenu')) {
                menu.classList.toggle('hidden');
            }
            return;
        }

        if (actionButton) {
            const action = actionButton.dataset.action;
            const index = actionButton.dataset.index;
            const rangeIndex = actionButton.dataset.rangeIndex;
            if (state.mixAudio[index] && state.mixAudio[index].audio_edit_prop) {
                state.mixAudio[index].audio_edit_prop[rangeIndex].action = action;
            }
            const mainButton = actionButton.closest('.trim-menu-actions').querySelector('.audioTypeDropdownBtn');
            if (mainButton) {
                mainButton.textContent = actionButton.textContent + " ▼";
            }
            actionButton.closest('.audioTypeDropdownMenu').classList.add('hidden');
            return; // Action handled
        }

        // Handle closing an entire audio track
        if (closeAudioTrackBtn) {
            const segmentIndex = parseInt(closeAudioTrackBtn.dataset.segmentIndex, 10);
            if (!isNaN(segmentIndex) && state.mixAudio[segmentIndex]) {
                state.mixAudio.splice(segmentIndex, 1);
                updateMixAudioUI(); // Re-render the UI
            }
            return; // Action handled
        }

        // Handle closing a specific time range
        if (closeTimeRangeBtn) {
            const segmentIndex = parseInt(closeTimeRangeBtn.dataset.segmentIndex, 10);
            const rangeIndex = parseInt(closeTimeRangeBtn.dataset.rangeIndex, 10);
            const audioTrack = state.mixAudio[segmentIndex];

            if (audioTrack?.audio_edit_prop) {
                audioTrack.audio_edit_prop.splice(rangeIndex, 1);

                // If it was the last one, add a default empty range back
                if (audioTrack.audio_edit_prop.length === 0) {
                    audioTrack.audio_edit_prop.push({ start: "00:00", end: "00:00", action: 'overlay' });
                }
                updateMixAudioUI(); // Re-render the UI
            }
            return; // Action handled
        }

        // Handle adding a new time range
        if (addTimeRangeBtn) {
            const segmentIndex = parseInt(addTimeRangeBtn.dataset.segmentIndex, 10);
            const audioTrack = state.mixAudio[segmentIndex];

            if (audioTrack?.audio_edit_prop) {
                // Add a new default time range
                audioTrack.audio_edit_prop.push({ start: "00:00", end: "00:00", action: "overlay" });
                updateMixAudioUI(); // Re-render the UI
            }
            return; // Action handled
        }
    });
    document.getElementById('mixAudioMenu').addEventListener('change', (e) => {
        // Ensure it's an input field
        if (e.target.matches('input')) {
            if (e.target.dataset.timeType === "start") {
                state.mixAudio[parseInt(e.target.dataset.segmentIndex)].audio_edit_prop[parseInt(e.target.dataset.rangeIndex)].start = e.target.value;
            } else if (e.target.dataset.timeType === "end") {
                state.mixAudio[parseInt(e.target.dataset.segmentIndex)].audio_edit_prop[parseInt(e.target.dataset.rangeIndex)].end = e.target.value;
            }
        }
    });
}

export const addAudioTrackToPlaylist = (file, options = {}) => {
    const audioTrack = {
        type: 'file',
        media_type: 'mix_audio',
        name: file.name,
        file: file,
        audio_edit_prop: [{
            action: options.action || 'overlay', // 'replace' or 'overlay'
            start: options.start || "00:00",
            end: options.end || "00:00",
            start_fade_in: options.start_fade_in || false,
            start_fade_out: options.start_fade_out || false
        }]
    };

    state.mixAudio.push(audioTrack);
    updateMixAudioUI(); // Update the UI if you decide to show these tracks
};

// Generate beep sound
const generateBeepSound = async () => {
    try {
        const beepBlob = await createBeepSound(1000, 1.0); // 1000Hz, 1 second
        const beepFile = new File([beepBlob], 'beep.wav', { type: 'audio/wav' });

        showInfo('Beep sound generated');
        addAudioTrackToPlaylist(beepFile);
    } catch (error) {
        console.error('Error generating beep:', error);
        showError('Failed to generate beep sound');
    }
};

// Create beep sound using Web Audio API
const createBeepSound = async (frequency = 1000, duration = 1.0) => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const sampleRate = audioContext.sampleRate;
    const numSamples = sampleRate * duration;
    const audioBuffer = audioContext.createBuffer(1, numSamples, sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
        channelData[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.3;
    }

    // Convert to WAV blob
    const wavBlob = audioBufferToWav(audioBuffer);
    audioContext.close();

    return wavBlob;
};

// Convert AudioBuffer to WAV blob
const audioBufferToWav = (audioBuffer) => {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const samples = audioBuffer.getChannelData(0);
    const dataLength = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    // WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // Write audio data
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, sample * 0x7FFF, true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
};

const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
};

// Replace this function in audio.js
// Replace your existing updateMixAudioUI function with this
export const updateMixAudioUI = () => {
    const container = document.getElementById('mixAudioSegmentsList');
    if (!container) return;

    // Clear previous content and add header
    container.innerHTML = '<h4>Mix Audio</h4>';

    const mixAudioTracks = state.mixAudio.filter(item => item.media_type === "mix_audio");

    if (mixAudioTracks.length === 0) {
        container.innerHTML += '<p>No Audio added.</p>'; // Use += to keep the header
        return;
    }

    // Iterate through the entire playlist to get the correct master index
    state.mixAudio.forEach((segment, index) => {
        if (segment.media_type === "mix_audio") {
            const segmentEl = document.createElement('div');
            segmentEl.className = 'caption-word-row drop-zone'; // Use a wrapper for better structure
            segmentEl.innerHTML = `
            <div class="mix-audio-title">
                <button class="mix-audio-close close-btn" data-segment-index="${index}" title="Remove this audio track">×</button>
                <span class="mix-audio-name">${segment.name}</span>
            </div>
            <div class="mix-audio-time-ranges">
                ${getMixAduioTimeRangeHtml(segment, index)}
            </div>
        `;
            container.appendChild(segmentEl);
        }
    });
};

// Replace this function in audio.js
// Replace your existing getMixAduioTimeRangeHtml function with this
const getMixAduioTimeRangeHtml = (segment, segmentIndex) => {
    let timeRangeHtml = "";

    segment.audio_edit_prop.forEach((prop, timeRangeIndex) => {
        // Determine if the 'add' button should be visible (only for the last item)
        const isLastItem = timeRangeIndex === segment.audio_edit_prop.length - 1;
        const addButtonVisibility = isLastItem ? '' : 'hidden';

        timeRangeHtml += `
        <div class="time-range-container">
            <div class="trim-menu-controls">
                <input type="text" class="time-input" value="${formatTime(parseTime(prop.start))}" data-segment-index="${segmentIndex}" data-range-index="${timeRangeIndex}" data-time-type="start" title="Start Time">
                <span class="time-separator">-</span>
                <input type="text" class="time-input" value="${formatTime(parseTime(prop.end))}" data-segment-index="${segmentIndex}" data-range-index="${timeRangeIndex}" data-time-type="end" title="End Time">

                <button class="time-range-close close-btn" data-segment-index="${segmentIndex}" data-range-index="${timeRangeIndex}" title="Remove time range">×</button>
                <button class="time-range-add close-btn tick-btn ${addButtonVisibility}" data-segment-index="${segmentIndex}" title="Add new time range">+</button>
            </div>
            <div class="trim-menu-actions mtop0-75">
                <label class="hidden" for="fadeInToggle_${segmentIndex}_${timeRangeIndex}">
                    <span>Fade In</span>
                    <div class="toggle-switch">
                        <input type="checkbox" id="fadeInToggle_${segmentIndex}_${timeRangeIndex}" ${prop.start_fade_in ? 'checked' : ''}>
                        <span class="switch-slider"></span>
                    </div>
                </label>
                <label class="hidden" for="fadeOutToggle_${segmentIndex}_${timeRangeIndex}">
                    <span>Fade Out</span>
                    <div class="toggle-switch">
                        <input type="checkbox" id="fadeOutToggle_${segmentIndex}_${timeRangeIndex}" ${prop.start_fade_out ? 'checked' : ''}>
                        <span class="switch-slider"></span>
                    </div>
                </label>
                <div>
                    <button class="btn btn-dropdown audioTypeDropdownBtn">${prop.action} ▼</button>
                    <div class="dropdown audioTypeDropdownMenu hidden">
                        <button class="btn" data-action="replace" data-index="${segmentIndex}" data-range-index="${timeRangeIndex}">Replace</button>
                        <button class="btn" data-action="overlay" data-index="${segmentIndex}" data-range-index="${timeRangeIndex}">Overlay</button>
                    </div>
                </div>
            </div>
        </div>
        `;
    });
    return timeRangeHtml;
};
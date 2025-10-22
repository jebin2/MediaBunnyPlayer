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
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';

import { state } from './state.js';
import { showError, showStatusMessage, hideStatusMessage } from './ui.js';
import { hideTrackMenus, switchAudioTrack } from './player.js';
import { audioTrack } from './constants.js'

const handleAudioDownload = async (trackIndex) => {
    if (!state.fileLoaded || !state.availableAudioTracks[trackIndex]) {
        showError("No valid audio track selected for download.");
        return;
    }

    const trackToDownload = state.availableAudioTracks[trackIndex];

    // ================== FIX STARTS HERE ==================
    // Check if the browser can actually decode this audio track before trying to convert it.
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
    // ================== FIX ENDS HERE ==================

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

        // Conversion options specifying ONLY the audio track.
        const conversionOptions = {
            input,
            output,
            audio: {
                track: trackToDownload,
                codec: 'mp3'
            },
            // By not including a 'video' key, we tell mediabunny to ignore the video.
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

        // Trigger download via a temporary link
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

export const audioEventlistener = () => {
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
}
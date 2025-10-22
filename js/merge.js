// ============================================================================
// MERGE
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
	Composition
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';

import { settingsMenu, mergeBtn, mergeModal, cancelMergeBtn, processMergeBtn, mergeFileList } from './constants.js';
import { state } from './state.js';
import { guidedPanleInfo } from './utility.js'
import { hideTrackMenus, pause } from './player.js'
import { getSelectedFiles, updatePlaylistUIOptimized } from './playlist.js'
import { hideStatusMessage, showError, showInfo, showStatusMessage } from './ui.js'

export const merge_define = () => {
    if (mergeBtn) {
		mergeBtn.onclick = (e) => {
			e.stopPropagation();
			showMergeModal();
		};
	}

    if (cancelMergeBtn) cancelMergeBtn.onclick = hideMergeModal;
    if (mergeModal) mergeModal.onclick = (e) => {
        if (e.target === mergeModal) hideMergeModal();
    };
    if (processMergeBtn) processMergeBtn.onclick = handleMergeAction;
}

const showMergeModal = () => {
	const selectedFiles = getSelectedFiles();
	if (selectedFiles.length < 2) {
		showError("Please select at least two video files from the playlist to merge.");
		return;
	}

	mergeFileList.innerHTML = '';
	selectedFiles.forEach(item => {
		const li = document.createElement('li');
		li.textContent = item.path.split('/').pop();
		mergeFileList.appendChild(li);
	});

	mergeModal.classList.remove('hidden');
	settingsMenu.classList.add('hidden');
};


const hideMergeModal = () => {
    if (mergeModal) mergeModal.classList.add('hidden');
};

export const handleMergeAction = async () => {
    if (state.playing) pause();

	const selectedFiles = getSelectedFiles();
	if (selectedFiles.length < 2) {
        showError("Please select at least two files to merge.");
        return;
    }

    hideMergeModal();
    hideTrackMenus();
    guidedPanleInfo('Merging clips...');
    
    const inputsToDispose = [];

    try {
        const composition = new Composition();
		let totalDuration = 0;

        for (const fileItem of selectedFiles) {
			const file = fileItem.file;
			const source = (file instanceof File) ? new BlobSource(file) : new UrlSource(file);
			const input = new Input({ source, formats: ALL_FORMATS });
			inputsToDispose.push(input);

			const videoTrack = await input.getPrimaryVideoTrack();
			const audioTrack = await input.getPrimaryAudioTrack();

			if (videoTrack) {
				composition.addVideoTrack(videoTrack, { offset: totalDuration });
			}
			if (audioTrack) {
				composition.addAudioTrack(audioTrack, { offset: totalDuration });
			}
			totalDuration += await input.computeDuration();
        }

		const output = new Output({
            format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
            target: new BufferTarget()
        });

		const conversion = await Conversion.init({ input: composition, output });
        if (!conversion.isValid) throw new Error('Could not create a valid conversion for merging.');

        conversion.onProgress = (progress) => showStatusMessage(`Merging clips... (${Math.round(progress * 100)}%)`);
        await conversion.execute();

        const originalName = 'merged_video';
        const clipName = `${originalName}_${new Date().getTime()}.mp4`;
        const mergedClipFile = new File([output.target.buffer], clipName, { type: 'video/mp4' });

        state.playlist.push({ type: 'file', name: clipName, file: mergedClipFile, isCutClip: true });
        updatePlaylistUIOptimized();
        showStatusMessage('Merged clip added to playlist!');
        setTimeout(hideStatusMessage, 2000);

    } catch (error) {
        console.error("Error during merging:", error);
        showError(`Failed to merge clips: ${error.message}`);
        hideStatusMessage();
    } finally {
        inputsToDispose.forEach(input => input.dispose());
        guidedPanleInfo("");
    }
};
import {setupEventListeners } from './eventListeners.js';
import { renderLoop } from './player.js';
import { updatePlaylistUIOptimized } from './playlist.js';
import { dynamicVideoUrl, registerServiceWorker} from './utility.js';
import { resize_define } from './resize.js';
import { setupImageToVideo } from './imageToVideo.js';
import { setupRecordingListeners } from './recording.js';

import { canEncodeAudio } from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';
import { registerMp3Encoder } from 'https://cdn.jsdelivr.net/npm/@mediabunny/mp3-encoder@1.24.0/+esm';

const initialize = async () => {
	// As per the documentation, check if the browser can encode MP3 natively.
	// If not, register the custom WASM-based encoder.
	try {
		if (!(await canEncodeAudio('mp3'))) {
			console.log('Native MP3 encoder not found. Registering custom WASM encoder.');
			await registerMp3Encoder();
			console.log('Custom MP3 encoder registered successfully.');
		} else {
			console.log('Native MP3 encoder found.');
		}
	} catch (err) {
		console.error('Failed to register the MP3 encoder:', err);
	}

	setupEventListeners();
	renderLoop();
	dynamicVideoUrl();
	updatePlaylistUIOptimized();
	registerServiceWorker();
	resize_define();
    setupImageToVideo();
	setupRecordingListeners();
}

// document.addEventListener('DOMContentLoaded', {
	initialize();
// });
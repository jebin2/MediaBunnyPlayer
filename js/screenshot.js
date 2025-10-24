// ============================================================================
// SCREENSHOT FUNCTIONALITY
// ============================================================================


import { canvas, screenshotOverlay, screenshotPreviewImg } from './constants.js';
import { state } from './state.js';
import { hideTrackMenus } from './player.js'
import { showError } from './ui.js'

export const takeScreenshot = () => {
	if (!state.fileLoaded || !canvas) {
		showError("Cannot take screenshot: No video loaded.");
		return;
	}

	canvas.toBlob((blob) => {
		if (!blob) {
			showError("Failed to create screenshot.");
			return;
		}

		state.currentScreenshotBlob = blob;

		if (screenshotPreviewImg.src && screenshotPreviewImg.src.startsWith('blob:')) {
			URL.revokeObjectURL(screenshotPreviewImg.src);
		}

		const imageUrl = URL.createObjectURL(blob);
		screenshotPreviewImg.src = imageUrl;
		screenshotOverlay.classList.remove('hidden');
		hideTrackMenus();

	}, 'image/png');
};
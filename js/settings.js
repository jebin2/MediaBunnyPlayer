import { settingsMenu, settingsCtrlBtn, playerArea, sidebar } from './constants.js';
import { state } from './state.js';
import { positionCropCanvas } from './crop.js'; // You will need to import this function

export const setupSettingsListeners = () => {
    settingsCtrlBtn.onclick = (e) => {
        e.stopPropagation();

        // If playlist is open, close it first
        if (playerArea.classList.contains('playlist-visible')) {
            playerArea.classList.remove('playlist-visible');
        }
        playerArea.classList.toggle('playlist-visible');
        // Toggle the settings sidebar
        sidebar.classList.add('hidden');
        settingsMenu.classList.toggle('hidden');

        // After the transition, reposition the crop canvas if it's active
        setTimeout(() => {
            if (state.isCropping || state.isPanning) {
                state.cropCanvasDimensions = positionCropCanvas();
            }
        }, 200); // 200ms delay to match CSS transition time
    };
};
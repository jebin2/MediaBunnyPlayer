import { settingsMenu, settingsCtrlBtn } from './constants.js';
import { state } from './state.js';

export const setupSettingsListeners = () => {
    settingsMenu.addEventListener("mouseleave", () => {
        if (state.playing) {
            settingsMenu.classList.add('hidden');
        }
    });

    settingsCtrlBtn.onclick = (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
    };

    document.addEventListener("click", (e) => {
        if (
            !settingsMenu.classList.contains('hidden') &&
            !settingsMenu.contains(e.target) &&
            !settingsCtrlBtn.contains(e.target)
        ) {
            settingsMenu.classList.add('hidden');
        }
    });
};

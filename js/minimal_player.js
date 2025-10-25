import { setupEventListeners } from './eventListeners.js';
import { renderLoop } from './player.js';
import { dynamicVideoUrl } from './utility.js';

export const allow_minimal = () => {
    const url = new URL(window.location.href);

    // Look for the 'bg_color' parameter
    const bgColor = url.searchParams.get('bg_color');

    // If the parameter exists...
    if (bgColor) {
        // Find the video container element
        const videoContainer = document.getElementById('videoContainer'); // Make sure your container has this ID

        if (videoContainer) {
            // Apply the background color, adding the '#' prefix
            videoContainer.style.setProperty('background-color', `#${bgColor}`, 'important');
        }
    }
    const header = document.querySelector(".header");
    header.style.display = "none";
    const controlsLeft = document.querySelector(".controls-left");
    controlsLeft.style.display = "none";
    const trackControls = document.querySelector(".track-controls");
    trackControls.style.display = "none";
    setupEventListeners();
    renderLoop();
    dynamicVideoUrl();
}
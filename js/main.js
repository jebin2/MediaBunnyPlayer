import {setupEventListeners } from './eventListeners.js'
import { renderLoop } from './player.js'
import { updatePlaylistUIOptimized } from './playlist.js'
import { dynamicVideoUrl, registerServiceWorker} from './utility.js'

const initialize = () => {
	setupEventListeners();
	renderLoop();
	dynamicVideoUrl();
	updatePlaylistUIOptimized();
	registerServiceWorker();
}
// document.addEventListener('DOMContentLoaded', {
	initialize();
// });
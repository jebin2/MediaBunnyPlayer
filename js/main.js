import {setupEventListeners } from './eventListeners.js'
import { renderLoop } from './player.js'
import { updatePlaylistUIOptimized } from './playlist.js'
import { dynamicVideoUrl, registerServiceWorker} from './utility.js'
import { resize_define } from './resize.js'

const initialize = () => {
	setupEventListeners();
	renderLoop();
	dynamicVideoUrl();
	updatePlaylistUIOptimized();
	registerServiceWorker();
	resize_define();
}
// document.addEventListener('DOMContentLoaded', {
	initialize();
// });
import { allow_minimal } from './minimal_player.js';
import { full_player } from './full_player.js';

const initialize = async () => {
	const urlParams = new URLSearchParams(window.location.search);
	const onlyVideoPlayer = urlParams.get('only_video_player');
	if (onlyVideoPlayer === 'true') {
		allow_minimal();
	} else {
		document.querySelector(".entryloading").classList.add('hidden');
		full_player()
	}
}

// document.addEventListener('DOMContentLoaded', {
initialize();
// });
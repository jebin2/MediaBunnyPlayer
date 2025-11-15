const initialize = async () => {
	const urlParams = new URLSearchParams(window.location.search);
	const onlyVideoPlayer = urlParams.get('only_video_player');
	if (onlyVideoPlayer === 'true') {
		const module = await import('./minimal_player.js');
        module.allow_minimal();
	} else {
		const module = await import('./full_player.js');
        module.full_player();
		document.getElementById("entryloading").classList.add('hidden');
	}
}

initialize();
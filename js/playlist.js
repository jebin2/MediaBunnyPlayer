// ============================================================================
// PLAYLIST MANAGEMENT
// ============================================================================

import {
	Input,
	ALL_FORMATS,
	BlobSource,
	UrlSource,
	AudioBufferSink,
	CanvasSink,
	Conversion,
	Output,
	Mp4OutputFormat,
	BufferTarget,
	QUALITY_HIGH
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.24.0/+esm';

import { $, MEDIABUNNY_URL, playerArea, videoContainer, canvas, dropZone, loading, playBtn, timeDisplay, progressContainer, progressBar, volumeSlider, muteBtn, fullscreenBtn, sidebar, playlistContent, videoControls, progressHandle, startTimeInput, endTimeInput, settingsCtrlBtn, settingsMenu, loopBtn, cutBtn, screenshotBtn, screenshotOverlay, screenshotPreviewImg, closeScreenshotBtn, copyScreenshotBtn, downloadScreenshotBtn, playbackSpeedInput, autoplayToggle, urlModal, urlInput, loadUrlBtn, cancelUrlBtn, showMessage, cropModeRadios, scaleOptionContainer, scaleWithRatioToggle, blurOptionContainer, smoothOptionContainer, smoothPathToggle, blurBackgroundToggle, blurAmountInput, HANDLE_SIZE, HANDLE_HALF, fixSizeBtn, prevBtn, nextBtn, cropBtn, cropCanvas, cropCtx, queuedAudioNodes, panScanBtn, ctx } from './constants.js';
import { state } from './state.js';
import { resetAllConfigs, updateDynamicCropOptionsUI } from './config.js'
import { applyResize, clampRectToVideoBounds, drawCropOverlay, drawCropWithHandles, getCursorForHandle, getInterpolatedCropRect, getResizeHandle, getScaledCoordinates, isInsideCropRect, positionCropCanvas, smoothPathWithMovingAverage, toggleCropFixed, togglePanning, toggleStaticCrop, updateFixSizeButton } from './crop.js'
import { handleCutAction } from './editing.js'
import { setupEventListeners } from './eventListeners.js'
import { checkPlaybackState, ensureSubtitleRenderer, getPlaybackTime, handleConversion, hideTrackMenus, loadMedia, pause, play, playNext, playPrevious, removeSubtitleOverlay, renderLoop, runAudioIterator, scheduleProgressUpdate, seekToTime, setPlaybackSpeed, setVolume, startVideoIterator, stopAndClear, switchAudioTrack, switchSubtitleTrack, toggleLoop, togglePlay, updateNextFrame, updateSubtitlesOptimized, updateTrackMenus } from './player.js'
import { dynamicVideoUrl, escapeHTML, formatTime, guidedPanleInfo, parseTime, registerServiceWorker, updateShortcutKeysVisibility, } from './utility.js'
import { takeScreenshot } from './screenshot.js'
import { hideStatusMessage, showControlsTemporarily, showDropZoneUI, showError, showInfo, showLoading, showPlayerUI, showStatusMessage, updateProgressBarUI, updateTimeInputs } from './ui.js'

export const handleFiles = (files) => {
	if (files.length === 0) return;

	const validFiles = Array.from(files).filter(file =>
		file.type.startsWith('video/') ||
		file.type.startsWith('audio/') ||
		file.name.match(/\.(mp4|webm|mkv|mov|mp3|wav|aac|flac|ogg|avi|flv|wmv)$/i)
	);

	if (validFiles.length === 0) {
		showError("No supported media files found.");
		return;
	}

	const fileEntries = validFiles.map(file => ({
		file,
		path: file.name
	}));
	const newTree = buildTreeFromPaths(fileEntries);
	state.playlist = mergeTrees(state.playlist, newTree);
	updatePlaylistUIOptimized();

	if (!state.fileLoaded && fileEntries.length > 0) {
		loadMedia(fileEntries[0].file);
	}
};

export const handleFolderSelection = (event) => {
	const files = event.target.files;
	if (!files.length) return;
	showLoading(true);

	const fileEntries = Array.from(files)
		.filter(file =>
			file.type.startsWith('video/') ||
			file.type.startsWith('audio/') ||
			file.name.match(/\.(mp4|webm|mkv|mov|mp3|wav|aac|flac|ogg|avi|flv|wmv)$/i)
		)
		.map(file => ({
			file,
			path: file.webkitRelativePath || file.name
		}));

	if (fileEntries.length > 0) {
		const newTree = buildTreeFromPaths(fileEntries);
		state.playlist = mergeTrees(state.playlist, newTree);
		updatePlaylistUIOptimized();
		if (!state.fileLoaded) loadMedia(fileEntries[0].file);
	} else {
		showError("No supported media files found in directory.");
	}
	showLoading(false);
	event.target.value = '';
};

const buildTreeFromPaths = (files) => {
	const tree = [];
	files.forEach(fileInfo => {
		const pathParts = fileInfo.path.split('/').filter(Boolean);
		let currentLevel = tree;

		pathParts.forEach((part, i) => {
			if (i === pathParts.length - 1) {
				if (!currentLevel.some(item => item.type === 'file' && item.name === part)) {
					currentLevel.push({
						type: 'file',
						name: part,
						file: fileInfo.file
					});
				}
			} else {
				let existingNode = currentLevel.find(item => item.type === 'folder' && item.name === part);
				if (!existingNode) {
					existingNode = {
						type: 'folder',
						name: part,
						children: []
					};
					currentLevel.push(existingNode);
				}
				currentLevel = existingNode.children;
			}
		});
	});
	return tree;
};

const mergeTrees = (mainTree, newTree) => {
	newTree.forEach(newItem => {
		const existingItem = mainTree.find(item => item.name === newItem.name && item.type === newItem.type);
		if (existingItem && existingItem.type === 'folder') {
			existingItem.children = mergeTrees(existingItem.children, newItem.children);
		} else if (!existingItem) {
			mainTree.push(newItem);
		}
	});
	return mainTree;
};

export const findFileByPath = (nodes, path) => {
	const pathParts = path.split('/').filter(Boolean);
	if (pathParts.length === 0) return null;

	const itemName = pathParts[0];
	const node = nodes.find(n => n.name === itemName);

	if (!node) return null;
	if (pathParts.length === 1 && node.type === 'file') return node.file;
	if (node.type === 'folder' && pathParts.length > 1) {
		return findFileByPath(node.children, pathParts.slice(1).join('/'));
	}
	return null;
};

export const removeItemFromPath = (nodes, path, parentPath = '') => {
	const pathParts = path.split('/').filter(Boolean);
	if (pathParts.length === 0) return false;

	const itemName = pathParts[0];
	for (let i = 0; i < nodes.length; i++) {
		if (escapeHTML(nodes[i].name) === itemName) {
			const nodeToRemove = nodes[i];
			const fullPath = parentPath ? `${parentPath}/${escapeHTML(nodeToRemove.name)}` : escapeHTML(nodeToRemove.name);

			if (pathParts.length === 1) {
				// This is the item to remove
				if (state.selectedFiles) {
					if (nodeToRemove.type === 'folder') {
						// If it's a folder, recursively remove all its children from the selection
						const removeChildrenFromSelection = (folderNode, folderPath) => {
							if (!folderNode.children) return;
							folderNode.children.forEach(child => {
								const childPath = `${folderPath}/${escapeHTML(child.name)}`;
								if (child.type === 'file') {
									state.selectedFiles.delete(childPath);
								} else if (child.type === 'folder') {
									removeChildrenFromSelection(child, childPath);
								}
							});
						};
						removeChildrenFromSelection(nodeToRemove, fullPath);
					} else {
						// If it's a file, remove it directly
						state.selectedFiles.delete(fullPath);
					}
				}

				nodes.splice(i, 1);
				return true;
			} else if (nodeToRemove.type === 'folder') {
				const removed = removeItemFromPath(nodeToRemove.children, pathParts.slice(1).join('/'), fullPath);
				if (removed && nodeToRemove.children.length === 0) {
					// If the folder becomes empty after the child is removed, remove the folder itself.
					nodes.splice(i, 1);
				}
				return removed;
			}
		}
	}
	return false;
};

export const clearPlaylist = () => {
	stopAndClear();
	state.playlist = [];
	state.playlistElementCache.clear();
	state.lastRenderedPlaylist = null;
	updatePlaylistUIOptimized();
};

const createPlaylistElement = (node, currentPath = '') => {
	const safeName = escapeHTML(node.name);
	const nodePath = currentPath ? `${currentPath}/${node.name}` : node.name;
	const safePath = escapeHTML(nodePath);

	if (node.type === 'folder') {
		const li = document.createElement('li');
		li.className = 'playlist-folder';
		li.dataset.path = safePath;

		const details = document.createElement('details');
		details.open = true;

		const summary = document.createElement('summary');
		const folderName = document.createElement('span');
		folderName.className = 'playlist-folder-name';
		folderName.title = safeName;
		folderName.textContent = safeName;

		const removeBtn = document.createElement('span');
		removeBtn.className = 'remove-item';
		removeBtn.dataset.path = safePath;
		removeBtn.textContent = '×';
		removeBtn.title = 'Remove folder';

		summary.appendChild(folderName);
		summary.appendChild(removeBtn);
		details.appendChild(summary);

		const ul = document.createElement('ul');
		ul.className = 'playlist-tree';
		node.children.forEach(child => {
			ul.appendChild(createPlaylistElement(child, nodePath));
		});
		details.appendChild(ul);
		li.appendChild(details);

		return li;
	} else {
		const li = document.createElement('li');
		const isActive = (state.currentPlayingFile === node.file);
		const isSelected = state.selectedFiles?.has(safePath) || false;

		li.className = `playlist-file ${node.isCutClip ? 'cut-clip' : ''} ${isActive ? 'active' : ''}`;
		li.dataset.path = safePath;
		li.title = safeName;

		// Checkbox
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'playlist-file-checkbox';
		checkbox.checked = isSelected;
		checkbox.dataset.path = safePath;
		checkbox.addEventListener('click', (e) => {
			e.stopPropagation(); // Prevent triggering file play
			handleCheckboxChange(safePath, e.target.checked);
		});

		// File name
		const fileName = document.createElement('span');
		fileName.className = 'playlist-file-name';
		fileName.title = safeName;
		fileName.textContent = safeName;

		li.appendChild(checkbox);
		li.appendChild(fileName);

		// Clip actions for cut clips
		if (node.isCutClip) {
			const clipActions = document.createElement('div');
			clipActions.className = 'clip-actions';

			const downloadBtn = document.createElement('button');
			downloadBtn.className = 'clip-action-btn';
			downloadBtn.dataset.action = 'download';
			downloadBtn.dataset.path = safePath;
			downloadBtn.textContent = '⬇️';
			downloadBtn.title = 'Download clip';

			const copyBtn = document.createElement('button');
			copyBtn.className = 'clip-action-btn';
			copyBtn.dataset.action = 'copy';
			copyBtn.dataset.path = safePath;
			copyBtn.textContent = '📋';
			copyBtn.title = 'Copy to clipboard';

			clipActions.appendChild(downloadBtn);
			clipActions.appendChild(copyBtn);
			li.appendChild(clipActions);
		}

		// Remove button
		const removeBtn = document.createElement('span');
		removeBtn.className = 'remove-item';
		removeBtn.dataset.path = safePath;
		removeBtn.textContent = '×';
		removeBtn.title = 'Remove file';
		li.appendChild(removeBtn);

		return li;
	}
};

const handleCheckboxChange = (path, isChecked) => {
	if (!state.selectedFiles) {
		state.selectedFiles = new Set();
	}

	if (isChecked) {
		state.selectedFiles.add(path);
	} else {
		state.selectedFiles.delete(path);
	}

	// Log selected files for debugging
	console.log('Selected files:', Array.from(state.selectedFiles));

	// You can add additional functionality here, such as:
	// - Enabling/disabling batch operation buttons
	// - Updating a counter of selected files
	// - Etc.
};

// Function to get selected files
export const getSelectedFiles = () => {
	if (!state.selectedFiles) return [];

	const files = [];
	state.selectedFiles.forEach(path => {
		const file = findFileByPath(state.playlist, path);
		if (file) {
			files.push({ path, file });
		}
	});
	return files;
};

// Function to clear all selections
export const clearAllSelections = () => {
	if (state.selectedFiles) {
		state.selectedFiles.clear();
	}
	updatePlaylistUIOptimized();
};

// Function to select all files
export const selectAllFiles = () => {
	if (!state.selectedFiles) {
		state.selectedFiles = new Set();
	}

	const addAllFiles = (nodes, currentPath = '') => {
		nodes.forEach(node => {
			const nodePath = currentPath ? `${currentPath}/${node.name}` : node.name;
			if (node.type === 'file') {
				state.selectedFiles.add(nodePath);
			} else if (node.type === 'folder') {
				addAllFiles(node.children, nodePath);
			}
		});
	};

	addAllFiles(state.playlist);
	updatePlaylistUIOptimized();
};

export const updatePlaylistUIOptimized = () => {
	if (state.playlist.length === 0) {
		playlistContent.innerHTML = '<p style="padding:1rem; opacity:0.7; text-align:center;">No files.</p>';
		state.playlistElementCache.clear();
		state.lastRenderedPlaylist = null;
		showDropZoneUI();
		return;
	}

	// Check if we need a full rebuild
	const playlistChanged = JSON.stringify(state.playlist) !== state.lastRenderedPlaylist;

	if (!playlistChanged) {
		// Just update active states
		updateActiveStates();
		return;
	}

	// Full rebuild needed
	const fragment = document.createDocumentFragment();
	const ul = document.createElement('ul');
	ul.className = 'playlist-tree';

	state.playlist.forEach(node => {
		ul.appendChild(createPlaylistElement(node));
	});

	fragment.appendChild(ul);
	playlistContent.innerHTML = '';
	playlistContent.appendChild(fragment);

	state.lastRenderedPlaylist = JSON.stringify(state.playlist);
};

const updateActiveStates = () => {
	const allFiles = playlistContent.querySelectorAll('.playlist-file');
	allFiles.forEach(fileEl => {
		const path = fileEl.dataset.path;
		const file = findFileByPath(state.playlist, path);
		const isActive = (file === state.currentPlayingFile);
		fileEl.classList.toggle('active', isActive);
	});
};

export const setupPlaylistEventListeners = () => {
	// Handle playlist item clicks
	playlistContent.addEventListener('click', (e) => {
		// Handle remove buttons
		if (e.target.classList.contains('remove-item')) {
			e.stopPropagation();
			const path = e.target.dataset.path;
			let isPlayingFile = false;
			const fileToRemove = findFileByPath(state.playlist, path);
			if (fileToRemove && state.currentPlayingFile) {
				isPlayingFile = (fileToRemove instanceof File && state.currentPlayingFile instanceof File) ?
					fileToRemove === state.currentPlayingFile :
					fileToRemove === state.currentPlayingFile;
			}

			removeItemFromPath(state.playlist, path);
			updatePlaylistUIOptimized();
			if (isPlayingFile) {
				stopAndClear();
				state.currentPlayingFile = null;
				showDropZoneUI();
			}
			return;
		}

		// Handle clip action buttons
		if (e.target.classList.contains('clip-action-btn')) {
			e.stopPropagation();
			const action = e.target.dataset.action;
			const path = e.target.dataset.path;
			handleClipAction(action, path);
			return;
		}

		// Handle file clicks (play file)
		const fileElement = e.target.closest('.playlist-file');
		if (fileElement && !e.target.classList.contains('playlist-file-checkbox')) {
			const path = fileElement.dataset.path;
			const file = findFileByPath(state.playlist, path);
			if (file) {
				loadMedia(file);
			}
		}
	});
	$('togglePlaylistBtn').onclick = () => {
		playerArea.classList.toggle('playlist-visible');
		setTimeout(() => {
			cropCanvasDimensions = positionCropCanvas();
		}, 200);
	}
};

export const openPlaylist = () => {
	if (playerArea.classList.contains('playlist-visible')) return;
	playerArea.classList.toggle('playlist-visible');
	setTimeout(() => {
		cropCanvasDimensions = positionCropCanvas();
	}, 200);
}

export const closePlaylist = () => {
	if (!playerArea.classList.contains('playlist-visible')) return;
	playerArea.classList.toggle('playlist-visible');
	setTimeout(() => {
		cropCanvasDimensions = positionCropCanvas();
	}, 200);
}

// Helper function for clip actions
const handleClipAction = async (action, path) => {
	const file = findFileByPath(state.playlist, path);
	if (!file) return;

	try {
		if (action === 'download') {
			// Create download link
			const url = URL.createObjectURL(file);
			const a = document.createElement('a');
			a.href = url;
			a.download = file.name || 'clip.mp4';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			showInfo('Download started');
		} else if (action === 'copy') {
			// Copy blob to clipboard (modern browsers)
			if (navigator.clipboard && window.ClipboardItem) {
				const item = new ClipboardItem({ [file.type]: file });
				await navigator.clipboard.write([item]);
				showInfo('Copied to clipboard');
			} else {
				showError('Clipboard API not supported');
			}
		}
	} catch (error) {
		console.error('Clip action error:', error);
		showError(`Failed to ${action} clip`);
	}
};
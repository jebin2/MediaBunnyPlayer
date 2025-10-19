// js/playlist.js

import { state, updateState } from './state.js';
import { showError, updatePlaylistUIOptimized, showDropZoneUI, showLoading } from './ui.js';
import { loadMedia, stopAndClear } from './player.js';

export const handleFiles = (files) => {
	if (files.length === 0) return;
	const validFiles = Array.from(files).filter(f => f.type.startsWith('video/') || f.type.startsWith('audio/') || f.name.match(/\.(mp4|webm|mkv|mov|mp3|wav|aac|flac|ogg|avi|flv|wmv)$/i));
	if (validFiles.length === 0) return showError("No supported media files found.");
	const fileEntries = validFiles.map(file => ({ file, path: file.webkitRelativePath || file.name }));
	const newTree = buildTreeFromPaths(fileEntries);
	updateState({ playlist: mergeTrees(state.playlist, newTree) });
	updatePlaylistUIOptimized();
	if (!state.fileLoaded && fileEntries.length > 0) loadMedia(fileEntries[0].file);
};

export const buildTreeFromPaths = (files) => {
	const tree = [];
	files.forEach(fileInfo => {
		const pathParts = fileInfo.path.split('/').filter(Boolean);
		let currentLevel = tree;
		pathParts.forEach((part, i) => {
			if (i === pathParts.length - 1) {
				if (!currentLevel.some(item => item.type === 'file' && item.name === part)) {
					currentLevel.push({ type: 'file', name: part, file: fileInfo.file });
				}
			} else {
				let existingNode = currentLevel.find(item => item.type === 'folder' && item.name === part);
				if (!existingNode) {
					existingNode = { type: 'folder', name: part, children: [] };
					currentLevel.push(existingNode);
				}
				currentLevel = existingNode.children;
			}
		});
	});
	return tree;
};

export const mergeTrees = (mainTree, newTree) => {
	newTree.forEach(newItem => {
		const existingItem = mainTree.find(item => item.name === newItem.name && item.type === newItem.type);
		if (existingItem?.type === 'folder') {
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
	const node = nodes.find(n => n.name === pathParts[0]);
	if (!node) return null;
	if (pathParts.length === 1 && node.type === 'file') return node.file;
	if (node.type === 'folder' && pathParts.length > 1) {
		return findFileByPath(node.children, pathParts.slice(1).join('/'));
	}
	return null;
};

export const removeItemFromPath = (nodes, path) => {
	const pathParts = path.split('/').filter(Boolean);
	if (pathParts.length === 0) return false;
	for (let i = 0; i < nodes.length; i++) {
		if (nodes[i].name === pathParts[0]) {
			if (pathParts.length === 1) {
				nodes.splice(i, 1);
				return true;
			} else if (nodes[i].type === 'folder') {
				const removed = removeItemFromPath(nodes[i].children, pathParts.slice(1).join('/'));
				if (removed && nodes[i].children.length === 0) nodes.splice(i, 1);
				return removed;
			}
		}
	}
	return false;
};

export const clearPlaylist = () => {
	stopAndClear();
	updateState({ playlist: [], lastRenderedPlaylist: null });
    state.playlistElementCache.clear();
	updatePlaylistUIOptimized();
};
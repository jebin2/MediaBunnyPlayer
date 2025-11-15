import { Input, ALL_FORMATS, BlobSource, UrlSource } from 'https://cdn.jsdelivr.net/npm/mediabunny@1.25.0/+esm';

// https://github.com/Vanilagy/mediabunny/blob/main/examples/metadata-extraction/metadata-extraction.ts
export const extractMetadata = (resource) => {
	// Create a new input from the resource
	const source = resource instanceof File
		? new BlobSource(resource)
		: new UrlSource(resource);
	const input = new Input({
		source,
		formats: ALL_FORMATS, // Accept all formats
	});

	let bytesRead = 0;
	let fileSize = null;

	input.source.onread = (start, end) => {
		bytesRead += end - start;
	};

	// Get the input's size
	void input.source.getSize().then(size => fileSize = size);

	// This object contains all the data that gets displayed:
	const object = {
		'Format': input.getFormat().then(format => format.name),
		'Full MIME type': input.getMimeType(),
		'Duration': input.computeDuration().then(duration => `${duration} seconds`),
		'Tracks': input.getTracks().then(tracks => tracks.map(track => ({
			'Type': track.type,
			'Codec': track.codec,
			'Full codec string': track.getCodecParameterString(),
			'Duration': track.computeDuration().then(duration => `${duration} seconds`),
			'Language code': track.languageCode,
			...(track.isVideoTrack()
				? {
						'Coded width': `${track.codedWidth} pixels`,
						'Coded height': `${track.codedHeight} pixels`,
						'Rotation': `${track.rotation}° clockwise`,
						'Transparency': track.canBeTransparent(),
					}
				: track.isAudioTrack()
					? {
							'Number of channels': track.numberOfChannels,
							'Sample rate': `${track.sampleRate} Hz`,
						}
					: {}),
			'Packet statistics': shortDelay().then(() => track.computePacketStats()).then(stats => ({
				'Packet count': stats.packetCount,
				'Average packet rate': `${stats.averagePacketRate} Hz${track.isVideoTrack() ? ' (FPS)' : ''}`,
				'Average bitrate': `${stats.averageBitrate} bps`,
			})),
			...(track.isVideoTrack()
				? {
						'Color space': track.getColorSpace().then(colorSpace => ({
							'Color primaries': colorSpace.primaries ?? 'Unknown',
							'Transfer characteristics': colorSpace.transfer ?? 'Unknown',
							'Matrix coefficients': colorSpace.matrix ?? 'Unknown',
							'Full range': colorSpace.fullRange ?? 'Unknown',
							'HDR': track.hasHighDynamicRange(),
						})),
					}
				: {}
			),
		}))),
		'Metadata tags': input.getMetadataTags().then((tags) => {
			const result = {
				'Title': tags.title,
				'Description': tags.description,
				'Artist': tags.artist,
				'Album': tags.album,
				'Album artist': tags.albumArtist,
				'Track number': tags.trackNumber,
				'Tracks total': tags.tracksTotal,
				'Disc number': tags.discNumber,
				'Discs total': tags.discsTotal,
				'Genre': tags.genre,
				'Date': tags.date?.toISOString().slice(0, 10),
				'Lyrics': tags.lyrics,
				'Comment': tags.comment,
				'Images': tags.images?.map((image) => {
					const blob = new Blob([image.data], { type: image.mimeType });
					const element = new Image();
					element.src = URL.createObjectURL(blob);

					return element;
				}),
				'Raw tag count': tags.raw && Object.keys(tags.raw).length,
			};

			if (Object.values(result).some(x => x !== undefined)) {
				return result;
			} else {
				return undefined;
			}
		}),
	};

    return object;
};
const shortDelay = () => {
	return new Promise(resolve => setTimeout(resolve, 1000 / 60));
};
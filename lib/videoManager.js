const settings = require('./settings.js')
const videoDB = new (require('./db.js'))('videos')
const channelDB = new (require('./db.js'))('channels')
const partialDB = new (require('./db.js'))('partial')

const fs = require('fs')
const sanitize = require("sanitize-filename");
const builder = require('xmlbuilder');


const cleanupExistingVideos = () => {
	Object.keys(videoDB).forEach(videoID => {
		if (videoDB[videoID].channel == "The WAN Show") {
			if (partialDB[videoID]) {
				if (fs.existsSync(videoDB[videoID].file)) fs.unlinkSync(videoDB[videoID].file);
				if (fs.existsSync(videoDB[videoID].artworkFile)) fs.unlinkSync(videoDB[videoID].artworkFile);
				if (fs.existsSync(videoDB[videoID].videoFile)) fs.unlinkSync(videoDB[videoID].videoFile);
				if (fs.existsSync(videoDB[videoID].audioFile)) fs.unlinkSync(videoDB[videoID].audioFile);
			}
			if (!fs.existsSync(videoDB[videoID].file) && !fs.existsSync(videoDB[videoID].videoFile) && !fs.existsSync(videoDB[videoID].audioFile)) { //  If the video does not exist remove it from videos.json
				delete videoDB[videoID];
				delete partialDB[videoID];
				return;
			}
		} else {
			if (!fs.existsSync(videoDB[videoID].file)) {
				delete videoDB[videoID]
				delete partialDB[videoID]
				return
			} //  If the video does not exist remove it from videos.json
			const videoStats = fs.statSync(videoDB[videoID].file);
			if (videoDB[videoID].saved === true && videoStats.size < 10000) delete videoDB[videoID]; // If the video is saved but its size is less than 10kb its failed, remove it.
			partialDB[videoID] = { transferred: videoStats.size }; // If the video is partially downloaded set its transferred size to its current size
		}
	});
}

const init = async () => {
	if (!fs.existsSync(settings.videoFolder)) fs.mkdirSync(settings.videoFolder); // Create the video folder needed
	await cleanupExistingVideos()
}

const displayVideosDetails = async () => { // Print out the current number of "episodes" for each channel
	console.log('\n\n=== \u001b[38;5;8mEpisode Count\u001b[0m ===')
	for (channel in channelDB) {
		if (settings.colourList[channel] == undefined) settings.colourList[channel] = '\u001b[38;5;153m'
		if (channel.indexOf(".") == -1) console.log(settings.colourList[channel]+channel+'\u001b[0m:', Object.keys(channelDB[channel]).length)
	}
	if (Object.keys(channelDB).length == 0) console.log('> No Episodes Yet!')
	console.log()
}

const formatVideoFolder = video => {
	/*
	/ Video Folder checks & generation
	*/
	video.folderPath = settings.videoFolder+video.channel+'/' // Create the video.folderPath variable that stores the path to the file

	if (settings.fileFormatting.ignoreFolderStructure) video.folderPath = settings.videoFolder // If we are ignoring folder structure then set the video.folderPath to just be the video folder
	if (!fs.existsSync(settings.videoFolder)) fs.mkdirSync(settings.videoFolder) // If the root video folder dosnt exist create it
	// Check if the first path exists (minus season folder)
	if (!fs.existsSync(video.folderPath)) fs.mkdirSync(video.folderPath); // If not create the folder needed

	/*
	/ Special folder formatting
	*/
	let seasonNumber = '01' // Set the season number to use if nothing special is being done to seasons
	if(settings.fileFormatting.monthsAsSeasons) { // If your formatting the videos with the YEAR+MONTH as the season then
		// If the month is less than 10 add a 0 to it
		seasonNumber = new Date(video.releaseDate).getFullYear()+date.getMonth()>9?'0'+date.getMonth():date.getMonth(); // Set the seasonNumber to be the YEAR+MONTH, eg 201801
		video.folderPath = `${video.folderPath}/S${seasonNumber}` // Set the raw path to include the new season folder
	} else if(settings.fileFormatting.yearsAsSeasons) { // If your formatting the videos with the YEAR as the season then
		seasonNumber = new Date(video.releaseDate).getFullYear() // Set the seasonNumber to be the YEAR, eg 2018
		video.folderPath = `${video.folderPath}/S${seasonNumber}`
	}
	// Check if the new path exists (plus season folder if enabled)
	if (!fs.existsSync(video.folderPath)) fs.mkdirSync(video.folderPath); // If not create the folder needed 
	video.seasonNumber = seasonNumber;

	return video;
}

const formatVideoFilename = video => {
	/*
	/ Title Formatting
	*/
	if (settings.fileFormatting.formatWithEpisodes == true) video.fileName = `S${video.seasonNumber}E${(video.episodeNumber)} - ${video.title}` // Add Episode Number
	if (settings.fileFormatting.formatWithDate == true) video.fileName = `${video.releaseDate} - ${video.title}` // Add the upload date to the filename
	if (settings.fileFormatting.formatWithchannel == true) video.fileName = `${video.channel} - ${video.title}` // Add channel naming if requested

	video.fileName = sanitize(video.fileName);
	return video;
}

const processVideo = (video, subscription) => {
	// Set defaults for video
	video.channel = subscription.title

	/*
	/ Channel Matching
	*/
	if (settings.channelIdentifiers[subscription.title.toLowerCase()]) {
		settings.channelIdentifiers[subscription.title.toLowerCase()].forEach(channel => { // For each channel in a channel
			if(video[channel.type].toLowerCase().indexOf(channel.check) > -1) { // Check if this video is part of a channel
				video.channel = channel.title
			}
		});
	}
	if (subscription.ignore[video.channel]) return // If this video is part of a channel we are ignoring then break
	if (!settings.colourList[video.channel]) settings.colourList[video.channel] = '\u001b[38;5;153m' // If this video's channel does not have a colour specified for its display, set a default

	if (videoDB[video.guid] == undefined) { // If this video does not exist in the videosDB meta then add it
		video.partial = false
		video.saved = false
		videoDB[video.guid] = video
	}

	// Maintain a count of videos for each channel to ensure proper numbering
	if (channelDB[video.channel] == undefined) channelDB[video.channel] = {}
	if (channelDB[video.channel][video.guid] == undefined) channelDB[video.channel][video.guid] = Object.keys(channelDB[video.channel]).length+1
	video.episodeNumber = channelDB[video.channel][video.guid]

	video = formatVideoFilename(formatVideoFolder(video));

	// if (!videoDB[video.guid].saved) { // If the video is not already downloaded
	// 	video.url = `${settings.floatplaneServer}/Videos/${video.guid}/${settings.video_res}.mp4?wmsAuthSign=${settings.key}`;
	// 	console.log(`${settings.colourList[video.channel]}>-- \u001b[0m${video.title} == \u001b[34mDOWNLOADING\u001b[0m`);
	// 	// if (settings.extras.downloadArtwork && video.thumbnail) { // If downloading artwork is enabled download it
	// 	// 	request(video.thumbnail.path).pipe(fs.createWriteStream(`${video.folderPath}${video.title}.${settings.extras.artworkFormat$}`))
	// 	// } // Save the thumbnail with the same name as the video so plex will use it

	// 	// if (liveCount < settings.maxParallelDownloads || settings.maxParallelDownloads == -1) { // If we havent hit the maxParallelDownloads or there isnt a limit then download
	// 	// 	if (videoDB[video.guid].partial) process.stdout.write(`${settings.colourList[video.channel]}>-- \u001b[0m${video.title} == \u001b[38;5;226mRESUMING DOWNLOAD\u001b[0m`);
	// 	// 	else process.stdout.write(`${settings.colourList[video.channel]}>-- \u001b[0m${video.title} == \u001b[34mDOWNLOADING\u001b[0m`);
	// 	// 	downloadVideo(video) // Download the video
	// 	// } else { // Otherwise add to queue
	// 	// 	if (videoDB[video.guid].partial) process.stdout.write(`${settings.colourList[video.channel]}>-- \u001b[0m${video.title} == \u001b[35mQUEUED \u001b[38;5;226mRESUME\u001b[0m`);
	// 	// 	else process.stdout.write(`${settings.colourList[video.channel]}>-- \u001b[0m${video.title} == \u001b[35mQUEUED\u001b[0m`);
	// 	// 	queueDownload(video) // Queue
	// 	// }
	// 	// if (settings.extras.saveNfo) {
	// 	// 	const nfo = builder.create('episodedetails').ele('title').text(video.title).up().ele('showtitle').text(video.channel).up().ele('description').text(video.description).up().ele('aired').text(video.releaseDate).up().ele('season').text(video.seasonNumber).up().ele('episode').text(video.episodeNumber).up().end({ pretty: true });
	// 	// 	fs.writeFileSync(`${+video.folderPath}${video.fileName}.nfo`, nfo, 'utf8')
	// 	// }
	// } else console.log(`${settings.colourList[video.channel]}${video.channel}\u001b[0m> ${video.title} == \u001b[32mEXISTS\u001b[0m`);
	return video
}

module.exports = { init, displayVideosDetails, processVideo }
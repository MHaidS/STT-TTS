// stt-tts-07jul2023 > server.js

const dotenv = require("dotenv");
dotenv.config({ path: "./config.env" });
// =========================================
const express = require("express");
const cors = require("cors");
const { Readable } = require("stream");
const mic = require("mic");
const fs = require("fs");
const { OpenAI } = require("openai");
const gTTS = require("gtts");

const fetch = require("cross-fetch"); // STT | TTS
const axios = require("axios"); // STT
const FormData = require("form-data"); // STT
const path = require("path"); // STT | TTS

const audioPath = path.join(__dirname, "tts_audio.wav");
// ============================
// Created separate microphone instances for each recording, recorded_audio1.wav and recorded_audio2.wav, as well as separate mic input streams; we also start both mic instances separately & handle errors independently which will stop the corresponding recording if an error occurs in either microphone instance, allowing to handle scenarios where you want to transcribe each recording independently.
// **** INITIALIZE THE MIC INSTANCE AND RECORDING STATUS ****
const micInstance1 = mic({
  rate: "48000",
  channels: "2",
  debug: false,
  exitOnSilence: 6,
  fileType: "wav",
});

const micInstance2 = mic({
  rate: "48000",
  channels: "2",
  debug: false,
  exitOnSilence: 6,
  fileType: "wav",
});

// create separate mic input streams
let micInputStream1 = micInstance1.getAudioStream();
let micInputStream2 = micInstance2.getAudioStream();

// start both microphone instances
micInstance1.start(); // Start the 1st microphone instance
micInstance2.start(); // start the 2nd microphone instance

// handle errors independently in the 2 microphone instances
micInputStream1.on("error", (err) => {
  console.error("Microphone 1 error:", err);
  stopRecording("recorded_audio1.wav"); // stop the 1st recording
});

micInputStream2.on("error", (err) => {
  console.error("Microphone 2 error:", err);
  stopRecording("recorded_audio2.wav"); // Stop the 2nd recording
});
// ==================================================
// ***** Create an instance of the Express application *****
const app = express();
// =================================
let transcription = ""; // for STT
let isRecording = false; // for STT; Initialize isRecording to false
// ************************
let audioFilename = ""; // for STT | TTS : initialized as an empty string in the server code

// ********* Middlewares ***********

app.use(cors()); // enable CORS for all routes
// ******************************
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public"))); // serve static files from the "public" directory
// =====================
// ********* CONFIGURATION FOR THE WHISPER ASR API *********

const whisperUrl = "https://api.openai.com/v1/audio/transcriptions";

const openai = new OpenAI({
  apiKey: process.env.WHISPER_API_KEY,
});
// ===============================================================

const transcriptions = {}; // initializes an empty object for storing transcriptions

// ++++++++++++++++++++++++++++++++++++++++++++++++++
// +++++++++++++++   FUNCTIONS   ++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++++++++++++++++++

// 29SEP: Modified the startRecording function to accept the mic instance as an argument.

// **** FUNCTION TO START RECORDING ****
async function startRecording(audioFilename, micInstance) {
  let recordingStream;

  if (isRecording) {
    console.log("Recording process already active");
    return;
  }

  isRecording = true;

  try {
    const audioFilePath = path.join(__dirname, audioFilename);

    console.log(`Recording started: ${audioFilename}`);
    recordingStream = fs.createWriteStream(audioFilePath);

    micInstance.start();

    const micInputStream = micInstance.getAudioStream();

    micInputStream.on("data", (data) => {
      recordingStream.write(data);
    });

    micInputStream.on("error", (err) => {
      console.error(`Microphone error for ${audioFilename}:`, err);
      stopRecording(audioFilename, micInstance);
    });

    micInputStream.on("stopComplete", () => {
      recordingStream.end();
      // ...
      isRecording = false;
      console.log(`Recording stopped: ${audioFilename}`);
    });
  } catch (error) {
    console.error("Recording error:", error);
    stopRecording(audioFilename, micInstance);
  }
}
// ============================
// (04OCT23) The 'stopRecording()' function is a crucial part of the recording process in the STT application. It ensures that the microphone is stopped, and the recording stream is appropriately handled, preventing any potential issues with ongoing or incomplete recordings. The logging statements are useful for debugging and monitoring the state of the recording process in the application.
// =========================================

// **** FUNCTION TO STOP RECORDING ****
function stopRecording(audioFile, micInstance) {
  let recordingStream = null;

  if (!isRecording) {
    console.log("No active recording process found");
    return;
  }

  micInstance.stop();

  if (recordingStream) {
    recordingStream.end();
    recordingStream = null;
  }

  isRecording = false;

  console.log(`Recording stopped: ${audioFile}`);
}
// ==========================================
// (04OCT23) The 'transcribeAudio()' function is a crucial part of the Speech-to-Text (STT) functionality of the application. It facilitates the communication with the Whisper ASR API, sending audio data for transcription, and handling the response. The goal is to obtain the transcribed text from the audio file, which can then be used in the application for further processing or display. The function is designed to be asynchronous (async) to handle the asynchronous nature of HTTP requests and includes error handling to manage potential issues during the transcription process.
// =========================================================

// xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// ** HELPER FUNCTION TO TRANSCRIBE AUDIO USING THE WHISPER ASR API **
// 05OCT: this function is no longer used in the STT transcription process; the function currently used is openai.audio.transcriptions.create() in the '/transcribe' route
async function transcribeAudio(audioFile) {
  try {
    const formData = new FormData();
    formData.append(
      "file",
      fs.createReadStream(path.join(__dirname, audioFile))
    );

    console.log("Sending audio for transcription...");

    const response = await axios.post(whisperUrl, formData, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...formData.getHeaders(),
      },
    });

    console.log("Transcription API Response Data:", response.data);

    if (response.data && response.data[0] && response.data[0].text) {
      const transcription = response.data[0].text;
      console.log("Transcription:", transcription);
      return transcription;
    } else {
      console.log("No transcription data found in the response.");
      return "";
    }
  } catch (error) {
    console.error("Transcription error:", error);
    throw error;
  }
}
// xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// ==========================================

// ++++++++++++++++++++++++++++++++++++++++++++++++++
// ++++++++++++++++++   ROUTES   ++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++++++++++++++++++

// ***** START RECORDING ROUTE *****
// Assuming the route definition
app.post("/record/start", async (req, res) => {
  const { audioFilename } = req.body;

  if (!audioFilename) {
    return res.status(400).json({ error: "No audio file provided." });
  }

  try {
    // Check if a previous recording is active and stop it
    await stopRecording(audioFilename, micInstance1); // Stop for micInstance1
    await stopRecording(audioFilename, micInstance2); // stop for micInstance2

    // Start a new recording for the specified audio file
    if (audioFilename === "recorded_audio1.wav") {
      startRecording(audioFilename, micInstance1);
    } else if (audioFilename === "recorded_audio2.wav") {
      startRecording(audioFilename, micInstance2);
    }

    // send a success response to the client
    res.sendStatus(200);
  } catch (error) {
    console.error("Start recording error:", error);
    res.status(500).json({ error: "Error starting recording" });
  }
});

// ===========================

// 29SEP: Modified the /record/stop route to ensure that it passes the correct microphone instance to the stopRecording function.
// ***** STOP RECORDING ROUTE *****

app.post("/record/stop", async (req, res) => {
  const { audioFilename } = req.body;

  if (!audioFilename) {
    return res.status(400).json({ error: "No audio file provided." });
  }

  try {
    // Stop the recording for the specified audio file
    if (audioFilename === "recorded_audio1.wav") {
      stopRecording(audioFilename, micInstance1);
    } else if (audioFilename === "recorded_audio2.wav") {
      stopRecording(audioFilename, micInstance2);
    }

    // send a success response to the client
    res.sendStatus(200);
  } catch (error) {
    console.error("Stop recording error:", error);
    res.status(500).json({ error: "Error stopping recording" });
  }
});

// ==============================
// 29SEP: Modified /record/replace route with some added console logs for debugging. The additional console logs should help to diagnose the issue. Specifically, it will log whether it found a previous 2nd recording and if it successfully removes it before starting a new recording.
// ***** REPLACE RECORDING ROUTE *****
app.post("/record/replace", async (req, res) => {
  try {
    console.log("Replacing recording...");

    // stop both mic instances before replacing
    await stopRecording("recorded_audio1.wav");
    await stopRecording("recorded_audio2.wav");

    // Check if the audio file for replacement exists
    if (fs.existsSync("recorded_audio2.wav")) {
      console.log("Previous 2nd recording found. Removing...");
      // Remove the existing audio file for the 2nd recording
      fs.unlinkSync("recorded_audio2.wav");
      console.log("Previous 2nd recording removed.");
    }

    // Start a new recording for the 2nd recording in 'recorded_audio2.wav'
    startRecording("recorded_audio2.wav", micInstance2);
    console.log("New 2nd recording started.");

    // send a success response to the client
    res.sendStatus(200);
  } catch (error) {
    console.error("Replace recording error:", error);
    res.status(500).json({ error: "Error starting replacement recording" });
  }
});
// ==============================

// 30SEP: Modified the /transcribe route to change from ‘response.data.text’ to just ‘response.text’. This modification assumes that the transcription text is directly available in response.text.

// ******* TRANSCRIBE ROUTE *******
app.post("/transcribe", async (req, res) => {
  const { audioFilename } = req.body;

  if (!audioFilename) {
    return res.status(400).json({ error: "No audio file provided." });
  }

  try {
    // check if the transcription has already been done for this file
    if (transcriptions.hasOwnProperty(audioFilename)) {
      console.log(
        `Transcription for ${audioFilename} already exists: ${transcriptions[audioFilename]}`
      );
      return res
        .status(200)
        .json({ transcription: transcriptions[audioFilename] });
    }

    // **********************************
    // Perform the transcription
    const response = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: fs.createReadStream(audioFilename),
    });

    // Log the entire response to inspect its structure
    console.log(`Full Response for ${audioFilename}:`, response);

    // Check if 'response.text' is defined before accessing it
    const transcription = response.text;

    if (!transcription) {
      console.error(
        `Transcription for ${audioFilename} is undefined. Response:`,
        response
      );
      return res.status(500).json({ error: "Error during transcription" });
    }
    // ******************************
    // Store the transcription result
    transcriptions[audioFilename] = transcription;

    console.log(`Transcription ${audioFilename}: ${transcription}`);

    // send the transcription to the client
    res.status(200).json({ transcription });
  } catch (error) {
    console.error("Transcription error:", error);
    res.status(500).json({ error: "Error during transcription" });
  }
});
//  ===========================================

// ******* ROUTE FOR "/tts" *******
app.post("/tts", async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "No text to speak" });
  }

  try {
    const gtts = new gTTS(text, "en");
    gtts.save(audioPath, (error) => {
      if (error) {
        console.error("Text to speech error:", error);
        return res
          .status(500)
          .json({ error: "Error converting text to speech" });
      }

      const audioData = fs.createReadStream(audioPath);
      res.set("Content-Disposition", 'attachment; filename="tts_audio.wav"');
      res.set("Content-Type", "audio/wav");
      audioData.pipe(res);
    });
  } catch (error) {
    console.error("Text to speech error:", error);
    res.status(500).json({ error: "Error converting text to speech" });
  }
});

// =======================================
// *** DOWNLOAD TTS AUDIO ROUTE ***
app.get("/download", (req, res) => {
  const audioFilename = "tts_audio.wav";
  const audioPath = path.join(__dirname, audioFilename);

  if (!fs.existsSync(audioPath)) {
    console.error(`Audio file not found: ${audioFilename}`);
    res.status(404).json({ error: "Error downloading the audio file" });
    return;
  }

  res.download(audioPath, (err) => {
    if (err) {
      console.error("Download error:", err);
      res.status(500).json({ error: "Error downloading the audio file" });
    } else {
      console.log("File download successful");
    }
  });
});
// *****************************************************
// **** START THE SERVER AND LISTEN ON THE SPECIFIED PORT ***
const port = 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
// *****************************************************

// ~~~~~~~~~~~~~~~~~~~~~~~~
// Here’s HOW STT IS SUPPOSED TO WORK on my app:
// RECORD, STOP, REPLACE, TRANSCRIBE
// 1. RECORD is pressed to start the recording.
// 2. STOP is pressed to stop the recording.
// 3. An audio file (‘recorded_audio1.wav’) is generated which can be verified at the backend.
// 4. Clicking on REPLACE will allow user to do the recording all over again; this becomes available right after pressing on STOP, when the 1st recording is successfully made & before the TRANSCRIBE button is utilized. It would be under the assumption that the 1st recording will no longer be used.
// ===> … for the 1st scenario, the user can transcribe the 1st recording in  'recorded_audio1.wav' file assuming that he doesn’t have any issues with it
// ===> … for the 2nd scenario, the user is able to save the 1st recording in  'recorded_audio1.wav' file but decides not to use it & to make use of the REPLACE button to save the 2nd recording in the 'recorded_audio2.wav' file to be transcribed independently instead
// 5. Pressing on TRANSCRIBE will send the audio file to openai.com for transcription & the transcribed text will now appear on the screen.
// ~~~~~~~~~~~~~~~~~~~~~~

// ~~~~~~~~~~~~~~~~~~~~~~
// Here’s HOW TTS  IS SUPPOSED TO WORK on my app:
// ‘input box’, SUBMIT, PLAY, REDO, DOWNLOAD
// 1. Type in text inside the input box then hit on SUBMIT which will convert text to audio in ‘tts_audio.wav’ file.
// 2. Pressing on PLAY should play the audio file in which each word is highlighted while being spoken.
// 3. REDO button will allow  the user to make changes on the inputted text without starting over from the beginning.
// 4. The IMPORT button will allow user to import an external ‘.txt’ file to be used as input for the TTS process.
// 5. The DOWNLOAD button will allow user to download the generated audio file from the TTS process.
// ~~~~~~~~~~~~~~~~~~~~~~

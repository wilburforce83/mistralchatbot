const express = require('express');
const { createParser } = require('eventsource-parser');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3079;

app.use(express.static('public'));
app.use(express.json());

// Set up persistent memory file
const memoryFolder = path.join(__dirname, 'memory');
const chatHistoryFile = path.join(memoryFolder, 'chat_history.json');
let chatHistory = [];

// Ensure the memory folder exists
if (!fs.existsSync(memoryFolder)) {
  fs.mkdirSync(memoryFolder);
}

// Load existing chat history if it exists
if (fs.existsSync(chatHistoryFile)) {
  try {
    const data = fs.readFileSync(chatHistoryFile, 'utf8');
    chatHistory = JSON.parse(data);
    console.log('Loaded chat history with', chatHistory.length, 'entries.');
  } catch (err) {
    console.error('Error reading chat history file:', err);
  }
}

// Helper to save chat history to file
function saveChatHistory() {
  fs.writeFile(chatHistoryFile, JSON.stringify(chatHistory, null, 2), (err) => {
    if (err) console.error('Error saving chat history:', err);
  });
}

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

app.post('/chat', async (req, res) => {
    const { prompt } = req.body;

    // Append the user prompt to chat history (wrapped in backticks)
    chatHistory.push({ role: 'user', text: `\`${prompt}\``, timestamp: new Date().toISOString() });
    saveChatHistory();

    const ollamaRes = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'mistral', prompt, stream: true }),
    });

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const decoder = new TextDecoder();
    let buffer = '';
    let assistantResponse = '';

    // Read streamed chunks from Ollama
    for await (const chunk of ollamaRes.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let lines = buffer.split('\n');
        // Keep last (potentially partial) line in the buffer
        buffer = lines.pop();
        for (const line of lines) {
            if (line.trim()) {
                // Append the line to our accumulated response
                assistantResponse += line.trim() + "\n";
                // Send each complete line as an SSE message
                res.write(`data: ${line.trim()}\n\n`);
            }
        }
    }

    // Flush any remaining text in the buffer
    if (buffer.trim()) {
        assistantResponse += buffer.trim() + "\n";
        res.write(`data: ${buffer.trim()}\n\n`);
    }
    res.end();

    // Save the full assistant response to chat history only once it's complete.
    chatHistory.push({ role: 'assistant', text: `\`${assistantResponse}\``, timestamp: new Date().toISOString() });
    saveChatHistory();
});

app.post('/tts', (req, res) => {
    const { text } = req.body;
    if (!text) {
      res.status(400).send('No text provided.');
      return;
    }
    
    // Define the output directory where Piper writes WAV files.
    const outputDir = '/home/wilbur/mistralchatbot/';
    
    // Capture the list of .wav files that already exist.
    const filesBefore = fs.readdirSync(outputDir).filter(f => f.endsWith('.wav'));
    
    console.log(`Starting Piper TTS for text: ${text}`);
    
    // Spawn Piper without the --out flag so that it writes to the current directory.
    const ttsProcess = spawn('/home/wilbur/piper/build/piper', [
      '--model', '/home/wilbur/piper/voices/alba_medium/en_GB-alba-medium.onnx'
    ], { cwd: outputDir });
    
    // Write the text into Piper's stdin (mimicking the echo pipe)
    ttsProcess.stdin.write(text);
    ttsProcess.stdin.end();
    
    // Capture any stderr output for debugging.
    ttsProcess.stderr.on('data', (data) => {
      console.error(`Piper stderr: ${data}`);
    });
    
    ttsProcess.on('error', (err) => {
      console.error('Failed to start Piper:', err);
      res.status(500).send('Piper TTS process failed to start.');
    });
    
    ttsProcess.on('exit', (code) => {
      console.log(`Piper exited with code ${code}`);
      if (code === 0) {
        // After Piper exits, re-read the output directory.
        fs.readdir(outputDir, (err, filesAfter) => {
          if (err) {
            console.error('Error reading output directory:', err);
            res.status(500).send('Error reading output directory.');
            return;
          }
          // Filter to .wav files.
          const wavFiles = filesAfter.filter(f => f.endsWith('.wav'));
          // Identify the new file by excluding files from before.
          const newFiles = wavFiles.filter(f => !filesBefore.includes(f));
          if (newFiles.length === 0) {
            console.error('No new output file found.');
            res.status(500).send('TTS output file not found.');
            return;
          }
          // If multiple files are found, pick the one with the latest modification time.
          let chosenFile = newFiles[0];
          if (newFiles.length > 1) {
            let latestMTime = 0;
            newFiles.forEach(file => {
              const stats = fs.statSync(path.join(outputDir, file));
              if (stats.mtimeMs > latestMTime) {
                latestMTime = stats.mtimeMs;
                chosenFile = file;
              }
            });
          }
          const tempFile = path.join(outputDir, chosenFile);
          console.log('Chosen TTS file:', tempFile);
          res.setHeader('Content-Type', 'audio/wav');
          const readStream = fs.createReadStream(tempFile);
          readStream.pipe(res);
          readStream.on('end', () => {
            // Clean up the file after streaming.
            fs.unlink(tempFile, (err) => {
              if (err) console.error('Error deleting temp file:', err);
            });
          });
        });
      } else {
        console.error('Piper process exited with code:', code);
        res.status(500).send('TTS generation failed.');
      }
    });
});

app.listen(port, () => {
    console.log(`✅ Mistral chatbot running at http://localhost:${port}`);
});

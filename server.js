const express = require('express');
const { createParser } = require('eventsource-parser');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// We'll import node-fetch, or you can rely on Node 18+ built-in fetch
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const port = 3079;

app.use(express.static('public'));
app.use(express.json());

// --- Chat history setup (same as before) ---
const memoryFolder = path.join(__dirname, 'memory');
const chatHistoryFile = path.join(memoryFolder, 'chat_history.json');
let chatHistory = [];

if (!fs.existsSync(memoryFolder)) {
  fs.mkdirSync(memoryFolder);
}
if (fs.existsSync(chatHistoryFile)) {
  try {
    const data = fs.readFileSync(chatHistoryFile, 'utf8');
    chatHistory = JSON.parse(data);
    console.log('Loaded chat history with', chatHistory.length, 'entries.');
  } catch (err) {
    console.error('Error reading chat history file:', err);
  }
}

function saveChatHistory() {
  fs.writeFile(chatHistoryFile, JSON.stringify(chatHistory, null, 2), (err) => {
    if (err) console.error('Error saving chat history:', err);
  });
}

// ----------------------------------------------------------------------
//  POST /chat
//  This route now integrates RAG + Ollama's streaming
// ----------------------------------------------------------------------
app.post('/chat', async (req, res) => {
  const { prompt } = req.body;

  // ------------------------------------------------
  // 1) Append user message to chat history
  // ------------------------------------------------
  chatHistory.push({ role: 'user', text: `\`${prompt}\``, timestamp: new Date().toISOString() });
  saveChatHistory();

  try {
    // ------------------------------------------------
    // 2) Call the Python RAG service to get top chunks
    // ------------------------------------------------
    // Replace with your actual RAG endpoint and port
    const ragRes = await fetch('http://localhost:8008/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: prompt })
    });
    const ragJson = await ragRes.json();

    // Suppose ragJson = { context: [ { text, metadata }, ... ], question: '...' }
    // Build a context string from these chunks
    let contextString = '';
    if (ragJson.context && Array.isArray(ragJson.context)) {
      ragJson.context.forEach((chunk, i) => {
        contextString += `[Source #${i+1}]\n${chunk.text}\n\n`;
      });
    }

    // ------------------------------------------------
    // 3) Build the final prompt for Ollama
    // ------------------------------------------------
    const finalPrompt = `
Use the following context to answer the user's question.
If you cannot find the answer, say you don't know.

Context:
${contextString}

User's Question:
${prompt}

Answer:
`;

    // ------------------------------------------------
    // 4) Send final prompt to Ollama with SSE streaming
    // ------------------------------------------------
    const ollamaRes = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: 'mistral', 
        prompt: finalPrompt,
        stream: true 
      }),
    });

    // ------------------------------------------------
    // 5) Stream the response back to the client (SSE)
    // ------------------------------------------------
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const decoder = new TextDecoder();
    let buffer = '';
    let assistantResponse = '';

    for await (const chunk of ollamaRes.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let lines = buffer.split('\n');
      // Keep last partial line in the buffer
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) {
          assistantResponse += line.trim() + '\n';
          // Send SSE message to client
          res.write(`data: ${line.trim()}\n\n`);
        }
      }
    }

    // Flush any remainder
    if (buffer.trim()) {
      assistantResponse += buffer.trim() + '\n';
      res.write(`data: ${buffer.trim()}\n\n`);
    }
    res.end();

    // ------------------------------------------------
    // 6) Save assistant response to chat history
    // ------------------------------------------------
    chatHistory.push({ role: 'assistant', text: `\`${assistantResponse}\``, timestamp: new Date().toISOString() });
    saveChatHistory();

  } catch (err) {
    console.error('Error in /chat route:', err);
    res.status(500).send('Error generating response via RAG + Ollama.');
  }
});

// ----------------------------------------------------------------------
//  POST /tts
//  Your existing TTS route (unchanged)
// ----------------------------------------------------------------------
app.post('/tts', (req, res) => {
  const { text } = req.body;
  if (!text) {
    res.status(400).send('No text provided.');
    return;
  }
  
  const outputDir = '/home/wilbur/mistralchatbot/';
  const filesBefore = fs.readdirSync(outputDir).filter(f => f.endsWith('.wav'));

  console.log(`Starting Piper TTS for text: ${text}`);

  const ttsProcess = spawn('/home/wilbur/piper/build/piper', [
    '--model', '/home/wilbur/piper/voices/alba_medium/en_GB-alba-medium.onnx'
  ], { cwd: outputDir });

  ttsProcess.stdin.write(text);
  ttsProcess.stdin.end();

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
      fs.readdir(outputDir, (err, filesAfter) => {
        if (err) {
          console.error('Error reading output directory:', err);
          res.status(500).send('Error reading output directory.');
          return;
        }
        const wavFiles = filesAfter.filter(f => f.endsWith('.wav'));
        const newFiles = wavFiles.filter(f => !filesBefore.includes(f));
        if (newFiles.length === 0) {
          console.error('No new output file found.');
          res.status(500).send('TTS output file not found.');
          return;
        }
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
  console.log(`✅ Mistral chatbot with RAG running at http://localhost:${port}`);
});

// app.js

const chatBox = document.getElementById('chat-box');
const form = document.getElementById('chat-form');
const input = document.getElementById('chat-input');
const ttsToggle = document.getElementById('tts-toggle');

// Global TTS queue and flag to manage sequential playback.
let ttsQueue = [];
let isPlaying = false;

// Variables to track the aggregated bot text and what’s already been queued for TTS.
let botText = '';
let lastSpokenIndex = 0;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const userText = input.value.trim();
  if (!userText) return;

  addMessage(userText, 'chat-user');
  input.value = '';

  // Reset the bot text and last spoken index for the new response
  botText = '';
  lastSpokenIndex = 0;

  // Create a new bot message element for rendering the response.
  const botMessageEl = addMessage('', 'chat-bot');

  // Start streaming the bot response from the Node backend.
  const res = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: userText })
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Process each line from the stream.
    for (const line of buffer.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const clean = line.replace('data:', '').trim();
      if (!clean) continue;

      try {
        const json = JSON.parse(clean);
        if (json.response) {
          // Append the new response text.
          botText += json.response;
          // Render the complete botText as Markdown.
          botMessageEl.innerHTML = `<div class="markdown">${marked.parse(botText)}</div>`;

          chatBox.scrollTop = chatBox.scrollHeight;
          // Check for complete sentences to queue for TTS.
          checkAndQueue();
        }
      } catch (err) {
        // Ignore incomplete JSON chunks.
      }
    }
    // Clear the buffer for the next chunk.
    buffer = '';
  }
});


// Utility function to add messages to the chat box.
function addMessage(text, cls) {
  const div = document.createElement('div');
  div.className = `chat-msg ${cls}`;
  if (cls === 'chat-user') {
    div.textContent = text;
  } else {
    div.innerHTML = text;
  }
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  return div;
}

/* --- TTS QUEUE FUNCTIONS --- */

// Checks the new portion of botText for a complete sentence (ending with . ! or ?)
// and queues it for TTS.
async function checkAndQueue() {
  if (!ttsToggle.checked) return;
  
  // Get the unsent text.
  const newText = botText.substring(lastSpokenIndex).trimStart();

  // Regex to capture a complete sentence ending in ., !, or ?.
  const match = newText.match(/^(.*?[.!?])(\s|$)/);
  if (match) {
    const sentence = match[1].trim();
    lastSpokenIndex += match[0].length;
    // Queue the sentence.
    ttsQueue.push(sentence);
    // Process the queue.
    processQueue();
    // Recursively check for more complete sentences.
    checkAndQueue();
  }
}

// Processes the TTS queue so that each audio plays only after the previous one finishes.
async function processQueue() {
  if (isPlaying || ttsQueue.length === 0) return;
  isPlaying = true;
  const sentence = ttsQueue.shift();
  try {
    const response = await fetch('/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sentence })
    });
    const arrayBuffer = await response.arrayBuffer();
    const audioBlob = new Blob([arrayBuffer], { type: 'audio/wav' });
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.onended = () => {
      isPlaying = false;
      processQueue();
    };
    audio.play().catch(err => {
      console.error('Playback error:', err);
      isPlaying = false;
      processQueue();
    });
  } catch (err) {
    console.error('TTS error:', err);
    isPlaying = false;
    processQueue();
  }
}

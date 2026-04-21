import './style.css';

const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const chatMessages = document.getElementById('chat-messages');
const newSessionBtn = document.getElementById('new-session');
const sendBtn = document.getElementById('send-btn');
const suggestionChips = document.querySelectorAll('.chip');
const statusText = document.querySelector('.status-text');
const statusIndicator = document.querySelector('.status-indicator');

let chatHistory = [];
let isGenerating = false;

// The backend endpoint we created
const API_ENDPOINT = 'http://localhost:3000/api/chat';

// Auto-resize textarea
messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
});

// Submit on Enter
messageInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.dispatchEvent(new Event('submit'));
    }
});

// Handle Chips
suggestionChips.forEach(chip => {
    chip.addEventListener('click', () => {
        messageInput.value = chip.textContent;
        chatForm.dispatchEvent(new Event('submit'));
    });
});

// New Session
newSessionBtn.addEventListener('click', () => {
    chatHistory = [];
    const welcome = document.querySelector('.welcome-message');
    chatMessages.innerHTML = '';
    if (welcome) {
        chatMessages.appendChild(welcome);
    }
    setStatus('Connected');
});

function setStatus(text, isError = false) {
    statusText.textContent = text;
    statusIndicator.style.backgroundColor = isError ? 'var(--warning-red)' : 'var(--success-green)';
    statusIndicator.style.boxShadow = `0 0 8px ${isError ? 'var(--warning-red)' : 'var(--success-green)'}`;
}

function createMessageElement(content, isUser, debugInfo = null) {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${isUser ? 'user' : 'ai'}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = isUser ? 'U' : 'AI';

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.textContent = content;

    if (debugInfo) {
        const debugHtml = document.createElement('div');
        debugHtml.className = 'debug-trace-container';
        
        debugHtml.innerHTML = `
            <div class="debug-trace-header" onclick="this.parentElement.classList.toggle('expanded')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path><path d="M12 9v2m0 4h.01"></path></svg>
                <span>View System Trace (${debugInfo.layer1_intent})</span>
            </div>
            <div class="debug-trace-body">
                <div class="trace-layer">
                    <strong>Layer 1 (Master)</strong>
                    <pre>${debugInfo.layer1_masterOutput}</pre>
                </div>
                <div class="trace-layer">
                    <strong>Layer 2 (Service Layer)</strong>
                    <div>Intent matched: <span class="highlight">${debugInfo.layer1_intent}</span></div>
                    <div>Keywords extracted: <span class="highlight">${debugInfo.layer2_keywords.length > 0 ? debugInfo.layer2_keywords.join(', ') : 'None'}</span></div>
                    <pre>${debugInfo.layer2_serviceData}</pre>
                </div>
                <div class="trace-layer">
                    <strong>Layer 3 (Reply Generation)</strong>
                    <div>System Prompt Selected: <span class="highlight">${debugInfo.layer3_promptFile}</span></div>
                </div>
            </div>
        `;
        messageContent.appendChild(debugHtml);
    }

    if (isUser) {
        wrapper.appendChild(messageContent);
        wrapper.appendChild(avatar);
    } else {
        wrapper.appendChild(avatar);
        wrapper.appendChild(messageContent);
    }

    return wrapper;
}

function showTypingIndicator() {
    const wrapper = document.createElement('div');
    wrapper.className = 'message ai';
    wrapper.id = 'typing-indicator';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = 'AI';

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'typing-dot';
        messageContent.appendChild(dot);
    }

    wrapper.appendChild(avatar);
    wrapper.appendChild(messageContent);
    chatMessages.appendChild(wrapper);
    scrollToBottom();
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isGenerating) return;

    const text = messageInput.value.trim();
    if (!text) return;

    // Reset input
    messageInput.value = '';
    messageInput.style.height = 'auto';

    // Remove welcome banner if present
    const welcome = document.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    // Add user message
    chatMessages.appendChild(createMessageElement(text, true));
    scrollToBottom();

    isGenerating = true;
    sendBtn.disabled = true;
    setStatus('Generating response...');
    showTypingIndicator();

    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                history: chatHistory,
                currentMessage: text
            })
        });

        removeTypingIndicator();

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const data = await response.json();
        
        // Add AI message with debug info
        chatMessages.appendChild(createMessageElement(data.reply, false, data.debug));
        
        // Update history
        chatHistory.push({ role: "User", content: text, intent: data.debug?.layer1_intent || 'default' });
        chatHistory.push({ role: "Assistant", content: data.reply });

        setStatus('Connected');
    } catch (error) {
        removeTypingIndicator();
        console.error('Error:', error);
        
        chatMessages.appendChild(createMessageElement(`Connection failed: Make sure the Node.js backend is running on port 3000 and the local LM studio is running.\nDetails: ${error.message}`, false));
        setStatus('Error', true);
    } finally {
        isGenerating = false;
        sendBtn.disabled = false;
        scrollToBottom();
        messageInput.focus();
    }
});

// --- PROMPT EDITOR LOGIC ---
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const intentList = document.getElementById('intent-list');
const promptEditor = document.getElementById('prompt-editor');
const savePromptBtn = document.getElementById('save-prompt-btn');
const deleteIntentBtn = document.getElementById('delete-intent-btn');
const restoreMasterBtn = document.getElementById('restore-master-btn');
const addIntentBtn = document.getElementById('add-intent-btn');
const currentEditTitle = document.getElementById('current-edit-title');
const saveStatus = document.getElementById('save-status');

let currentPrompts = {};
let activeIntent = null;

const PROMPT_API = 'http://localhost:3000/api/prompts';

settingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    settingsModal.classList.remove('hidden');
    loadPrompts();
});

closeModalBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

async function loadPrompts() {
    try {
        const res = await fetch(PROMPT_API);
        currentPrompts = await res.json();
        renderIntentList();
    } catch (e) {
        console.error("Failed to load prompts", e);
    }
}

function renderIntentList() {
    intentList.innerHTML = '';
    
    // Always render Master first
    if (currentPrompts['master']) {
        intentList.appendChild(createIntentListItem('master', currentPrompts['master'].isSpecial));
    }
    
    // Render the rest
    for (const intent of Object.keys(currentPrompts)) {
        if (intent !== 'master') {
            intentList.appendChild(createIntentListItem(intent, false));
        }
    }
}

function createIntentListItem(intent, isSpecial) {
    const li = document.createElement('li');
    li.className = `intent-item ${activeIntent === intent ? 'active' : ''}`;
    
    let icon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
    if (isSpecial) {
        icon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fbbf24" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
    }

    li.innerHTML = `${icon} <span style="text-transform: capitalize;">${intent}</span>`;
    
    li.addEventListener('click', () => {
        selectIntent(intent);
    });
    
    return li;
}

function selectIntent(intent) {
    activeIntent = intent;
    const promptData = currentPrompts[intent];
    
    currentEditTitle.textContent = `Editing: ${intent.charAt(0).toUpperCase() + intent.slice(1)}`;
    promptEditor.value = promptData.content;
    promptEditor.disabled = false;
    savePromptBtn.disabled = false;
    
    // Toggle strict visibility
    if (intent === 'master') {
        restoreMasterBtn.classList.remove('hidden');
        deleteIntentBtn.classList.add('hidden');
    } else if (intent === 'default') {
        restoreMasterBtn.classList.add('hidden');
        deleteIntentBtn.classList.add('hidden');
    } else {
        restoreMasterBtn.classList.add('hidden');
        deleteIntentBtn.classList.remove('hidden');
    }
    
    renderIntentList();
}

promptEditor.addEventListener('input', () => {
    savePromptBtn.disabled = false;
    saveStatus.textContent = '';
});

savePromptBtn.addEventListener('click', async () => {
    if (!activeIntent) return;
    
    savePromptBtn.disabled = true;
    saveStatus.textContent = 'Saving...';
    saveStatus.style.color = 'var(--text-secondary)';
    
    try {
        const res = await fetch(`${PROMPT_API}/${activeIntent}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: promptEditor.value })
        });
        
        if (res.ok) {
            saveStatus.textContent = 'Saved successfully!';
            saveStatus.style.color = 'var(--success-green)';
            currentPrompts[activeIntent].content = promptEditor.value;
        } else {
            throw new Error("Save returned error");
        }
    } catch (e) {
        saveStatus.textContent = 'Failed to save.';
        saveStatus.style.color = 'var(--warning-red)';
    } finally {
        setTimeout(() => { saveStatus.textContent = ''; }, 3000);
        savePromptBtn.disabled = false;
    }
});

deleteIntentBtn.addEventListener('click', async () => {
    if (!activeIntent || activeIntent === 'master' || activeIntent === 'default') return;
    
    if (confirm(`Are you sure you want to delete the "${activeIntent}" intent?\nThis deletes the file and unregisters it from the routing logic.`)) {
        try {
            const res = await fetch(`${PROMPT_API}/${activeIntent}`, { method: 'DELETE' });
            if (res.ok) {
                promptEditor.value = '';
                promptEditor.disabled = true;
                savePromptBtn.disabled = true;
                activeIntent = null;
                deleteIntentBtn.classList.add('hidden');
                currentEditTitle.textContent = 'Editing: -';
                await loadPrompts();
            }
        } catch (e) {
            alert('Failed to delete intent.');
        }
    }
});

restoreMasterBtn.addEventListener('click', async () => {
    if (confirm("This will overwrite the Master Prompt with the factory default JSON routing configuration. Are you sure?")) {
        try {
            const res = await fetch(`${PROMPT_API}/restore-master`, { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                promptEditor.value = data.content;
                currentPrompts['master'].content = data.content;
                saveStatus.textContent = 'Restored successfully!';
                saveStatus.style.color = 'var(--success-green)';
                setTimeout(() => { saveStatus.textContent = ''; }, 3000);
            }
        } catch (e) {
            alert('Failed to restore master.');
        }
    }
});

addIntentBtn.addEventListener('click', async () => {
    const newIntent = prompt("Enter new intent name (lowercase, no spaces):");
    if (!newIntent) return;
    
    const cleanIntent = newIntent.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
    if (!cleanIntent || currentPrompts[cleanIntent]) {
        alert("Invalid or duplicate intent name.");
        return;
    }
    
    try {
        const defaultContent = `You are an AI handling the ${cleanIntent} intent. Answer the user appropriately.`;
        const res = await fetch(PROMPT_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intent: cleanIntent, content: defaultContent })
        });
        
        if (res.ok) {
            await loadPrompts();
            selectIntent(cleanIntent);
        }
    } catch (e) {
        alert("Failed to create new intent.");
    }
});

import './style.css';

const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const chatMessages = document.getElementById('chat-messages');
const newSessionBtn = document.getElementById('new-session');
const sendBtn = document.getElementById('send-btn');
const suggestionChips = document.querySelectorAll('.chip');
const statusText = document.querySelector('.status-text');
const statusIndicator = document.querySelector('.status-indicator');

let isGenerating = false;
let sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

// The backend endpoint we created
const API_ENDPOINT = `http://${window.location.hostname}:3001/api/chat/session`;

// Auto-resize textarea
messageInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
});

// Submit on Enter
messageInput.addEventListener('keydown', function (e) {
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
    sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
                sessionId: sessionId,
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

const PROMPT_API = `http://${window.location.hostname}:3000/api/prompts`;

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

// --- RESTAURANTS DOM LOGIC ---
const navChat = document.getElementById('nav-chat');
const navRestaurants = document.getElementById('nav-restaurants');
const chatAreaMain = document.querySelector('.chat-area');
const chatInputArea = document.getElementById('chat-input-area');
const restaurantsArea = document.getElementById('restaurants-area');

const API_RESTAURANTS = `http://${window.location.hostname}:3000/api/restaurants`;

// Tab Switching
navChat.addEventListener('click', (e) => {
    e.preventDefault();
    navChat.classList.add('active');
    navRestaurants.classList.remove('active');

    // show chat
    chatAreaMain.style.display = 'flex';
    document.querySelector('.chat-header').style.display = 'flex';
    chatMessages.style.display = 'flex';
    chatInputArea.style.display = 'block';

    // hide restos
    restaurantsArea.classList.add('hidden');
});

navRestaurants.addEventListener('click', (e) => {
    e.preventDefault();
    navRestaurants.classList.add('active');
    navChat.classList.remove('active');

    // hide chat
    document.querySelector('.chat-header').style.display = 'none';
    chatMessages.style.display = 'none';
    chatInputArea.style.display = 'none';

    // show restos
    restaurantsArea.classList.remove('hidden');
    loadRestaurants();
});

// Restaurant Table Rendering
const tbody = document.getElementById('restaurants-tbody');
let currentRestaurantsData = [];
let currentSortColumn = 'id';
let currentSortDirection = 'asc';

async function loadRestaurants() {
    try {
        const res = await fetch(API_RESTAURANTS);
        currentRestaurantsData = await res.json();
        renderRestaurantsTable();
    } catch (e) {
        console.error("Failed to load restaurants", e);
    }
}

function renderRestaurantsTable() {
    // Sort logic
    const sortedData = [...currentRestaurantsData].sort((a, b) => {
        let valA = a[currentSortColumn];
        let valB = b[currentSortColumn];

        // Handle nulls
        if (valA === null || valA === undefined) valA = '';
        if (valB === null || valB === undefined) valB = '';

        // If numeric
        if (typeof valA === 'number' && typeof valB === 'number') {
            return currentSortDirection === 'asc' ? valA - valB : valB - valA;
        }

        // Default to string comparison
        valA = valA.toString().toLowerCase();
        valB = valB.toString().toLowerCase();

        if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    tbody.innerHTML = '';

    // Update header UI
    document.querySelectorAll('#restaurants-table th.sortable').forEach(th => {
        const col = th.getAttribute('data-sort');
        th.classList.remove('active-sort', 'asc', 'desc');
        if (col === currentSortColumn) {
            th.classList.add('active-sort', currentSortDirection);
        }
    });

    if (sortedData.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="7" style="text-align: center; color: var(--text-secondary);">No restaurants found. Add one or import CSV.</td>`;
        tbody.appendChild(tr);
        return;
    }

    sortedData.forEach(r => {
        const tr = document.createElement('tr');

        // Options badges
        let optionsHtml = '';
        if (r.booking_available) optionsHtml += `<span class="status-badge">Booking</span>`;
        if (r.queuing_available) optionsHtml += `<span class="status-badge">Queuing</span>`;
        if (r.phone_order_available) optionsHtml += `<span class="status-badge">Phone Order</span>`;

        tr.innerHTML = `
            <td>${r.id}</td>
            <td style="font-weight: 500;">${r.name || 'N/A'}</td>
            <td>${r.region || 'N/A'}</td>
            <td>${r.rating ? r.rating.toFixed(1) : 'N/A'}</td>
            <td>${r.tag || 'N/A'}</td>
            <td>${r.phone_number || 'N/A'}</td>
            <td>${optionsHtml}</td>
            <td>
                <button class="icon-btn-small edit-resto-btn" data-id="${r.id}" title="Edit"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                <button class="icon-btn-small delete-resto-btn" data-id="${r.id}" style="color: #f87171;" title="Delete"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // attach events
    document.querySelectorAll('.edit-resto-btn').forEach(btn => {
        btn.addEventListener('click', () => openRestaurantModal(btn.getAttribute('data-id')));
    });

    document.querySelectorAll('.delete-resto-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteRestaurant(btn.getAttribute('data-id')));
    });
}

// Add header click listeners for sorting
document.querySelectorAll('#restaurants-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
        const column = th.getAttribute('data-sort');
        if (currentSortColumn === column) {
            currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            currentSortColumn = column;
            currentSortDirection = 'asc';
        }
        renderRestaurantsTable();
    });
});

// Modal Logic
const restoModal = document.getElementById('restaurant-modal');
const restoForm = document.getElementById('restaurant-form');
const addRestoBtn = document.getElementById('add-restaurant-btn');
const closeRestoModalBtn = document.getElementById('close-restaurant-modal-btn');
const cancelRestoBtn = document.getElementById('cancel-resto-btn');

addRestoBtn.addEventListener('click', () => {
    openRestaurantModal();
});

closeRestoModalBtn.addEventListener('click', () => restoModal.classList.add('hidden'));
cancelRestoBtn.addEventListener('click', () => restoModal.classList.add('hidden'));

function openRestaurantModal(id = null) {
    restoForm.reset();
    document.getElementById('resto-id').value = '';
    document.getElementById('restaurant-modal-title').textContent = id ? 'Edit Restaurant' : 'Add Restaurant';

    if (id) {
        const r = currentRestaurantsData.find(x => x.id == id);
        if (r) {
            document.getElementById('resto-id').value = r.id;
            document.getElementById('resto-name').value = r.name || '';
            document.getElementById('resto-region').value = r.region || '';
            document.getElementById('resto-rating').value = r.rating || '';
            document.getElementById('resto-tag').value = r.tag || '';
            document.getElementById('resto-phone').value = r.phone_number || '';
            document.getElementById('resto-address').value = r.address || '';
            document.getElementById('resto-desc').value = r.description || '';
            document.getElementById('resto-booking').checked = r.booking_available;
            document.getElementById('resto-queuing').checked = r.queuing_available;
            document.getElementById('resto-phone-order').checked = r.phone_order_available;
        }
    }

    restoModal.classList.remove('hidden');
}

restoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('resto-id').value;

    const payload = {
        name: document.getElementById('resto-name').value,
        region: document.getElementById('resto-region').value,
        rating: parseFloat(document.getElementById('resto-rating').value) || 0,
        tag: document.getElementById('resto-tag').value,
        phone_number: document.getElementById('resto-phone').value,
        address: document.getElementById('resto-address').value,
        description: document.getElementById('resto-desc').value,
        booking_available: document.getElementById('resto-booking').checked,
        queuing_available: document.getElementById('resto-queuing').checked,
        phone_order_available: document.getElementById('resto-phone-order').checked
    };

    try {
        const url = id ? `${API_RESTAURANTS}/${id}` : API_RESTAURANTS;
        const method = id ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            restoModal.classList.add('hidden');
            loadRestaurants();
        } else {
            alert('Error saving restaurant');
        }
    } catch (e) {
        console.error(e);
        alert('Network error saving restaurant');
    }
});

async function deleteRestaurant(id) {
    if (!confirm('Delete this restaurant?')) return;
    try {
        const res = await fetch(`${API_RESTAURANTS}/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadRestaurants();
        } else {
            alert('Error deleting');
        }
    } catch (e) {
        console.error(e);
    }
}

// CSV Logic
const importCsvBtn = document.getElementById('import-csv-btn');
const csvInput = document.getElementById('csv-upload-input');

importCsvBtn.addEventListener('click', () => {
    csvInput.click();
});

csvInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    importCsvBtn.textContent = 'Uploading...';
    importCsvBtn.disabled = true;

    try {
        const res = await fetch(`${API_RESTAURANTS}/import`, {
            method: 'POST',
            body: formData
        });

        const data = await res.json();
        if (res.ok) {
            alert(`Successfully imported ${data.count} restaurants!`);
            loadRestaurants();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (err) {
        console.error(err);
        alert('Network error importing CSV');
    } finally {
        importCsvBtn.textContent = 'Import CSV';
        importCsvBtn.disabled = false;
        csvInput.value = ''; // reset
    }
});

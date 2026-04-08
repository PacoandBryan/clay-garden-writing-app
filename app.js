// --- Config ---
const CLIENT_ID = '347928919011-m1osqc1fk5808r9i5t86pdtosfohd4ih.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
const STOP_WORDS = new Set(['i','me','my','myself','we','our','ours','ourselves','you','your','yours','yourself','yourselves','he','him','his','himself','she','her','hers','herself','it','its','itself','they','them','their','theirs','themselves','what','which','who','whom','this','that','these','those','am','is','are','was','were','be','been','being','have','has','had','having','do','does','did','doing','a','an','the','and','but','if','or','because','as','until','while','of','at','by','for','with','about','against','between','into','through','during','before','after','above','below','to','from','up','down','in','out','on','off','over','under','again','further','then','once','here','there','when','where','why','how','all','any','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','s','t','can','will','just','don','should','now', 'actually', 'really', 'very', 'like', 'just', 'so', 'then', 'even', 'also', 'about', 'many', 'some', 'other']);

let tokenClient;
let accessToken = null;
let nodes = JSON.parse(localStorage.getItem('clay_garden_nodes') || '[]');
let lastSyncTimestamp = parseInt(localStorage.getItem('clay_garden_last_sync') || '0');

// Infinite Canvas State
let isDraggingNode = false;
let dragNode = null;
let dragOffset = { x: 0, y: 0 };
let hasMovedNode = false; 
let linkingMode = false;
let linkSourceId = null;
let activeNodeId = null;
let currentTransform = d3.zoomIdentity;

// Initialize Lucide icons
lucide.createIcons();

// Elements
const fab = document.getElementById('fab');
const createModal = document.getElementById('create-modal');
const modalTitle = document.getElementById('modal-title');
const editIdInput = document.getElementById('edit-id');
const saveNodeBtn = document.getElementById('save-node');
const syncBtn = document.getElementById('sync-btn');
const writingArea = document.getElementById('writing-area');
const timeSpentInput = document.getElementById('time-spent');
const nodeColorInput = document.getElementById('node-color');
const summaryInput = document.getElementById('summary');
const linkLayer = document.getElementById('link-layer');
const viewportContent = document.getElementById('viewport-content');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// --- Infinite Canvas Setup (D3 Zoom) ---
const zoom = d3.zoom()
    .scaleExtent([0.1, 5])
    .on('zoom', (event) => {
        currentTransform = event.transform;
        viewportContent.style.transform = `translate(${currentTransform.x}px, ${currentTransform.y}px) scale(${currentTransform.k})`;
    });

d3.select('#viewport').call(zoom);

// --- Google Auth (GIS) ---
function initGIS() {
    if (typeof google === 'undefined' || !google.accounts) {
        setTimeout(initGIS, 100);
        return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        ux_mode: 'popup',
        callback: async (resp) => {
            if (resp.error) {
                setSyncStatus('error');
                return;
            }
            accessToken = resp.access_token;
            await performSync();
        },
    });
}

window.onload = () => {
    initGIS();
    renderAll();
};

function renderAll() {
    renderAllNodes();
    updateLinks();
    renderAnalytics();
    renderHistoryTable();
}

// --- Analytics, History, etc. ---
function renderAnalytics() {
    renderPowerWords();
    renderWPMChart();
}

function renderPowerWords() {
    const list = document.getElementById('power-words-list');
    list.innerHTML = '';
    const freqMap = {};
    nodes.forEach(node => {
        const words = node.text.toLowerCase().match(/\b\w+\b/g) || [];
        words.forEach(word => {
            if (word.length > 3 && !STOP_WORDS.has(word)) freqMap[word] = (freqMap[word] || 0) + 1;
        });
    });
    const topWords = Object.entries(freqMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
    topWords.forEach(([word, count]) => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center bg-violet-50/50 px-4 py-2 rounded-xl border border-violet-100/50';
        div.innerHTML = `<span class="text-clay-text font-medium">${word}</span><span class="bg-violet-100 text-violet-600 px-2 py-0.5 rounded-lg text-xs font-black">${count}</span>`;
        list.appendChild(div);
    });
}

function renderWPMChart() {
    const canvas = document.getElementById('wpm-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const last7 = nodes.slice(-7);
    const wpmData = last7.map(n => (n.text.trim().split(/\s+/).length) / (parseFloat(n.timeSpent) || 1));
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const width = rect.width; const height = rect.height;
    const padding = 20; const barWidth = (width - padding * 2) / 7 - 10;
    const maxWpm = Math.max(...wpmData, 50);
    ctx.clearRect(0, 0, width, height);
    wpmData.forEach((wpm, i) => {
        const barHeight = (wpm / maxWpm) * (height - padding * 2);
        const x = padding + i * (barWidth + 10);
        const y = height - padding - barHeight;
        const grad = ctx.createLinearGradient(x, y, x, y + barHeight);
        grad.addColorStop(0, '#A78BFA'); grad.addColorStop(1, '#7C3AED');
        ctx.fillStyle = grad; ctx.beginPath(); ctx.roundRect(x, y, barWidth, barHeight, 8); ctx.fill();
        ctx.fillStyle = '#635F69'; ctx.font = 'bold 10px Nunito'; ctx.textAlign = 'center';
        ctx.fillText(Math.round(wpm), x + barWidth / 2, y - 5);
    });
}

function renderHistoryTable() {
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = '';
    nodes.slice().reverse().forEach(node => {
        const date = new Date(node.timestamp).toLocaleDateString();
        const wordCount = node.text.trim().split(/\s+/).length;
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-violet-50/30 transition-colors group';
        tr.innerHTML = `<td class="py-4 pl-2"><input type="checkbox" class="node-checkbox rounded border-violet-200" data-id="${node.id}"></td><td class="py-4 text-sm font-bold text-clay-text">${date}</td><td class="py-4 text-sm text-clay-muted truncate max-w-[200px]">${node.summary}</td><td class="py-4 text-right pr-2 text-sm font-black text-violet-600">${wordCount}</td>`;
        tbody.appendChild(tr);
    });
}

document.getElementById('select-all').addEventListener('change', (e) => {
    document.querySelectorAll('.node-checkbox').forEach(cb => cb.checked = e.target.checked);
});

document.getElementById('export-btn').addEventListener('click', () => {
    const selectedIds = Array.from(document.querySelectorAll('.node-checkbox:checked')).map(cb => cb.dataset.id);
    if (selectedIds.length === 0) return alert('Select some entries to export.');
    const selectedNodes = nodes.filter(n => selectedIds.includes(n.id));
    let markdown = '';
    selectedNodes.forEach(node => {
        const date = new Date(node.timestamp).toLocaleDateString();
        markdown += `# ${date} - ${node.summary}\n\n${node.text}\n\n---\n\n`;
    });
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `clay_garden_export_${Date.now()}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
});

function getKeywords(text) {
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    return new Set(words.filter(w => w.length > 2 && !STOP_WORDS.has(w)));
}

function calculateJaccard(setA, setB) {
    if (setA.size === 0 || setB.size === 0) return 0;
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
}

function saveToLocal() {
    localStorage.setItem('clay_garden_nodes', JSON.stringify(nodes));
}

function setSyncStatus(state) {
    const colors = { idle: '#cbd5e1', syncing: '#38bdf8', synced: '#22c55e', error: '#ef4444' };
    statusDot.style.backgroundColor = colors[state];
    statusText.innerText = state.charAt(0).toUpperCase() + state.slice(1);
    if (state === 'syncing') gsap.to(statusDot, { scale: 1.5, repeat: -1, yoyo: true, duration: 0.5 });
    else { gsap.killTweensOf(statusDot); gsap.to(statusDot, { scale: 1, duration: 0.3, ease: "bounce.out" }); }
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    const content = modal.querySelector('div[id$="content"]');
    modal.classList.remove('hidden');
    gsap.to(content, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out(1.7)" });
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    const content = modal.querySelector('div[id$="content"]');
    gsap.to(content, { scale: 0.95, opacity: 0, duration: 0.2, onComplete: () => {
        modal.classList.add('hidden');
        lucide.createIcons();
    }});
}

window.closeModal = closeModal;

// --- Node Management ---
function renderAllNodes() {
    viewportContent.querySelectorAll('.clay-node').forEach(n => n.remove());
    nodes.forEach(data => createNodeVisual(data, true));
}

fab.addEventListener('click', () => {
    modalTitle.innerText = "Sculpt Node";
    editIdInput.value = ""; writingArea.value = ""; timeSpentInput.value = "";
    nodeColorInput.value = "#7C3AED"; summaryInput.value = "";
    activeNodeId = null; openModal('create-modal');
});

saveNodeBtn.addEventListener('click', () => {
    const id = editIdInput.value || Date.now().toString();
    const existing = nodes.find(n => n.id === id);
    const data = {
        id: id, text: writingArea.value, timeSpent: timeSpentInput.value, color: nodeColorInput.value,
        summary: summaryInput.value || "Untitled Node", timestamp: Date.now(),
        keywords: Array.from(getKeywords(writingArea.value)),
        manualLinks: existing ? (existing.manualLinks || []) : [],
        x: existing ? existing.x : ((-currentTransform.x + window.innerWidth/2) / currentTransform.k),
        y: existing ? existing.y : ((-currentTransform.y + window.innerHeight/2) / currentTransform.k)
    };
    if (!data.text) return;
    if (existing) Object.assign(existing, data); else nodes.push(data);
    saveToLocal(); renderAll(); closeModal('create-modal');
});

document.getElementById('edit-node').addEventListener('click', () => {
    if (activeNodeId) {
        const data = nodes.find(n => n.id === activeNodeId);
        if (data) {
            modalTitle.innerText = "Edit Node";
            editIdInput.value = data.id;
            writingArea.value = data.text;
            timeSpentInput.value = data.timeSpent;
            nodeColorInput.value = data.color || "#7C3AED";
            summaryInput.value = data.summary;
            closeModal('view-modal');
            openModal('create-modal');
        }
    }
});

document.getElementById('delete-node').addEventListener('click', () => {
    if (activeNodeId) {
        nodes = nodes.filter(n => n.id !== activeNodeId);
        nodes.forEach(n => {
            if (n.manualLinks) n.manualLinks = n.manualLinks.filter(id => id !== activeNodeId);
        });
        saveToLocal(); renderAll(); closeModal('view-modal');
        activeNodeId = null;
    }
});

document.getElementById('link-node').addEventListener('click', () => {
    if (activeNodeId) {
        linkingMode = true; linkSourceId = activeNodeId; closeModal('view-modal');
        statusText.innerText = "Select Target..."; statusDot.style.backgroundColor = "#3b82f6";
    }
});

document.getElementById('reset-app-btn').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all local data? This will not delete your Drive data.')) {
        localStorage.clear();
        location.reload();
    }
});

function createNodeVisual(data, isInitial = false) {
    const node = document.createElement('div');
    node.className = 'clay-node';
    node.dataset.id = data.id;
    node.style.left = `${data.x}px`;
    node.style.top = `${data.y}px`;
    node.style.background = data.color || '#7C3AED';
    const wordCount = data.text.trim().split(/\s+/).length;
    const size = Math.min(Math.max(wordCount / 5 + 32, 32), 80);
    node.style.width = `${size}px`; node.style.height = `${size}px`;
    
    node.addEventListener('mousedown', (e) => {
        if (linkingMode) { handleLinking(data.id); return; }
        e.stopPropagation(); // Stop D3 zoom from triggering
        isDraggingNode = true;
        hasMovedNode = false;
        dragNode = node;
        const rect = node.getBoundingClientRect();
        dragOffset.x = (e.clientX - rect.left) / currentTransform.k;
        dragOffset.y = (e.clientY - rect.top) / currentTransform.k;
        node.style.cursor = 'grabbing';
    });

    node.addEventListener('click', (e) => {
        if (hasMovedNode || linkingMode) return;
        activeNodeId = data.id;
        document.getElementById('view-summary').innerText = data.summary;
        document.getElementById('view-content').innerText = data.text;
        openModal('view-modal');
    });

    viewportContent.appendChild(node);
    if (!isInitial) gsap.from(node, { scale: 0, duration: 0.5, ease: "elastic.out(1, 0.5)" });
}

// --- Dragging Engine ---
document.addEventListener('mousemove', (e) => {
    if (isDraggingNode && dragNode) {
        hasMovedNode = true;
        const x = (e.clientX - currentTransform.x) / currentTransform.k - dragOffset.x;
        const y = (e.clientY - currentTransform.y) / currentTransform.k - dragOffset.y;
        dragNode.style.left = `${x}px`;
        dragNode.style.top = `${y}px`;
        updateLinks();
    }
});

document.addEventListener('mouseup', () => {
    if (isDraggingNode && dragNode) {
        const id = dragNode.dataset.id;
        const data = nodes.find(n => n.id === id);
        if (data) {
            data.x = parseFloat(dragNode.style.left);
            data.y = parseFloat(dragNode.style.top);
            saveToLocal();
        }
        dragNode.style.cursor = 'grab';
        isDraggingNode = false;
        dragNode = null;
    }
});

function handleLinking(targetId) {
    if (linkSourceId === targetId) return;
    const source = nodes.find(n => n.id === linkSourceId);
    if (!source.manualLinks) source.manualLinks = [];
    if (!source.manualLinks.includes(targetId)) source.manualLinks.push(targetId);
    else source.manualLinks = source.manualLinks.filter(id => id !== targetId);
    linkingMode = false; linkSourceId = null; setSyncStatus('idle'); saveToLocal(); updateLinks();
}

function updateLinks() {
    linkLayer.innerHTML = '';
    const map = new Map();
    viewportContent.querySelectorAll('.clay-node').forEach(el => {
        const rect = el.getBoundingClientRect();
        const centerX = (rect.left - currentTransform.x + rect.width / 2) / currentTransform.k;
        const centerY = (rect.top - currentTransform.y + rect.height / 2) / currentTransform.k;
        map.set(el.dataset.id, { x: centerX, y: centerY });
    });

    nodes.forEach((source, i) => {
        if (source.manualLinks) {
            source.manualLinks.forEach(tid => {
                const pA = map.get(source.id); const pB = map.get(tid);
                if (pA && pB) drawLink(pA, pB, source.color, true);
            });
        }
        for (let j = i + 1; j < nodes.length; j++) {
            const target = nodes[j];
            if (calculateJaccard(new Set(source.keywords), new Set(target.keywords)) > 0.15) {
                const pA = map.get(source.id); const pB = map.get(target.id);
                if (pA && pB) drawLink(pA, pB, '#38bdf8', false);
            }
        }
    });
}

function drawLink(p1, p2, color, isManual) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", p1.x); line.setAttribute("y1", p1.y);
    line.setAttribute("x2", p2.x); line.setAttribute("y2", p2.y);
    line.setAttribute("stroke", color || "#7C3AED");
    line.setAttribute("stroke-width", isManual ? "3" : "1.5");
    line.setAttribute("stroke-opacity", isManual ? "0.6" : "0.2");
    if (!isManual) line.setAttribute("stroke-dasharray", "4 4");
    linkLayer.appendChild(line);
}

window.addEventListener('resize', updateLinks);

// --- Sync Logic ---
syncBtn.addEventListener('click', () => {
    if (!tokenClient) return alert('Auth loading...');
    setSyncStatus('syncing');
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
});

async function performSync() {
    const filename = 'writing_data.json';
    const headers = { Authorization: `Bearer ${accessToken}` };
    try {
        const listResp = await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${filename}'&fields=files(id,modifiedTime)`, { headers });
        const listData = await listResp.json();
        const fileId = listData.files.length > 0 ? listData.files[0].id : null;
        const driveModifiedTime = fileId ? new Date(listData.files[0].modifiedTime).getTime() : 0;

        // Pull newer data
        if (fileId && driveModifiedTime > lastSyncTimestamp + 5000) {
            if (confirm('Drive has a newer version. Overwrite local data with Drive data?')) {
                const getResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers });
                const remoteNodes = await getResp.json();
                if (Array.isArray(remoteNodes)) {
                    nodes = remoteNodes;
                    localStorage.setItem('clay_garden_nodes', JSON.stringify(nodes));
                    localStorage.setItem('clay_garden_last_sync', driveModifiedTime.toString());
                    alert('Data pulled successfully!'); 
                    location.reload(); 
                    return;
                }
            }
        }

        // Push local data
        const boundary = 'foo_bar_baz';
        const metadata = { name: filename, parents: ['appDataFolder'] };
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
                     `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(nodes)}\r\n` +
                     `--${boundary}--`;
        
        const url = fileId ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart` : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
        const uploadResp = await fetch(url, {
            method: fileId ? 'PATCH' : 'POST',
            headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` },
            body: body
        });

        if (uploadResp.ok) {
            const updateInfo = await uploadResp.json();
            // Important: Use the actual modified time from the server response
            const finalModifiedTime = updateInfo.modifiedTime ? new Date(updateInfo.modifiedTime).getTime() : Date.now();
            lastSyncTimestamp = finalModifiedTime;
            localStorage.setItem('clay_garden_last_sync', lastSyncTimestamp.toString());
            setSyncStatus('synced'); 
            setTimeout(() => setSyncStatus('idle'), 3000);
        }
    } catch (e) { console.error(e); setSyncStatus('error'); }
}

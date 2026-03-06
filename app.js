/**
 * Counter App - Volledig Script
 * Inclusief: Swipe-bediening, CSV Export, Dashboard-tijdlijn & Animaties
 */

const dbName = 'CounterAppDB';
let db;
let currentSort = localStorage.getItem('sortMethod') || 'manual';
let isCompactMode = localStorage.getItem('compactMode') === 'true';
let currentTimeframe = localStorage.getItem('timeframe') || 'V';
let currentTab = 'Favorites'; 

const presetColors = ['#FADCD9', '#F8E2CF', '#F5EECC', '#C9E4DE', '#C6DEF1', '#DBCDF0', '#F2C6DE', '#F7D9C4', '#E2E2E2', '#C1E1C1', '#F0E6EF', '#E2D1F9'];
let selectedModalColor = presetColors[0];
let editingCardId = null;

let chartInstance = null;
let selectedDashboardCards = [];

// Swipe variabelen
let touchstartX = 0;
let touchendX = 0;

// --- 1. DATABASE ---
const initDB = () => {
    return new Promise((resolve) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('events')) {
                const eventStore = db.createObjectStore('events', { keyPath: 'id' });
                eventStore.createIndex('cardId', 'cardId', { unique: false });
            }
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(); };
    });
};

const getAllFromStore = (storeName) => {
    return new Promise((resolve) => {
        const trans = db.transaction([storeName], 'readonly');
        const req = trans.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
    });
};

const saveCard = (card) => {
    return new Promise((resolve) => {
        const store = db.transaction(['cards'], 'readwrite').objectStore('cards');
        store.put(card).onsuccess = () => resolve();
    });
};

const saveEventStore = (event) => {
    return new Promise((resolve) => {
        const store = db.transaction(['events'], 'readwrite').objectStore('events');
        store.put(event).onsuccess = () => resolve();
    });
};

const deleteEventFromDB = (id) => {
    return new Promise((resolve) => {
        const store = db.transaction(['events'], 'readwrite').objectStore('events');
        store.delete(id).onsuccess = () => resolve();
    });
};

// --- 2. CSV EXPORT ---
const exportToCSV = async () => {
    const cards = await getAllFromStore('cards');
    const events = await getAllFromStore('events');
    
    if (events.length === 0) {
        alert("Geen gegevens om te exporteren.");
        return;
    }

    let csv = 'Datum;Tijd;Kaart;Delta\n';
    events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    events.forEach(ev => {
        const card = cards.find(c => c.id === ev.cardId);
        const cardName = card ? card.name : 'Verwijderde Kaart';
        const dateObj = new Date(ev.timestamp);
        const date = dateObj.toLocaleDateString('nl-NL');
        const time = dateObj.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
        csv += `${date};${time};${cardName};${ev.delta}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `counter_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// --- 3. CLICK EVENTS ---
window.addEv = async (id, delta) => {
    const event = { id: crypto.randomUUID(), cardId: id, timestamp: new Date().toISOString(), delta: delta };
    await saveEventStore(event);
    renderCards();
    if(currentTab === 'Dashboard') renderDashboard();
};

window.updateEventTimestamp = async (eventId, newLocalTime) => {
    const events = await getAllFromStore('events');
    const event = events.find(e => e.id === eventId);
    if (event) {
        event.timestamp = new Date(newLocalTime).toISOString();
        await saveEventStore(event);
        renderCards(); 
        if(currentTab === 'Dashboard') renderDashboard();
    }
};

window.removeEvent = async (eventId) => {
    await deleteEventFromDB(eventId);
    if (editingCardId) renderEventHistory(editingCardId); 
    renderCards(); 
    if(currentTab === 'Dashboard') renderDashboard();
};

// --- 4. RENDERING KAARTEN ---
const renderCards = async () => {
    const containerElement = document.getElementById('cardContainer');
    const allCards = await getAllFromStore('cards');
    const events = await getAllFromStore('events');
    
    const isArchiveTab = currentTab === 'Archive';
    const cards = allCards.filter(c => !c.deleted && (isArchiveTab ? c.archived : !c.archived));
    const periods = getPeriods();
    const stats = {};
    
    cards.forEach(c => stats[c.id] = { val: 0, total: 0, last: null });

    events.forEach(ev => {
        if (!stats[ev.cardId]) return;
        const time = new Date(ev.timestamp).getTime();
        stats[ev.cardId].total += ev.delta;
        if (time >= periods[currentTimeframe.toLowerCase()]) stats[ev.cardId].val += ev.delta;
        if (!stats[ev.cardId].last || time > new Date(stats[ev.cardId].last).getTime()) stats[ev.cardId].last = ev.timestamp;
    });

    const list = cards.map(c => ({
        ...c, display: (c.startValue || 0) + stats[c.id].val,
        total: (c.startValue || 0) + stats[c.id].total, last: stats[c.id].last
    }));

    if (currentSort === 'alphabetical') list.sort((a,b) => a.name.localeCompare(b.name));
    else if (currentSort === 'highest') list.sort((a,b) => b.display - a.display);
    else list.sort((a,b) => (a.orderIndex || 0) - (b.orderIndex || 0));

    containerElement.innerHTML = '';
    list.forEach(card => {
        const div = document.createElement('div');
        div.className = 'card'; div.style.backgroundColor = card.color; div.dataset.id = card.id;
        const fDate = card.last ? new Date(card.last).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Geen clicks';
        
        div.innerHTML = `
            <div class="drag-handle" style="display: ${currentSort==='manual'?'block':'none'}">☰</div>
            <button class="counter-btn" onclick="addEv('${card.id}', -${card.stepValue || 1})">-</button>
            <div class="card-center">
                <div onclick="openEditModal('${card.id}')" style="cursor:pointer">
                    <span class="card-title">${card.name} ✏️</span>
                </div>
                <div class="card-count">${card.display}</div>
                <span class="card-datetime">${fDate}</span>
            </div>
            <button class="counter-btn" onclick="addEv('${card.id}', ${card.stepValue || 1})">+</button>
            <div class="card-total">Totaal: ${card.total}</div>
        `;
        containerElement.appendChild(div);
    });
};

// --- 5. DASHBOARD ---
const parseInputDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
};

window.handlePresetChange = (val) => {
    const customDiv = document.getElementById('customDateRange');
    const now = new Date();
    let start = new Date(); let end = new Date();
    customDiv.classList.add('hidden');

    if (val === 'today') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (val === '14d') start.setDate(now.getDate() - 14);
    else if (val === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (val === '3m') start.setMonth(now.getMonth() - 3);
    else if (val === '6m') start.setMonth(now.getMonth() - 6);
    else if (val === '1y') start.setFullYear(now.getFullYear() - 1);
    else if (val === 'custom') { customDiv.classList.remove('hidden'); return; }

    const toStr = (d) => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
    document.getElementById('dashStart').value = toStr(start);
    document.getElementById('dashEnd').value = toStr(end);
    renderDashboard();
};

const renderDashboard = async () => {
    const allCards = await getAllFromStore('cards');
    const events = await getAllFromStore('events');
    const activeCards = allCards.filter(c => !c.deleted);
    const startStr = document.getElementById('dashStart').value;
    const endStr = document.getElementById('dashEnd').value;
    const startDate = parseInputDate(startStr);
    const endDate = parseInputDate(endStr);
    endDate.setHours(23, 59, 59, 999);
    const isSingleDay = startStr === endStr;

    if (selectedDashboardCards.length === 0 && activeCards.length > 0) {
        selectedDashboardCards = activeCards.slice(0, 5).map(c => c.id);
    }

    const filtersDiv = document.getElementById('dashboardFilters');
    filtersDiv.innerHTML = '';
    activeCards.forEach(card => {
        const chip = document.createElement('div');
        const isActive = selectedDashboardCards.includes(card.id);
        chip.className = `filter-chip ${isActive ? 'active' : ''}`;
        chip.style.backgroundColor = card.color; chip.textContent = card.name;
        chip.onclick = () => {
            isActive ? selectedDashboardCards = selectedDashboardCards.filter(id => id !== card.id) : selectedDashboardCards.push(card.id);
            renderDashboard();
        };
        filtersDiv.appendChild(chip);
    });

    const labels = []; const dataByCard = {};
    selectedDashboardCards.forEach(id => dataByCard[id] = []);

    if (isSingleDay) {
        for (let h = 0; h < 24; h++) {
            labels.push(`${h.toString().padStart(2, '0')}:00`);
            selectedDashboardCards.forEach(id => {
                const hourTotal = events.filter(e => {
                    const et = new Date(e.timestamp);
                    return e.cardId === id && et.getFullYear() === startDate.getFullYear() && et.getMonth() === startDate.getMonth() && et.getDate() === startDate.getDate() && et.getHours() === h;
                }).reduce((sum, e) => sum + e.delta, 0);
                dataByCard[id].push(hourTotal);
            });
        }
    } else {
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            labels.push(d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' }));
            selectedDashboardCards.forEach(id => {
                const dayTotal = events.filter(e => e.cardId === id && new Date(e.timestamp).toDateString() === d.toDateString()).reduce((sum, e) => sum + e.delta, 0);
                dataByCard[id].push(dayTotal);
            });
        }
    }

    const datasets = selectedDashboardCards.map(id => {
        const card = activeCards.find(c => c.id === id);
        return {
            label: card.name, data: dataByCard[id], borderColor: (card.color === '#E2E2E2' || card.color === '#F5EECC') ? '#999' : card.color,
            backgroundColor: card.color, tension: 0.4, borderWidth: 3, pointRadius: labels.length > 60 ? 0 : 4, pointBackgroundColor: '#fff'
        };
    });

    const ctx = document.getElementById('myChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line', data: { labels, datasets },
        options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' }, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
};

function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
}

// --- 6. TAB LOGICA & SWIPE ---
const switchTab = (newTab) => {
    if (currentTab === newTab) return;
    const tabsOrder = ['Archive', 'Favorites', 'Dashboard'];
    const goingRight = tabsOrder.indexOf(newTab) > tabsOrder.indexOf(currentTab);
    const mainContent = document.getElementById('mainContent');
    const oldContainer = getContainer(currentTab);
    const newContainer = getContainer(newTab);
    
    const clone = oldContainer.cloneNode(true);
    clone.id = ''; clone.classList.add('card-container-clone');
    mainContent.appendChild(clone);
    clone.classList.add(goingRight ? 'slide-out-to-left' : 'slide-out-to-right');
    
    currentTab = newTab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(newTab.toLowerCase() + 'Tab').classList.add('active');
    
    oldContainer.classList.add('hidden-tab');
    newContainer.classList.remove('hidden-tab');
    document.querySelector('.controls').style.display = newTab === 'Dashboard' ? 'none' : 'flex';

    if (newTab === 'Dashboard') {
        if (!document.getElementById('dashStart').value) handlePresetChange('14d');
        else renderDashboard();
    } else renderCards();
    
    newContainer.classList.add(goingRight ? 'slide-in-from-right' : 'slide-in-from-left');
    setTimeout(() => { clone.remove(); newContainer.classList.remove('slide-in-from-right', 'slide-in-from-left'); }, 350);
};

const handleGesture = () => {
    const tabsOrder = ['Archive', 'Favorites', 'Dashboard'];
    const currentIndex = tabsOrder.indexOf(currentTab);
    const threshold = 50; // Hoeveel pixels moet je vegen?

    if (touchendX < touchstartX - threshold) {
        // Swipe naar links -> Volgende tab
        if (currentIndex < tabsOrder.length - 1) switchTab(tabsOrder[currentIndex + 1]);
    }
    if (touchendX > touchstartX + threshold) {
        // Swipe naar rechts -> Vorige tab
        if (currentIndex > 0) switchTab(tabsOrder[currentIndex - 1]);
    }
};

const getContainer = (tab) => tab === 'Dashboard' ? document.getElementById('dashboardContainer') : document.getElementById('cardContainer');

// --- 7. MODALS & HELPERS ---
const toLocalDatetime = (isoString) => {
    const date = new Date(isoString);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const renderEventHistory = async (cardId) => {
    let container = document.getElementById('eventHistoryContainer');
    if (!container) {
        container = document.createElement('div'); container.id = 'eventHistoryContainer';
        const editActions = document.getElementById('editActionsArea');
        editActions.parentNode.insertBefore(container, editActions);
    }
    const events = await getAllFromStore('events');
    const cardEvents = events.filter(e => e.cardId === cardId).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    let html = `<label style="display:block; font-size:0.8rem; font-weight:bold; margin-bottom:0.4rem; color:#777;">Klik Historie</label>`;
    if (cardEvents.length === 0) html += `<div style="font-size:0.85rem; color:#999; margin-bottom: 1.5rem;">Geen data.</div>`;
    else {
        html += `<div class="event-history-list">`;
        cardEvents.forEach(ev => {
            html += `<div class="event-row"><span class="event-delta ${ev.delta > 0 ? 'pos' : 'neg'}">${ev.delta > 0 ? '+'+ev.delta : ev.delta}</span>
            <input type="datetime-local" class="event-time-input" value="${toLocalDatetime(ev.timestamp)}" onchange="updateEventTimestamp('${ev.id}', this.value)">
            <button type="button" class="event-delete-btn" onclick="removeEvent('${ev.id}')">🗑️</button></div>`;
        });
        html += `</div>`;
    }
    container.innerHTML = html;
};

window.openEditModal = async (id) => {
    editingCardId = id;
    const cards = await getAllFromStore('cards');
    const card = cards.find(c => c.id === id);
    document.getElementById('cardTitleInput').value = card.name;
    document.getElementById('cardStartInput').value = card.startValue || 0;
    document.getElementById('cardStepInput').value = card.stepValue || 1;
    selectedModalColor = card.color;
    document.getElementById('archiveCardBtn').textContent = card.archived ? 'Herstel naar Fav' : 'Archiveer';
    document.getElementById('editActionsArea').classList.remove('hidden');
    updateColorSelection(); renderEventHistory(id);
    document.getElementById('newCardModal').classList.remove('hidden');
};

const setupModals = () => {
    const mainModal = document.getElementById('newCardModal');
    document.getElementById('openModalBtn').onclick = () => {
        editingCardId = null; document.getElementById('cardTitleInput').value = '';
        document.getElementById('cardStartInput').value = 0; document.getElementById('cardStepInput').value = 1;
        document.getElementById('editActionsArea').classList.add('hidden');
        if (document.getElementById('eventHistoryContainer')) document.getElementById('eventHistoryContainer').innerHTML = '';
        mainModal.classList.remove('hidden');
    };
    document.getElementById('saveCardBtn').onclick = async () => {
        const name = document.getElementById('cardTitleInput').value.trim();
        if (!name) return;
        let card;
        if (editingCardId) {
            const all = await getAllFromStore('cards'); card = all.find(c => c.id === editingCardId);
            card.name = name; card.color = selectedModalColor;
            card.startValue = parseFloat(document.getElementById('cardStartInput').value);
            card.stepValue = parseFloat(document.getElementById('cardStepInput').value);
        } else {
            card = { id: crypto.randomUUID(), name, color: selectedModalColor, startValue: parseFloat(document.getElementById('cardStartInput').value), stepValue: parseFloat(document.getElementById('cardStepInput').value), archived: false, deleted: false, orderIndex: Date.now() };
        }
        await saveCard(card); mainModal.classList.add('hidden'); renderCards();
    };
    document.getElementById('archiveCardBtn').onclick = async () => {
        const all = await getAllFromStore('cards'); const card = all.find(c => c.id === editingCardId);
        card.archived = !card.archived; await saveCard(card); mainModal.classList.add('hidden'); renderCards();
    };
    document.getElementById('deleteCardBtn').onclick = () => document.getElementById('confirmDeleteModal').classList.remove('hidden');
    document.getElementById('confirmDeleteBtn').onclick = async () => {
        const all = await getAllFromStore('cards'); const card = all.find(c => c.id === editingCardId);
        if (card) { card.deleted = true; await saveCard(card); }
        document.getElementById('confirmDeleteModal').classList.add('hidden'); mainModal.classList.add('hidden'); renderCards();
    };
    document.getElementById('cancelModalBtn').onclick = () => mainModal.classList.add('hidden');
    document.getElementById('cancelDeleteBtn').onclick = () => document.getElementById('confirmDeleteModal').classList.add('hidden');
};

const getPeriods = () => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const u = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
    const w = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay()||7) + 1).getTime();
    const m = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const j = new Date(now.getFullYear(), 0, 1).getTime();
    return { u, v: d, w, m, j };
};

const updateColorSelection = () => {
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === selectedModalColor));
};

// --- 8. START APP ---
initDB().then(() => {
    setupModals();
    
    // Swipe Listeners
    document.addEventListener('touchstart', e => { touchstartX = e.changedTouches[0].screenX; }, false);
    document.addEventListener('touchend', e => { touchendX = e.changedTouches[0].screenX; handleGesture(); }, false);

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.onclick = exportToCSV;

    document.getElementById('archiveTab').onclick = () => switchTab('Archive');
    document.getElementById('favoritesTab').onclick = () => switchTab('Favorites');
    document.getElementById('dashboardTab').onclick = () => switchTab('Dashboard');
    const picker = document.getElementById('colorPicker');
    presetColors.forEach(col => {
        const s = document.createElement('div'); s.className = 'color-swatch'; s.style.backgroundColor = col; s.dataset.color = col;
        s.onclick = () => { selectedModalColor = col; updateColorSelection(); }; picker.appendChild(s);
    });
    const compactBtn = document.getElementById('compactBtn');
    compactBtn.onclick = () => {
        isCompactMode = !isCompactMode; localStorage.setItem('compactMode', isCompactMode);
        document.body.classList.toggle('compact-mode', isCompactMode); compactBtn.classList.toggle('active', isCompactMode);
    };
    if (isCompactMode) { document.body.classList.add('compact-mode'); compactBtn.classList.add('active'); }
    const tfBtn = document.getElementById('timeframeBtn');
    const tfMenu = document.getElementById('timeframeMenu');
    tfBtn.textContent = `[${currentTimeframe}]`;
    tfBtn.onclick = (e) => { e.stopPropagation(); tfMenu.classList.toggle('hidden'); };
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.onclick = () => {
            currentTimeframe = item.dataset.val; localStorage.setItem('timeframe', currentTimeframe);
            tfBtn.textContent = `[${currentTimeframe}]`; tfMenu.classList.add('hidden'); renderCards();
        };
    });
    window.onclick = () => tfMenu.classList.add('hidden');
    document.getElementById('sortSelect').onchange = (e) => {
        currentSort = e.target.value; localStorage.setItem('sortMethod', currentSort); renderCards();
    };
    renderCards();
    new Sortable(document.getElementById('cardContainer'), {
        handle: '.drag-handle', animation: 150,
        onEnd: async () => {
            const items = Array.from(document.getElementById('cardContainer').children);
            const cards = await getAllFromStore('cards');
            for(let i=0; i<items.length; i++) {
                const card = cards.find(c => c.id === items[i].dataset.id);
                if (card) { card.orderIndex = i; await saveCard(card); }
            }
        }
    });
});

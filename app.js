/**
 * Counter App - Volledig en Werkend
 */

const dbName = 'CounterAppDB';
let db;
let currentSort = localStorage.getItem('sortMethod') || 'manual';
let isCompactMode = localStorage.getItem('compactMode') === 'true';
let currentTimeframe = localStorage.getItem('timeframe') || 'V';
let currentTab = 'Favorites';
let searchQuery = '';

const presetColors = ['#FADCD9', '#F8E2CF', '#F5EECC', '#C9E4DE', '#C6DEF1', '#DBCDF0', '#F2C6DE', '#F7D9C4', '#E2E2E2', '#C1E1C1', '#F0E6EF', '#E2D1F9'];
let selectedModalColor = presetColors[0];
let editingCardId = null;

let chartInstance = null;
let selectedDashboardCards = [];

// Nieuwe variabelen voor Maaltijden en Swipe
let mealsList = [];
let activeMealCardId = null;
let touchstartX = 0;
let touchendX = 0;

// Poep / Bristol variabelen
let activePoepCardId = null;
let selectedBristolType = 4; // Standaard type 4

const bristolTypes = [
    { type: 1, emoji: '🪨', label: 'Harde\nkeutels',  color: '#8B4513' },
    { type: 2, emoji: '🌰', label: 'Worst\nklonterig', color: '#A0522D' },
    { type: 3, emoji: '🌭', label: 'Worst\ngebarsten', color: '#CD853F' },
    { type: 4, emoji: '🐍', label: 'Slang\nglad',     color: '#8B6914' },
    { type: 5, emoji: '🫘', label: 'Zachte\nstukjes',  color: '#D2691E' },
    { type: 6, emoji: '💩', label: 'Pluizig\nzacht',   color: '#B8860B' },
    { type: 7, emoji: '💧', label: 'Vloei-\nbaar',     color: '#DAA520' },
];

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

// --- 2. CSV MAALTIJDEN INLEZEN ---
const loadMealsFromCSV = async () => {
    try {
        const response = await fetch('Maaltijden - Blad1.csv');
        const text = await response.text();
        const rows = text.split('\n').map(row => row.split(','));
        // Pak de namen uit de eerste kolom (negeer de titel-rij)
        const names = [...new Set(rows.slice(1).map(r => r[0]?.trim().replace(/^"|"$/g, '')))].filter(Boolean);
        mealsList = names.sort();

        const select = document.getElementById('mealSelect');
        mealsList.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            select.appendChild(opt);
        });
    } catch (e) {
        console.warn("CSV bestand niet gevonden in map, of kan niet lokaal worden ingelezen zonder server.");
    }
};

// --- 3. CSV EXPORT (Met Notitie Veld + Tab kolom) ---
const exportToCSV = async () => {
    const cards = await getAllFromStore('cards');
    const events = await getAllFromStore('events');
    
    if (events.length === 0) {
        alert("Geen gegevens om te exporteren.");
        return;
    }

    let csv = 'Datum;Tijd;Kaart;Delta;Notitie;Tab\n';
    events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    events.forEach(ev => {
        const card = cards.find(c => c.id === ev.cardId);
        const cardName = card ? card.name : 'Verwijderde Kaart';
        const tab = card ? (card.archived ? 'Archief' : 'Favoriet') : 'Favoriet';
        const dateObj = new Date(ev.timestamp);
        const date = dateObj.toLocaleDateString('nl-NL');
        const time = dateObj.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
        csv += `${date};${time};${cardName};${ev.delta};${ev.note || ''};${tab}\n`;
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

// --- 3b. CSV IMPORT ---
let pendingImportData = null;

const importFromCSV = async (file) => {
    const text = await file.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    if (lines.length < 2) { showImportResult('❌ Bestand is leeg of ongeldig.', []); return; }

    const header = lines[0].toLowerCase();
    if (!header.includes('kaart') || !header.includes('delta')) {
        showImportResult('❌ Ongeldig CSV formaat. Verwacht: Datum;Tijd;Kaart;Delta;Notitie', []); return;
    }

    const hasTabCol = header.includes('tab');
    const allCards = await getAllFromStore('cards');
    const existingNames = new Set(allCards.filter(c => !c.deleted).map(c => c.name.toLowerCase()));
    const newCardsMap = new Map();

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(';');
        if (cols.length < 4) continue;
        const naam = cols[2]?.trim();
        if (!naam) continue;
        const key = naam.toLowerCase();
        if (!existingNames.has(key) && !newCardsMap.has(key)) {
            const tabVal = hasTabCol ? (cols[5]?.trim().toLowerCase() || '') : '';
            newCardsMap.set(key, { naam, archived: tabVal === 'archief' });
        }
    }

    pendingImportData = { lines, newCardsMap, hasTabCol };

    if (newCardsMap.size === 0) {
        executeImport(new Set());
    } else {
        showImportCardPicker(newCardsMap);
    }
};

const showImportCardPicker = (newCardsMap) => {
    document.getElementById('importChoiceArea').classList.remove('hidden');
    document.getElementById('importResultArea').classList.add('hidden');
    const listEl = document.getElementById('importCardList');
    listEl.innerHTML = '';
    newCardsMap.forEach(({ naam, archived }, key) => {
        const label = document.createElement('label');
        label.className = 'import-card-check-label';
        label.innerHTML = `<input type="checkbox" class="import-card-cb" data-key="${key}" checked>
            <span class="import-card-name">${naam}</span>
            <span class="import-card-tab">${archived ? '📦 Archief' : '⭐ Favoriet'}</span>`;
        listEl.appendChild(label);
    });
    document.getElementById('importModal').classList.remove('hidden');
};

const executeImport = async (skipKeys) => {
    const { lines, newCardsMap } = pendingImportData;
    const allCards = await getAllFromStore('cards');
    const allEvents = await getAllFromStore('events');
    const existingEventIds = new Set(allEvents.map(e => e.id));
    const cardMap = {};
    allCards.forEach(c => { if (!c.deleted) cardMap[c.name.toLowerCase()] = c; });

    let newCards = 0, newEvents = 0;
    const skippedLines = [];
    const createdCards = {};
    const seenInFile = {};

    for (let i = 1; i < lines.length; i++) {
        const lineNum = i + 1;
        const cols = lines[i].split(';');
        if (cols.length < 4) { skippedLines.push(`Regel ${lineNum}: te weinig kolommen ("${lines[i]}")`); continue; }

        const [datumStr, tijdStr, kaartNaam, deltaStr, ...rest] = cols;
        const naam = kaartNaam?.trim();
        const delta = parseFloat(deltaStr?.trim());
        const note = rest[0]?.trim() || '';

        if (!naam || isNaN(delta)) { skippedLines.push(`Regel ${lineNum}: ongeldige kaart of delta`); continue; }

        const key = naam.toLowerCase();
        if (skipKeys.has(key)) continue;

        const dateParts = datumStr?.trim().split('-').map(Number);
        const timeParts = tijdStr?.trim().split(':').map(Number);
        let timestamp;
        try {
            if (dateParts.length !== 3 || dateParts.some(isNaN)) throw new Error();
            const [day, month, year] = dateParts;
            const d = new Date(year, month - 1, day, timeParts[0] || 0, timeParts[1] || 0);
            if (isNaN(d.getTime())) throw new Error();
            timestamp = d.toISOString();
        } catch { skippedLines.push(`Regel ${lineNum}: datum onleesbaar ("${datumStr}")`); continue; }

        let card = cardMap[key] || createdCards[key];
        if (!card) {
            const cardInfo = newCardsMap.get(key);
            const color = presetColors[Math.floor(Math.random() * presetColors.length)];
            card = { id: crypto.randomUUID(), name: naam, color, startValue: 0, stepValue: 1,
                archived: cardInfo ? cardInfo.archived : false, deleted: false, orderIndex: Date.now() + i };
            await saveCard(card);
            createdCards[key] = card; cardMap[key] = card; newCards++;
        }

        const baseKey = `imp_${card.id}_${timestamp}_${delta}`;
        if (!seenInFile[baseKey]) seenInFile[baseKey] = 0;
        seenInFile[baseKey]++;
        const eventId = `${baseKey}_${seenInFile[baseKey]}`;

        if (existingEventIds.has(eventId)) { skippedLines.push(`Regel ${lineNum}: al aanwezig (${naam} op ${datumStr} ${tijdStr})`); continue; }

        await saveEventStore({ id: eventId, cardId: card.id, timestamp, delta, note: note || undefined });
        newEvents++;
    }

    const log = [
        newCards > 0 ? `✅ ${newCards} nieuwe kaart${newCards !== 1 ? 'en' : ''} aangemaakt` : '',
        `✅ ${newEvents} event${newEvents !== 1 ? 's' : ''} geïmporteerd`,
        skippedLines.length > 0 ? `<details style="margin-top:0.5rem"><summary style="cursor:pointer;font-weight:700;">⚠️ ${skippedLines.length} overgeslagen — klik voor details</summary><div style="margin-top:0.5rem;font-size:0.8rem;color:#666;line-height:1.8">${skippedLines.map(l => `• ${l}`).join('<br>')}</div></details>` : '',
    ].filter(Boolean);

    showImportResult(null, log);
    renderCards();
};

const showImportResult = (error, logLines) => {
    document.getElementById('importChoiceArea').classList.add('hidden');
    document.getElementById('importResultArea').classList.remove('hidden');
    document.getElementById('importStatus').innerHTML = error
        ? `<span style="color:var(--danger)">${error}</span>`
        : logLines.map(l => `<div>${l}</div>`).join('');
    document.getElementById('importModal').classList.remove('hidden');
};


window.addEv = async (id, delta) => {
    // Als het de poep-kaart is en delta positief, open de poep modal
    if (delta > 0) {
        const cards = await getAllFromStore('cards');
        const card = cards.find(c => c.id === id);
        if (card && card.name.toLowerCase() === 'poep') {
            openPoepModal(id);
            return;
        }
    }
    const event = { id: crypto.randomUUID(), cardId: id, timestamp: new Date().toISOString(), delta: delta };
    await saveEventStore(event);
    if (searchQuery.trim()) {
        renderSearchResults(searchQuery);
    } else {
        renderCards();
    }
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

window.openMealModal = (id) => {
    activeMealCardId = id;
    document.getElementById('mealModal').classList.remove('hidden');
    document.getElementById('customMealInput').value = '';
    document.getElementById('mealSelect').value = '';
};

window.openPoepModal = (id) => {
    activePoepCardId = id;
    selectedBristolType = 4;
    // Checkboxes resetten
    document.getElementById('poepRemsporen').checked = false;
    document.getElementById('poepDrijven').checked = false;
    document.getElementById('poepStinkt').checked = false;
    // Bristol knoppen renderen
    const grid = document.getElementById('bristolGrid');
    grid.innerHTML = '';
    bristolTypes.forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'bristol-btn' + (b.type === 4 ? ' selected' : '');
        btn.style.backgroundColor = b.type === 4 ? b.color + '33' : '#f5f5f5';
        btn.innerHTML = `<span class="b-num">${b.emoji}</span><span class="b-num" style="color:${b.color}">${b.type}</span><span class="b-label">${b.label}</span>`;
        btn.onclick = () => {
            selectedBristolType = b.type;
            document.querySelectorAll('.bristol-btn').forEach(el => {
                el.classList.remove('selected');
                el.style.backgroundColor = '#f5f5f5';
            });
            btn.classList.add('selected');
            btn.style.backgroundColor = b.color + '33';
        };
        grid.appendChild(btn);
    });
    document.getElementById('poepModal').classList.remove('hidden');
};

// --- 5. RENDERING KAARTEN ---
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
    // events is al opgehaald bovenaan renderCards, hergebruik die variabele
    list.forEach(card => {
        const div = document.createElement('div');
        div.className = 'card'; div.style.backgroundColor = card.color; div.dataset.id = card.id;
        const fDate = card.last ? new Date(card.last).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Geen clicks';
        
        // Controleer of deze kaart 'Eten' heet
        let extraBtnHTML = '';
        if (card.name.toLowerCase() === 'eten') {
            extraBtnHTML = `<button class="meal-log-btn" onclick="openMealModal('${card.id}')">🍴 Maaltijd Loggen</button>`;
        }
        // Controleer of deze kaart 'Poep' heet
        if (card.name.toLowerCase() === 'poep') {
            extraBtnHTML = `<button class="meal-log-btn" onclick="openPoepModal('${card.id}')">💩 Poep Loggen</button>`;
            // Laatste poep info tonen — gebruik de al opgehaalde events
            const lastPoepEvent = events.filter(e => e.cardId === card.id && e.note).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
            if (lastPoepEvent) {
                extraBtnHTML += `<span class="poep-card-info">${lastPoepEvent.note}</span>`;
            }
        }

        div.innerHTML = `
            <div class="drag-handle" style="display: ${currentSort==='manual'?'block':'none'}">☰</div>
            <button class="counter-btn" onclick="addEv('${card.id}', -${card.stepValue || 1})">-</button>
            <div class="card-center">
                <div onclick="openEditModal('${card.id}')" style="cursor:pointer">
                    <span class="card-title">${card.name} ✏️</span>
                </div>
                <div class="card-count">${card.display}</div>
                <span class="card-datetime">${fDate}</span>
                ${extraBtnHTML}
            </div>
            <button class="counter-btn" onclick="addEv('${card.id}', ${card.stepValue || 1})">+</button>
            <div class="card-total">Totaal: ${card.total}</div>
        `;
        containerElement.appendChild(div);
    });
};

// --- 5b. ZOEKRESULTATEN ---
const renderSearchResults = async (query) => {
    const containerElement = document.getElementById('searchResultsContainer');
    const allCards = await getAllFromStore('cards');
    const events = await getAllFromStore('events');

    const q = query.toLowerCase().trim();
    // Zoek in zowel Favorieten als Archief (niet verwijderd)
    const matched = allCards.filter(c => !c.deleted && c.name.toLowerCase().includes(q));

    const periods = getPeriods();
    const stats = {};
    matched.forEach(c => stats[c.id] = { val: 0, total: 0, last: null });
    events.forEach(ev => {
        if (!stats[ev.cardId]) return;
        const time = new Date(ev.timestamp).getTime();
        stats[ev.cardId].total += ev.delta;
        if (time >= periods[currentTimeframe.toLowerCase()]) stats[ev.cardId].val += ev.delta;
        if (!stats[ev.cardId].last || time > new Date(stats[ev.cardId].last).getTime()) stats[ev.cardId].last = ev.timestamp;
    });

    const list = matched.map(c => ({
        ...c,
        display: (c.startValue || 0) + stats[c.id].val,
        total: (c.startValue || 0) + stats[c.id].total,
        last: stats[c.id].last
    })).sort((a, b) => a.name.localeCompare(b.name));

    containerElement.innerHTML = '';

    if (list.length === 0) {
        containerElement.innerHTML = `<div style="text-align:center; color:#aaa; padding:2rem; font-weight:600;">Geen kaarten gevonden voor "${query}"</div>`;
        return;
    }

    list.forEach(card => {
        const div = document.createElement('div');
        div.className = 'card'; div.style.backgroundColor = card.color; div.dataset.id = card.id;
        const fDate = card.last ? new Date(card.last).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Geen clicks';
        const sourceBadge = card.archived ? 'Archief' : 'Favoriet';

        let extraBtnHTML = '';
        if (card.name.toLowerCase() === 'eten') {
            extraBtnHTML = `<button class="meal-log-btn" onclick="openMealModal('${card.id}')">🍴 Maaltijd Loggen</button>`;
        }
        if (card.name.toLowerCase() === 'poep') {
            extraBtnHTML = `<button class="meal-log-btn" onclick="openPoepModal('${card.id}')">💩 Poep Loggen</button>`;
            const lastPoepEvent = events.filter(e => e.cardId === card.id && e.note).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
            if (lastPoepEvent) extraBtnHTML += `<span class="poep-card-info">${lastPoepEvent.note}</span>`;
        }

        div.innerHTML = `
            <span class="search-source-badge">${sourceBadge}</span>
            <button class="counter-btn" onclick="addEv('${card.id}', -${card.stepValue || 1})">-</button>
            <div class="card-center">
                <div onclick="openEditModal('${card.id}')" style="cursor:pointer">
                    <span class="card-title">${card.name} ✏️</span>
                </div>
                <div class="card-count">${card.display}</div>
                <span class="card-datetime">${fDate}</span>
                ${extraBtnHTML}
            </div>
            <button class="counter-btn" onclick="addEv('${card.id}', ${card.stepValue || 1})">+</button>
            <div class="card-total">Totaal: ${card.total}</div>
        `;
        containerElement.appendChild(div);
    });
};


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

const switchTab = (newTab) => {
    if (currentTab === newTab) return;
    // Zoekbalk leegmaken bij tab-wissel
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.value) {
        searchInput.value = '';
        searchQuery = '';
        document.getElementById('searchClearBtn').classList.add('hidden');
        document.getElementById('searchResultsContainer').classList.add('hidden-tab');
        document.querySelector('.tabs-container').style.opacity = '';
        document.querySelector('.tabs-container').style.pointerEvents = '';
    }
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

const getContainer = (tab) => tab === 'Dashboard' ? document.getElementById('dashboardContainer') : document.getElementById('cardContainer');

// --- 7. MODALS, SETUP & HELPERS ---
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
            ${ev.note ? `<span style="font-size:0.7rem;color:#666;flex:1;text-align:right;padding-right:4px;" title="${ev.note}">📝</span>` : ''}
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

// --- 8. INITIALISATIE (Opstarten) ---
initDB().then(() => {
    
    // Laad CSV op de achtergrond
    loadMealsFromCSV();

    // Zoekfunctie
    const searchInput = document.getElementById('searchInput');
    const searchClearBtn = document.getElementById('searchClearBtn');
    const searchResultsContainer = document.getElementById('searchResultsContainer');

    const activateSearch = (q) => {
        searchQuery = q;
        const hasQuery = q.trim().length > 0;
        searchClearBtn.classList.toggle('hidden', !hasQuery);

        if (hasQuery) {
            // Verberg tabs + actieve tab inhoud, toon zoekresultaten
            document.querySelector('.tabs-container').style.opacity = '0.4';
            document.querySelector('.tabs-container').style.pointerEvents = 'none';
            document.getElementById('cardContainer').classList.add('hidden-tab');
            document.getElementById('dashboardContainer').classList.add('hidden-tab');
            searchResultsContainer.classList.remove('hidden-tab');
            renderSearchResults(q);
        } else {
            // Herstel normale weergave
            document.querySelector('.tabs-container').style.opacity = '';
            document.querySelector('.tabs-container').style.pointerEvents = '';
            searchResultsContainer.classList.add('hidden-tab');
            if (currentTab !== 'Dashboard') document.getElementById('cardContainer').classList.remove('hidden-tab');
            else document.getElementById('dashboardContainer').classList.remove('hidden-tab');
        }
    };

    searchInput.addEventListener('input', (e) => activateSearch(e.target.value));
    searchClearBtn.onclick = () => {
        searchInput.value = '';
        searchInput.focus();
        activateSearch('');
    };

    // Event Listeners (Knoppen)
    document.getElementById('exportBtn').onclick = exportToCSV;

    // CSV dropdown
    const csvMenuBtn = document.getElementById('csvMenuBtn');
    const csvMenu = document.getElementById('csvMenu');
    csvMenuBtn.onclick = (e) => { e.stopPropagation(); csvMenu.classList.toggle('hidden'); };

    let pendingImportFile = null;

    document.getElementById('csvFileInput').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        e.target.value = '';
        csvMenu.classList.add('hidden');
        importFromCSV(file);
    };
    document.getElementById('confirmImportBtn').onclick = () => {
        const skipKeys = new Set();
        document.querySelectorAll('.import-card-cb:not(:checked)').forEach(cb => skipKeys.add(cb.dataset.key));
        executeImport(skipKeys);
    };
    document.getElementById('cancelImportBtn').onclick = () => {
        document.getElementById('importModal').classList.add('hidden');
        pendingImportData = null;
    };
    document.getElementById('closeImportModalBtn').onclick = () => {
        document.getElementById('importModal').classList.add('hidden');
        pendingImportData = null;
    };

    document.getElementById('archiveTab').onclick = () => switchTab('Archive');
    document.getElementById('favoritesTab').onclick = () => switchTab('Favorites');
    document.getElementById('dashboardTab').onclick = () => switchTab('Dashboard');
    
    // Modal Nieuwe Kaart openen
    document.getElementById('openModalBtn').onclick = () => {
        editingCardId = null; 
        document.getElementById('cardTitleInput').value = '';
        document.getElementById('cardStartInput').value = 0; 
        document.getElementById('cardStepInput').value = 1;
        document.getElementById('editActionsArea').classList.add('hidden');
        if (document.getElementById('eventHistoryContainer')) document.getElementById('eventHistoryContainer').innerHTML = '';
        document.getElementById('newCardModal').classList.remove('hidden');
    };

    // Kaart opslaan
    document.getElementById('saveCardBtn').onclick = async () => {
        const name = document.getElementById('cardTitleInput').value.trim();
        if (!name) return;
        let card;
        if (editingCardId) {
            const all = await getAllFromStore('cards'); 
            card = all.find(c => c.id === editingCardId);
            card.name = name; card.color = selectedModalColor;
            card.startValue = parseFloat(document.getElementById('cardStartInput').value);
            card.stepValue = parseFloat(document.getElementById('cardStepInput').value);
        } else {
            card = { id: crypto.randomUUID(), name, color: selectedModalColor, startValue: parseFloat(document.getElementById('cardStartInput').value), stepValue: parseFloat(document.getElementById('cardStepInput').value), archived: false, deleted: false, orderIndex: Date.now() };
        }
        await saveCard(card); document.getElementById('newCardModal').classList.add('hidden'); renderCards();
    };

    // Kaart archiveren/verwijderen
    document.getElementById('archiveCardBtn').onclick = async () => {
        const all = await getAllFromStore('cards'); const card = all.find(c => c.id === editingCardId);
        card.archived = !card.archived; await saveCard(card); document.getElementById('newCardModal').classList.add('hidden'); renderCards();
    };
    document.getElementById('deleteCardBtn').onclick = () => document.getElementById('confirmDeleteModal').classList.remove('hidden');
    document.getElementById('confirmDeleteBtn').onclick = async () => {
        const all = await getAllFromStore('cards'); const card = all.find(c => c.id === editingCardId);
        if (card) { card.deleted = true; await saveCard(card); }
        document.getElementById('confirmDeleteModal').classList.add('hidden'); document.getElementById('newCardModal').classList.add('hidden'); renderCards();
    };

    // Modal Annuleren Knoppen
    document.getElementById('cancelModalBtn').onclick = () => document.getElementById('newCardModal').classList.add('hidden');
    document.getElementById('cancelDeleteBtn').onclick = () => document.getElementById('confirmDeleteModal').classList.add('hidden');
    document.getElementById('cancelMealBtn').onclick = () => document.getElementById('mealModal').classList.add('hidden');

    // Poep Modal Knoppen
    document.getElementById('cancelPoepBtn').onclick = () => document.getElementById('poepModal').classList.add('hidden');
    document.getElementById('confirmPoepBtn').onclick = async () => {
        if (!activePoepCardId) return;
        const bt = bristolTypes.find(b => b.type === selectedBristolType);
        const remsporen = document.getElementById('poepRemsporen').checked;
        const drijven = document.getElementById('poepDrijven').checked;
        const stinkt = document.getElementById('poepStinkt').checked;
        const extras = [remsporen && 'remsporen', drijven && 'drijft', stinkt && 'stinkt'].filter(Boolean);
        const note = `Type ${bt.type} ${bt.label.replace('\n', ' ')} (${['bruin'].concat(extras).join(', ')})`;
        const event = {
            id: crypto.randomUUID(),
            cardId: activePoepCardId,
            timestamp: new Date().toISOString(),
            delta: 1,
            note
        };
        await saveEventStore(event);
        document.getElementById('poepModal').classList.add('hidden');
        renderCards();
    };

    // Maaltijd Bevestigen Knop
    document.getElementById('confirmMealBtn').onclick = async () => {
        const selected = document.getElementById('mealSelect').value;
        const custom = document.getElementById('customMealInput').value.trim();
        const mealName = custom || selected || "Onbekende maaltijd";

        if (activeMealCardId) {
            const event = { 
                id: crypto.randomUUID(), 
                cardId: activeMealCardId, 
                timestamp: new Date().toISOString(), 
                delta: 1,
                note: mealName 
            };
            await saveEventStore(event);
            document.getElementById('mealModal').classList.add('hidden');
            renderCards();
        }
    };

    // UI instellingen (Kleuren, Compact, Sorteren)
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

    const tfLabels = { U: 'Uur', V: 'Vandaag', W: 'Week', M: 'Maand', J: 'Jaar' };
    const tfBtn = document.getElementById('timeframeBtn');
    const tfMenu = document.getElementById('timeframeMenu');
    tfBtn.textContent = tfLabels[currentTimeframe] || currentTimeframe;
    tfBtn.onclick = (e) => { e.stopPropagation(); tfMenu.classList.toggle('hidden'); };
    document.querySelectorAll('#timeframeMenu .dropdown-item').forEach(item => {
        item.onclick = () => {
            currentTimeframe = item.dataset.val; localStorage.setItem('timeframe', currentTimeframe);
            tfBtn.textContent = tfLabels[currentTimeframe] || currentTimeframe;
            tfMenu.classList.add('hidden'); renderCards();
        };
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-container')) {
            tfMenu.classList.add('hidden');
            csvMenu.classList.add('hidden');
        }
    });
    document.getElementById('sortSelect').onchange = (e) => {
        currentSort = e.target.value; localStorage.setItem('sortMethod', currentSort); renderCards();
    };

    // SWIPE LOGICA
    document.addEventListener('touchstart', e => { touchstartX = e.changedTouches[0].screenX; }, false);
    document.addEventListener('touchend', e => { 
        touchendX = e.changedTouches[0].screenX; 
        const tabsOrder = ['Archive', 'Favorites', 'Dashboard'];
        const currentIndex = tabsOrder.indexOf(currentTab);
        const threshold = 50;
        if (touchendX < touchstartX - threshold && currentIndex < tabsOrder.length - 1) {
            switchTab(tabsOrder[currentIndex + 1]);
        }
        if (touchendX > touchstartX + threshold && currentIndex > 0) {
            switchTab(tabsOrder[currentIndex - 1]);
        }
    }, false);

    // Initial render
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

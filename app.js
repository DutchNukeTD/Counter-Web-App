// --- INITIALIZATION ---
const dbName = 'CounterAppDB';
let db;
let currentSort = localStorage.getItem('sortMethod') || 'manual';
document.getElementById('sortSelect').value = currentSort;

const presetColors = [
    '#FADCD9', '#F8E2CF', '#F5EECC', '#C9E4DE', 
    '#C6DEF1', '#DBCDF0', '#F2C6DE', '#F7D9C4', 
    '#E2E2E2', '#C1E1C1', '#F0E6EF', '#E2D1F9'
];
let selectedModalColor = presetColors[0];
let editingCardId = null; // Houdt bij of we een kaart bewerken of nieuw maken

const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains('cards')) {
                db.createObjectStore('cards', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('events')) {
                const eventStore = db.createObjectStore('events', { keyPath: 'id' });
                eventStore.createIndex('cardId_date', ['cardId', 'date'], { unique: false });
            }
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(); };
        request.onerror = (e) => { reject(e); };
    });
};

const generateUUID = () => crypto.randomUUID();
const getTodayDateString = () => new Date().toISOString().split('T')[0];

const getAllFromStore = (storeName) => {
    return new Promise((resolve) => {
        const trans = db.transaction([storeName], 'readonly');
        const req = trans.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
    });
};

// --- DATA OPERATIONS ---
const addCardToDB = (name, color) => {
    return new Promise((resolve) => {
        const transaction = db.transaction(['cards'], 'readwrite');
        const countReq = transaction.objectStore('cards').count();
        countReq.onsuccess = () => {
            const card = {
                id: generateUUID(),
                name: name,
                color: color || '#E2E2E2',
                orderIndex: countReq.result,
                createdAt: new Date().toISOString()
            };
            transaction.objectStore('cards').add(card);
            transaction.oncomplete = () => resolve(card);
        };
    });
};

// NIEUW: Functie om de naam en kleur van een bestaande kaart op te slaan
const updateCardDetailsInDB = (id, newName, newColor) => {
    return new Promise((resolve) => {
        const store = db.transaction(['cards'], 'readwrite').objectStore('cards');
        const req = store.get(id);
        req.onsuccess = () => {
            const card = req.result;
            card.name = newName;
            card.color = newColor;
            store.put(card).onsuccess = resolve;
        };
    });
};

const addEventToDB = (cardId, delta) => {
    return new Promise((resolve) => {
        const event = {
            id: generateUUID(), cardId: cardId,
            date: getTodayDateString(), timestamp: new Date().toISOString(),
            delta: delta
        };
        const transaction = db.transaction(['events'], 'readwrite');
        transaction.objectStore('events').add(event);
        transaction.oncomplete = () => resolve(event);
    });
};

const updateCardOrderInDB = (id, newIndex) => {
    return new Promise((resolve) => {
        const store = db.transaction(['cards'], 'readwrite').objectStore('cards');
        const req = store.get(id);
        req.onsuccess = () => {
            const card = req.result;
            card.orderIndex = newIndex;
            store.put(card).onsuccess = resolve;
        };
    });
};

// --- TIME FORMATTERS ---
const formatTimeAgo = (timestamp) => {
    if (!timestamp) return "Nog niet geklikt";
    const diffMs = Date.now() - new Date(timestamp).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "Zojuist";
    if (diffMins < 60) return `${diffMins} min. geleden`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs} uur geleden`;
    const diffDays = Math.floor(diffHrs / 24);
    return `${diffDays} dagen geleden`;
};

const formatDateTime = (timestamp) => {
    if (!timestamp) return "-";
    const d = new Date(timestamp);
    const date = d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
};

// --- UI LOGIC ---
const renderCards = async () => {
    const cards = await getAllFromStore('cards');
    const events = await getAllFromStore('events');

    const statsMap = {};
    cards.forEach(c => statsMap[c.id] = { today: 0, total: 0, lastTimestamp: null });

    const todayStr = getTodayDateString();
    events.forEach(ev => {
        if (!statsMap[ev.cardId]) return;
        statsMap[ev.cardId].total += ev.delta;
        if (ev.date === todayStr) statsMap[ev.cardId].today += ev.delta;
        
        const evTime = new Date(ev.timestamp).getTime();
        const currLast = statsMap[ev.cardId].lastTimestamp;
        if (!currLast || evTime > new Date(currLast).getTime()) {
            statsMap[ev.cardId].lastTimestamp = ev.timestamp;
        }
    });

    const cardsWithStats = cards.map(card => ({
        ...card,
        todayValue: statsMap[card.id].today,
        totalValue: statsMap[card.id].total,
        lastTimestamp: statsMap[card.id].lastTimestamp
    }));

    if (currentSort === 'alphabetical') {
        cardsWithStats.sort((a, b) => a.name.localeCompare(b.name));
    } else if (currentSort === 'highest') {
        cardsWithStats.sort((a, b) => b.todayValue - a.todayValue);
    } else {
        cardsWithStats.sort((a, b) => a.orderIndex - b.orderIndex);
    }

    const container = document.getElementById('cardContainer');
    container.innerHTML = '';

    // Check of we in 'manual' mode zitten. Zo ja = zichtbaar, anders onzichtbaar (maar neemt wel ruimte in!)
    const dragVisibility = currentSort === 'manual' ? 'visible' : 'hidden';

    cardsWithStats.forEach(card => {
        const div = document.createElement('div');
        div.className = 'card';
        div.dataset.id = card.id;
        div.style.backgroundColor = card.color || '#E2E2E2';
        
        div.innerHTML = `
            <div class="drag-handle" style="visibility: ${dragVisibility};">☰</div>
            <button class="counter-btn minus-btn ${card.todayValue <= 0 ? 'disabled' : ''}" data-id="${card.id}">-</button>
            
            <div class="card-center">
                <div class="card-title-container edit-card-btn" data-id="${card.id}">
                    <div class="card-title">${card.name}</div>
                    <div class="edit-icon">✏️</div>
                </div>
                <div class="card-count">${card.todayValue}</div>
                <div class="card-time-ago">${formatTimeAgo(card.lastTimestamp)}</div>
                <div class="card-datetime">${formatDateTime(card.lastTimestamp)}</div>
            </div>

            <button class="counter-btn plus-btn" data-id="${card.id}">+</button>
            <div class="card-total">Totaal: ${card.totalValue}</div>
        `;
        container.appendChild(div);
    });

    attachEventListeners();
};

const attachEventListeners = () => {
    document.querySelectorAll('.plus-btn').forEach(btn => {
        btn.onclick = async (e) => {
            await addEventToDB(e.target.dataset.id, 1);
            renderCards(); 
        };
    });

    document.querySelectorAll('.minus-btn').forEach(btn => {
        btn.onclick = async (e) => {
            if (e.target.classList.contains('disabled')) return;
            await addEventToDB(e.target.dataset.id, -1);
            renderCards(); 
        };
    });

    // NIEUW: Edit knop functionaliteit
    document.querySelectorAll('.edit-card-btn').forEach(btn => {
        btn.onclick = (e) => {
            const cardId = e.currentTarget.dataset.id;
            openModalForEdit(cardId);
        };
    });
};

// --- MODAL & CSV LOGIC ---
const setupModal = () => {
    const modal = document.getElementById('newCardModal');
    const colorPicker = document.getElementById('colorPicker');
    const modalTitle = document.querySelector('.modal-content h2');
    const saveBtn = document.getElementById('saveCardBtn');
    const titleInput = document.getElementById('cardTitleInput');
    
    // Render color swatches with data-color attributes
    presetColors.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;
        swatch.dataset.color = color; // Makkelijk terug te vinden
        if (color === selectedModalColor) swatch.classList.add('selected');
        
        swatch.onclick = () => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
            selectedModalColor = color;
        };
        colorPicker.appendChild(swatch);
    });

    // Modal open logic for NEW card
    document.getElementById('openModalBtn').onclick = () => {
        editingCardId = null; 
        titleInput.value = ''; 
        modalTitle.textContent = 'Nieuwe Kaart';
        saveBtn.textContent = 'Aanmaken';

        // Reset kleur
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        document.querySelector(`.color-swatch[data-color="${presetColors[0]}"]`).classList.add('selected');
        selectedModalColor = presetColors[0];

        modal.classList.remove('hidden');
        titleInput.focus();
    };
    
    document.getElementById('cancelModalBtn').onclick = () => {
        modal.classList.add('hidden');
    };

    // Modal save logic (voor zowel NIEUW als BEWERKEN)
    document.getElementById('saveCardBtn').onclick = async () => {
        const title = titleInput.value.trim();
        if (title) {
            if (editingCardId) {
                await updateCardDetailsInDB(editingCardId, title, selectedModalColor);
            } else {
                await addCardToDB(title, selectedModalColor);
            }
            modal.classList.add('hidden');
            renderCards();
        } else {
            alert('Vul a.u.b. een titel in.');
        }
    };
};

// NIEUW: Helper functie om modal te vullen met gegevens van bestaande kaart
const openModalForEdit = async (cardId) => {
    editingCardId = cardId;
    const store = db.transaction(['cards'], 'readonly').objectStore('cards');
    
    store.get(cardId).onsuccess = (req) => {
        const card = req.target.result;
        
        document.getElementById('cardTitleInput').value = card.name;
        document.querySelector('.modal-content h2').textContent = 'Kaart Bewerken';
        document.getElementById('saveCardBtn').textContent = 'Opslaan';

        // Selecteer juiste kleur
        selectedModalColor = card.color || presetColors[0];
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        
        const activeSwatch = document.querySelector(`.color-swatch[data-color="${selectedModalColor}"]`);
        if (activeSwatch) activeSwatch.classList.add('selected');

        document.getElementById('newCardModal').classList.remove('hidden');
        document.getElementById('cardTitleInput').focus();
    };
};

const exportToCSV = async () => {
    const cards = await getAllFromStore('cards');
    const events = await getAllFromStore('events');
    if (events.length === 0) return alert("Geen data om te exporteren.");

    const cardMap = {};
    cards.forEach(card => cardMap[card.id] = card.name);

    let csvContent = "data:text/csv;charset=utf-8,Date,Time,Card Name,Delta,Event ID\n";
    events.forEach(ev => {
        let cardName = `"${(cardMap[ev.cardId] || 'Unknown').replace(/"/g, '""')}"`; 
        const timeStr = new Date(ev.timestamp).toLocaleTimeString();
        csvContent += `${ev.date},${timeStr},${cardName},${ev.delta},${ev.id}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.href = encodedUri;
    link.download = `counter_export_${getTodayDateString()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// --- INIT APP ---
const initApp = async () => {
    await initDB();
    setupModal();
    await renderCards();

    const container = document.getElementById('cardContainer');
    new Sortable(container, {
        handle: '.drag-handle',
        animation: 150,
        disabled: currentSort !== 'manual',
        onEnd: async function () {
            const itemEls = Array.from(container.children);
            for (let i = 0; i < itemEls.length; i++) {
                await updateCardOrderInDB(itemEls[i].dataset.id, i);
            }
        }
    });

    document.getElementById('sortSelect').addEventListener('change', (e) => {
        currentSort = e.target.value;
        localStorage.setItem('sortMethod', currentSort);
        location.reload(); 
    });

    document.getElementById('exportBtn').addEventListener('click', exportToCSV);
};

initApp();
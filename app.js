// --- CONFIG & STATE ---
const dbName = 'CounterAppDB';
let db;
let currentSort = localStorage.getItem('sortMethod') || 'manual';
let isCompactMode = localStorage.getItem('compactMode') === 'true';
let currentTimeframe = localStorage.getItem('timeframe') || 'V';
const timeframes = ['U', 'V', 'W', 'M', 'J'];

const presetColors = ['#FADCD9', '#F8E2CF', '#F5EECC', '#C9E4DE', '#C6DEF1', '#DBCDF0', '#F2C6DE', '#F7D9C4', '#E2E2E2', '#C1E1C1', '#F0E6EF', '#E2D1F9'];
let selectedModalColor = presetColors[0];
let editingCardId = null;

// --- DB CORE ---
const initDB = () => {
    return new Promise((resolve, reject) => {
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
        request.onerror = (e) => reject(e);
    });
};

const getAllFromStore = (storeName) => {
    return new Promise((resolve) => {
        const trans = db.transaction([storeName], 'readonly');
        const req = trans.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
    });
};

// --- DATA ACTIONS ---
const saveCard = (card) => {
    return new Promise((resolve) => {
        const store = db.transaction(['cards'], 'readwrite').objectStore('cards');
        const req = store.put(card);
        req.onsuccess = () => resolve();
    });
};

const addEvent = (cardId, delta) => {
    return new Promise((resolve) => {
        const event = {
            id: crypto.randomUUID(), cardId: cardId,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0],
            delta: delta
        };
        const store = db.transaction(['events'], 'readwrite').objectStore('events');
        store.add(event).onsuccess = () => resolve();
    });
};

// --- UI RENDER ---
const renderCards = async () => {
    const allCards = await getAllFromStore('cards');
    const cards = allCards.filter(c => !c.deleted);
    const events = await getAllFromStore('events');

    const periods = getPeriods();
    const stats = {};
    cards.forEach(c => stats[c.id] = { valU:0, valV:0, valW:0, valM:0, valJ:0, total:0, last:null });

    events.forEach(ev => {
        if (!stats[ev.cardId]) return;
        const time = new Date(ev.timestamp).getTime();
        stats[ev.cardId].total += ev.delta;
        if (time >= periods.h) stats[ev.cardId].valU += ev.delta;
        if (time >= periods.d) stats[ev.cardId].valV += ev.delta;
        if (time >= periods.w) stats[ev.cardId].valW += ev.delta;
        if (time >= periods.m) stats[ev.cardId].valM += ev.delta;
        if (time >= periods.y) stats[ev.cardId].valJ += ev.delta;
        if (!stats[ev.cardId].last || time > new Date(stats[ev.cardId].last).getTime()) stats[ev.cardId].last = ev.timestamp;
    });

    const key = 'val' + currentTimeframe;
    const list = cards.map(c => ({
        ...c,
        display: (c.startValue || 0) + stats[c.id][key],
        total: (c.startValue || 0) + stats[c.id].total,
        last: stats[c.id].last
    }));

    if (currentSort === 'alphabetical') list.sort((a,b) => a.name.localeCompare(b.name));
    else if (currentSort === 'highest') list.sort((a,b) => b.display - a.display);
    else list.sort((a,b) => (a.orderIndex || 0) - (b.orderIndex || 0));

    const container = document.getElementById('cardContainer');
    container.innerHTML = '';
    
    list.forEach(card => {
        const step = card.stepValue || 1;
        const div = document.createElement('div');
        div.className = 'card';
        div.style.backgroundColor = card.color;
        div.innerHTML = `
            <div class="drag-handle" style="display: ${currentSort==='manual'?'block':'none'}">☰</div>
            <button class="counter-btn minus" data-id="${card.id}" data-step="${step}">-</button>
            <div class="card-center">
                <div class="card-title-container edit-trigger" data-id="${card.id}">
                    <span class="card-title">${card.name}</span> ✏️
                </div>
                <div class="card-count">${card.display}</div>
                <div class="card-time-ago">${formatTime(card.last)}</div>
            </div>
            <button class="counter-btn plus" data-id="${card.id}" data-step="${step}">+</button>
            <div class="card-total">Totaal: ${card.total}</div>
        `;
        container.appendChild(div);
    });

    // Event listeners voor de kaarten
    document.querySelectorAll('.plus').forEach(b => b.onclick = () => addEvent(b.dataset.id, parseFloat(b.dataset.step)).then(renderCards));
    document.querySelectorAll('.minus').forEach(b => b.onclick = () => addEvent(b.dataset.id, -parseFloat(b.dataset.step)).then(renderCards));
    document.querySelectorAll('.edit-trigger').forEach(b => b.onclick = () => openEditModal(b.dataset.id));
};

// --- MODAL LOGIC ---
const openEditModal = async (id) => {
    editingCardId = id;
    const cards = await getAllFromStore('cards');
    const card = cards.find(c => c.id === id);
    if (!card) return;

    document.getElementById('cardTitleInput').value = card.name;
    document.getElementById('cardStartInput').value = card.startValue || 0;
    document.getElementById('cardStepInput').value = card.stepValue || 1;
    selectedModalColor = card.color;
    
    document.querySelector('#newCardModal h2').textContent = "Kaart Aanpassen";
    document.getElementById('deleteActionArea').classList.remove('hidden');
    updateColorSelection();
    document.getElementById('newCardModal').classList.remove('hidden');
};

const setupModals = () => {
    const mainModal = document.getElementById('newCardModal');
    const confirmModal = document.getElementById('confirmDeleteModal');

    // Kleur kiezer vullen
    const picker = document.getElementById('colorPicker');
    presetColors.forEach(col => {
        const s = document.createElement('div');
        s.className = 'color-swatch';
        s.style.backgroundColor = col;
        s.dataset.color = col;
        s.onclick = () => { selectedModalColor = col; updateColorSelection(); };
        picker.appendChild(s);
    });

    document.getElementById('openModalBtn').onclick = () => {
        editingCardId = null;
        document.getElementById('cardTitleInput').value = '';
        document.getElementById('cardStartInput').value = 0;
        document.getElementById('cardStepInput').value = 1;
        document.querySelector('#newCardModal h2').textContent = "Nieuwe Kaart";
        document.getElementById('deleteActionArea').classList.add('hidden');
        mainModal.classList.remove('hidden');
    };

    document.getElementById('saveCardBtn').onclick = async () => {
        const name = document.getElementById('cardTitleInput').value.trim();
        if (!name) return alert("Naam verplicht");

        let card;
        if (editingCardId) {
            const all = await getAllFromStore('cards');
            card = all.find(c => c.id === editingCardId);
            card.name = name; card.color = selectedModalColor;
            card.startValue = parseFloat(document.getElementById('cardStartInput').value);
            card.stepValue = parseFloat(document.getElementById('cardStepInput').value);
        } else {
            card = {
                id: crypto.randomUUID(), name, color: selectedModalColor,
                startValue: parseFloat(document.getElementById('cardStartInput').value),
                stepValue: parseFloat(document.getElementById('cardStepInput').value),
                deleted: false, orderIndex: Date.now()
            };
        }
        await saveCard(card);
        mainModal.classList.add('hidden');
        renderCards();
    };

    document.getElementById('cancelModalBtn').onclick = () => mainModal.classList.add('hidden');

    // VERWIJDER LOGICA
    document.getElementById('deleteCardBtn').onclick = () => confirmModal.classList.remove('hidden');
    document.getElementById('cancelDeleteBtn').onclick = () => confirmModal.classList.add('hidden');

    document.getElementById('confirmDeleteBtn').onclick = async () => {
        if (!editingCardId) return;
        const all = await getAllFromStore('cards');
        const card = all.find(c => c.id === editingCardId);
        if (card) {
            card.deleted = true;
            await saveCard(card);
        }
        confirmModal.classList.add('hidden');
        mainModal.classList.add('hidden');
        renderCards();
    };
};

// --- HELPERS ---
const updateColorSelection = () => {
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === selectedModalColor));
};

const getPeriods = () => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const h = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
    const w = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay()||7) + 1).getTime();
    const m = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const y = new Date(now.getFullYear(), 0, 1).getTime();
    return { h, d, w, m, y };
};

const formatTime = (ts) => {
    if (!ts) return "Nog geen clicks";
    const diff = (Date.now() - new Date(ts).getTime()) / 60000;
    if (diff < 1) return "Zojuist";
    if (diff < 60) return Math.floor(diff) + "m geleden";
    if (diff < 1440) return Math.floor(diff/60) + "u geleden";
    return new Date(ts).toLocaleDateString();
};

const setupToggles = () => {
    const frameBtn = document.getElementById('timeframeBtn');
    const menu = document.getElementById('timeframeMenu');
    
    document.body.classList.toggle('compact-mode', isCompactMode);
    document.getElementById('compactBtn').classList.toggle('active', isCompactMode);
    frameBtn.textContent = `[${currentTimeframe}]`;

    document.getElementById('compactBtn').onclick = () => {
        isCompactMode = !isCompactMode;
        localStorage.setItem('compactMode', isCompactMode);
        document.body.classList.toggle('compact-mode', isCompactMode);
        document.getElementById('compactBtn').classList.toggle('active', isCompactMode);
    };

    frameBtn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
    document.querySelectorAll('.dropdown-item').forEach(i => {
        i.onclick = () => {
            currentTimeframe = i.dataset.val;
            localStorage.setItem('timeframe', currentTimeframe);
            frameBtn.textContent = `[${currentTimeframe}]`;
            menu.classList.add('hidden');
            renderCards();
        };
    });
    window.onclick = () => menu.classList.add('hidden');
};

// --- INIT ---
initDB().then(() => {
    setupModals();
    setupToggles();
    renderCards();
    
    document.getElementById('sortSelect').onchange = (e) => {
        currentSort = e.target.value;
        localStorage.setItem('sortMethod', currentSort);
        renderCards();
    };

    const container = document.getElementById('cardContainer');
    new Sortable(container, {
        handle: '.drag-handle', animation: 150,
        onEnd: async () => {
            const items = Array.from(container.children);
            const cards = await getAllFromStore('cards');
            for(let i=0; i<items.length; i++) {
                const card = cards.find(c => c.id === items[i].dataset.id);
                if (card) { card.orderIndex = i; await saveCard(card); }
            }
        }
    });
});

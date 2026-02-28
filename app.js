const dbName = 'CounterAppDB';
let db;
let currentSort = localStorage.getItem('sortMethod') || 'manual';
let isCompactMode = localStorage.getItem('compactMode') === 'true';
let currentTimeframe = localStorage.getItem('timeframe') || 'V';
let currentTab = 'Favorites';

const presetColors = ['#FADCD9', '#F8E2CF', '#F5EECC', '#C9E4DE', '#C6DEF1', '#DBCDF0', '#F2C6DE', '#F7D9C4', '#E2E2E2', '#C1E1C1', '#F0E6EF', '#E2D1F9'];
let selectedModalColor = presetColors[0];
let editingCardId = null;

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

window.addEv = async (id, delta) => {
    const event = { id: crypto.randomUUID(), cardId: id, timestamp: new Date().toISOString(), delta: delta };
    const store = db.transaction(['events'], 'readwrite').objectStore('events');
    store.add(event).onsuccess = () => renderCards();
};

const renderCards = async (containerElement = document.getElementById('cardContainer')) => {
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
        div.className = 'card';
        div.style.backgroundColor = card.color;
        div.dataset.id = card.id;
        
        // Alleen de absolute datum/tijd gebruiken
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

const switchTab = (newTab) => {
    if (currentTab === newTab) return;
    const mainContent = document.getElementById('mainContent');
    const oldContainer = document.getElementById('cardContainer');
    const clone = oldContainer.cloneNode(true);
    clone.id = ''; 
    clone.classList.add('card-container-clone');
    mainContent.appendChild(clone);
    const goingToArchive = (newTab === 'Archive');
    clone.classList.add(goingToArchive ? 'slide-out-to-right' : 'slide-out-to-left');
    currentTab = newTab;
    document.getElementById('archiveTab').classList.toggle('active', newTab === 'Archive');
    document.getElementById('favoritesTab').classList.toggle('active', newTab === 'Favorites');
    renderCards(oldContainer);
    oldContainer.className = goingToArchive ? 'slide-in-from-left' : 'slide-in-from-right';
    setTimeout(() => {
        clone.remove();
        oldContainer.className = ''; 
    }, 350);
};

const setupTabs = () => {
    document.getElementById('archiveTab').onclick = () => switchTab('Archive');
    document.getElementById('favoritesTab').onclick = () => switchTab('Favorites');
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
    updateColorSelection();
    document.getElementById('newCardModal').classList.remove('hidden');
};

const setupModals = () => {
    const mainModal = document.getElementById('newCardModal');
    document.getElementById('openModalBtn').onclick = () => {
        editingCardId = null;
        document.getElementById('cardTitleInput').value = '';
        document.getElementById('cardStartInput').value = 0;
        document.getElementById('cardStepInput').value = 1;
        document.getElementById('editActionsArea').classList.add('hidden');
        mainModal.classList.remove('hidden');
    };
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
        await saveCard(card);
        mainModal.classList.add('hidden');
        renderCards();
    };
    document.getElementById('archiveCardBtn').onclick = async () => {
        const all = await getAllFromStore('cards');
        const card = all.find(c => c.id === editingCardId);
        card.archived = !card.archived;
        await saveCard(card);
        mainModal.classList.add('hidden');
        renderCards();
    };
    document.getElementById('deleteCardBtn').onclick = () => document.getElementById('confirmDeleteModal').classList.remove('hidden');
    document.getElementById('confirmDeleteBtn').onclick = async () => {
        const all = await getAllFromStore('cards');
        const card = all.find(c => c.id === editingCardId);
        if (card) { card.deleted = true; await saveCard(card); }
        document.getElementById('confirmDeleteModal').classList.add('hidden');
        mainModal.classList.add('hidden');
        renderCards();
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

initDB().then(() => {
    setupModals();
    setupTabs();
    const picker = document.getElementById('colorPicker');
    presetColors.forEach(col => {
        const s = document.createElement('div');
        s.className = 'color-swatch'; s.style.backgroundColor = col; s.dataset.color = col;
        s.onclick = () => { selectedModalColor = col; updateColorSelection(); };
        picker.appendChild(s);
    });
    const compactBtn = document.getElementById('compactBtn');
    compactBtn.onclick = () => {
        isCompactMode = !isCompactMode;
        localStorage.setItem('compactMode', isCompactMode);
        document.body.classList.toggle('compact-mode', isCompactMode);
        compactBtn.classList.toggle('active', isCompactMode);
    };
    if (isCompactMode) { document.body.classList.add('compact-mode'); compactBtn.classList.add('active'); }
    const tfBtn = document.getElementById('timeframeBtn');
    const tfMenu = document.getElementById('timeframeMenu');
    tfBtn.textContent = `[${currentTimeframe}]`;
    tfBtn.onclick = (e) => { e.stopPropagation(); tfMenu.classList.toggle('hidden'); };
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.onclick = () => {
            currentTimeframe = item.dataset.val;
            localStorage.setItem('timeframe', currentTimeframe);
            tfBtn.textContent = `[${currentTimeframe}]`;
            tfMenu.classList.add('hidden');
            renderCards();
        };
    });
    window.onclick = () => tfMenu.classList.add('hidden');
    document.getElementById('sortSelect').onchange = (e) => {
        currentSort = e.target.value;
        localStorage.setItem('sortMethod', currentSort);
        renderCards();
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

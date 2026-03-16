import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    getFirestore,
    collection,
    addDoc,
    onSnapshot,
    query,
    orderBy,
    doc,
    updateDoc,
    deleteDoc,
    getDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========================
   Firebase config
========================= */
const firebaseConfig = {
    apiKey: "AIzaSyA7MMSUKoIK2XIhFWRyEkrjXpjMU2ckS3I",
    authDomain: "luckypick-ba098.firebaseapp.com",
    projectId: "luckypick-ba098",
    storageBucket: "luckypick-ba098.firebasestorage.app",
    messagingSenderId: "489340303205",
    appId: "1:489340303205:web:b6744ef6d4eccdcd1ad38c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* =========================
   DOM elements
========================= */
const loginPage = document.getElementById("loginPage");
const gameSelectPage = document.getElementById("gameSelectPage");
const appPage = document.getElementById("appPage");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const loginMessage = document.getElementById("loginMessage");

const gameSelectPlayerName = document.getElementById("gameSelectPlayerName");
const backToLoginBtn = document.getElementById("backToLoginBtn");
const gameCards = document.querySelectorAll(".game-card");

const currentPlayerNameEl = document.getElementById("currentPlayerName");
const currentGameNameEl = document.getElementById("currentGameName");
const pageTitle = document.getElementById("pageTitle");
const logoutBtn = document.getElementById("logoutBtn");
const changeGameBtn = document.getElementById("changeGameBtn");

const lottoSection = document.getElementById("lottoSection");
const eurojackpotSection = document.getElementById("eurojackpotSection");

const numberGrid = document.getElementById("numberGrid");
const euroMainGrid = document.getElementById("euroMainGrid");
const euroStarGrid = document.getElementById("euroStarGrid");

const countEl = document.getElementById("count");
const euroMainCountEl = document.getElementById("euroMainCount");
const euroStarCountEl = document.getElementById("euroStarCount");

const messageEl = document.getElementById("message");
const selectedListEl = document.getElementById("selectedList");
const savedRowCountEl = document.getElementById("savedRowCount");
const saveRowBtn = document.getElementById("saveRowBtn");
const clearCurrentBtn = document.getElementById("clearCurrentBtn");
const loadBtn = document.getElementById("loadBtn");

const myRowsEl = document.getElementById("myRows");
const playersPanels = document.getElementById("playersPanels");

/* =========================
   App state
========================= */
const GAME_CONFIG = {
    lotto: {
        name: "Lotto",
        maxMain: 6,
        mainRange: 45,
        hasStars: false
    },
    eurojackpot: {
        name: "EuroJackpot",
        maxMain: 5,
        mainRange: 50,
        hasStars: true,
        maxStars: 2,
        starRange: 12
    }
};

let currentUser = null;
let currentUserProfile = null;
let currentGame = null;
let editingRowId = null;
let allTickets = [];
let unsubscribeTickets = null;

let currentSelection = {
    main: [],
    stars: []
};

/* =========================
   Helpers
========================= */
function showPage(pageName) {
    loginPage.classList.add("hidden");
    gameSelectPage.classList.add("hidden");
    appPage.classList.add("hidden");

    if (pageName === "login") loginPage.classList.remove("hidden");
    if (pageName === "games") gameSelectPage.classList.remove("hidden");
    if (pageName === "app") appPage.classList.remove("hidden");
}

function resetCurrentSelection() {
    currentSelection = { main: [], stars: [] };
}

function formatDate(value) {
    if (!value) return "Unknown date";
    if (typeof value.toDate === "function") {
        return value.toDate().toLocaleString();
    }
    return new Date(value).toLocaleString();
}

function isAdmin() {
    return currentUserProfile?.role === "admin";
}

function canEditRow(row) {
    if (!row || !currentUser) return false;
    return isAdmin() || row.playerUid === currentUser.uid;
}

function getRowsForCurrentGame() {
    if (!currentGame) return [];
    return allTickets.filter((row) => row.game === currentGame);
}

function getMyRowsForCurrentGame() {
    if (!currentGame || !currentUser) return [];
    return allTickets.filter(
        (row) => row.game === currentGame && row.playerUid === currentUser.uid
    );
}

function isSelectionComplete() {
    const config = GAME_CONFIG[currentGame];
    if (!config) return false;

    if (currentGame === "lotto") {
        return currentSelection.main.length === config.maxMain;
    }

    if (currentGame === "eurojackpot") {
        return (
            currentSelection.main.length === config.maxMain &&
            currentSelection.stars.length === config.maxStars
        );
    }

    return false;
}

/* =========================
   Auth
========================= */
async function login() {
    const email = usernameInput.value.trim();
    const password = passwordInput.value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
        loginMessage.textContent = "";
    } catch (error) {
        loginMessage.textContent = error.message;
    }
}

async function logout() {
    try {
        if (unsubscribeTickets) {
            unsubscribeTickets();
            unsubscribeTickets = null;
        }

        currentUser = null;
        currentUserProfile = null;
        currentGame = null;
        editingRowId = null;
        allTickets = [];
        resetCurrentSelection();

        await signOut(auth);
    } catch (error) {
        messageEl.textContent = error.message;
    }
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;

        try {
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
                currentUserProfile = userSnap.data();
            } else {
                currentUserProfile = {
                    displayName: user.email,
                    role: "player"
                };
            }

            gameSelectPlayerName.textContent =
                currentUserProfile.displayName || user.email;

            showPage("games");
        } catch (error) {
            loginMessage.textContent = error.message;
            showPage("login");
        }
    } else {
        currentUser = null;
        currentUserProfile = null;
        currentGame = null;
        editingRowId = null;
        allTickets = [];
        resetCurrentSelection();
        showPage("login");
    }
});

/* =========================
   Firestore sync
========================= */
function listenToTickets() {
    if (unsubscribeTickets) {
        unsubscribeTickets();
        unsubscribeTickets = null;
    }

    const q = query(collection(db, "tickets"), orderBy("createdAt", "desc"));

    unsubscribeTickets = onSnapshot(
        q,
        (snapshot) => {
            allTickets = snapshot.docs.map((docSnap) => ({
                id: docSnap.id,
                ...docSnap.data()
            }));

            if (currentGame) {
                renderMyRows();
                renderPlayersPanels();
                updateSelectionSummary();
            }
        },
        (error) => {
            messageEl.textContent = error.message;
        }
    );
}

/* =========================
   Game selection
========================= */
function selectGame(gameKey) {
    currentGame = gameKey;
    editingRowId = null;
    resetCurrentSelection();
    messageEl.textContent = "";
    listenToTickets();
    renderGamePage();
    showPage("app");
}

/* =========================
   Number selection
========================= */
function toggleMainNumber(number) {
    const config = GAME_CONFIG[currentGame];
    const index = currentSelection.main.indexOf(number);

    if (index !== -1) {
        currentSelection.main.splice(index, 1);
        messageEl.textContent = "";
    } else {
        if (currentSelection.main.length >= config.maxMain) {
            messageEl.textContent = `You can only choose ${config.maxMain} main numbers.`;
            return;
        }
        currentSelection.main.push(number);
        currentSelection.main.sort((a, b) => a - b);
        messageEl.textContent = "";
    }

    renderCurrentGameGrid();
    updateSelectionSummary();
}

function toggleStarNumber(number) {
    const config = GAME_CONFIG[currentGame];
    const index = currentSelection.stars.indexOf(number);

    if (index !== -1) {
        currentSelection.stars.splice(index, 1);
        messageEl.textContent = "";
    } else {
        if (currentSelection.stars.length >= config.maxStars) {
            messageEl.textContent = `You can only choose ${config.maxStars} lucky stars.`;
            return;
        }
        currentSelection.stars.push(number);
        currentSelection.stars.sort((a, b) => a - b);
        messageEl.textContent = "";
    }

    renderCurrentGameGrid();
    updateSelectionSummary();
}

function renderGrid(container, rangeMax, selectedValues, onClick, selectedClass = "selected") {
    container.innerHTML = "";

    for (let i = 1; i <= rangeMax; i++) {
        const btn = document.createElement("button");
        btn.className = "number-btn";
        btn.textContent = i;

        if (selectedValues.includes(i)) {
            btn.classList.add(selectedClass);
        }

        btn.addEventListener("click", () => onClick(i));
        container.appendChild(btn);
    }
}

function renderCurrentGameGrid() {
    const config = GAME_CONFIG[currentGame];
    if (!config) return;

    if (currentGame === "lotto") {
        renderGrid(numberGrid, config.mainRange, currentSelection.main, toggleMainNumber, "selected");
        countEl.textContent = currentSelection.main.length;
    } else if (currentGame === "eurojackpot") {
        renderGrid(euroMainGrid, config.mainRange, currentSelection.main, toggleMainNumber, "selected");
        renderGrid(euroStarGrid, config.starRange, currentSelection.stars, toggleStarNumber, "star-selected");
        euroMainCountEl.textContent = currentSelection.main.length;
        euroStarCountEl.textContent = currentSelection.stars.length;
    }
}

/* =========================
   Save / edit / delete
========================= */
async function saveCurrentRow() {
    if (!isSelectionComplete()) {
        messageEl.textContent = "Please complete the row before saving.";
        return;
    }

    if (!currentUser) {
        messageEl.textContent = "You are not logged in.";
        return;
    }

    const payload = {
        playerUid: currentUser.uid,
        playerName: currentUserProfile?.displayName || currentUser.email,
        game: currentGame,
        gameLabel: GAME_CONFIG[currentGame].name,
        numbers: [...currentSelection.main],
        stars: currentGame === "eurojackpot" ? [...currentSelection.stars] : [],
        updatedAt: serverTimestamp()
    };

    try {
        if (editingRowId) {
            const existing = allTickets.find((r) => r.id === editingRowId);

            if (!existing || !canEditRow(existing)) {
                messageEl.textContent = "You cannot edit this row.";
                return;
            }

            await updateDoc(doc(db, "tickets", editingRowId), payload);
            editingRowId = null;
            messageEl.textContent = "Row updated.";
        } else {
            await addDoc(collection(db, "tickets"), {
                ...payload,
                createdAt: serverTimestamp()
            });
            messageEl.textContent = "Row saved.";
        }

        resetCurrentSelection();
        renderCurrentGameGrid();
        updateSelectionSummary();
    } catch (error) {
        messageEl.textContent = error.message;
    }
}

function editMyRow(rowId) {
    const row = allTickets.find((r) => r.id === rowId);

    if (!row || !canEditRow(row)) {
        messageEl.textContent = "You cannot edit this row.";
        return;
    }

    currentGame = row.game;
    editingRowId = row.id;
    currentSelection.main = [...(row.numbers || [])];
    currentSelection.stars = [...(row.stars || [])];

    renderGamePage();
    showPage("app");
    messageEl.textContent = "Editing row. Save current row to update it.";
}

async function deleteMyRow(rowId) {
    const row = allTickets.find((r) => r.id === rowId);

    if (!row || !canEditRow(row)) {
        messageEl.textContent = "You cannot delete this row.";
        return;
    }

    try {
        await deleteDoc(doc(db, "tickets", rowId));
        messageEl.textContent = "Row deleted.";

        if (editingRowId === rowId) {
            editingRowId = null;
            resetCurrentSelection();
            renderCurrentGameGrid();
            updateSelectionSummary();
        }
    } catch (error) {
        messageEl.textContent = error.message;
    }
}

/* =========================
   Rendering
========================= */
function updateSelectionSummary() {
    if (!currentGame) return;

    if (currentGame === "lotto") {
        selectedListEl.textContent = currentSelection.main.length
            ? currentSelection.main.join(", ")
            : "None";
    } else {
        const mainPart = currentSelection.main.length
            ? `Main: ${currentSelection.main.join(", ")}`
            : "Main: none";
        const starPart = currentSelection.stars.length
            ? `Stars: ${currentSelection.stars.join(", ")}`
            : "Stars: none";
        selectedListEl.textContent = `${mainPart} | ${starPart}`;
    }

    savedRowCountEl.textContent = getMyRowsForCurrentGame().length;
}

function renderMyRows() {
    myRowsEl.innerHTML = "";

    const rows = getMyRowsForCurrentGame();

    if (!rows.length) {
        myRowsEl.innerHTML = `<div class="small">No saved rows yet.</div>`;
        return;
    }

    rows.forEach((row, index) => {
        const item = document.createElement("div");
        item.className = "row-item";

        const meta = document.createElement("div");
        meta.className = "row-label";
        meta.textContent = `${row.playerName || "Unknown"} | ${row.gameLabel || row.game} | ${formatDate(row.createdAt)}`;

        const label = document.createElement("div");
        label.className = "row-label";
        label.textContent = `Row ${index + 1}`;

        const values = document.createElement("div");
        values.className = "row-values";

        if (row.game === "lotto") {
            values.textContent = (row.numbers || []).join(", ");
        } else {
            values.textContent = `Main: ${(row.numbers || []).join(", ")} | Stars: ${(row.stars || []).join(", ")}`;
        }

        const actions = document.createElement("div");
        actions.className = "row-actions";

        const editBtn = document.createElement("button");
        editBtn.className = "action secondary small-btn";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => editMyRow(row.id));

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "action secondary small-btn";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => deleteMyRow(row.id));

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(meta);
        item.appendChild(label);
        item.appendChild(values);
        item.appendChild(actions);

        myRowsEl.appendChild(item);
    });
}

function renderPlayersPanels() {
    playersPanels.innerHTML = "";

    const rows = getRowsForCurrentGame();

    if (!rows.length) {
        playersPanels.innerHTML = `<div class="small">No saved rows yet for ${GAME_CONFIG[currentGame].name}.</div>`;
        return;
    }

    const grouped = {};
    rows.forEach((row) => {
        const key = row.playerUid || "unknown";
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(row);
    });

    Object.values(grouped).forEach((playerRows) => {
        const panel = document.createElement("div");
        panel.className = "panel";

        const firstRow = playerRows[0];

        const title = document.createElement("div");
        title.className = "player-name";

        let label = firstRow.playerName || "Unknown";
        if (currentUser && firstRow.playerUid === currentUser.uid) {
            label += " (you)";
        }
        if (isAdmin() && currentUser && firstRow.playerUid !== currentUser.uid) {
            label += " (admin view)";
        }

        title.textContent = label;
        panel.appendChild(title);

        playerRows.forEach((row, index) => {
            const item = document.createElement("div");
            item.className = "row-item";

            const meta = document.createElement("div");
            meta.className = "row-label";
            meta.textContent = `${row.playerName || "Unknown"} | ${row.gameLabel || row.game} | ${formatDate(row.createdAt)}`;

            const label = document.createElement("div");
            label.className = "row-label";
            label.textContent = `Row ${index + 1}`;

            const values = document.createElement("div");
            values.className = "row-values";

            if (row.game === "lotto") {
                values.textContent = (row.numbers || []).join(", ");
            } else {
                values.textContent = `Main: ${(row.numbers || []).join(", ")} | Stars: ${(row.stars || []).join(", ")}`;
            }

            item.appendChild(meta);
            item.appendChild(label);
            item.appendChild(values);

            if (canEditRow(row)) {
                const actions = document.createElement("div");
                actions.className = "row-actions";

                const editBtn = document.createElement("button");
                editBtn.className = "action secondary small-btn";
                editBtn.textContent = "Edit";
                editBtn.addEventListener("click", () => editMyRow(row.id));

                const deleteBtn = document.createElement("button");
                deleteBtn.className = "action secondary small-btn";
                deleteBtn.textContent = "Delete";
                deleteBtn.addEventListener("click", () => deleteMyRow(row.id));

                actions.appendChild(editBtn);
                actions.appendChild(deleteBtn);
                item.appendChild(actions);
            }

            panel.appendChild(item);
        });

        playersPanels.appendChild(panel);
    });
}

function renderGamePage() {
    const config = GAME_CONFIG[currentGame];
    if (!config) return;

    currentPlayerNameEl.textContent =
        currentUserProfile?.displayName || currentUser?.email || "";
    currentGameNameEl.textContent = config.name;
    pageTitle.textContent = `${config.name} Picker`;

    lottoSection.classList.toggle("hidden", currentGame !== "lotto");
    eurojackpotSection.classList.toggle("hidden", currentGame !== "eurojackpot");

    renderCurrentGameGrid();
    updateSelectionSummary();
    renderMyRows();
    renderPlayersPanels();
}

/* =========================
   Event listeners
========================= */
loginBtn.addEventListener("click", login);

passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
});

backToLoginBtn.addEventListener("click", logout);
logoutBtn.addEventListener("click", logout);

gameCards.forEach((card) => {
    card.addEventListener("click", () => {
        selectGame(card.dataset.game);
    });
});

changeGameBtn.addEventListener("click", () => {
    currentGame = null;
    editingRowId = null;
    resetCurrentSelection();
    messageEl.textContent = "";
    showPage("games");
});

saveRowBtn.addEventListener("click", saveCurrentRow);

clearCurrentBtn.addEventListener("click", () => {
    editingRowId = null;
    resetCurrentSelection();
    messageEl.textContent = "Current selection cleared.";
    renderCurrentGameGrid();
    updateSelectionSummary();
});

loadBtn.addEventListener("click", () => {
    messageEl.textContent = "Live sync is active.";
});
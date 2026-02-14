/**
 * LOVE LETTER GAME LOGIC
 * Includes: Single Player, Pass & Play, P2P Multiplayer
 * Bots: Easy (Random), Medium (Heuristic), Hard (Calculating/Tracker)
 */

// --- Game Constants & State ---
const CARDS = [
    { value: 1, name: "Guard", count: 5, desc: "Guess a player's hand (cannot guess Guard)." },
    { value: 2, name: "Priest", count: 2, desc: "Look at another player's hand." },
    { value: 3, name: "Baron", count: 2, desc: "Compare hands; lower value is out." },
    { value: 4, name: "Handmaid", count: 2, desc: "Ignore all effects until next turn." },
    { value: 5, name: "Prince", count: 2, desc: "Choose player to discard hand." },
    { value: 6, name: "King", count: 1, desc: "Trade hands with another player." },
    { value: 7, name: "Countess", count: 1, desc: "Discard if you have King or Prince." },
    { value: 8, name: "Princess", count: 1, desc: "If discarded, you lose." }
];

let state = {
    players: [],
    deck: [],
    currentPlayerIndex: 0,
    gameMode: 'single',
    myPlayerId: null,
    turnPhase: 'draw',
    removedCard: null,
    removedFaceUp: [],
    logs: [],
    winner: null
};

// --- Networking (PeerJS) ---
let peer = null;
let connections = []; // Host: Array of PeerJS connections
let hostConn = null; // Client: Connection to Host
let isHost = false;
let lobbyPlayers = []; // {id, name}

function initPeer(customId = null) {
    // Clean up existing peer if any
    if (peer) {
        peer.destroy();
        peer = null;
    }

    const options = { debug: 2 };

    // PeerJS will error if ID is taken, so we need to handle that.
    // However, the 'open' event is where we know it succeeded.
    // The 'error' event handles failure.

    peer = new Peer(customId, options);

    peer.on('open', (id) => {
        state.myPlayerId = id;
        document.getElementById('peer-id-display').innerText = `Your ID: ${id}`;
        if(isHost) {
             showLobbyScreen();
             document.getElementById('lobby-status').innerText = "Hosting... Share your ID.";
             updateLobbyHost();
        }
    });

    peer.on('connection', (c) => {
        if (!isHost) {
            c.close();
            return;
        }
        handleIncomingConnection(c);
    });

    peer.on('error', (err) => {
        console.error(err);
        if (err.type === 'unavailable-id') {
            alert("Custom ID is already taken. Please try another.");
            isHost = false;
            // Maybe reset to menu?
        } else {
            alert("Network Error: " + err.type);
        }
    });
}

function handleIncomingConnection(c) {
    console.log("Incoming connection from", c.peer);
    c.on('open', () => {
        connections.push(c);
        updateLobbyHost();
    });
    c.on('data', (data) => handleNetworkData(data, c));
    c.on('close', () => {
        connections = connections.filter(conn => conn !== c);
        updateLobbyHost();
        if (state.gameMode === 'multi' && state.players.length > 0) {
            log(`Player ${c.peer} disconnected.`);
            // In a robust game, we might pause or replace with bot.
        }
    });
}

function updateLobbyHost() {
    const list = [{id: state.myPlayerId, name: "Host (You)"}];
    connections.forEach((c, i) => {
        list.push({id: c.peer, name: `Player ${i+2}`});
    });
    lobbyPlayers = list;
    updateLobbyUI();

    connections.forEach(c => {
        if(c.open) c.send({ type: 'LOBBY_UPDATE', payload: lobbyPlayers });
    });

    const btn = document.getElementById('lobby-start-btn');
    if (lobbyPlayers.length >= 2) {
        btn.classList.remove('hidden');
        btn.disabled = false;
    } else {
        btn.classList.add('hidden');
    }
}

function joinGame() {
    const destId = document.getElementById('remote-id-input').value;
    if(!destId) return alert("Enter Host ID!");

    isHost = false;
    // Init peer (random ID)
    initPeer();
    // Wait for open before connecting
    // Actually initPeer is async in terms of 'open' event.
    // We should probably init peer FIRST, then connect.
    // Refactoring: initPeer() is called on 'Multiplayer' menu click?
    // Wait, previous code called initPeer() in showMultiplayerMenu.
    // But now we might want custom ID for host.
    // Client doesn't need custom ID usually.

    // Let's rely on the peer instance created when menu opened.
    // BUT if host wants custom ID, we destroy and recreate.

    // For client, we just use the existing one or create one if missing.
    if(!peer || peer.destroyed) initPeer();

    // Check if peer is open before connecting
    if(peer.open) {
        connectToHost(destId);
    } else {
        peer.on('open', () => connectToHost(destId));
    }
}

function connectToHost(destId) {
    hostConn = peer.connect(destId);

    hostConn.on('open', () => {
        console.log("Connected to host!");
        showLobbyScreen();
        document.getElementById('lobby-status').innerText = "Connected! Waiting for host to start...";
    });

    hostConn.on('data', (data) => handleNetworkData(data, hostConn));
    hostConn.on('close', () => {
        alert("Disconnected from host.");
        quitGame();
    });
}

function hostGame() {
    isHost = true;
    connections = [];
    const customId = document.getElementById('host-id-input').value.trim();
    if(customId) {
        // Re-init with custom ID
        initPeer(customId);
        // 'open' handler will show lobby
    } else {
        // Use existing random ID (or re-init if needed)
        if(!peer || peer.destroyed) initPeer();
        else {
             showLobbyScreen();
             document.getElementById('lobby-status').innerText = "Hosting... Share your ID.";
             updateLobbyHost();
        }
    }
}

function sendData(type, payload) {
    if (isHost) {
        connections.forEach(c => {
            if (c.open) c.send({ type, payload });
        });
    } else if (hostConn && hostConn.open) {
        hostConn.send({ type, payload });
    }
}

function handleNetworkData(data, sourceConn) {
    if (data.type === 'SYNC_STATE') {
        state = data.payload;
        // Restore local ID for view logic
        state.myPlayerId = peer.id;
        renderGame();

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'hidden'));
        document.getElementById('game-screen').classList.add('active');

    } else if (data.type === 'LOBBY_UPDATE') {
        lobbyPlayers = data.payload;
        updateLobbyUI();
    } else if (data.type === 'ACTION') {
        if (isHost) {
            const player = state.players[state.currentPlayerIndex];
            if (player.id === sourceConn.peer) {
                processMove(data.payload.cardIdx, data.payload.targetId, data.payload.guess);
            }
        }
    } else if (data.type === 'GAME_OVER') {
        alert("Host ended the game.");
        quitGame();
    }
}

// --- UI Transitions ---

function showLobbyScreen() {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.classList.add('hidden');
    });
    document.getElementById('lobby-screen').classList.remove('hidden');
    document.getElementById('lobby-screen').classList.add('active');
}

function updateLobbyUI() {
    const list = document.getElementById('lobby-player-list');
    list.innerHTML = lobbyPlayers.map(p => `<div>${p.name} ${p.id === state.myPlayerId ? '(You)' : ''}</div>`).join('');
}

function showMainMenu() {
    // If peer exists, destroy it to clean up?
    if(peer) {
        peer.destroy();
        peer = null;
    }
    location.reload();
}

function showMultiplayerMenu() {
    document.getElementById('menu-screen').classList.remove('active');
    document.getElementById('multiplayer-screen').classList.add('active');
    document.getElementById('multiplayer-screen').classList.remove('hidden');
    // Pre-init peer with random ID so it's ready, unless they choose Host with Custom
    initPeer();
}

function quitGame() {
    if(isHost) {
        // Notify clients?
        sendData('GAME_OVER', {});
        connections.forEach(c => c.close());
        connections = [];
    } else {
        if(hostConn) hostConn.close();
    }
    showMainMenu();
}

// --- Game Start ---

function startGame(mode) {
    state.gameMode = mode;
    state.players = [];
    state.logs = [];
    state.removedFaceUp = [];
    
    if (mode === 'single') {
        state.players.push({ id: 0, name: "You", hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
        state.players.push({ id: 1, name: "Bot Easy", hand: [], discard: [], isProtected: false, isOut: false, type: 'bot', difficulty: 'easy' });
        state.players.push({ id: 2, name: "Bot Medium", hand: [], discard: [], isProtected: false, isOut: false, type: 'bot', difficulty: 'medium' });
        state.players.push({ id: 3, name: "Bot Hard", hand: [], discard: [], isProtected: false, isOut: false, type: 'bot', difficulty: 'hard' });
    } else if (mode === 'pass') {
        let count = prompt("How many players? (2-4)", "4");
        count = parseInt(count);
        if(isNaN(count) || count < 2 || count > 4) count = 4;

        for(let i=0; i<count; i++) {
            state.players.push({ id: i, name: `Player ${i+1}`, hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
        }
    } else if (mode === 'multi') {
        if (lobbyPlayers.length < 2) return alert("Need at least 2 players!");

        lobbyPlayers.forEach(p => {
             state.players.push({ id: p.id, name: p.name, hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
        });
    }

    startRound();
    
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'hidden'));
    document.getElementById('game-screen').classList.add('active');

    // Add Quit Button to Game Screen if not there
    addQuitButton();

    renderGame();
    
    if (state.gameMode === 'multi' && isHost) syncClients();
}

function addQuitButton() {
    let btn = document.getElementById('quit-btn');
    if(!btn) {
        const container = document.getElementById('game-info');
        btn = document.createElement('button');
        btn.id = 'quit-btn';
        btn.innerText = "Quit";
        btn.className = 'back-btn';
        btn.style.fontSize = '0.8rem';
        btn.style.padding = '5px 10px';
        btn.style.margin = '0';
        btn.onclick = quitGame;

        container.appendChild(btn);
    }
}

function startRound() {
    state.deck = [];
    CARDS.forEach(card => {
        for(let i=0; i<card.count; i++) state.deck.push(card);
    });
    
    for (let i = state.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]];
    }

    state.removedFaceUp = [];
    state.removedCard = null;

    state.removedCard = state.deck.pop();

    if (state.players.length === 2) {
        for(let i=0; i<3; i++) {
            if(state.deck.length > 0) state.removedFaceUp.push(state.deck.pop());
        }
    }

    state.players.forEach(p => {
        p.hand = [state.deck.pop()];
        p.discard = [];
        p.isProtected = false;
        p.isOut = false;
    });

    state.currentPlayerIndex = 0;
    state.turnPhase = 'draw';
    
    processTurnStart();
}

function processTurnStart() {
    const player = state.players[state.currentPlayerIndex];
    if (player.isOut) {
        nextTurn();
        return;
    }
    
    player.isProtected = false;

    if (state.deck.length > 0) {
        player.hand.push(state.deck.pop());
    } else {
        endRound();
        return;
    }

    state.turnPhase = 'play';
    const name = player.name === "You" ? "Your" : `${player.name}'s`;
    log(`--- ${name} Turn ---`);
    renderGame();

    if (player.type === 'bot') {
        setTimeout(() => botPlay(player), 1000 + Math.random() * 1000);
    }
    if (state.gameMode === 'multi' && isHost) syncClients();
}

// --- Bot Logic ---

function botPlay(bot) {
    if (!isHost && state.gameMode === 'multi') return;

    const hand = bot.hand;
    let cardIdx = 0;
    let targetId = null;
    let guess = 2;

    const hasCountess = hand.find(c => c.value === 7);
    const hasRoyalty = hand.find(c => c.value === 5 || c.value === 6);

    if (hasCountess && hasRoyalty) {
        cardIdx = hand.indexOf(hasCountess);
    } else {
        const options = [0, 1];
        const safeOptions = options.filter(i => hand[i].value !== 8);
        if (safeOptions.length > 0) {
            cardIdx = safeOptions[Math.floor(Math.random() * safeOptions.length)];
        } else {
            cardIdx = 0;
        }
    }

    const card = hand[cardIdx];

    const validTargets = state.players.filter(p => !p.isOut && !p.isProtected && p.id !== bot.id);
    
    if (card.value === 5) {
        if (validTargets.length === 0) targetId = bot.id;
        else targetId = validTargets[Math.floor(Math.random() * validTargets.length)].id;
    } else if ([1, 2, 3, 6].includes(card.value)) {
        if (validTargets.length > 0) {
            targetId = validTargets[Math.floor(Math.random() * validTargets.length)].id;
        } else {
            targetId = null;
        }
    }

    if (card.value === 1) {
        const possible = [2,3,4,5,6,7,8];
        guess = possible[Math.floor(Math.random() * possible.length)];
    }

    processMove(cardIdx, targetId, guess);
}

// --- Interaction ---

let selectedHandIdx = null;

function selectCard(idx) {
    const player = state.players[state.currentPlayerIndex];
    if (state.gameMode === 'multi' && player.id !== state.myPlayerId) return;
    if (player.type !== 'human') return;

    selectedHandIdx = idx;
    renderGame();
    document.getElementById('play-btn').disabled = false;
}

document.getElementById('play-btn').addEventListener('click', () => {
    const player = state.players[state.currentPlayerIndex];
    const card = player.hand[selectedHandIdx];
    
    const otherCard = player.hand[selectedHandIdx === 0 ? 1 : 0];
    if ((otherCard.value === 6 || otherCard.value === 5) && card.value !== 7 && player.hand.some(c=>c.value===7)) {
        alert("You must play the Countess!");
        return;
    }

    const needsTarget = [1, 2, 3, 5, 6].includes(card.value);
    
    if (needsTarget) {
        const opponents = state.players.filter(p => p.id !== player.id && !p.isOut);
        const validOpponents = opponents.filter(p => !p.isProtected);

        if (card.value === 5) {
            if (validOpponents.length === 0) {
                showTargetModal(card, [player]);
            } else {
                showTargetModal(card, [...validOpponents, player]);
            }
        } else {
            if (validOpponents.length === 0) {
                submitMove(selectedHandIdx, null, null);
            } else {
                showTargetModal(card, validOpponents);
            }
        }
    } else {
        submitMove(selectedHandIdx, null, null);
    }
});

function showTargetModal(card, targets) {
    const modal = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-options');
    document.getElementById('modal-title').innerText = `Use ${card.name} on:`;
    content.innerHTML = '';
    
    targets.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'modal-option';
        btn.innerText = p.name + (p.id === state.players[state.currentPlayerIndex].id ? " (You)" : "");
        btn.onclick = () => {
            if (card.value === 1) {
                showGuardGuessModal(selectedHandIdx, p.id);
            } else {
                submitMove(selectedHandIdx, p.id, null);
                closeModal();
            }
        };
        content.appendChild(btn);
    });
    modal.classList.remove('hidden');
}

function showGuardGuessModal(cardIdx, targetId) {
    const content = document.getElementById('modal-options');
    document.getElementById('modal-title').innerText = "Guess Card:";
    content.innerHTML = '';
    const options = [2,3,4,5,6,7,8];
    options.forEach(val => {
        const btn = document.createElement('button');
        btn.className = 'modal-option';
        btn.innerText = CARDS.find(c => c.value === val).name;
        btn.onclick = () => {
            submitMove(cardIdx, targetId, val);
            closeModal();
        };
        content.appendChild(btn);
    });
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

function submitMove(cardIdx, targetId, guess) {
    if (state.gameMode === 'multi' && !isHost) {
        sendData('ACTION', { cardIdx, targetId, guess });
    } else {
        processMove(cardIdx, targetId, guess);
    }
}

// --- Core Logic ---

function processMove(cardIdx, targetId, guess) {
    const player = state.players[state.currentPlayerIndex];
    const playedCard = player.hand.splice(cardIdx, 1)[0];
    player.discard.push(playedCard);
    
    let logMsg = `${player.name} plays ${playedCard.name}`;

    let targetPlayer = state.players.find(p => p.id === targetId);

    if (playedCard.value === 8) {
        log(logMsg);
        eliminate(player, "discarded Princess");
    }
    else if (playedCard.value === 4) {
        player.isProtected = true;
        log(logMsg + " (Protected)");
    }
    else if (playedCard.value === 7) {
        log(logMsg);
    }
    else {
        if (!targetPlayer) {
            log(logMsg + " but has no valid targets.");
        } else {
            logMsg += ` targeting ${targetPlayer.name}`;

            if (playedCard.value === 5) {
                log(logMsg);
                const discard = targetPlayer.hand.pop();
                if (discard) {
                    targetPlayer.discard.push(discard);
                    log(`${targetPlayer.name} discards ${discard.name}.`);

                    if (discard.value === 8) {
                        eliminate(targetPlayer, "forced Princess discard");
                    } else {
                        let draw = null;
                        if (state.deck.length > 0) draw = state.deck.pop();
                        else draw = state.removedCard;

                        if (draw) targetPlayer.hand.push(draw);
                    }
                }
            }
            else if (playedCard.value === 6) {
                log(logMsg);
                const myCard = player.hand[0];
                const theirCard = targetPlayer.hand[0];
                player.hand[0] = theirCard;
                targetPlayer.hand[0] = myCard;
                log("Hands traded.");
            }
            else if (playedCard.value === 3) {
                log(logMsg);
                const myVal = player.hand[0].value;
                const theirVal = targetPlayer.hand[0].value;

                if (player.type === 'human' || targetPlayer.type === 'human') {
                    log(`Baron Compare: ${player.name}(${myVal}) vs ${targetPlayer.name}(${theirVal})`);
                }

                if (myVal > theirVal) {
                    eliminate(targetPlayer, "Baron comparison");
                } else if (theirVal > myVal) {
                    eliminate(player, "Baron comparison");
                } else {
                    log("It's a tie. No one is out.");
                }
            }
            else if (playedCard.value === 2) {
                log(logMsg);
                if (player.type === 'human') {
                    setTimeout(() => alert(`You see ${targetPlayer.name}'s card: ${targetPlayer.hand[0].name}`), 100);
                }
            }
            else if (playedCard.value === 1) {
                log(logMsg + ` guessing ${CARDS.find(c=>c.value===guess).name}`);
                if (targetPlayer.hand[0].value === guess) {
                    log("Correct guess!");
                    eliminate(targetPlayer, "Guard guess");
                } else {
                    log("Wrong guess.");
                }
            }
        }
    }

    selectedHandIdx = null;
    checkWinCondition();
}

function eliminate(player, reason) {
    player.isOut = true;
    if (player.hand.length > 0) {
        const c = player.hand.pop();
        player.discard.push(c);
        log(`${player.name} reveals ${c.name} and is out (${reason})!`);
    } else {
        log(`${player.name} is out (${reason})!`);
    }
}

function checkWinCondition() {
    const active = state.players.filter(p => !p.isOut);
    if (active.length === 1) {
        endGame(active[0]);
        return;
    }

    if (state.deck.length === 0) {
        endRound();
        return;
    }

    nextTurn();
}

function endRound() {
    log("Deck empty! Round Over. Comparing hands...");
    
    const active = state.players.filter(p => !p.isOut);

    active.sort((a, b) => {
        const valA = a.hand[0] ? a.hand[0].value : -1;
        const valB = b.hand[0] ? b.hand[0].value : -1;
        if (valA !== valB) return valB - valA;

        const sumA = a.discard.reduce((s, c) => s + c.value, 0);
        const sumB = b.discard.reduce((s, c) => s + c.value, 0);
        return sumB - sumA;
    });
    
    const winner = active[0];
    endGame(winner);
}

function endGame(winner) {
    state.winner = winner;
    log(`*** ${winner.name} Wins the Round! ***`);
    alert(`${winner.name} Wins!`);
    renderGame();
}

function nextTurn() {
    do {
        state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    } while(state.players[state.currentPlayerIndex].isOut);
    
    processTurnStart();
}

// --- Utils & UI ---

function log(msg) {
    state.logs.unshift(msg);
    const area = document.getElementById('log-area');
    if(area) area.innerHTML = state.logs.map(l => `<div>${l}</div>`).join('');
}

function syncClients() {
    const cleanState = JSON.parse(JSON.stringify(state));
    sendData('SYNC_STATE', cleanState);
}

function renderGame() {
    const playArea = document.getElementById('play-area');
    let removedArea = document.getElementById('removed-cards');
    if (!removedArea && state.removedFaceUp.length > 0) {
        removedArea = document.createElement('div');
        removedArea.id = 'removed-cards';
        playArea.prepend(removedArea);
    }
    if (removedArea) {
        removedArea.innerHTML = '<strong>Removed:</strong> ' + state.removedFaceUp.map(c => c.name).join(', ');
    }

    document.getElementById('deck-count').innerText = `Deck: ${state.deck.length}`;

    const curr = state.players[state.currentPlayerIndex];
    if(curr) {
        const name = curr.name === "You" ? "Your" : `${curr.name}'s`;
        document.getElementById('turn-indicator').innerText = `${name} Turn`;
    }

    const oppContainer = document.getElementById('opponents-container');
    oppContainer.innerHTML = '';
    
    state.players.forEach((p, idx) => {
        const isMe = (state.gameMode === 'single' && idx === 0) || (state.gameMode === 'multi' && p.id === state.myPlayerId) || (state.gameMode === 'pass' && idx === state.currentPlayerIndex);
        
        if (!isMe) {
            const el = document.createElement('div');
            el.className = `opponent ${idx === state.currentPlayerIndex ? 'active' : ''} ${p.isProtected ? 'protected' : ''} ${p.isOut ? 'out' : ''}`;
            el.innerHTML = `
                <div><strong>${p.name}</strong></div>
                <div>Cards: ${p.hand.length}</div>
                <div>Score: ${calculateScore(p)}</div>
            `;
            oppContainer.appendChild(el);
        }
    });

    const handContainer = document.getElementById('player-hand');
    handContainer.innerHTML = '';
    
    let localPlayer = null;
    if (state.gameMode === 'single') localPlayer = state.players[0];
    else if (state.gameMode === 'multi') localPlayer = state.players.find(p => p.id === state.myPlayerId);
    else if (state.gameMode === 'pass') localPlayer = state.players[state.currentPlayerIndex];

    if (localPlayer && !localPlayer.isOut) {
        localPlayer.hand.forEach((card, i) => {
            const el = document.createElement('div');
            el.className = `card ${selectedHandIdx === i ? 'selected' : ''}`;
            el.innerHTML = `
                <div class="value">${card.value}</div>
                <div class="name">${card.name}</div>
                <div class="desc">${card.desc}</div>
            `;
            el.onclick = () => selectCard(i);
            handContainer.appendChild(el);
        });
    }
}

function calculateScore(p) {
    return p.discard.reduce((sum, c) => sum + c.value, 0);
}

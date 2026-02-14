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
    winner: null,
    memory: {} // For bots to track revealed cards: { playerId: { cardValue: int, turnSeen: int } }
};

// --- Sound Manager ---
class SoundManager {
    constructor() {
        this.ctx = null;
        this.enabled = true;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    playTone(freq, type, duration) {
        if (!this.enabled || !this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    play(name) {
        try {
            this.init();
            if(this.ctx && this.ctx.state === 'suspended') this.ctx.resume();

            switch(name) {
                case 'turn': this.playTone(440, 'sine', 0.3); break; // A4
                case 'play': this.playTone(600, 'triangle', 0.1); break;
                case 'win':
                    this.playTone(523.25, 'sine', 0.2); // C5
                    setTimeout(() => this.playTone(659.25, 'sine', 0.2), 200); // E5
                    setTimeout(() => this.playTone(783.99, 'sine', 0.4), 400); // G5
                    break;
                case 'eliminate': this.playTone(150, 'sawtooth', 0.4); break;
                case 'shuffle':
                    // Simulate shuffle noise with quick bursts of white noise (approximated)
                    this.playTone(1000, 'square', 0.05);
                    setTimeout(() => this.playTone(1200, 'square', 0.05), 50);
                    break;
            }
        } catch (e) {
            console.error("Audio error:", e);
        }
    }
}

const audio = new SoundManager();

// --- Theme & Help ---

function toggleTheme() {
    document.body.classList.toggle('light-theme');
    const btn = document.getElementById('theme-btn');
    btn.innerText = document.body.classList.contains('light-theme') ? '🌞' : '🌓';
}

function toggleHelpModal() {
    const modal = document.getElementById('help-modal-overlay');
    const content = document.getElementById('card-list');

    if (modal.classList.contains('hidden')) {
        // Populate
        content.innerHTML = CARDS.map(c => `
            <div class="help-card-row">
                <div style="width: 15%"><strong>${c.value}</strong></div>
                <div style="width: 25%"><strong>${c.name}</strong> (${c.count})</div>
                <div style="width: 60%">${c.desc}</div>
            </div>
        `).join('');
        modal.classList.remove('hidden');
    } else {
        modal.classList.add('hidden');
    }
}


// --- Networking (PeerJS) ---
let peer = null;
let connections = []; // Host: Array of PeerJS connections
let hostConn = null; // Client: Connection to Host
let isHost = false;
let lobbyPlayers = []; // {id, name}

function initPeer(customId = null) {
    if (peer) {
        peer.destroy();
        peer = null;
    }
    const options = { debug: 1 };
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
        if (!isHost) { c.close(); return; }
        handleIncomingConnection(c);
    });

    peer.on('error', (err) => {
        console.error(err);
        if (err.type === 'unavailable-id') {
            alert("Custom ID taken.");
            isHost = false;
        } else {
            alert("Network Error: " + err.type);
        }
    });
}

function handleIncomingConnection(c) {
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
    initPeer();
    if(!peer || peer.destroyed) initPeer();

    if(peer.open) connectToHost(destId);
    else peer.on('open', () => connectToHost(destId));
}

function connectToHost(destId) {
    hostConn = peer.connect(destId);
    hostConn.on('open', () => {
        showLobbyScreen();
        document.getElementById('lobby-status').innerText = "Connected! Waiting for host...";
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
    if(customId) initPeer(customId);
    else {
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
        connections.forEach(c => { if (c.open) c.send({ type, payload }); });
    } else if (hostConn && hostConn.open) {
        hostConn.send({ type, payload });
    }
}

function handleNetworkData(data, sourceConn) {
    if (data.type === 'SYNC_STATE') {
        state = data.payload;
        state.myPlayerId = peer.id;
        renderGame();
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'hidden'));
        document.getElementById('game-screen').classList.add('active');

        // Check for personal notifications/sounds in logs maybe?
        // Or just let log update handle it.

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
    document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
    document.getElementById('lobby-screen').classList.remove('hidden');
    document.getElementById('lobby-screen').classList.add('active');
}

function updateLobbyUI() {
    const list = document.getElementById('lobby-player-list');
    list.innerHTML = lobbyPlayers.map(p => `<div>${p.name} ${p.id === state.myPlayerId ? '(You)' : ''}</div>`).join('');
}

function showMainMenu() {
    if(peer) { peer.destroy(); peer = null; }
    location.reload();
}

function showMultiplayerMenu() {
    document.getElementById('menu-screen').classList.remove('active');
    document.getElementById('multiplayer-screen').classList.add('active');
    document.getElementById('multiplayer-screen').classList.remove('hidden');
    initPeer();
}

function quitGame() {
    if(isHost) {
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
    // Init Audio Context on user gesture
    audio.init();

    state.gameMode = mode;
    state.players = [];
    state.logs = [];
    const logArea = document.getElementById('log-area');
    if(logArea) logArea.innerHTML = ''; // Clear visual log

    state.removedFaceUp = [];
    state.memory = {};

    // Clean up game info buttons (Quit, Play Again)
    const infoContainer = document.getElementById('game-info');
    Array.from(infoContainer.querySelectorAll('button')).forEach(b => b.remove());
    
    if (mode === 'single') {
        state.players.push({ id: 0, name: "You", hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
        state.players.push({ id: 1, name: "Bot Easy", hand: [], discard: [], isProtected: false, isOut: false, type: 'bot', difficulty: 'easy' });
        state.players.push({ id: 2, name: "Bot Medium", hand: [], discard: [], isProtected: false, isOut: false, type: 'bot', difficulty: 'medium' });
        state.players.push({ id: 3, name: "Bot Hard", hand: [], discard: [], isProtected: false, isOut: false, type: 'bot', difficulty: 'hard' });
    } else if (mode === 'pass') {
        let count = prompt("How many players? (2-4)", "4");
        count = parseInt(count);
        if(isNaN(count) || count < 2 || count > 4) count = 4;
        for(let i=0; i<count; i++) state.players.push({ id: i, name: `Player ${i+1}`, hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
    } else if (mode === 'multi') {
        if (lobbyPlayers.length < 2) return alert("Need at least 2 players!");
        lobbyPlayers.forEach(p => {
             state.players.push({ id: p.id, name: p.name, hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
        });
    }

    startRound();
    
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'hidden'));
    document.getElementById('game-screen').classList.add('active');

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
    
    // Shuffle
    for (let i = state.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]];
    }
    audio.play('shuffle');

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
    state.memory = {}; // Reset memory

    processTurnStart();
}

function showPassPlayInterstitial(name, callback) {
    const overlay = document.getElementById('pass-play-overlay');
    document.getElementById('pass-play-msg').innerText = `${name} Turn`;
    overlay.classList.remove('hidden');

    const btn = document.getElementById('pass-play-btn');
    btn.onclick = () => {
        overlay.classList.add('hidden');
        callback();
    };
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

    if (state.gameMode === 'pass') {
        showPassPlayInterstitial(name, () => {
            renderGame();
            const indicator = document.getElementById('turn-indicator');
            if (indicator) {
                indicator.innerText = `${name} Turn`;
                indicator.classList.add('pulse');
            }
            audio.play('turn');
        });
        return;
    }

    // Normal flow
    const indicator = document.getElementById('turn-indicator');
    if (indicator) {
        indicator.innerText = `${name} Turn`;
        if (player.name === "You") {
            audio.play('turn');
            indicator.classList.add('pulse');
        } else {
            indicator.classList.remove('pulse');
        }
    }

    renderGame();

    if (player.type === 'bot') {
        setTimeout(() => botPlay(player), 1500);
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

    // 1. Mandatory Moves
    const hasCountess = hand.find(c => c.value === 7);
    const hasRoyalty = hand.find(c => c.value === 5 || c.value === 6);

    if (hasCountess && hasRoyalty) {
        cardIdx = hand.indexOf(hasCountess);
    } else {
        // 2. Strategy based on Difficulty
        // Simple heuristic: Try not to discard Princess (8)
        const safeOptions = hand.map((c, i) => i).filter(i => hand[i].value !== 8);

        if (safeOptions.length === 0) {
            // Must discard Princess (lose)
            cardIdx = 0;
        } else {
            // Pick a random safe card for Easy
            // Harder bots can prioritize
            if (bot.difficulty === 'hard') {
                // Prioritize Handmaid (4) > Baron (3) > Guard (1)
                // Avoid Prince (5) or King (6) unless necessary?
                // Simplification for now: Pick highest value card that is safe?
                // Or keep high value?
                // Let's just pick random safe for now, but use memory for targeting.
                cardIdx = safeOptions[Math.floor(Math.random() * safeOptions.length)];
            } else {
                cardIdx = safeOptions[Math.floor(Math.random() * safeOptions.length)];
            }
        }
    }

    const card = hand[cardIdx];

    // Target Selection
    const validTargets = state.players.filter(p => !p.isOut && !p.isProtected && p.id !== bot.id);
    
    if (card.value === 5) { // Prince
        // If targeting others is possible, do it. Else target self (unless Princess, but logic handled above).
        if (validTargets.length > 0) {
            targetId = validTargets[Math.floor(Math.random() * validTargets.length)].id;
        } else {
            targetId = bot.id; // Must target self
        }
    } else if ([1, 2, 3, 6].includes(card.value)) {
        if (validTargets.length > 0) {
            // Smart Targeting
            if (bot.difficulty === 'hard') {
                // Target someone we have info on?
                // Or target leader (most cards in discard?) - score logic
                targetId = validTargets[0].id; // Simplified
            } else {
                targetId = validTargets[Math.floor(Math.random() * validTargets.length)].id;
            }
        } else {
            targetId = null; // Card effect fizzles
        }
    }

    // Guard Guessing
    if (card.value === 1 && targetId !== null) {
        // Memory Check for Hard Bot
        if (bot.difficulty === 'hard' && state.memory[targetId]) {
             guess = state.memory[targetId].cardValue;
        } else {
             const possible = [2,3,4,5,6,7,8];
             guess = possible[Math.floor(Math.random() * possible.length)];
        }
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
    
    const hasCountess = player.hand.some(c => c.value === 7);
    const hasRoyalty = player.hand.some(c => c.value === 5 || c.value === 6);

    if (hasCountess && hasRoyalty && card.value !== 7) {
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
    
    audio.play('play');

    let logMsg = `${player.name} plays <strong>${playedCard.name}</strong>`;

    let targetPlayer = state.players.find(p => p.id === targetId);

    // Update Memory: If anyone plays a card, we know they don't have it anymore (obviously)
    // But specific effects reveal cards.

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

                // Memory Update: Host/Bots know who has what now
                if(isHost || state.gameMode !== 'multi') {
                     recordMemory(player.id, theirCard.value);
                     recordMemory(targetPlayer.id, myCard.value);
                }

                log("Hands traded.");
            }
            else if (playedCard.value === 3) {
                log(logMsg);
                const myVal = player.hand[0].value;
                const theirVal = targetPlayer.hand[0].value;

                // Only players involved see the values in real life, but logic compares.
                // We'll reveal in log only if human involved or debug.
                // Actually, standard play: only the two see.

                if (myVal > theirVal) {
                    eliminate(targetPlayer, "Baron comparison");
                } else if (theirVal > myVal) {
                    eliminate(player, "Baron comparison");
                } else {
                    log("It's a tie. No one is out.");
                    // Tie reveals nothing? Or implies equality?
                }
            }
            else if (playedCard.value === 2) {
                log(logMsg);
                const seenCard = targetPlayer.hand[0];

                // Memory Update
                if (isHost || state.gameMode !== 'multi') {
                    recordMemory(targetPlayer.id, seenCard.value);
                }

                if (player.type === 'human') {
                    // Show modal or alert
                    setTimeout(() => alert(`You see ${targetPlayer.name}'s card: ${seenCard.name}`), 100);
                }
            }
            else if (playedCard.value === 1) {
                const guessName = CARDS.find(c=>c.value===guess).name;
                log(logMsg + ` guessing <strong>${guessName}</strong>`);
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

function recordMemory(playerId, cardValue) {
    state.memory[playerId] = { cardValue: cardValue, turn: state.logs.length };
}

function eliminate(player, reason) {
    player.isOut = true;
    audio.play('eliminate');
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
    audio.play('win');
    log(`*** ${winner.name} Wins the Round! ***`);
    alert(`${winner.name} Wins!`);
    renderGame();

    // Play Again Button
    const container = document.getElementById('game-info');
    const btn = document.createElement('button');
    btn.innerText = "Play Again";
    btn.className = 'back-btn';
    btn.style.fontSize = '0.8rem';
    btn.style.padding = '5px 10px';
    btn.style.marginLeft = '10px';
    btn.style.backgroundColor = 'var(--accent)';
    btn.style.color = '#fff';
    btn.onclick = () => startGame(state.gameMode);
    container.appendChild(btn);
}

function nextTurn() {
    do {
        state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    } while(state.players[state.currentPlayerIndex].isOut);
    
    processTurnStart();
}

// --- Utils & UI ---

function log(msg) {
    state.logs.push(msg); // Push to end
    const area = document.getElementById('log-area');
    if(area) {
        const entry = document.createElement('div');
        entry.innerHTML = msg;
        area.appendChild(entry);
        area.scrollTop = area.scrollHeight;
    }
}

function syncClients() {
    const cleanState = JSON.parse(JSON.stringify(state));
    sendData('SYNC_STATE', cleanState);
}

function renderGame() {
    // Deck Count
    document.getElementById('deck-count').innerText = `Deck: ${state.deck.length}`;

    // Last Played
    const lastPlayer = state.players[(state.currentPlayerIndex - 1 + state.players.length) % state.players.length];
    const display = document.getElementById('active-card-display');
    if (lastPlayer && lastPlayer.discard.length > 0) {
        const c = lastPlayer.discard[lastPlayer.discard.length - 1];
        display.innerHTML = `<div class="card" style="transform: scale(0.6); margin: 0; pointer-events: none;">
            <div class="value">${c.value}</div>
            <div class="name">${c.name}</div>
        </div>`;
    } else {
        display.innerHTML = '';
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
                <div>Tiebreaker: ${calculateScore(p)}</div>
            `;
            oppContainer.appendChild(el);
        }
    });

    const playBtn = document.getElementById('play-btn');
    if (playBtn) playBtn.disabled = (selectedHandIdx === null);

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

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
    players: [], // { id, name, hand: [], discard: [], isProtected: false, isOut: false, type: 'human'|'bot', difficulty: 'easy' }
    deck: [],
    currentPlayerIndex: 0,
    gameMode: 'single', // single, pass, multi
    myPlayerId: null, // For multiplayer
    turnPhase: 'draw', // draw, play, effect
    removedCard: null, // Card removed at start of round
    logs: []
};

// --- Networking (PeerJS) ---
let peer = null;
let conn = null;
let isHost = false;

function initPeer() {
    peer = new Peer(null, { debug: 2 });
    peer.on('open', (id) => {
        document.getElementById('peer-id-display').innerText = `Your ID: ${id}`;
        state.myPlayerId = id;
    });
    peer.on('connection', (c) => {
        if(conn) { c.close(); return; } // Only 1v1 supported for simplicity in this demo
        conn = c;
        setupConnection();
        if(isHost) setTimeout(() => startGame('multi', true), 1000);
    });
}

function joinGame() {
    const destId = document.getElementById('remote-id-input').value;
    if(!destId) return alert("Enter an ID!");
    conn = peer.connect(destId);
    setupConnection();
}

function hostGame() {
    isHost = true;
    document.getElementById('peer-id-display').innerText += " (Waiting for opponent...)";
    // UI update to show waiting
}

function setupConnection() {
    conn.on('data', (data) => {
        handleNetworkData(data);
    });
    conn.on('open', () => {
        console.log("Connected!");
        if(!isHost) document.getElementById('peer-id-display').innerText = "Connected! Waiting for host...";
    });
}

function sendData(type, payload) {
    if (conn && conn.open) {
        conn.send({ type, payload });
    }
}

function handleNetworkData(data) {
    if (data.type === 'SYNC_STATE') {
        // Update local state from host
        const oldId = state.myPlayerId;
        state = data.payload;
        state.myPlayerId = oldId; // Keep our ID reference
        renderGame();
    } else if (data.type === 'ACTION') {
        // Host receives action from client
        if (isHost) {
            processMove(data.payload.cardIdx, data.payload.targetId, data.payload.guess);
        }
    }
}

// --- Game Setup ---

function showMultiplayerMenu() {
    document.getElementById('menu-screen').classList.remove('active');
    document.getElementById('multiplayer-screen').classList.add('active');
    document.getElementById('multiplayer-screen').classList.remove('hidden');
    initPeer();
}

function showMainMenu() {
    location.reload(); 
}

function startGame(mode, isMultiHost = false) {
    state.gameMode = mode;
    state.players = [];
    
    // Setup Players
    if (mode === 'single') {
        state.players.push({ id: 0, name: "You", hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
        // Add 3 Bots with different difficulties
        state.players.push({ id: 1, name: "Bot Easy", hand: [], discard: [], isProtected: false, isOut: false, type: 'bot', difficulty: 'easy' });
        state.players.push({ id: 2, name: "Bot Medium", hand: [], discard: [], isProtected: false, isOut: false, type: 'bot', difficulty: 'medium' });
        state.players.push({ id: 3, name: "Bot Hard", hand: [], discard: [], isProtected: false, isOut: false, type: 'bot', difficulty: 'hard' });
    } else if (mode === 'pass') {
        state.players.push({ id: 0, name: "Player 1", hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
        state.players.push({ id: 1, name: "Player 2", hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
        state.players.push({ id: 2, name: "Player 3", hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
        state.players.push({ id: 3, name: "Player 4", hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
    } else if (mode === 'multi') {
        // 2 Player P2P for simplicity in this specific code block
        state.players.push({ id: state.myPlayerId, name: "Host (You)", hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
        state.players.push({ id: conn.peer, name: "Guest", hand: [], discard: [], isProtected: false, isOut: false, type: 'human' });
    }

    startRound();
    
    // UI Switch
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'hidden'));
    document.getElementById('game-screen').classList.add('active');
    renderGame();
    
    if (state.gameMode === 'multi' && isHost) syncClients();
}

function startRound() {
    // 1. Create Deck
    state.deck = [];
    CARDS.forEach(card => {
        for(let i=0; i<card.count; i++) state.deck.push(card);
    });
    
    // Shuffle
    for (let i = state.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]];
    }

    // Remove one card (face down)
    state.removedCard = state.deck.pop();

    // Deal 1 card to each player
    state.players.forEach(p => {
        p.hand = [state.deck.pop()];
        p.discard = [];
        p.isProtected = false;
        p.isOut = false;
    });

    state.currentPlayerIndex = 0; // Winner of prev round usually starts, keeping simple here
    state.turnPhase = 'draw';
    
    processTurnStart();
}

function processTurnStart() {
    const player = state.players[state.currentPlayerIndex];
    if (player.isOut) {
        nextTurn();
        return;
    }
    
    // Draw Card
    if (state.deck.length > 0) {
        player.hand.push(state.deck.pop());
    } else {
        // End Round if deck empty
        endRound();
        return;
    }

    state.turnPhase = 'play';
    log(`Turn: ${player.name}`);
    renderGame();

    if (player.type === 'bot') {
        setTimeout(() => botPlay(player), 1500);
    }
    if (state.gameMode === 'multi' && isHost) syncClients();
}

// --- Bot Logic ---

function botPlay(bot) {
    if (!isHost && state.gameMode === 'multi') return; // Only host runs bots in multi

    const hand = bot.hand;
    let cardIdx = 0;
    let target = null;
    let guess = 1; // Default Guard guess

    // --- Hard Bot Strategy (Calculating) ---
    if (bot.difficulty === 'hard') {
        // 1. Always discard Countess if caught with King/Prince
        const hasCountess = hand.find(c => c.value === 7);
        const hasRoyalty = hand.find(c => c.value === 5 || c.value === 6);
        if (hasCountess && hasRoyalty) {
            cardIdx = hand.indexOf(hasCountess);
        } else {
            // 2. Prioritize attacking high value targets or eliminating
            // Calculate known cards from discards to make better Guard guesses
            const allDiscards = state.players.flatMap(p => p.discard);
            const remainingGuards = 5 - allDiscards.filter(c => c.value === 1).length;
            
            // Logic: if holding Baron (3) and high card, use Baron
            const baronIdx = hand.findIndex(c => c.value === 3);
            const otherCard = hand.find((c, i) => i !== baronIdx);
            if (baronIdx !== -1 && otherCard && otherCard.value > 4) {
                cardIdx = baronIdx;
            } else {
                // Default: Play lower value card to save high value, unless it's a Prince
                if (hand[0].value < hand[1].value && hand[0].value !== 5) cardIdx = 0;
                else if (hand[1].value !== 5) cardIdx = 1;
            }
        }
    } 
    // --- Medium Bot (Heuristic) ---
    else if (bot.difficulty === 'medium') {
         // Simple rule: Don't discard Princess. Play Handmaid early.
         if (hand[0].value === 8) cardIdx = 1;
         else if (hand[1].value === 8) cardIdx = 0;
         else if (hand[0].value === 4) cardIdx = 0;
         else if (hand[1].value === 4) cardIdx = 1;
         else cardIdx = Math.floor(Math.random() * 2);
    }
    // --- Easy Bot (Random) ---
    else {
        cardIdx = Math.floor(Math.random() * 2);
    }

    // Safety check for Countess
    const c = hand[cardIdx];
    const other = hand[cardIdx === 0 ? 1 : 0];
    if ((other.value === 6 || other.value === 5) && hand.find(x => x.value === 7)) {
        cardIdx = hand.findIndex(x => x.value === 7);
    }

    // Pick Target
    const validTargets = state.players.filter(p => !p.isOut && !p.isProtected && p.id !== bot.id);
    if (validTargets.length > 0) {
        // Hard bot targets player with highest known score or randomly
        target = validTargets[Math.floor(Math.random() * validTargets.length)].id;
    } else {
        target = bot.id; // Self target (e.g. Prince) or dummy
    }
    
    // Make Guess (for Guard) - Hard bot counts cards ideally, simplified here to smart random
    if (hand[cardIdx].value === 1) {
        const possible = [2,3,4,5,6,7,8];
        guess = possible[Math.floor(Math.random() * possible.length)];
    }

    processMove(cardIdx, target, guess);
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
    
    // Check Countess Rule
    const otherCard = player.hand[selectedHandIdx === 0 ? 1 : 0];
    if ((otherCard.value === 6 || otherCard.value === 5) && card.value !== 7 && player.hand.some(c=>c.value===7)) {
        alert("You must play the Countess!");
        return;
    }

    // Needs Target? (Guard, Priest, Baron, King, Prince)
    const needsTarget = [1, 2, 3, 5, 6].includes(card.value);
    
    if (needsTarget) {
        // Filter valid targets
        const targets = state.players.filter(p => !p.isOut && (!p.isProtected || card.value === 5) && (card.value === 5 || p.id !== player.id));
        // Note: Prince (5) can target self. Everyone else cannot target self. 
        // Strict rules: if all opponents protected, card is played with no effect (except Prince).
        const enemies = state.players.filter(p => p.id !== player.id && !p.isOut);
        const allProtected = enemies.every(p => p.isProtected);

        if (allProtected && card.value !== 5) {
             // Play without effect
             submitMove(selectedHandIdx, null, null);
        } else {
            showTargetModal(card, targets);
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
        btn.innerText = p.name;
        btn.onclick = () => {
            if (card.value === 1) { // Guard needs guess
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
        // Optimistic UI update could go here, but waiting for host is safer
    } else {
        processMove(cardIdx, targetId, guess);
    }
}

// --- Core Logic ---

function processMove(cardIdx, targetId, guess) {
    const player = state.players[state.currentPlayerIndex];
    const playedCard = player.hand.splice(cardIdx, 1)[0];
    player.discard.push(playedCard);
    
    log(`${player.name} plays ${playedCard.name}`);

    // Effects
    let targetPlayer = state.players.find(p => p.id === targetId);
    
    // Princess
    if (playedCard.value === 8) {
        eliminate(player, "discarded Princess");
    }
    // Handmaid
    else if (playedCard.value === 4) {
        player.isProtected = true;
    }
    // Logic for targeted cards (if target is valid)
    else if (targetPlayer) {
        if (targetPlayer.isProtected && playedCard.value !== 5) {
            log(`${targetPlayer.name} is protected!`);
        } else {
            switch(playedCard.value) {
                case 1: // Guard
                    if (targetPlayer.hand[0].value === guess) {
                        log(`Correct! ${targetPlayer.name} had ${targetPlayer.hand[0].name}.`);
                        eliminate(targetPlayer, "Guard guess");
                    } else {
                        log("Wrong guess.");
                    }
                    break;
                case 2: // Priest
                    if (player.type === 'human') alert(`You see: ${targetPlayer.hand[0].name}`);
                    log(`${player.name} looks at a hand.`);
                    break;
                case 3: // Baron
                    const myVal = player.hand[0].value;
                    const theirVal = targetPlayer.hand[0].value;
                    if (myVal > theirVal) eliminate(targetPlayer, "Baron comparison");
                    else if (theirVal > myVal) eliminate(player, "Baron comparison");
                    else log("It's a tie.");
                    break;
                case 5: // Prince
                    const discard = targetPlayer.hand.pop();
                    log(`${targetPlayer.name} discards ${discard.name}.`);
                    if (discard.value === 8) eliminate(targetPlayer, "forced Princess discard");
                    else {
                        const draw = state.deck.length > 0 ? state.deck.pop() : state.removedCard;
                        targetPlayer.hand.push(draw);
                    }
                    break;
                case 6: // King
                    const temp = player.hand[0];
                    player.hand[0] = targetPlayer.hand[0];
                    targetPlayer.hand[0] = temp;
                    log("Hands traded.");
                    break;
            }
        }
    }

    selectedHandIdx = null;
    checkWinCondition();
}

function eliminate(player, reason) {
    player.isOut = true;
    player.discard.push(...player.hand);
    player.hand = [];
    log(`${player.name} is out (${reason})!`);
}

function checkWinCondition() {
    const active = state.players.filter(p => !p.isOut);
    if (active.length === 1) {
        log(`Winner: ${active[0].name}!`);
        setTimeout(() => alert(`${active[0].name} Wins!`), 500);
        return; // Game Over
    }
    if (state.deck.length === 0 && state.players[state.currentPlayerIndex].hand.length === 1) {
        endRound();
        return;
    }
    nextTurn();
}

function endRound() {
    // Compare hands
    let winner = null;
    let maxVal = -1;
    let tie = false;
    
    state.players.forEach(p => {
        if (!p.isOut && p.hand.length > 0) {
            const val = p.hand[0].value;
            if (val > maxVal) {
                maxVal = val;
                winner = p;
                tie = false;
            } else if (val === maxVal) {
                tie = true;
                // Tie breaker: discard pile sum (simplified: just first found wins in this code for brevity)
            }
        }
    });
    
    if(winner) alert(`Round Over! Winner: ${winner.name} with ${winner.hand[0].name}`);
    else alert("Round Over! It's a total tie!");
}

function nextTurn() {
    state.players[state.currentPlayerIndex].isProtected = false; // protection expires
    
    do {
        state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    } while(state.players[state.currentPlayerIndex].isOut);
    
    processTurnStart();
    if (isHost && state.gameMode === 'multi') syncClients();
}

// --- Utils & UI ---

function log(msg) {
    state.logs.unshift(msg);
    const area = document.getElementById('log-area');
    area.innerHTML = state.logs.map(l => `<div>${l}</div>`).join('');
}

function syncClients() {
    const cleanState = JSON.parse(JSON.stringify(state)); // Deep copy
    // Hide hands for clients
    cleanState.players.forEach(p => {
        if(p.id !== conn.peer) p.hand = p.hand.map(c => ({...c, value: 0, name: "Hidden"})); 
    });
    // But we are sending this TO the guest, so we must hide HOST hand and reveal GUEST hand
    // Actually, simple solution: send full state, client UI hides opponent cards. 
    // In secure app, sanitize here. For this demo, we send full state.
    sendData('SYNC_STATE', state);
}

function renderGame() {
    // Indicators
    document.getElementById('deck-count').innerText = `Deck: ${state.deck.length}`;
    const curr = state.players[state.currentPlayerIndex];
    document.getElementById('turn-indicator').innerText = `${curr.name}'s Turn`;

    // Render Opponents
    const oppContainer = document.getElementById('opponents-container');
    oppContainer.innerHTML = '';
    
    state.players.forEach((p, idx) => {
        // Find relative index to always center "Me" at bottom?
        // For simplicity, just render everyone not-me at top
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

    // Render Player Hand
    const handContainer = document.getElementById('player-hand');
    handContainer.innerHTML = '';
    
    // Determine who is "local" player to render
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

    // Last Played
    const activeDisplay = document.getElementById('active-card-display');
    activeDisplay.innerHTML = '';
    state.players.forEach(p => {
        if(p.discard.length > 0) {
            const last = p.discard[p.discard.length-1];
            // Just showing the very last card played globally would be better
        }
    });
    // Actually, let's just show the log. The 'last played' visual is complex with multiple players.
}

function calculateScore(p) {
    return p.discard.reduce((sum, c) => sum + c.value, 0); // Tie breaker score
}

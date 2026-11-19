/**
 * ==========================================================================
 * TORNEO DEL TALENTO — PANTALLA DE PROYECCIÓN PÚBLICA (/proyeccion)
 * Controlador en tiempo real con Socket.IO para auditorios y pantallas 16:9.
 * Visualización de Lobby, Duelos 1v1, Cronómetro, Revelación, Bracket y Podio.
 * ==========================================================================
 */

(function () {
  "use strict";

  // Símbolos geométricos para opciones tipo Kahoot
  const SHAPES = ["▲", "◆", "●", "■"];

  // Estado del proyector en memoria cliente
  const state = {
    socket: null,
    code: "",
    tournamentName: "Torneo del Talento",
    status: "lobby", // 'select', 'lobby', 'prep', 'duel', 'question', 'reveal', 'bracket', 'podium'
    participants: [],
    currentMatch: null,
    currentQuestion: null,
    rounds: [],
    thirdMatch: null,
    timerInterval: null,
    activeMatchAnswers: new Set(),
    isAudioEnabled: true
  };

  // Referencias del DOM
  const dom = {
    statusBadge: document.getElementById("proj-connection-badge"),
    codeBadge: document.getElementById("proj-header-code"),
    tournamentName: document.getElementById("proj-header-name"),
    btnSound: document.getElementById("btn-proj-sound"),
    btnFullscreen: document.getElementById("btn-proj-fullscreen"),
    panels: {
      select: document.getElementById("panel-code-select"),
      lobby: document.getElementById("panel-lobby"),
      prep: document.getElementById("panel-prep"),
      duel: document.getElementById("panel-duel"),
      question: document.getElementById("panel-question"),
      bracket: document.getElementById("panel-bracket"),
      podium: document.getElementById("panel-podium")
    },
    // Selector de Sala
    codeForm: document.getElementById("code-entry-form"),
    codeInput: document.getElementById("code-entry-input"),
    codeError: document.getElementById("code-entry-error"),
    // Lobby
    qrImage: document.getElementById("lobby-qr-img"),
    lobbyCodeBig: document.getElementById("lobby-code-big"),
    lobbyCount: document.getElementById("lobby-roster-count"),
    rosterGrid: document.getElementById("lobby-roster-grid"),
    rosterEmpty: document.getElementById("lobby-roster-empty"),
    // Duelo 1v1
    duelRoundName: document.getElementById("duel-round-name"),
    fighterAName: document.getElementById("fighter-a-name"),
    fighterAAvatar: document.getElementById("fighter-a-avatar"),
    fighterAScore: document.getElementById("fighter-a-score"),
    fighterAStatus: document.getElementById("fighter-a-status"),
    fighterBName: document.getElementById("fighter-b-name"),
    fighterBAvatar: document.getElementById("fighter-b-avatar"),
    fighterBScore: document.getElementById("fighter-b-score"),
    fighterBStatus: document.getElementById("fighter-b-status"),
    // Pregunta en vivo
    timerBar: document.getElementById("proj-timer-bar"),
    timeClock: document.getElementById("proj-time-clock"),
    qCategory: document.getElementById("proj-q-category"),
    qText: document.getElementById("proj-q-text"),
    optionsGrid: document.getElementById("proj-options-grid"),
    stripPlayerA: document.getElementById("strip-player-a"),
    stripPlayerAName: document.getElementById("strip-player-a-name"),
    stripPlayerB: document.getElementById("strip-player-b"),
    stripPlayerBName: document.getElementById("strip-player-b-name"),
    revealPanel: document.getElementById("proj-reveal-panel"),
    revealExplanation: document.getElementById("proj-reveal-explanation"),
    // Bracket
    bracketViewport: document.getElementById("bracket-viewport"),
    // Podio
    podiumP1Name: document.getElementById("podium-p1-name"),
    podiumP1Points: document.getElementById("podium-p1-points"),
    podiumP2Name: document.getElementById("podium-p2-name"),
    podiumP2Points: document.getElementById("podium-p2-points"),
    podiumP3Name: document.getElementById("podium-p3-name"),
    podiumP3Points: document.getElementById("podium-p3-points"),
    podiumP4Row: document.getElementById("podium-p4-row"),
    podiumP4Name: document.getElementById("podium-p4-name"),
    podiumP4Points: document.getElementById("podium-p4-points")
  };

  /**
   * Cambia el panel visible en la pantalla grande.
   */
  function showPanel(panelName) {
    state.status = panelName;
    Object.keys(dom.panels).forEach((key) => {
      if (dom.panels[key]) {
        dom.panels[key].classList.toggle("active", key === panelName);
      }
    });
  }

  /**
   * Actualiza el badge de conexión superior.
   */
  function updateConnectionBadge(status, text) {
    if (!dom.statusBadge) return;
    dom.statusBadge.className = "badge";
    if (status === "connected") {
      dom.statusBadge.classList.add("badge-connected");
      dom.statusBadge.innerHTML = `<span class="badge-dot badge-pulse"></span> ${text || "En vivo"}`;
    } else if (status === "reconnecting") {
      dom.statusBadge.classList.add("badge-gold");
      dom.statusBadge.innerHTML = `<span class="badge-dot badge-pulse"></span> ${text || "Conectando..."}`;
    } else {
      dom.statusBadge.classList.add("badge-disconnected");
      dom.statusBadge.innerHTML = `<span class="badge-dot"></span> ${text || "Desconectado"}`;
    }
  }

  /**
   * Muestra un toast breve en pantalla.
   */
  function showToast(msg) {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  /**
   * Extrae el código de sala desde la URL actual.
   * Soporta /proyeccion/XXXX, /presentacion/XXXX y ?code=XXXX.
   */
  function extractRoomCode() {
    const urlParams = new URLSearchParams(window.location.search);
    const queryCode = (urlParams.get("code") || urlParams.get("codigo") || "").trim().toUpperCase();
    if (queryCode) return queryCode;

    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2) {
      const candidate = pathParts[1].trim().toUpperCase();
      if (candidate.length >= 3 && candidate !== "PROYECCION") {
        return candidate;
      }
    }
    return "";
  }

  /**
   * Conecta con el servidor Socket.IO y solicita unirse como pantalla de proyección.
   */
  function connectToRoom(code) {
    if (!code) {
      showPanel("select");
      return;
    }

    state.code = code;
    if (dom.codeBadge) {
      dom.codeBadge.innerHTML = `SALA: <b>${code}</b>`;
    }
    if (dom.lobbyCodeBig) {
      dom.lobbyCodeBig.textContent = code;
    }

    // Cargar QR oficial
    if (dom.qrImage) {
      dom.qrImage.src = `/api/tournament/${code}/qr?format=svg`;
    }

    updateConnectionBadge("reconnecting", "Conectando...");

    const socket = window.io ? window.io() : null;
    if (!socket) {
      updateConnectionBadge("disconnected", "Sin conexión");
      showToast("Error: No se pudo cargar el cliente de Socket.IO.");
      return;
    }
    state.socket = socket;

    socket.on("connect", () => {
      updateConnectionBadge("connected", "En vivo");
      socket.emit("join_projection", { code }, (res) => {
        if (res && res.error) {
          if (dom.codeError) dom.codeError.textContent = res.error;
          showPanel("select");
          showToast(res.error);
        } else {
          showPanel("lobby");
        }
      });
    });

    socket.on("disconnect", () => {
      updateConnectionBadge("disconnected", "Desconectado");
    });

    socket.on("reconnect_attempt", () => {
      updateConnectionBadge("reconnecting", "Reconectando...");
    });

    // -------------------------------------------------------------
    // LISTENERS DE EVENTOS DE PROYECCIÓN
    // -------------------------------------------------------------

    // Estado inicial completo entregado por el servidor
    socket.on("projection_state", (payload) => {
      handleProjectionState(payload);
    });

    // Actualización de participantes en sala de espera
    socket.on("lobby_updated", (payload) => {
      handleLobbyUpdated(payload);
    });

    // Comienzo del torneo
    socket.on("tournament_started", (payload) => {
      handleTournamentStarted(payload);
    });

    // Lanzamiento de pregunta en vivo
    socket.on("question_started", (payload) => {
      handleQuestionStarted(payload);
    });

    // Confirmación de respuesta de algún jugador (sin revelar opción)
    socket.on("answer_acknowledged", (payload) => {
      handleAnswerAcknowledged(payload);
    });

    // Revelación oficial de la respuesta por el organizador / cronómetro
    socket.on("question_revealed", (payload) => {
      handleQuestionRevealed(payload);
    });

    // Aviso de desconexión de jugador
    socket.on("duel_player_disconnected", (data) => {
      showToast(`⚠️ ${data.name || "Un competidor"} perdió conexión temporal.`);
    });

    // Desconexión de ambos competidores (gracia de 30s)
    socket.on("duel_both_disconnected", (data) => {
      showToast("Pausa: ambos competidores perdieron conexión temporal.");
    });

    // Módulo 2.5: Eventos de duelo en proyección
    socket.on("match_started", (payload) => {
      handleMatchStarted(payload);
    });

    socket.on("question_closed", (payload) => {
      handleQuestionClosed(payload);
    });

    socket.on("duel_result", (payload) => {
      handleDuelResult(payload);
    });

    socket.on("tournament_finished", (payload) => {
      handleTournamentFinished(payload);
    });
  }

  /**
   * Procesa el estado inicial recibido tras join_projection.
   */
  function handleProjectionState(payload) {
    if (!payload) return;
    state.tournamentName = payload.name || state.tournamentName;
    if (dom.tournamentName) {
      dom.tournamentName.textContent = state.tournamentName;
    }

    state.rounds = payload.rounds || [];
    state.thirdMatch = payload.thirdMatch || null;

    if (payload.status === "active") {
      if (payload.duelState === "question_active" && payload.activeQuestion) {
        handleQuestionStarted({
          question: payload.activeQuestion,
          matchId: payload.currentMatchId,
          durationMs: payload.durationMs,
          startTime: payload.startTime
        });
      } else {
        showPanel("bracket");
        renderBracket(state.rounds);
      }
    } else if (payload.status === "finished") {
      showPanel("podium");
      renderPodiumFromState();
    } else {
      showPanel("lobby");
      renderLobbyParticipants(payload.participants || []);
    }
  }

  /**
   * Actualiza el mosaico del lobby con animación para nuevos participantes.
   */
  function handleLobbyUpdated(payload) {
    const list = payload?.participants || [];
    const prevCount = state.participants.length;
    state.participants = list;

    if (dom.lobbyCount) {
      dom.lobbyCount.textContent = `${list.length} inscritos`;
    }

    renderLobbyParticipants(list);

    // Si entró un nuevo participante, emitir sonido breve
    if (list.length > prevCount && window.TalentoAudio) {
      window.TalentoAudio.play("tap");
    }
  }

  /**
   * Renderiza las fichas de los participantes en el mosaico.
   */
  function renderLobbyParticipants(list) {
    if (!dom.rosterGrid) return;
    dom.rosterGrid.innerHTML = "";

    if (list.length === 0) {
      if (dom.rosterEmpty) dom.rosterEmpty.style.display = "block";
      return;
    }

    if (dom.rosterEmpty) dom.rosterEmpty.style.display = "none";

    list.forEach((p) => {
      const chip = document.createElement("div");
      chip.className = "player-card-chip";
      const initial = (p.name || "P").charAt(0).toUpperCase();
      chip.innerHTML = `
        <div class="chip-avatar">${initial}</div>
        <span>${p.name}</span>
      `;
      dom.rosterGrid.appendChild(chip);
    });
  }

  /**
   * Maneja el inicio oficial del torneo.
   */
  function handleTournamentStarted(payload) {
    state.rounds = payload?.rounds || [];
    state.thirdMatch = payload?.thirdMatch || null;

    showPanel("prep");
    if (window.TalentoAudio) window.TalentoAudio.play("win");
    showToast("¡El torneo ha iniciado oficialmente!");

    // Tras 3 segundos de cortinilla de preparación, mostrar el cuadro o el primer duelo
    setTimeout(() => {
      showPanel("bracket");
      renderBracket(state.rounds);
    }, 3200);
  }

  /**
   * Maneja el lanzamiento de una pregunta en vivo.
   */
  function handleQuestionStarted(payload) {
    const { question, matchId, durationMs, startTime } = payload || {};
    state.currentQuestion = question;
    state.activeMatchAnswers.clear();

    if (!question) return;

    if (dom.qCategory) dom.qCategory.textContent = question.category || "General";
    if (dom.qText) dom.qText.textContent = question.question || "";

    // Resetear indicadores inferiores de respuesta
    if (dom.stripPlayerA) dom.stripPlayerA.classList.remove("has-answered");
    if (dom.stripPlayerB) dom.stripPlayerB.classList.remove("has-answered");
    if (dom.revealPanel) dom.revealPanel.style.display = "none";

    // Renderizar opciones estilo Kahoot
    renderProjectionOptions(question);

    // Iniciar cronómetro autoritativo
    startCountdown(startTime, durationMs || 20000);

    showPanel("question");
    if (window.TalentoAudio) window.TalentoAudio.play("tap");
  }

  /**
   * Renderiza las opciones en la pantalla gigante.
   */
  function renderProjectionOptions(q) {
    if (!dom.optionsGrid) return;
    dom.optionsGrid.innerHTML = "";

    if (q.type === "mc") {
      dom.optionsGrid.className = "proj-options-grid four";
      (q.options || []).forEach((optText, idx) => {
        const card = document.createElement("div");
        card.className = `proj-option-card opt-${idx % 4}`;
        card.dataset.index = idx;
        card.innerHTML = `
          <span class="shape">${SHAPES[idx % 4]}</span>
          <span class="text">${optText}</span>
        `;
        dom.optionsGrid.appendChild(card);
      });
    } else if (q.type === "vf") {
      dom.optionsGrid.className = "proj-options-grid two";
      const cardV = document.createElement("div");
      cardV.className = "proj-option-card opt-1";
      cardV.innerHTML = `<span class="shape">✓</span><span class="text">Verdadero</span>`;

      const cardF = document.createElement("div");
      cardF.className = "proj-option-card opt-0";
      cardF.innerHTML = `<span class="shape">✗</span><span class="text">Falso</span>`;

      dom.optionsGrid.appendChild(cardV);
      dom.optionsGrid.appendChild(cardF);
    } else {
      // Ordenamiento / Numérico
      dom.optionsGrid.className = "proj-options-grid two";
      const notice = document.createElement("div");
      notice.className = "proj-option-card opt-1";
      notice.style.gridColumn = "1 / -1";
      notice.innerHTML = `<span class="shape">⚙️</span><span class="text">Pregunta de aplicación técnica — Los participantes responden en sus dispositivos.</span>`;
      dom.optionsGrid.appendChild(notice);
    }
  }

  /**
   * Sincroniza el cronómetro autoritativo en la pantalla de proyección.
   */
  function startCountdown(startTimeMs, durationMs) {
    if (state.timerInterval) clearInterval(state.timerInterval);

    const start = startTimeMs || Date.now();
    const end = start + durationMs;

    function tick() {
      const now = Date.now();
      const remainingMs = Math.max(0, end - now);
      const remainingSec = Math.ceil(remainingMs / 1000);
      const pct = Math.max(0, (remainingMs / durationMs) * 100);

      if (dom.timeClock) {
        dom.timeClock.textContent = `${remainingSec}s`;
        dom.timeClock.classList.toggle("critical", remainingSec <= 5);
      }

      if (dom.timerBar) {
        dom.timerBar.style.width = `${pct}%`;
        dom.timerBar.classList.toggle("critical", remainingSec <= 5);
      }

      if (remainingSec <= 5 && remainingSec > 0 && remainingMs % 1000 < 100) {
        if (window.TalentoAudio) window.TalentoAudio.play("warning");
      }

      if (remainingMs <= 0) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }
    }

    tick();
    state.timerInterval = setInterval(tick, 100);
  }

  /**
   * Marca en la arena de proyección que un competidor ya respondió (sin revelar opción).
   */
  function handleAnswerAcknowledged(payload) {
    const { participantId } = payload || {};
    state.activeMatchAnswers.add(participantId);

    // Comprobar si corresponde a Player A o Player B
    if (dom.stripPlayerA && participantId === dom.stripPlayerA.dataset.id) {
      dom.stripPlayerA.classList.add("has-answered");
    } else if (dom.stripPlayerB && participantId === dom.stripPlayerB.dataset.id) {
      dom.stripPlayerB.classList.add("has-answered");
    }

    if (window.TalentoAudio) window.TalentoAudio.play("tap");
  }

  /**
   * Revela la respuesta correcta en la pantalla gigante.
   */
  function handleQuestionRevealed(payload) {
    if (state.timerInterval) clearInterval(state.timerInterval);

    const { question, isCorrect, explanation } = payload || {};
    const correctOpt = question?.correctAnswer;

    // Resaltar la tarjeta correcta y atenuar las demás
    if (dom.optionsGrid) {
      const cards = dom.optionsGrid.querySelectorAll(".proj-option-card");
      cards.forEach((card) => {
        const textSpan = card.querySelector(".text");
        const cardText = textSpan ? textSpan.textContent.trim() : "";
        if (correctOpt !== undefined && cardText.toLowerCase() === String(correctOpt).toLowerCase()) {
          card.classList.add("revealed-correct");
        } else {
          card.classList.add("dimmed");
        }
      });
    }

    // Mostrar panel explicativo
    if (dom.revealPanel) {
      dom.revealPanel.style.display = "block";
      if (dom.revealExplanation) {
        dom.revealExplanation.textContent = explanation || question?.explanation || "Respuesta procesada.";
      }
    }

    // Actualizar marcadores de la arena con los puntajes actualizados
    if (payload.matchScores) {
      if (dom.fighterAScore) dom.fighterAScore.textContent = payload.matchScores.scoreA ?? 0;
      if (dom.fighterBScore) dom.fighterBScore.textContent = payload.matchScores.scoreB ?? 0;
    }

    if (window.TalentoAudio) window.TalentoAudio.play("ok");
  }

  function handleMatchStarted(payload) {
    state.currentMatch = payload;
    showPanel("duel");

    if (dom.duelRoundName) {
      dom.duelRoundName.textContent = `Duelo ${payload.matchId}`;
    }

    if (dom.fighterAName) dom.fighterAName.textContent = payload.playerA?.name || "Competidor 1";
    if (dom.fighterBName) dom.fighterBName.textContent = payload.playerB?.name || "Competidor 2";
    if (dom.fighterAScore) dom.fighterAScore.textContent = "0";
    if (dom.fighterBScore) dom.fighterBScore.textContent = "0";

    if (dom.fighterAAvatar) dom.fighterAAvatar.textContent = (payload.playerA?.name || "A").charAt(0).toUpperCase();
    if (dom.fighterBAvatar) dom.fighterBAvatar.textContent = (payload.playerB?.name || "B").charAt(0).toUpperCase();

    // Sincronizar identificadores para el reconocimiento de respuestas
    if (dom.stripPlayerA) {
      dom.stripPlayerA.dataset.id = payload.playerA?.id || "";
      dom.stripPlayerA.classList.remove("has-answered");
    }
    if (dom.stripPlayerB) {
      dom.stripPlayerB.dataset.id = payload.playerB?.id || "";
      dom.stripPlayerB.classList.remove("has-answered");
    }
    if (dom.stripPlayerAName) dom.stripPlayerAName.textContent = payload.playerA?.name || "Competidor 1";
    if (dom.stripPlayerBName) dom.stripPlayerBName.textContent = payload.playerB?.name || "Competidor 2";

    if (window.TalentoAudio) window.TalentoAudio.play("tap");
  }

  function handleQuestionClosed(payload) {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    if (dom.timeClock) dom.timeClock.textContent = "0s";
    if (dom.timerBar) dom.timerBar.style.width = "0%";
  }

  function handleDuelResult(payload) {
    if (dom.fighterAScore && payload.winner && dom.stripPlayerA) {
      if (payload.winner.id === dom.stripPlayerA.dataset.id) {
        dom.fighterAScore.textContent = payload.winner.score;
      } else {
        dom.fighterAScore.textContent = payload.loser.score;
      }
    }
    if (dom.fighterBScore && payload.winner && dom.stripPlayerB) {
      if (payload.winner.id === dom.stripPlayerB.dataset.id) {
        dom.fighterBScore.textContent = payload.winner.score;
      } else {
        dom.fighterBScore.textContent = payload.loser.score;
      }
    }

    state.rounds = payload.rounds || state.rounds;
    state.thirdMatch = payload.thirdMatch || state.thirdMatch;

    showToast(`🏆 Ganador del duelo: ${payload.winner?.name}!`);

    setTimeout(() => {
      showPanel("bracket");
      renderBracket(state.rounds);
    }, 3500);
  }

  function handleTournamentFinished(payload) {
    showPanel("podium");
    const p = payload.podium || [];
    renderPodium(p[0], p[1], p[2], p[3]);
  }

  /**
   * Renderiza el cuadro de eliminación (bracket) en la pantalla.
   */
  function renderBracket(rounds) {
    if (!dom.bracketViewport || !Array.isArray(rounds)) return;
    dom.bracketViewport.innerHTML = "";

    rounds.forEach((roundMatches, roundIdx) => {
      const col = document.createElement("div");
      col.className = "bracket-round-column";

      const header = document.createElement("div");
      header.className = "round-col-header";
      header.textContent = getRoundTitle(roundIdx, rounds.length);
      col.appendChild(header);

      roundMatches.forEach((m) => {
        const node = document.createElement("div");
        node.className = "bracket-match-node" + (m.status === "active" ? " active-duel" : "");

        const pAName = m.playerA ? (m.playerA.name || "Por definir") : "BYE";
        const pBName = m.playerB ? (m.playerB.name || "Por definir") : "BYE";

        node.innerHTML = `
          <div class="node-player ${m.winnerId === m.playerA?.id ? "winner" : ""}">
            <span class="name">${pAName}</span>
            <span class="score">${m.scoreA !== undefined ? m.scoreA : ""}</span>
          </div>
          <div class="node-player ${m.winnerId === m.playerB?.id ? "winner" : ""}">
            <span class="name">${pBName}</span>
            <span class="score">${m.scoreB !== undefined ? m.scoreB : ""}</span>
          </div>
        `;
        col.appendChild(node);
      });

      dom.bracketViewport.appendChild(col);
    });
  }

  function getRoundTitle(idx, total) {
    if (idx === total - 1) return "Gran Final";
    if (idx === total - 2) return "Semifinales";
    if (idx === total - 3) return "Cuartos de Final";
    return `Ronda ${idx + 1}`;
  }

  /**
   * Renderiza el podio de ganadores (hasta 4° lugar).
   */
  function renderPodium(p1, p2, p3, p4) {
    showPanel("podium");
    if (dom.podiumP1Name) dom.podiumP1Name.textContent = p1?.name || "1° Puesto";
    if (dom.podiumP1Points) dom.podiumP1Points.textContent = p1?.score ? `${p1.score} pts` : "Campeón";

    if (dom.podiumP2Name) dom.podiumP2Name.textContent = p2?.name || "2° Puesto";
    if (dom.podiumP2Points) dom.podiumP2Points.textContent = p2?.score ? `${p2.score} pts` : "Subcampeón";

    if (dom.podiumP3Name) dom.podiumP3Name.textContent = p3?.name || "3° Puesto";
    if (dom.podiumP3Points) dom.podiumP3Points.textContent = p3?.score ? `${p3.score} pts` : "Tercer Puesto";

    // 4° lugar: sólo se muestra si existe (torneos de 4+ jugadores)
    if (p4 && dom.podiumP4Row) {
      dom.podiumP4Row.style.display = "block";
      if (dom.podiumP4Name) dom.podiumP4Name.textContent = p4.name || "4° Lugar";
      if (dom.podiumP4Points) dom.podiumP4Points.textContent = p4.score ? `${p4.score} pts` : "";
    } else if (dom.podiumP4Row) {
      dom.podiumP4Row.style.display = "none";
    }

    if (window.TalentoConfetti) {
      window.TalentoConfetti.start(6000, 120);
    }
    if (window.TalentoAudio) {
      window.TalentoAudio.play("win");
    }
  }

  function renderPodiumFromState() {
    // Si los participantes tienen score, ordenar de mayor a menor
    const sorted = state.participants.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    renderPodium(sorted[0], sorted[1], sorted[2], sorted[3]);
  }

  /**
   * Configura eventos de interfaz (pantalla completa, sonido, selector).
   */
  function bindUI() {
    // Formulario de ingreso de código si se accede a /proyeccion directamente
    if (dom.codeForm) {
      dom.codeForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const entered = (dom.codeInput?.value || "").trim().toUpperCase();
        if (entered.length >= 3) {
          connectToRoom(entered);
        } else if (dom.codeError) {
          dom.codeError.textContent = "Ingresa un código de sala válido.";
        }
      });
    }

    // Toggle de pantalla completa
    if (dom.btnFullscreen) {
      dom.btnFullscreen.addEventListener("click", () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }

    // Toggle de sonido
    if (dom.btnSound) {
      dom.btnSound.addEventListener("click", () => {
        if (window.TalentoAudio) {
          const enabled = window.TalentoAudio.toggle();
          dom.btnSound.textContent = enabled ? "🔊" : "🔇";
          showToast(enabled ? "Sonido activado" : "Sonido silenciado");
        }
      });
    }
  }

  // Inicialización
  document.addEventListener("DOMContentLoaded", () => {
    bindUI();
    const code = extractRoomCode();
    connectToRoom(code);
  });
})();

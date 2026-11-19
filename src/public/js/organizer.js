/**
 * ==========================================================================
 * TORNEO DEL TALENTO — CONTROLADOR DEL ORGANIZADOR (/organizador)
 * Panel de administración para crear, supervisar y controlar torneos en tiempo real.
 * ==========================================================================
 */

(function () {
  "use strict";

  // Estado del organizador en memoria.
  // adminSecret se persiste en sessionStorage (solo vive en esta pestaña, se borra al cerrar).
  const state = {
    socket: null,
    code: "",
    name: "Sin torneo seleccionado",
    status: "idle", // 'idle', 'lobby', 'active', 'finished'
    participants: [],
    rounds: [],
    thirdMatch: null,
    adminSecret: "",
    isAuthenticated: false,
    apiStatus: null,
    duelState: "idle",
    currentMatch: null,
    matchScores: { scoreA: 0, scoreB: 0 }
  };

  // ── Persistencia de sesión ──────────────────────────────────────────────
  // Guardamos code + adminSecret en sessionStorage para sobrevivir F5.
  // sessionStorage es por-pestaña y no persiste entre sesiones del navegador,
  // lo que es suficientemente seguro para una clave de administrador temporal.
  function saveSession() {
    if (!state.code || !state.adminSecret) return;
    try {
      sessionStorage.setItem(
        "org_session",
        JSON.stringify({ code: state.code, adminSecret: state.adminSecret, name: state.name, status: state.status })
      );
    } catch (_) {}
  }

  function clearSession() {
    try { sessionStorage.removeItem("org_session"); } catch (_) {}
  }

  function loadSavedSession() {
    try {
      const raw = sessionStorage.getItem("org_session");
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  // Elementos del DOM
  const dom = {
    // Cabecera
    sessionCodeBadge: document.getElementById("org-session-code"),
    connectionBadge: document.getElementById("org-connection-badge"),
    authBadge: document.getElementById("org-auth-badge"),
    // Pestañas
    navBtns: document.querySelectorAll(".org-nav-btn"),
    tabPanels: {
      summary: document.getElementById("tab-summary"),
      create: document.getElementById("tab-create"),
      lobby: document.getElementById("tab-lobby"),
      matches: document.getElementById("tab-matches"),
      connection: document.getElementById("tab-connection")
    },
    // Métricas Resumen
    summaryTourneyName: document.getElementById("summary-tourney-name"),
    summaryTourneyStatus: document.getElementById("summary-tourney-status"),
    metricParticipants: document.getElementById("metric-participants"),
    metricMatches: document.getElementById("metric-matches"),
    metricRoomCode: document.getElementById("metric-room-code"),
    btnOpenProjection: document.getElementById("btn-open-projection"),
    btnOpenParticipant: document.getElementById("btn-open-participant"),
    // Formulario Crear Torneo
    formCreate: document.getElementById("form-create-tournament"),
    btnSubmitCreate: document.getElementById("btn-submit-create"),
    createError: document.getElementById("create-error"),
    // Formulario Conectar Sala Existente
    formConnect: document.getElementById("form-connect-existing"),
    connectCodeInput: document.getElementById("connect-code-input"),
    connectSecretInput: document.getElementById("connect-secret-input"),
    connectError: document.getElementById("connect-error"),
    // Sala de Espera (Lobby)
    lobbyCodeBig: document.getElementById("lobby-code-display"),
    lobbyTotalBadge: document.getElementById("lobby-total-badge"),
    lobbyQrImg: document.getElementById("lobby-qr-img"),
    participantsTableBody: document.getElementById("participants-table-body"),
    btnStartTournament: document.getElementById("btn-start-tournament"),
    btnRefreshLobby: document.getElementById("btn-refresh-lobby"),
    // Modal Iniciar Torneo
    modalConfirmStart: document.getElementById("modal-confirm-start"),
    btnConfirmStartAction: document.getElementById("btn-confirm-start-action"),
    btnCancelStartAction: document.getElementById("btn-cancel-start-action"),
    // Cuadro de Duelos
    matchesStatusAlert: document.getElementById("matches-status-alert"),
    bracketPreviewBox: document.getElementById("bracket-preview-box"),
    // Panel de Control del Duelo
    duelControlPanel: document.getElementById("duel-control-panel"),
    btnStartMatch: document.getElementById("btn-start-match"),
    btnLaunchQuestion: document.getElementById("btn-launch-question"),
    btnCloseQuestion: document.getElementById("btn-close-question"),
    btnRevealAnswer: document.getElementById("btn-reveal-answer"),
    btnNextMatch: document.getElementById("btn-next-match"),
    btnFinishTournament: document.getElementById("btn-finish-tournament"),
    duelStatusText: document.getElementById("duel-status-text"),
    duelScoreA: document.getElementById("duel-score-a"),
    duelScoreB: document.getElementById("duel-score-b"),
    duelNameA: document.getElementById("duel-name-a"),
    duelNameB: document.getElementById("duel-name-b"),
    activeMatchSelect: document.getElementById("active-match-select"),
    // Centro de Conexión
    connSocketState: document.getElementById("conn-socket-state"),
    connDbState: document.getElementById("conn-db-state"),
    connDbLatency: document.getElementById("conn-db-latency"),
    connQuestionsLoaded: document.getElementById("conn-questions-loaded"),
    btnRefreshHealth: document.getElementById("btn-refresh-health")
  };

  /**
   * Muestra una pestaña del panel.
   */
  function switchTab(tabName) {
    dom.navBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });

    Object.keys(dom.tabPanels).forEach((key) => {
      if (dom.tabPanels[key]) {
        dom.tabPanels[key].classList.toggle("active", key === tabName);
      }
    });
  }

  /**
   * Muestra una notificación toast breve.
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
      setTimeout(() => toast.remove(), 250);
    }, 2800);
  }

  /**
   * Actualiza el badge de estado de conexión.
   */
  function updateConnectionBadge(status, text) {
    if (!dom.connectionBadge) return;
    dom.connectionBadge.className = "badge";
    if (status === "connected") {
      dom.connectionBadge.classList.add("badge-connected");
      dom.connectionBadge.innerHTML = `<span class="badge-dot badge-pulse"></span> ${text || "En línea"}`;
    } else if (status === "reconnecting") {
      dom.connectionBadge.classList.add("badge-gold");
      dom.connectionBadge.innerHTML = `<span class="badge-dot badge-pulse"></span> ${text || "Reconectando..."}`;
    } else {
      dom.connectionBadge.classList.add("badge-disconnected");
      dom.connectionBadge.innerHTML = `<span class="badge-dot"></span> ${text || "Desconectado"}`;
    }

    if (dom.connSocketState) {
      dom.connSocketState.textContent = status === "connected" ? "Conectado al servidor" : "Sin conexión";
      dom.connSocketState.style.color = status === "connected" ? "var(--ok)" : "var(--bad)";
    }
  }

  /**
   * Actualiza el badge de autenticación.
   */
  function updateAuthBadge(isAuthenticated) {
    state.isAuthenticated = isAuthenticated;
    if (!dom.authBadge) return;
    dom.authBadge.className = "badge " + (isAuthenticated ? "badge-connected" : "badge-disconnected");
    dom.authBadge.textContent = isAuthenticated ? "Admin Autorizado" : "Sin Autenticar";
  }

  /**
   * Inicializa la conexión con Socket.IO y sus listeners.
   */
  function initSocket() {
    updateConnectionBadge("reconnecting", "Iniciando...");

    const socket = window.io ? window.io() : null;
    if (!socket) {
      updateConnectionBadge("disconnected", "Sin conexión");
      return;
    }
    state.socket = socket;

    function handleConnect() {
      updateConnectionBadge("connected", "En línea");

      // Si hay sesión guardada o en memoria, re-autenticar
      if (state.code && state.adminSecret) {
        authenticateOrganizer(state.code, state.adminSecret, true);
      }
    }

    socket.on("connect", handleConnect);
    // Si el socket ya está conectado al momento de registrar el handler
    if (socket.connected) {
      handleConnect();
    }

    // Estado completo de la sala tras auth_organizer → join_projection
    socket.on("projection_state", (payload) => {
      if (!payload) return;

      // Restaurar estado de torneo desde el servidor
      if (payload.status && payload.status !== "idle") {
        state.status = payload.status;
      }
      if (payload.name) state.name = payload.name;
      if (Array.isArray(payload.participants)) {
        state.participants = payload.participants;
      }
      if (Array.isArray(payload.rounds)) {
        state.rounds = payload.rounds;
      }
      if (payload.thirdMatch !== undefined) {
        state.thirdMatch = payload.thirdMatch;
      }

      updateSummaryMetrics();
      updateLobbyView();

      // Si el torneo ya estaba activo, mostrar el bracket directamente
      if (state.status === "active" || state.status === "finished") {
        renderMatchesView();
        switchTab("matches");
      } else if (state.status === "lobby") {
        switchTab("lobby");
        // Recargar QR si aún no estaba cargado
        if (dom.lobbyQrImg && (!dom.lobbyQrImg.src || dom.lobbyQrImg.src === window.location.href)) {
          dom.lobbyQrImg.src = `/api/tournament/${state.code}/qr?format=svg`;
        }
      }
    });

    socket.on("disconnect", () => {
      updateConnectionBadge("disconnected", "Desconectado");
      updateAuthBadge(false);
    });

    socket.on("reconnect_attempt", () => {
      updateConnectionBadge("reconnecting", "Reconectando...");
    });

    // Actualización de participantes en sala de espera
    socket.on("lobby_updated", (payload) => {
      const previousCount = state.participants.length;
      state.participants = payload?.participants || [];
      const newCount = state.participants.length;

      updateLobbyView();
      updateSummaryMetrics();

      // Toast solo si llegó un nuevo participante (no en la carga inicial)
      if (previousCount > 0 && newCount > previousCount) {
        const newest = state.participants[state.participants.length - 1];
        showToast(`👤 Nuevo inscrito: ${newest?.name || "participante"} (${newCount} en sala)`);
      } else if (previousCount === 0 && newCount === 1) {
        const newest = state.participants[0];
        showToast(`👤 Primer inscrito: ${newest?.name || "participante"}`);
      }
    });

    // Torneo iniciado oficialmente
    socket.on("tournament_started", (payload) => {
      state.status = "active";
      state.rounds = payload?.rounds || [];
      state.thirdMatch = payload?.thirdMatch || null;
      updateSummaryMetrics();
      renderMatchesView();
      showToast("¡El torneo ha sido iniciado!");
    });

    // Módulo 2.5: Eventos de Orquestación de Duelo
    socket.on("match_started", (payload) => {
      handleMatchStarted(payload);
    });

    socket.on("question_started", (payload) => {
      handleOrgQuestionStarted(payload);
    });

    socket.on("question_closed", (payload) => {
      handleOrgQuestionClosed(payload);
    });

    socket.on("question_revealed", (payload) => {
      handleOrgQuestionRevealed(payload);
    });

    socket.on("duel_result", (payload) => {
      handleDuelResult(payload);
    });

    socket.on("tournament_finished", (payload) => {
      handleTournamentFinished(payload);
    });
  }

  // -------------------------------------------------------------
  // MÓDULO 2.5: MANEJADORES DE ESTADO DE DUELO EN TIEMPO REAL
  // -------------------------------------------------------------

  function updateDuelButtons(duelState) {
    state.duelState = duelState;
    if (!dom.duelControlPanel) return;

    dom.duelControlPanel.style.display = "block";

    if (dom.btnLaunchQuestion) dom.btnLaunchQuestion.disabled = (duelState !== "match_ready" && duelState !== "answer_revealed");
    if (dom.btnCloseQuestion) dom.btnCloseQuestion.disabled = (duelState !== "question_active");
    if (dom.btnRevealAnswer) dom.btnRevealAnswer.disabled = (duelState !== "question_closed");
    if (dom.btnNextMatch) dom.btnNextMatch.disabled = (duelState !== "answer_revealed");
    if (dom.btnFinishTournament) dom.btnFinishTournament.disabled = false;
  }

  function handleMatchStarted(payload) {
    state.currentMatch = payload;
    updateDuelButtons("match_ready");

    if (dom.duelStatusText) dom.duelStatusText.textContent = `Duelo ${payload.matchId} en curso — Listo para lanzar pregunta`;
    if (dom.duelNameA) dom.duelNameA.textContent = payload.playerA?.name || "Jugador A";
    if (dom.duelNameB) dom.duelNameB.textContent = payload.playerB?.name || "Jugador B";
    if (dom.duelScoreA) dom.duelScoreA.textContent = "0";
    if (dom.duelScoreB) dom.duelScoreB.textContent = "0";

    // Marcar el enfrentamiento como in_progress en el bracket local
    if (Array.isArray(state.rounds)) {
      for (const round of state.rounds) {
        if (Array.isArray(round)) {
          for (const m of round) {
            if (m && m.id === payload.matchId) {
              m.status = "in_progress";
            }
          }
        }
      }
    }
    if (state.thirdMatch && state.thirdMatch.id === payload.matchId) {
      state.thirdMatch.status = "in_progress";
    }
    renderMatchesView();

    showToast(`⚔️ Duelo ${payload.matchId} activado: ${payload.playerA?.name} vs ${payload.playerB?.name}`);
  }

  function handleOrgQuestionStarted(payload) {
    updateDuelButtons("question_active");
    if (dom.duelStatusText) {
      dom.duelStatusText.textContent = `Pregunta ${payload.questionOrder || 1}/${payload.totalQuestions || 2} activa — Tiempo en marcha`;
    }
  }

  function handleOrgQuestionClosed(payload) {
    updateDuelButtons("question_closed");
    if (dom.duelStatusText) {
      dom.duelStatusText.textContent = "Tiempo cerrado — Listo para revelar respuestas";
    }
  }

  function handleOrgQuestionRevealed(payload) {
    updateDuelButtons("answer_revealed");
    if (dom.duelScoreA) dom.duelScoreA.textContent = payload.matchScores?.scoreA ?? 0;
    if (dom.duelScoreB) dom.duelScoreB.textContent = payload.matchScores?.scoreB ?? 0;

    const played = payload.questionsPlayed || 0;
    const total = payload.totalQuestions || 2;
    if (dom.duelStatusText) {
      dom.duelStatusText.textContent = played >= total
        ? `Pregunta ${played}/${total} revelada — Fin del duelo disponible`
        : `Pregunta ${played}/${total} revelada — Siguiente pregunta lista`;
    }
  }

  function handleDuelResult(payload) {
    updateDuelButtons("match_finished");
    state.rounds = payload.rounds || state.rounds;
    state.thirdMatch = payload.thirdMatch || state.thirdMatch;
    renderMatchesView();

    const winnerName = payload.winner?.name || "Ganador";
    showToast(`🏆 Ganador del duelo: ${winnerName}!`);
    if (dom.duelStatusText) {
      dom.duelStatusText.textContent = `Duelo completado — Ganador: ${winnerName}`;
    }
  }

  function handleTournamentFinished(payload) {
    state.status = "finished";
    updateDuelButtons("tournament_finished");
    updateSummaryMetrics();
    showToast("🏁 ¡El torneo ha finalizado!");

    // Limpiar sesión persistida: el torneo terminó, no tiene sentido restaurarla
    clearSession();

    if (dom.matchesStatusAlert) {
      const p = payload.podium || [];
      dom.matchesStatusAlert.innerHTML = `
        <div class="card" style="text-align:center; padding:24px; border:2px solid var(--gold); background:rgba(212,175,55,0.08);">
          <h3 style="color:var(--gold); margin:0 0 16px;">🏆 Torneo Finalizado — Podio Oficial</h3>
          <div style="display:flex; justify-content:center; gap:20px; flex-wrap:wrap;">
            ${p[0] ? `<div style="min-width:120px;"><b>🥇 1° Lugar</b><br><span style="font-size:18px; color:var(--gold); font-weight:700;">${p[0].name}</span></div>` : ""}
            ${p[1] ? `<div style="min-width:120px;"><b>🥈 2° Lugar</b><br><span style="font-size:18px; color:var(--mist); font-weight:700;">${p[1].name}</span></div>` : ""}
            ${p[2] ? `<div style="min-width:120px;"><b>🥉 3° Lugar</b><br><span style="font-size:18px; color:var(--sage); font-weight:700;">${p[2].name}</span></div>` : ""}
            ${p[3] ? `<div style="min-width:120px;"><b>🏅 4° Lugar</b><br><span style="font-size:18px; color:#a0a0a0; font-weight:700;">${p[3].name}</span></div>` : ""}
          </div>
        </div>
      `;
    }
  }

  // -------------------------------------------------------------
  // ACCIONES DEL ORGANIZADOR
  // -------------------------------------------------------------

  function triggerStartMatch(matchId) {
    if (!state.code || !state.socket) return;
    state.socket.emit("organizer_start_match", { code: state.code, matchId }, (res) => {
      if (res && res.error) {
        showToast(res.error);
      } else if (res && res.success && res.data) {
        handleMatchStarted({
          matchId,
          playerA: res.data.playerA,
          playerB: res.data.playerB
        });
      }
    });
  }

  function triggerLaunchQuestion() {
    if (!state.code || !state.socket) return;
    if (dom.btnLaunchQuestion) dom.btnLaunchQuestion.disabled = true;
    state.socket.emit("organizer_launch_question", { code: state.code }, (res) => {
      if (res && res.error) {
        showToast(res.error);
        if (dom.btnLaunchQuestion) dom.btnLaunchQuestion.disabled = false;
      }
    });
  }

  function triggerCloseQuestion() {
    if (!state.code || !state.socket) return;
    if (dom.btnCloseQuestion) dom.btnCloseQuestion.disabled = true;
    state.socket.emit("organizer_close_question", { code: state.code }, (res) => {
      if (res && res.error) {
        showToast(res.error);
        if (dom.btnCloseQuestion) dom.btnCloseQuestion.disabled = false;
      }
    });
  }

  function triggerRevealAnswer() {
    if (!state.code || !state.socket) return;
    if (dom.btnRevealAnswer) dom.btnRevealAnswer.disabled = true;
    state.socket.emit("organizer_reveal_answer", { code: state.code }, (res) => {
      if (res && res.error) {
        showToast(res.error);
        if (dom.btnRevealAnswer) dom.btnRevealAnswer.disabled = false;
      }
    });
  }

  function triggerNextMatch() {
    if (!state.code || !state.socket) return;
    if (dom.btnNextMatch) dom.btnNextMatch.disabled = true;
    state.socket.emit("organizer_next_match", { code: state.code }, (res) => {
      if (res && res.error) {
        showToast(res.error);
        if (dom.btnNextMatch) dom.btnNextMatch.disabled = false;
      } else if (res && res.success) {
        if (res.action === "launch_next_question") {
          showToast("Lanza la siguiente pregunta para continuar el duelo.");
        } else if (res.action === "match_advanced") {
          showToast(`Duelo terminado. Siguiente enfrentamiento: ${res.nextMatchId}`);
        } else if (res.action === "tournament_finished") {
          showToast("¡Torneo concluido con éxito!");
        }
      }
    });
  }

  function triggerFinishTournament() {
    if (!state.code || !state.socket) return;
    if (!confirm("¿Deseas finalizar el torneo y proclamar el podio oficial?")) return;
    state.socket.emit("organizer_finish_tournament", { code: state.code }, (res) => {
      if (res && res.error) showToast(res.error);
    });
  }

  /**
   * Autentica el socket como organizador para la sala dada.
   */
  /**
   * Autentica el socket como organizador para la sala dada.
   * @param {string} code - Código de sala
   * @param {string} secret - Clave de administrador
   * @param {boolean} [isRestore=false] - true si se llama automáticamente al restaurar sesión (F5)
   */
  function authenticateOrganizer(code, secret, isRestore = false) {
    if (!state.socket) return;

    // Timeout de seguridad de 4 segundos para no dejar (restaurando...) colgado indefinidamente
    const timer = setTimeout(() => {
      if (dom.sessionCodeBadge && dom.sessionCodeBadge.innerHTML.includes("restaurando")) {
        dom.sessionCodeBadge.innerHTML = `SALA: <b>${code}</b> <button id="btn-retry-auth" style="font-size:10px; background:rgba(212,175,55,0.2); border:1px solid var(--gold); color:var(--gold); border-radius:4px; cursor:pointer; padding:2px 6px;">Reintentar</button>`;
        const btnRetry = document.getElementById("btn-retry-auth");
        if (btnRetry) btnRetry.onclick = () => authenticateOrganizer(code, secret, isRestore);
      }
    }, 4000);

    state.socket.emit(
      "auth_organizer",
      { code: code.toUpperCase(), adminSecret: secret },
      (res) => {
        clearTimeout(timer);

        if (res && res.success) {
          updateAuthBadge(true);
          state.code = code.toUpperCase();
          state.adminSecret = secret;

          if (dom.sessionCodeBadge) {
            dom.sessionCodeBadge.innerHTML = `SALA: <b>${state.code}</b>`;
          }

          // Si el servidor devolvió los datos del torneo en la respuesta, usarlos directamente
          if (res.tournament) {
            if (res.tournament.status) state.status = res.tournament.status;
            if (res.tournament.name) state.name = res.tournament.name;
            if (Array.isArray(res.tournament.participants)) state.participants = res.tournament.participants;
            if (Array.isArray(res.tournament.rounds)) state.rounds = res.tournament.rounds;
            if (res.tournament.thirdMatch !== undefined) state.thirdMatch = res.tournament.thirdMatch;
          }

          // Persistir sesión para sobrevivir F5
          saveSession();

          // Unirse también al canal de proyección para recibir actualizaciones en tiempo real
          state.socket.emit("join_projection", { code: state.code });

          // Actualizar UI
          updateSummaryMetrics();
          updateLobbyView();

          // Cambiar a la pestaña correspondiente según el estado
          if (state.status === "active" || state.status === "finished") {
            renderMatchesView();
            switchTab("matches");
          } else {
            switchTab("lobby");
            if (dom.lobbyQrImg && (!dom.lobbyQrImg.src || dom.lobbyQrImg.src === window.location.href)) {
              dom.lobbyQrImg.src = `/api/tournament/${state.code}/qr?format=svg`;
            }
          }

          showToast(isRestore
            ? `✅ Sesión restaurada — Sala ${state.code} (${state.participants.length} participantes)`
            : "Sesión de organizador autenticada correctamente."
          );
        } else {
          updateAuthBadge(false);
          const err = res?.error || "Error de autenticación.";

          if (isRestore) {
            // La sala ya no existe en el servidor (ej: servidor reiniciado en modo memoria).
            // Limpiar sesión y avisar claramente al organizador.
            clearSession();
            state.code = "";
            state.adminSecret = "";
            state.name = "Sin torneo seleccionado";
            state.status = "idle";
            state.participants = [];

            if (dom.sessionCodeBadge) {
              dom.sessionCodeBadge.innerHTML = `SALA: <span style="color:var(--bad); font-size:11px;">no encontrada</span>`;
            }

            if (dom.createError) {
              dom.createError.style.color = "var(--gold)";
              dom.createError.textContent =
                `⚠️ La sala anterior (${code}) ya no existe en el servidor. Crea una nueva sala para continuar.`;
            }

            showToast("⚠️ La sala no existe en el servidor. Crea un nuevo torneo.");
            updateSummaryMetrics();
            switchTab("create");
          } else {
            if (dom.connectError) dom.connectError.textContent = err;
            showToast(err);
          }
        }
      }
    );
  }

  /**
   * Procesa la creación de un nuevo torneo mediante POST /api/tournament/create.
   */
  async function handleCreateTournament(formData) {
    if (dom.btnSubmitCreate) dom.btnSubmitCreate.disabled = true;
    if (dom.createError) dom.createError.textContent = "";

    try {
      const payload = {
        name: formData.get("name")?.trim(),
        adminSecret: formData.get("adminSecret")?.trim(),
        settings: {
          questionsPerDuel: parseInt(formData.get("questionsPerDuel"), 10) || 2,
          timePerQuestion: parseInt(formData.get("timePerQuestion"), 10) || 20,
          maxParticipants: parseInt(formData.get("maxParticipants"), 10) || 32,
          difficultyMode: formData.get("difficultyMode") || "progressive",
          enableThirdPlace: formData.get("enableThirdPlace") === "on",
          soundEnabled: formData.get("soundEnabled") === "on",
          prizeFirst: formData.get("prizeFirst")?.trim() || "",
          prizeSecond: formData.get("prizeSecond")?.trim() || "",
          prizeThird: formData.get("prizeThird")?.trim() || ""
        }
      };

      const res = await fetch("/api/tournament/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Error al crear el torneo.");
      }

      const tourney = data.data;
      state.code = tourney.code;
      state.name = tourney.name;
      state.adminSecret = payload.adminSecret;
      state.status = "lobby";
      state.participants = [];

      // Persistir sesión para sobrevivir F5
      saveSession();

      // Autenticar la sesión de Socket.IO inmediatamente
      authenticateOrganizer(state.code, state.adminSecret);

      // Cargar QR oficial
      if (dom.lobbyQrImg) {
        dom.lobbyQrImg.src = tourney.qrCode || `/api/tournament/${state.code}/qr?format=svg`;
      }

      showToast(`¡Torneo "${state.name}" creado con sala ${state.code}!`);
      updateSummaryMetrics();
      updateLobbyView();
      switchTab("lobby");
    } catch (err) {
      if (dom.createError) dom.createError.textContent = err.message;
      showToast(err.message);
    } finally {
      if (dom.btnSubmitCreate) dom.btnSubmitCreate.disabled = false;
    }
  }

  /**
   * Actualiza las métricas y botones del panel de resumen.
   */
  function updateSummaryMetrics() {
    if (dom.summaryTourneyName) dom.summaryTourneyName.textContent = state.name;
    if (dom.metricRoomCode) dom.metricRoomCode.textContent = state.code || "----";
    if (dom.metricParticipants) dom.metricParticipants.textContent = state.participants.length;

    let statusText = "Sin sala";
    if (state.status === "lobby") statusText = "En Sala de Espera";
    if (state.status === "active") statusText = "En Progreso";
    if (state.status === "finished") statusText = "Finalizado";
    if (dom.summaryTourneyStatus) dom.summaryTourneyStatus.textContent = statusText;

    // Calcular duelos totales
    let totalMatches = 0;
    if (Array.isArray(state.rounds)) {
      totalMatches = state.rounds.reduce((acc, r) => acc + (Array.isArray(r) ? r.length : 0), 0);
      if (state.thirdMatch) totalMatches++;
    }
    if (dom.metricMatches) dom.metricMatches.textContent = totalMatches;

    // Actualizar botones de enlaces
    if (dom.btnOpenProjection) {
      dom.btnOpenProjection.onclick = () => {
        if (state.code) window.open(`/proyeccion/${state.code}`, "_blank");
        else showToast("Primero crea o conecta una sala de torneo.");
      };
    }

    if (dom.btnOpenParticipant) {
      dom.btnOpenParticipant.onclick = () => {
        if (state.code) window.open(`/jugar?code=${state.code}`, "_blank");
        else showToast("Primero crea o conecta una sala de torneo.");
      };
    }
  }

  /**
   * Actualiza la tabla de participantes de la sala de espera.
   */
  function updateLobbyView() {
    if (dom.lobbyCodeBig) dom.lobbyCodeBig.textContent = state.code || "----";
    if (dom.lobbyTotalBadge) dom.lobbyTotalBadge.textContent = `${state.participants.length} inscritos`;

    if (!dom.participantsTableBody) return;
    dom.participantsTableBody.innerHTML = "";

    if (state.participants.length === 0) {
      const emptyRow = document.createElement("tr");
      emptyRow.innerHTML = `<td colspan="4" style="text-align:center; color:var(--sage); padding:24px;">No hay participantes inscritos todavía. Comparte el código o proyecta el QR.</td>`;
      dom.participantsTableBody.appendChild(emptyRow);
      if (dom.btnStartTournament) dom.btnStartTournament.disabled = true;
      return;
    }

    state.participants.forEach((p, idx) => {
      const row = document.createElement("tr");
      const statusClass = p.isConnected ? "badge-connected" : "badge-disconnected";
      const statusText = p.isConnected ? "En línea" : "Desconectado";
      row.innerHTML = `
        <td><b>#${idx + 1}</b></td>
        <td><b>${p.name}</b></td>
        <td><span class="badge ${statusClass}"><span class="badge-dot"></span> ${statusText}</span></td>
        <td style="font-family:var(--f-mono); font-size:12px; color:var(--sage);">${p.id}</td>
      `;
      dom.participantsTableBody.appendChild(row);
    });

    // Habilitar botón de inicio solo si hay 2 o más participantes
    if (dom.btnStartTournament) {
      dom.btnStartTournament.disabled = state.participants.length < 2 || state.status !== "lobby";
    }
  }

  /**
   * Recarga manualmente la lista de participantes desde el servidor.
   * Útil si el organizador sospecha que no llegó la actualización en tiempo real.
   */
  function refreshLobby() {
    if (!state.code || !state.socket) {
      showToast("No hay sala activa.");
      return;
    }

    const btns = [dom.btnRefreshLobby, document.getElementById("btn-refresh-table")].filter(Boolean);
    btns.forEach((b) => {
      b.disabled = true;
      b.textContent = "🔄 Actualizando...";
    });

    state.socket.emit("join_projection", { code: state.code }, (res) => {
      btns.forEach((b) => {
        b.disabled = false;
        b.textContent = b.id === "btn-refresh-table" ? "🔄 Actualizar lista" : "🔄 Recargar Participantes";
      });

      if (res && res.error) {
        showToast("Error al recargar: " + res.error);
      } else {
        if (res && Array.isArray(res.participants)) {
          state.participants = res.participants;
          updateLobbyView();
          updateSummaryMetrics();
        }
        showToast(`✅ Lista actualizada: ${state.participants.length} participante(s) en sala`);
      }
    });
  }

  /**
   * Inicia el torneo oficialmente llamando a organizer_start_tournament.
   */
  function triggerStartTournament() {
    if (!state.code) {
      showToast("No hay sala activa.");
      return;
    }

    if (state.participants.length < 2) {
      showToast("Se requieren al menos 2 participantes para iniciar el torneo.");
      return;
    }

    if (!state.socket) {
      showToast("Error de conexión Socket.IO.");
      return;
    }

    state.socket.emit(
      "organizer_start_tournament",
      { code: state.code, adminSecret: state.adminSecret },
      (res) => {
        if (res && res.error) {
          showToast(`Error: ${res.error}`);
        } else if (res && res.success) {
          state.status = "active";
          state.rounds = res.data?.rounds || [];
          state.thirdMatch = res.data?.thirdMatch || null;
          showToast("¡Torneo iniciado! Bracket generado.");
          updateSummaryMetrics();
          renderMatchesView();
          switchTab("matches");
        }
      }
    );
  }

  /**
   * Renderiza el cuadro y estado de los enfrentamientos.
   */
  function renderMatchesView() {
    if (!dom.bracketPreviewBox) return;
    dom.bracketPreviewBox.innerHTML = "";

    if (!Array.isArray(state.rounds) || state.rounds.length === 0) {
      if (dom.matchesStatusAlert) {
        dom.matchesStatusAlert.innerHTML = `
          <div class="card" style="text-align:center; padding:30px;">
            <p style="color:var(--sage); font-size:16px;">El torneo aún no ha iniciado. El cuadro de eliminatorias se generará automáticamente cuando inicies el torneo en la sala de espera.</p>
          </div>
        `;
      }
      return;
    }

    if (dom.matchesStatusAlert) {
      dom.matchesStatusAlert.innerHTML = "";
    }

    if (dom.duelControlPanel && state.status === "active") {
      dom.duelControlPanel.style.display = "block";
    }

    state.rounds.forEach((roundMatches, roundIdx) => {
      const col = document.createElement("div");
      col.className = "bracket-preview-col";

      const header = document.createElement("div");
      header.style.fontFamily = "var(--f-mono)";
      header.style.fontSize = "12px";
      header.style.color = "var(--gold)";
      header.style.textTransform = "uppercase";
      header.style.marginBottom = "8px";
      header.textContent = getRoundName(roundIdx, state.rounds.length);
      col.appendChild(header);

      roundMatches.forEach((m) => {
        const node = document.createElement("div");
        node.className = "bracket-preview-node" + (m.status === "completed" ? " completed" : "");
        const pA = m.playerA ? (m.playerA.name || "TBD") : "BYE";
        const pB = m.playerB ? (m.playerB.name || "TBD") : "BYE";

        const isReady = m.status === "ready";
        const isInProgress = m.status === "in_progress";
        const canLaunch = (isReady || isInProgress) && !m.isBye && m.playerA && m.playerB;

        let actionBtnHtml = "";
        if (canLaunch) {
          if (isInProgress) {
            actionBtnHtml = `<div style="margin-top:6px; font-size:11px; padding:4px 8px; text-align:center; background:rgba(212,175,55,0.15); border:1px solid var(--gold); color:var(--gold); border-radius:6px; font-weight:700;">⚡ En Curso — Usa controles arriba</div>`;
          } else {
            actionBtnHtml = `<button class="btn btn-primary btn-block btn-start-match-card" data-match-id="${m.id}" style="margin-top:6px; font-size:11px; padding:4px 8px;">▶ Activar Duelo</button>`;
          }
        }

        node.innerHTML = `
          <div style="font-weight:700; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
            <span>Duelo ${m.id}</span>
            <span style="font-size:10px; color:${isInProgress ? "var(--gold)" : "var(--sage)"}; text-transform:uppercase; font-weight:${isInProgress ? "700" : "400"};">${m.status}</span>
          </div>
          <div style="display:flex; justify-content:space-between; color:${m.winnerId === m.playerA?.id ? "var(--gold)" : "var(--mist)"};">
            <span>${pA}</span>
            <span>${m.scoreA !== undefined ? m.scoreA : ""}</span>
          </div>
          <div style="display:flex; justify-content:space-between; color:${m.winnerId === m.playerB?.id ? "var(--gold)" : "var(--mist)"};">
            <span>${pB}</span>
            <span>${m.scoreB !== undefined ? m.scoreB : ""}</span>
          </div>
          ${actionBtnHtml}
        `;

        const startBtn = node.querySelector(".btn-start-match-card");
        if (startBtn) {
          startBtn.addEventListener("click", () => {
            triggerStartMatch(m.id);
          });
        }

        col.appendChild(node);
      });

      dom.bracketPreviewBox.appendChild(col);
    });
  }

  function getRoundName(idx, total) {
    if (idx === total - 1) return "Final";
    if (idx === total - 2) return "Semifinales";
    if (idx === total - 3) return "Cuartos";
    return `Ronda ${idx + 1}`;
  }

  /**
   * Consulta el estado de salud de la API (/api/health).
   */
  async function checkApiHealth() {
    try {
      const res = await fetch("/api/health");
      const json = await res.json();
      state.apiStatus = json;

      if (dom.connDbState) {
        dom.connDbState.textContent = json.database?.connected ? "Conectado" : "Desconectado";
        dom.connDbState.style.color = json.database?.connected ? "var(--ok)" : "var(--bad)";
      }

      if (dom.connDbLatency) {
        dom.connDbLatency.textContent = json.database?.latency || "N/A";
      }

      if (dom.connQuestionsLoaded) {
        dom.connQuestionsLoaded.textContent = `${json.questions?.staticLoaded || 0} estáticas + ${json.questions?.mathGeneratorsCount || 0} generadores`;
      }

      showToast("Diagnóstico del servidor actualizado.");
    } catch (err) {
      showToast("Error al consultar /api/health");
    }
  }

  /**
   * Vinculación de eventos de la interfaz de usuario.
   */
  function bindUI() {
    // Pestañas
    dom.navBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        switchTab(btn.dataset.tab);
      });
    });

    // Formulario Crear Torneo
    if (dom.formCreate) {
      dom.formCreate.addEventListener("submit", (e) => {
        e.preventDefault();
        const formData = new FormData(dom.formCreate);
        handleCreateTournament(formData);
      });
    }

    // Formulario Conectar Torneo Existente
    if (dom.formConnect) {
      dom.formConnect.addEventListener("submit", (e) => {
        e.preventDefault();
        const code = dom.connectCodeInput?.value?.trim().toUpperCase();
        const secret = dom.connectSecretInput?.value?.trim();
        if (code && secret) {
          authenticateOrganizer(code, secret);
        } else if (dom.connectError) {
          dom.connectError.textContent = "Ingresa el código de sala y la clave de administrador.";
        }
      });
    }

    // Botón Iniciar Torneo (abre modal de confirmación)
    if (dom.btnStartTournament) {
      dom.btnStartTournament.addEventListener("click", () => {
        if (dom.modalConfirmStart) dom.modalConfirmStart.classList.add("active");
      });
    }

    // Recargar lista de participantes manualmente
    if (dom.btnRefreshLobby) {
      dom.btnRefreshLobby.addEventListener("click", refreshLobby);
    }
    const btnRefreshTable = document.getElementById("btn-refresh-table");
    if (btnRefreshTable) {
      btnRefreshTable.addEventListener("click", refreshLobby);
    }

    // Cancelar Inicio
    if (dom.btnCancelStartAction) {
      dom.btnCancelStartAction.addEventListener("click", () => {
        if (dom.modalConfirmStart) dom.modalConfirmStart.classList.remove("active");
      });
    }

    // Confirmar Inicio
    if (dom.btnConfirmStartAction) {
      dom.btnConfirmStartAction.addEventListener("click", () => {
        if (dom.modalConfirmStart) dom.modalConfirmStart.classList.remove("active");
        triggerStartTournament();
      });
    }

    // Refrescar Healthcheck
    if (dom.btnRefreshHealth) {
      dom.btnRefreshHealth.addEventListener("click", () => {
        checkApiHealth();
      });
    }

    // Módulo 2.5: Botones de control del duelo
    if (dom.btnLaunchQuestion) {
      dom.btnLaunchQuestion.addEventListener("click", () => {
        triggerLaunchQuestion();
      });
    }

    if (dom.btnCloseQuestion) {
      dom.btnCloseQuestion.addEventListener("click", () => {
        triggerCloseQuestion();
      });
    }

    if (dom.btnRevealAnswer) {
      dom.btnRevealAnswer.addEventListener("click", () => {
        triggerRevealAnswer();
      });
    }

    if (dom.btnNextMatch) {
      dom.btnNextMatch.addEventListener("click", () => {
        triggerNextMatch();
      });
    }

    if (dom.btnFinishTournament) {
      dom.btnFinishTournament.addEventListener("click", () => {
        triggerFinishTournament();
      });
    }
  }

  // Arranque del panel
  document.addEventListener("DOMContentLoaded", () => {
    bindUI();

    // Restaurar sesión desde sessionStorage si el organizador recargó la página
    const saved = loadSavedSession();
    if (saved && saved.code && saved.adminSecret) {
      state.code = saved.code;
      state.adminSecret = saved.adminSecret;
      state.name = saved.name || "Torneo en curso";
      state.status = saved.status || "lobby";

      // Mostrar el badge de sesión de inmediato
      if (dom.sessionCodeBadge) {
        dom.sessionCodeBadge.innerHTML = `SALA: <b>${state.code}</b> <span style="font-size:10px; color:var(--gold);">(restaurando...)</span>`;
      }

      // Cambiar de inmediato a la pestaña adecuada para ver la sala
      if (state.status === "lobby") {
        switchTab("lobby");
        if (dom.lobbyCodeBig) dom.lobbyCodeBig.textContent = state.code;
        if (dom.lobbyQrImg) dom.lobbyQrImg.src = `/api/tournament/${state.code}/qr?format=svg`;
      } else if (state.status === "active" || state.status === "finished") {
        switchTab("matches");
      }

      showToast(`🔄 Restaurando sesión de la sala ${state.code}...`);
    }

    initSocket();   // socket.on('connect') re-autentica automáticamente si state.code && state.adminSecret
    checkApiHealth();
  });
})();

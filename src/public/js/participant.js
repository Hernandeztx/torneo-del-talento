/**
 * ==========================================================================
 * TORNEO DEL TALENTO — CLIENTE DEL PARTICIPANTE (/jugar)
 * Conexión en tiempo real con Socket.IO, persistencia de sesión en sessionStorage,
 * soporte para reconexión instantánea y botonera de juego estilo Kahoot.
 * ==========================================================================
 */

(function () {
  "use strict";

  // Claves de almacenamiento de sesión local
  const STORAGE_KEYS = {
    CODE: "talento_code",
    NAME: "talento_name",
    TOKEN: "talento_token",
    ID: "talento_id"
  };

  // Estado del participante en memoria cliente
  const state = {
    socket: null,
    code: "",
    name: "",
    token: "",
    participantId: "",
    currentMatchId: null,
    currentQuestion: null,
    hasAnswered: false,
    answeredTime: null,
    timerInterval: null
  };

  // Elementos DOM principales
  const dom = {
    statusBadge: document.getElementById("connection-badge"),
    soundBtn: document.getElementById("sound-toggle"),
    screens: {
      join: document.getElementById("screen-join"),
      lobby: document.getElementById("screen-lobby"),
      spectator: document.getElementById("screen-spectator"),
      question: document.getElementById("screen-question"),
      answered: document.getElementById("screen-answered"),
      verdict: document.getElementById("screen-verdict")
    },
    // Pantalla Ingreso
    joinForm: document.getElementById("join-form"),
    inputCode: document.getElementById("input-code"),
    inputName: document.getElementById("input-name"),
    joinBtn: document.getElementById("btn-join"),
    joinError: document.getElementById("join-error"),
    // Pantalla Lobby
    lobbyAvatar: document.getElementById("lobby-avatar"),
    lobbyName: document.getElementById("lobby-name"),
    lobbyCode: document.getElementById("lobby-code"),
    lobbyCount: document.getElementById("lobby-count"),
    participantsList: document.getElementById("participants-list"),
    btnLeave: document.getElementById("btn-leave-lobby"),
    // Pantalla Espectador
    specFighterA: document.getElementById("spec-fighter-a"),
    specFighterB: document.getElementById("spec-fighter-b"),
    // Pantalla Pregunta
    timerBar: document.getElementById("timer-bar"),
    timeLeft: document.getElementById("time-left"),
    qCategory: document.getElementById("q-category"),
    qLevel: document.getElementById("q-level"),
    qText: document.getElementById("q-text"),
    optionsContainer: document.getElementById("options-container"),
    // Pantalla Respondido
    answeredTimeText: document.getElementById("answered-time-text"),
    // Pantalla Veredicto
    verdictCard: document.getElementById("verdict-card"),
    verdictTitle: document.getElementById("verdict-title"),
    verdictPoints: document.getElementById("verdict-points"),
    verdictExplanation: document.getElementById("verdict-explanation")
  };

  // Símbolos geométricos y colores Kahoot
  const SHAPES = ["▲", "◆", "●", "■"];

  /**
   * Cambia la pantalla visible.
   */
  function showScreen(screenName) {
    Object.keys(dom.screens).forEach((key) => {
      if (dom.screens[key]) {
        dom.screens[key].classList.toggle("active", key === screenName);
      }
    });
  }

  /**
   * Actualiza el badge de estado de conexión.
   */
  function updateConnectionStatus(status, text) {
    if (!dom.statusBadge) return;
    dom.statusBadge.className = "badge";
    if (status === "connected") {
      dom.statusBadge.classList.add("badge-connected");
      dom.statusBadge.innerHTML = `<span class="badge-dot badge-pulse"></span> ${text || "Conectado"}`;
    } else if (status === "reconnecting") {
      dom.statusBadge.classList.add("badge-gold");
      dom.statusBadge.innerHTML = `<span class="badge-dot badge-pulse"></span> ${text || "Reconectando..."}`;
    } else {
      dom.statusBadge.classList.add("badge-disconnected");
      dom.statusBadge.innerHTML = `<span class="badge-dot"></span> ${text || "Desconectado"}`;
    }
  }

  /**
   * Muestra un toast breve.
   */
  function showToast(msg) {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
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
   * Restaura la sesión guardada en sessionStorage si existe.
   */
  function loadSavedSession() {
    state.code = sessionStorage.getItem(STORAGE_KEYS.CODE) || "";
    state.name = sessionStorage.getItem(STORAGE_KEYS.NAME) || "";
    state.token = sessionStorage.getItem(STORAGE_KEYS.TOKEN) || "";
    state.participantId = sessionStorage.getItem(STORAGE_KEYS.ID) || "";

    // Detección de código en URL (?code=XXXX o ?codigo=XXXX)
    const urlParams = new URLSearchParams(window.location.search);
    const urlCode = (urlParams.get("code") || urlParams.get("codigo") || "").trim().toUpperCase();
    if (urlCode) {
      state.code = urlCode;
      if (dom.inputCode) dom.inputCode.value = urlCode;
    } else if (state.code && dom.inputCode) {
      dom.inputCode.value = state.code;
    }

    if (state.name && dom.inputName) {
      dom.inputName.value = state.name;
    }
  }

  /**
   * Guarda la sesión actual en sessionStorage.
   */
  function saveSession(data) {
    if (data.tournamentCode) {
      state.code = data.tournamentCode;
      sessionStorage.setItem(STORAGE_KEYS.CODE, data.tournamentCode);
    }
    if (data.name) {
      state.name = data.name;
      sessionStorage.setItem(STORAGE_KEYS.NAME, data.name);
    }
    if (data.rawToken) {
      state.token = data.rawToken;
      sessionStorage.setItem(STORAGE_KEYS.TOKEN, data.rawToken);
    }
    if (data.participantId) {
      state.participantId = data.participantId;
      sessionStorage.setItem(STORAGE_KEYS.ID, data.participantId);
    }
  }

  /**
   * Limpia la sesión y vuelve a la pantalla inicial.
   */
  function clearSession() {
    sessionStorage.removeItem(STORAGE_KEYS.CODE);
    sessionStorage.removeItem(STORAGE_KEYS.NAME);
    sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
    sessionStorage.removeItem(STORAGE_KEYS.ID);
    state.code = "";
    state.name = "";
    state.token = "";
    state.participantId = "";
    showScreen("join");
  }

  /**
   * Inicializa la conexión de Socket.IO y sus listeners.
   */
  function initSocket() {
    updateConnectionStatus("reconnecting", "Iniciando...");

    // Cargar Socket.IO nativo provisto por el servidor
    const socket = window.io ? window.io() : null;
    if (!socket) {
      updateConnectionStatus("disconnected", "Sin conexión");
      showToast("Error al cargar cliente Socket.IO");
      return;
    }
    state.socket = socket;

    socket.on("connect", () => {
      updateConnectionStatus("connected", "En línea");

      // Si teníamos una sesión previa guardada, intentar reconexión automática transparente
      if (state.code && state.token) {
        attemptAutoReconnect();
      }
    });

    socket.on("disconnect", () => {
      updateConnectionStatus("disconnected", "Desconectado");
    });

    socket.on("reconnect_attempt", () => {
      updateConnectionStatus("reconnecting", "Reconectando...");
    });

    // Actualización de lista de participantes en el lobby
    socket.on("lobby_updated", (data) => {
      renderLobbyParticipants(data);
    });

    // Inicio de torneo
    socket.on("tournament_started", (data) => {
      showToast("¡El torneo ha comenzado!");
      if (window.TalentoAudio) window.TalentoAudio.play("win");
      showScreen("spectator");
    });

    // Lanzamiento de pregunta
    socket.on("question_started", (payload) => {
      handleQuestionStarted(payload);
    });

    // Confirmación de respuesta de algún jugador
    socket.on("answer_acknowledged", (payload) => {
      if (payload.participantId === state.participantId) {
        // Confirmación para nosotros
        state.hasAnswered = true;
        showScreen("answered");
      }
    });

    // Revelación de respuesta
    socket.on("question_revealed", (payload) => {
      handleQuestionRevealed(payload);
    });

    // Módulo 2.5: Eventos de duelo
    socket.on("match_started", (payload) => {
      state.currentMatchId = payload.matchId;
      state.hasAnswered = false;
      if (dom.specFighterA) dom.specFighterA.textContent = payload.playerA?.name || "Competidor 1";
      if (dom.specFighterB) dom.specFighterB.textContent = payload.playerB?.name || "Competidor 2";
      showScreen("spectator");
      showToast(`⚔️ Enfrentamiento ${payload.matchId} en curso`);
    });

    socket.on("question_closed", () => {
      disableOptions();
      if (!state.hasAnswered) {
        showToast("⏱ Tiempo concluido.");
      }
    });

    socket.on("duel_result", (payload) => {
      const isWinner = payload.winner?.id === state.participantId;
      const isLoser = payload.loser?.id === state.participantId;

      if (isWinner) {
        showToast("🏆 ¡Ganaste el enfrentamiento!");
        if (window.TalentoAudio) window.TalentoAudio.play("win");
        if (window.TalentoConfetti) window.TalentoConfetti.start(4000, 80);
      } else if (isLoser) {
        showToast("Has concluido tu participación en este enfrentamiento.");
        if (window.TalentoAudio) window.TalentoAudio.play("bad");
      } else {
        showToast(`Duelo finalizado: Ganador ${payload.winner?.name}`);
      }

      setTimeout(() => {
        showScreen("spectator");
      }, 3500);
    });

    socket.on("tournament_finished", (payload) => {
      const me = (payload.podium || []).find((p) => p.id === state.participantId);
      if (me) {
        showToast(`🏅 ¡Felicitaciones! Has obtenido el puesto #${me.rank}`);
        if (window.TalentoConfetti) window.TalentoConfetti.start(5000, 100);
      } else {
        showToast("¡Torneo finalizado con éxito!");
      }
    });

    // Pausa por desconexión de ambos competidores
    socket.on("duel_both_disconnected", (data) => {
      showToast("Pausa temporal: ambos jugadores perdieron conexión.");
    });
  }

  /**
   * Intenta la reconexión con el token almacenado.
   */
  function attemptAutoReconnect() {
    state.socket.emit(
      "join_participant",
      {
        code: state.code,
        rawToken: state.token
      },
      (res) => {
        if (res && res.success) {
          saveSession(res.data);
          setupLobbyView(state.name, state.code);
          showScreen("lobby");
          showToast(`Reconectado como ${state.name}`);
        } else {
          // Token inválido o torneo cerrado
          clearSession();
        }
      }
    );
  }

  /**
   * Envía la solicitud de registro de nuevo participante.
   */
  function registerNewParticipant(code, name) {
    if (dom.joinBtn) dom.joinBtn.disabled = true;
    if (dom.joinError) dom.joinError.textContent = "";

    state.socket.emit(
      "join_participant",
      {
        code: code.trim().toUpperCase(),
        name: name.trim()
      },
      (res) => {
        if (dom.joinBtn) dom.joinBtn.disabled = false;

        if (res && res.error) {
          if (dom.joinError) dom.joinError.textContent = res.error;
          if (window.TalentoAudio) window.TalentoAudio.play("bad");
          return;
        }

        if (res && res.success) {
          saveSession(res.data);
          setupLobbyView(res.data.name, res.data.tournamentCode);
          showScreen("lobby");
          if (window.TalentoAudio) window.TalentoAudio.play("ok");
          showToast(`¡Bienvenido, ${res.data.name}!`);
        }
      }
    );
  }

  /**
   * Configura la información del usuario en la pantalla de lobby.
   */
  function setupLobbyView(name, code) {
    if (dom.lobbyName) dom.lobbyName.textContent = name;
    if (dom.lobbyCode) dom.lobbyCode.textContent = code;
    if (dom.lobbyAvatar) {
      dom.lobbyAvatar.textContent = (name || "P").charAt(0).toUpperCase();
    }
  }

  /**
   * Renderiza la lista de participantes en el lobby.
   */
  function renderLobbyParticipants(data) {
    if (!data) return;
    if (dom.lobbyCount) {
      dom.lobbyCount.textContent = `${data.totalParticipants || 0} inscritos`;
    }

    if (dom.participantsList && Array.isArray(data.participants)) {
      dom.participantsList.innerHTML = "";
      data.participants.forEach((p) => {
        const pill = document.createElement("span");
        pill.className = "participant-pill" + (p.id === state.participantId ? " me" : "");
        pill.textContent = p.name;
        dom.participantsList.appendChild(pill);
      });
    }
  }

  /**
   * Maneja el inicio de una pregunta en tiempo real.
   */
  function handleQuestionStarted(payload) {
    const { question, matchId, durationMs, startTime, hasAlreadyAnswered } = payload || {};
    state.currentQuestion = question;
    state.currentMatchId = matchId;
    state.hasAnswered = Boolean(hasAlreadyAnswered);

    if (!question) return;

    if (dom.qCategory) dom.qCategory.textContent = question.category || "General";
    if (dom.qLevel) dom.qLevel.textContent = "★".repeat(question.level || 1);
    if (dom.qText) dom.qText.textContent = question.question || "";

    // Iniciar cronómetro visual del cliente
    startTimer(startTime, durationMs || 20000);

    // Renderizar botonera según el tipo
    renderQuestionOptions(question);

    if (state.hasAnswered) {
      disableOptions();
      showScreen("answered");
    } else {
      showScreen("question");
      if (window.TalentoAudio) window.TalentoAudio.play("tap");
    }
  }

  /**
   * Inicia el temporizador de cuenta regresiva en el cliente.
   */
  function startTimer(startTimeMs, durationMs) {
    if (state.timerInterval) clearInterval(state.timerInterval);

    const start = startTimeMs || Date.now();
    const end = start + durationMs;

    function update() {
      const now = Date.now();
      const remainingMs = Math.max(0, end - now);
      const remainingSec = Math.ceil(remainingMs / 1000);
      const pct = Math.max(0, (remainingMs / durationMs) * 100);

      if (dom.timeLeft) dom.timeLeft.textContent = `${remainingSec}s`;
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
        if (!state.hasAnswered) {
          // Se acabó el tiempo
          disableOptions();
        }
      }
    }

    update();
    state.timerInterval = setInterval(update, 100);
  }

  /**
   * Renderiza las opciones según el tipo de pregunta.
   */
  function renderQuestionOptions(q) {
    if (!dom.optionsContainer) return;
    dom.optionsContainer.innerHTML = "";

    if (q.type === "mc") {
      // Opción múltiple (4 tarjetas de colores Kahoot)
      dom.optionsContainer.className = "options-grid four";
      (q.options || []).forEach((optText, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `option-btn opt-${idx % 4}`;
        btn.innerHTML = `<span class="shape-icon">${SHAPES[idx % 4]}</span><span>${optText}</span>`;
        btn.onclick = () => submitPlayerAnswer(optText);
        dom.optionsContainer.appendChild(btn);
      });
    } else if (q.type === "vf") {
      // Verdadero o Falso (2 botones gigantes)
      dom.optionsContainer.className = "options-grid two";
      const btnV = document.createElement("button");
      btnV.type = "button";
      btnV.className = "option-btn opt-1";
      btnV.innerHTML = `<span class="shape-icon">✓</span><span>Verdadero</span>`;
      btnV.onclick = () => submitPlayerAnswer(true);

      const btnF = document.createElement("button");
      btnF.type = "button";
      btnF.className = "option-btn opt-0";
      btnF.innerHTML = `<span class="shape-icon">✗</span><span>Falso</span>`;
      btnF.onclick = () => submitPlayerAnswer(false);

      dom.optionsContainer.appendChild(btnV);
      dom.optionsContainer.appendChild(btnF);
    } else if (q.type === "ord") {
      // Ordenamiento (Slots + Fichas)
      renderOrderingUI(q);
    } else if (q.type === "num") {
      // Cálculo numérico (Display + Teclado)
      renderNumericUI(q);
    }
  }

  /**
   * Renderizado modular para preguntas de ordenamiento.
   */
  function renderOrderingUI(q) {
    dom.optionsContainer.className = "options-grid";
    const ordWrapper = document.createElement("div");
    ordWrapper.style.display = "grid";
    ordWrapper.style.gap = "10px";

    const selected = [];
    const pool = (q.options || []).slice();

    const slotsRow = document.createElement("div");
    slotsRow.style.display = "flex";
    slotsRow.style.gap = "6px";
    slotsRow.style.flexWrap = "wrap";
    slotsRow.style.marginBottom = "8px";

    const chipsRow = document.createElement("div");
    chipsRow.style.display = "flex";
    chipsRow.style.gap = "8px";
    chipsRow.style.flexWrap = "wrap";

    function refresh() {
      slotsRow.innerHTML = "";
      selected.forEach((item, i) => {
        const slot = document.createElement("button");
        slot.className = "btn btn-ghost";
        slot.style.fontSize = "13px";
        slot.style.padding = "8px 12px";
        slot.textContent = `${i + 1}. ${item}`;
        slot.onclick = () => {
          selected.splice(i, 1);
          pool.push(item);
          refresh();
        };
        slotsRow.appendChild(slot);
      });

      chipsRow.innerHTML = "";
      pool.forEach((item, i) => {
        const chip = document.createElement("button");
        chip.className = "btn btn-primary";
        chip.style.fontSize = "13px";
        chip.style.padding = "8px 12px";
        chip.textContent = item;
        chip.onclick = () => {
          pool.splice(i, 1);
          selected.push(item);
          refresh();
        };
        chipsRow.appendChild(chip);
      });

      confirmBtn.disabled = pool.length > 0;
    }

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn btn-primary btn-block";
    confirmBtn.textContent = "Confirmar Orden";
    confirmBtn.disabled = true;
    confirmBtn.onclick = () => submitPlayerAnswer(selected);

    refresh();
    ordWrapper.appendChild(slotsRow);
    ordWrapper.appendChild(chipsRow);
    ordWrapper.appendChild(confirmBtn);
    dom.optionsContainer.appendChild(ordWrapper);
  }

  /**
   * Renderizado modular para preguntas de cálculo numérico.
   */
  function renderNumericUI(q) {
    dom.optionsContainer.className = "options-grid";
    const numWrapper = document.createElement("div");
    numWrapper.style.display = "grid";
    numWrapper.style.gap = "10px";

    const display = document.createElement("input");
    display.className = "form-input code-input";
    display.readOnly = true;
    display.placeholder = `0 ${q.unit || ""}`;

    let currentVal = "";

    const pad = document.createElement("div");
    pad.style.display = "grid";
    pad.style.gridTemplateColumns = "repeat(3, 1fr)";
    pad.style.gap = "8px";

    ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"].forEach((key) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-ghost";
      btn.style.fontSize = "22px";
      btn.style.padding = "12px";
      btn.textContent = key;
      btn.onclick = () => {
        if (key === "⌫") {
          currentVal = currentVal.slice(0, -1);
        } else if (key === "," && !currentVal.includes(",")) {
          currentVal += ",";
        } else if (key !== ",") {
          currentVal += key;
        }
        display.value = currentVal ? `${currentVal} ${q.unit || ""}` : "";
        if (window.TalentoAudio) window.TalentoAudio.play("tap");
      };
      pad.appendChild(btn);
    });

    const sendBtn = document.createElement("button");
    sendBtn.className = "btn btn-primary btn-block";
    sendBtn.textContent = "Enviar Respuesta";
    sendBtn.onclick = () => {
      if (currentVal.trim()) submitPlayerAnswer(currentVal.trim());
    };

    numWrapper.appendChild(display);
    numWrapper.appendChild(pad);
    numWrapper.appendChild(sendBtn);
    dom.optionsContainer.appendChild(numWrapper);
  }

  /**
   * Deshabilita los botones de opciones.
   */
  function disableOptions() {
    if (!dom.optionsContainer) return;
    const buttons = dom.optionsContainer.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
  }

  /**
   * Envía la respuesta del jugador al servidor con protección anti-rebote.
   */
  function submitPlayerAnswer(givenAnswer) {
    if (state.hasAnswered) return;
    state.hasAnswered = true;
    disableOptions();

    if (state.timerInterval) clearInterval(state.timerInterval);

    if (window.TalentoAudio) window.TalentoAudio.play("tap");

    state.socket.emit(
      "submit_answer",
      {
        tournamentCode: state.code,
        matchId: state.currentMatchId,
        questionId: state.currentQuestion ? state.currentQuestion.id : null,
        answer: givenAnswer,
        participantId: state.participantId
      },
      (res) => {
        if (res && res.error) {
          showToast(res.error);
        } else {
          showScreen("answered");
        }
      }
    );
  }

  /**
   * Muestra la revelación del resultado tras la pregunta.
   */
  function handleQuestionRevealed(payload) {
    // El servidor emite: { question, results: { playerA: {...}, playerB: {...} }, matchScores, ... }
    // Debemos buscar nuestros resultados dentro de results según nuestro participantId
    const { question, results } = payload || {};

    // Buscar el resultado correspondiente a este participante
    let myResult = null;
    if (results) {
      if (results.playerA && results.playerA.participantId === state.participantId) {
        myResult = results.playerA;
      } else if (results.playerB && results.playerB.participantId === state.participantId) {
        myResult = results.playerB;
      }
    }

    const isCorrect = myResult ? myResult.isCorrect : false;
    const pointsEarned = myResult ? myResult.points : 0;
    const explanation = (question && question.explanation) || payload.explanation || "";

    if (dom.verdictCard) {
      dom.verdictCard.className = "verdict-card " + (isCorrect ? "ok" : "bad");
    }
    if (dom.verdictTitle) {
      dom.verdictTitle.textContent = isCorrect ? "¡CORRECTO!" : "¡INCORRECTO!";
    }
    if (dom.verdictPoints) {
      dom.verdictPoints.textContent = isCorrect ? `+${pointsEarned || 0} pts` : "+0 pts";
    }
    if (dom.verdictExplanation) {
      dom.verdictExplanation.textContent = explanation || (question && question.explanation) || "";
    }

    showScreen("verdict");

    if (window.TalentoAudio) {
      window.TalentoAudio.play(isCorrect ? "ok" : "bad");
    }

    if (isCorrect && window.TalentoConfetti) {
      window.TalentoConfetti.start(2000, 60);
    }
  }

  /**
   * Inicialización de eventos de interfaz.
   */
  function bindUIEvents() {
    // Envío del formulario de ingreso
    if (dom.joinForm) {
      dom.joinForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const code = dom.inputCode ? dom.inputCode.value : "";
        const name = dom.inputName ? dom.inputName.value : "";
        registerNewParticipant(code, name);
      });
    }

    // Botón para salir del lobby
    if (dom.btnLeave) {
      dom.btnLeave.addEventListener("click", () => {
        if (confirm("¿Seguro que deseas salir de este torneo?")) {
          clearSession();
        }
      });
    }

    // Toggle de sonido
    if (dom.soundBtn) {
      dom.soundBtn.addEventListener("click", () => {
        if (window.TalentoAudio) {
          const enabled = window.TalentoAudio.toggle();
          dom.soundBtn.textContent = enabled ? "🔊" : "🔇";
          showToast(enabled ? "Sonido activado" : "Sonido desactivado");
        }
      });
      // Inicializar icono
      if (window.TalentoAudio && !window.TalentoAudio.isEnabled()) {
        dom.soundBtn.textContent = "🔇";
      }
    }
  }

  // Arranque del cliente
  document.addEventListener("DOMContentLoaded", () => {
    loadSavedSession();
    bindUIEvents();
    initSocket();
  });
})();

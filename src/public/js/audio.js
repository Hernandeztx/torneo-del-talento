/**
 * ==========================================================================
 * TORNEO DEL TALENTO — MOTOR DE AUDIO SINTETIZADO (WEB AUDIO API)
 * Genera efectos sonoros puros mediante osciladores matemáticos en tiempo real.
 * Cero archivos .mp3 externos, cero latencia, compatible con móviles.
 * ==========================================================================
 */

(function (window) {
  "use strict";

  let audioCtx = null;
  let soundEnabled = true;

  // Restaurar preferencia de sonido desde localStorage
  try {
    const saved = localStorage.getItem("talento_sound");
    if (saved !== null) {
      soundEnabled = saved === "true";
    }
  } catch (e) {}

  function getContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Desbloqueo de audio al primer toque/clic (requerido por navegadores móviles)
  function unlockAudio() {
    getContext();
    document.removeEventListener("touchstart", unlockAudio);
    document.removeEventListener("click", unlockAudio);
  }
  document.addEventListener("touchstart", unlockAudio, { passive: true });
  document.addEventListener("click", unlockAudio, { passive: true });

  const SOUND_SEQUENCES = {
    // Acierto: tono alegre ascendente (Mi - La)
    ok: [
      [660, 0.09],
      [880, 0.14]
    ],
    // Fallo: tono grave descendente
    bad: [
      [220, 0.18],
      [160, 0.22]
    ],
    // Victoria / Podio: Fanfarria mayor (Do - Mi - Sol - Do agudo)
    win: [
      [523, 0.12],
      [659, 0.12],
      [784, 0.12],
      [1047, 0.35]
    ],
    // Cuenta regresiva / Segundero
    tick: [
      [880, 0.03]
    ],
    // Advertencia últimos segundos
    warning: [
      [440, 0.08]
    ],
    // Toque de botón táctil
    tap: [
      [520, 0.03]
    ]
  };

  const TalentoAudio = {
    play: function (kind) {
      if (!soundEnabled) return;
      const ctx = getContext();
      if (!ctx) return;

      const seq = SOUND_SEQUENCES[kind] || SOUND_SEQUENCES.tap;
      let t = ctx.currentTime;

      try {
        seq.forEach(([freq, duration]) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = kind === "bad" ? "sawtooth" : "triangle";
          osc.frequency.setValueAtTime(freq, t);

          gain.gain.setValueAtTime(0.18, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(t);
          osc.stop(t + duration);
          t += duration * 0.85;
        });
      } catch (err) {
        // Silencioso ante errores de contexto de audio
      }
    },

    toggle: function () {
      soundEnabled = !soundEnabled;
      try {
        localStorage.setItem("talento_sound", String(soundEnabled));
      } catch (e) {}
      return soundEnabled;
    },

    isEnabled: function () {
      return soundEnabled;
    },

    setEnabled: function (val) {
      soundEnabled = Boolean(val);
      try {
        localStorage.setItem("talento_sound", String(soundEnabled));
      } catch (e) {}
    }
  };

  window.TalentoAudio = TalentoAudio;
})(window);

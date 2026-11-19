/**
 * ==========================================================================
 * TORNEO DEL TALENTO — SISTEMA DE CONFETI EN CANVAS
 * Animación de física ligera para celebraciones de victoria y podio.
 * Cero dependencias externas, alto rendimiento en móviles y pantallas 4K.
 * ==========================================================================
 */

(function (window) {
  "use strict";

  let canvas = null;
  let ctx = null;
  let animId = null;
  let particles = [];
  const COLORS = ["#f2a93b", "#ffcf7a", "#2fa37f", "#3d7be0", "#e0714f", "#eef4f1"];

  function getCanvas() {
    if (!canvas) {
      canvas = document.getElementById("fx-canvas");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "fx-canvas";
        canvas.style.position = "fixed";
        canvas.style.inset = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.pointerEvents = "none";
        canvas.style.zIndex = "9999";
        document.body.appendChild(canvas);
      }
      ctx = canvas.getContext("2d");
      resize();
      window.addEventListener("resize", resize, { passive: true });
    }
    return canvas;
  }

  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  const TalentoConfetti = {
    start: function (durationMs = 4000, count = 140) {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      getCanvas();
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;

      particles = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: -20 - Math.random() * (H * 0.4),
        vx: (Math.random() - 0.5) * 3.5,
        vy: 2.5 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.15,
        sizeW: 6 + Math.random() * 8,
        sizeH: 4 + Math.random() * 6,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]
      }));

      const startTime = performance.now();
      const endTime = startTime + durationMs;

      if (animId) cancelAnimationFrame(animId);

      function loop(now) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.rotSpeed;

          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.sizeW / 2, -p.sizeH / 2, p.sizeW, p.sizeH);
          ctx.restore();
        });

        if (now < endTime) {
          animId = requestAnimationFrame(loop);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          animId = null;
        }
      }

      animId = requestAnimationFrame(loop);
    },

    stop: function () {
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  window.TalentoConfetti = TalentoConfetti;
})(window);

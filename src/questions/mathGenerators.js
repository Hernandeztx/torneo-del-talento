"use strict";

/**
 * Utilidades aleatorias y de formato idénticas a Torneo_Talento.html (líneas 317-318).
 */
function rnd(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

function fmt(n) {
  return Number(n).toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

/**
 * Generadores matemáticos procedimentales idénticos a GENS en Torneo_Talento.html (líneas 326-332).
 */
const GENS = {
  rotacion: {
    level: 2,
    category: "Cálculo",
    name: "Rotación de personal",
    make() {
      const s = rnd(3, 24);
      const p = rnd(4, 30) * 10;
      const ans = Math.round((s / p) * 1000) / 10;
      return {
        key: `rot${s}-${p}`,
        type: "num",
        level: 2,
        category: "Cálculo",
        question: `En un año salieron ${s} personas y la plantilla promedio fue de ${p}. ¿Cuál es la rotación? (en %, con 1 decimal)`,
        ans,
        tol: 0.1,
        unit: "%",
        explanation: `${s} ÷ ${p} × 100 = ${fmt(ans)} %`
      };
    }
  },

  carga: {
    level: 2,
    category: "Cálculo",
    name: "Carga de trabajo en horas-hombre",
    make() {
      const u = rnd(5, 60) * 1000;
      const h = rnd(2, 16) * 0.05;
      const v = Math.round(u * h);
      return {
        key: `car${u}-${h.toFixed(2)}`,
        type: "num",
        level: 2,
        category: "Cálculo",
        question: `Una planta debe producir ${fmt(u)} unidades al mes y cada una requiere ${fmt(h)} h de trabajo. ¿Cuántas horas-hombre necesita al mes?`,
        ans: v,
        tol: 0.5,
        unit: "h",
        explanation: `${fmt(u)} × ${fmt(h)} = ${fmt(v)} horas-hombre`
      };
    }
  },

  brecha: {
    level: 1,
    category: "Cálculo",
    name: "Brecha de dotación",
    make() {
      const n = rnd(30, 140);
      const m = n - rnd(3, 25);
      return {
        key: `bre${n}-${m}`,
        type: "num",
        level: 1,
        category: "Cálculo",
        question: `Una planta necesita ${n} operarios y hoy tiene ${m}. ¿Cuántos operarios le faltan?`,
        ans: n - m,
        tol: 0,
        unit: "operarios",
        explanation: `${n} − ${m} = ${n - m}`
      };
    }
  },

  productivas: {
    level: 3,
    category: "Cálculo",
    name: "Horas productivas efectivas",
    make() {
      const H = rnd(40, 50) * 4;
      const a = rnd(3, 12);
      const f = rnd(16, 19) * 5;
      const v = Math.round(H * (1 - a / 100) * (f / 100) * 10) / 10;
      return {
        key: `pro${H}-${a}-${f}`,
        type: "num",
        level: 3,
        category: "Cálculo",
        question: `Un operario trabaja ${H} h al mes, con ${a} % de ausentismo y ${f} % de eficiencia. ¿Cuántas horas productivas tiene? (1 decimal)`,
        ans: v,
        tol: 0.6,
        unit: "h",
        explanation: `${H} × ${fmt(1 - a / 100)} × ${fmt(f / 100)} ≈ ${fmt(v)} h`
      };
    }
  },

  operarios: {
    level: 3,
    category: "Cálculo",
    name: "Cálculo de plantilla requerida",
    make() {
      const C = rnd(30, 120) * 200;
      const r = rnd(130, 165);
      const v = Math.ceil(C / r);
      return {
        key: `ope${C}-${r}`,
        type: "num",
        level: 3,
        category: "Cálculo",
        question: `La carga es de ${fmt(C)} horas-hombre al mes y cada operario rinde ${r} h productivas. ¿Cuántos operarios se necesitan? (redondea hacia arriba)`,
        ans: v,
        tol: 0,
        unit: "operarios",
        explanation: `${fmt(C)} ÷ ${r} = ${fmt(Math.round((C / r) * 100) / 100)} → ${v}`
      };
    }
  }
};

/**
 * Genera una pregunta de cálculo procedimental para un nivel de dificultad dado.
 */
function generateMathQuestion(targetLevel = 2, usedKeys = new Set()) {
  const keys = Object.keys(GENS).filter(
    (k) => Math.abs(GENS[k].level - targetLevel) <= 1
  );

  for (let tries = 0; tries < 200; tries++) {
    const k = keys[Math.floor(Math.random() * keys.length)];
    const item = GENS[k].make();
    if (!usedKeys.has(item.key)) {
      usedKeys.add(item.key);
      return {
        id: "gen:" + item.key,
        key: item.key,
        type: "num",
        level: item.level,
        category: item.category,
        question: item.question,
        options: null,
        correctAnswer: item.ans,
        tolerance: item.tol,
        unit: item.unit,
        explanation: item.explanation
      };
    }
  }
  return null;
}

module.exports = {
  GENS,
  rnd,
  fmt,
  generateMathQuestion
};


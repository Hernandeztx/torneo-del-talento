"use strict";

/**
 * Función hash djb2 idéntica a la original de Torneo_Talento.html (línea 322).
 * Garantiza IDs deterministas para cada pregunta estática.
 */
function hid(t) {
  let h = 5381;
  for (let i = 0; i < t.length; i++) {
    h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  }
  return "q" + h.toString(36);
}

/**
 * BANCO ORIGINAL extraído con fidelidad 100% de Torneo_Talento.html (líneas 225-307).
 * Tuplas: [tipo, nivel, categoria, pregunta, opciones/booleano, explicacion]
 */
const RAW_BANCO = [
  // ---- Concepto ----
  ["mc",1,"Concepto","¿Cuál es una de las tres preguntas de la planeación del talento?",["¿Cuántas personas necesito?","¿Cuánto cuesta una máquina?","¿Dónde queda la empresa?","¿Quién es el dueño?"],"Las tres preguntas son: cuántas personas, con qué competencias y cuándo."],
  ["vf",1,"Concepto","Las máquinas se compran; el talento se construye.",true,"Fue la idea central de la lámina 3."],
  ["vf",1,"Concepto","Planear el talento es solo asunto de Recursos Humanos y no tiene que ver con ingeniería.",false,"Los ingenieros industriales lideran procesos y equipos, así que también planean talento."],
  ["mc",1,"Concepto","La planeación del talento define cuántas personas y con qué competencias. ¿Qué otro elemento define?",["El momento en que se necesitan","El salario de cada cargo","El lugar de nacimiento","La edad de cada persona"],"Las tres preguntas son cuántas personas, con qué competencias y cuándo."],
  ["mc",1,"Concepto","Lo contrario de planear el talento es…",["Apagar incendios","Medir indicadores","Hacer un diagnóstico","Formar al personal"],"Reaccionar cuando el problema ya llegó es apagar incendios."],
  ["mc",2,"Concepto","¿Qué tres cosas hacen al talento difícil de copiar?",["Conocimiento, experiencia y cultura","Máquinas, edificios y marcas","Salarios, bonos y horarios","Precios, clientes y proveedores"],"Son las tres esferas que giraban alrededor de la ficha dorada."],
  ["vf",2,"Concepto","Hoy el talento se considera solo un gasto de nómina.",false,"Hoy se ve como ventaja competitiva."],
  ["mc",2,"Concepto","Según Chiavenato, la planeación del talento consiste sobre todo en…",["Prever las necesidades de personal antes de que ocurran","Contratar cuando aparece una vacante","Reducir la nómina","Evaluar el desempeño una vez al año"],"No es solo contratar: es prever."],
  ["vf",2,"Concepto","Tener más personal del necesario no le cuesta nada a la empresa.",false,"Tener de más sube los costos de nómina sin necesidad."],
  ["mc",2,"Concepto","Formar a un buen supervisor puede tomar…",["Varios meses","Un día","Una hora","Nada: se contrata hecho"],"Por eso hay que empezar antes de que el actual se vaya."],
  ["mc",3,"Concepto","Una empresa espera a que renuncie su supervisor para buscar reemplazo. ¿Cuál es el problema?",["Ya es tarde: formar uno toma meses","Va a pagar menos","No necesita reemplazo","Ninguno, es lo ideal"],"Planear es anticiparse al momento en que hace falta."],
  ["vf",3,"Concepto","Algunas competencias se contratan afuera y otras se desarrollan con la gente que ya está.",true,"Las dos vías se combinan según el costo y el tiempo."],
  ["mc",3,"Concepto","Si me paso en la cantidad de personal tengo costos; si me quedo corto tengo…",["Sobrecarga, horas extra y atrasos","Más ganancias","Menos rotación","Mejor clima"],"Las dos fallas cuestan: por eso se calcula la dotación."],

  // ---- Objetivos ----
  ["mc",1,"Objetivos","¿Cuál es un objetivo de planear el talento?",["Tener el personal adecuado a tiempo","Comprar más máquinas","Subir los precios","Abrir más oficinas"],"Cantidad y perfil correctos antes de que haga falta."],
  ["vf",1,"Objetivos","Reducir la rotación es uno de los objetivos de planear el talento.",true,"Menos rotación significa menos costos y menos conocimiento perdido."],
  ["mc",2,"Objetivos","¿Qué provoca contratar “a la carrera”?",["Errores de selección y reprocesos","Más productividad","Menos costos","Mejor clima laboral"],"Sin tiempo para seleccionar bien, se equivoca el perfil."],
  ["mc",2,"Objetivos","¿Hacia qué deben apuntar todos los objetivos de la planeación del talento?",["La estrategia de la empresa","El salario del gerente","La cantidad de máquinas","Las vacaciones del personal"],"Cada objetivo acerca a la empresa a cumplir su estrategia."],
  ["mc",2,"Objetivos","Tener sucesores para los cargos críticos sirve para…",["Que la operación no dependa de una sola persona","Despedir más fácil","Pagar menos","Evitar capacitaciones"],"Si alguien clave se va, otro está listo para seguir."],
  ["vf",2,"Objetivos","Cuando una persona se va, se lleva parte del conocimiento de la empresa.",true,"Por eso la rotación cuesta más que el reemplazo."],
  ["mc",3,"Objetivos","¿Qué objetivo busca que todos “remen hacia el mismo lado”?",["Equipos alineados con la estrategia","Menos rotación","Personal a tiempo","Desarrollo de líderes"],"Que cada persona sepa cómo aporta a la estrategia."],
  ["vf",3,"Objetivos","Desarrollar líderes y sucesores no es parte de la planeación del talento.",false,"Desarrollo y retención es uno de los cuatro objetivos."],

  // ---- Estrategia ----
  ["ord",2,"Estrategia","Ordena la relación de la estrategia a los resultados",["Estrategia","Talento requerido","Plan de talento","Resultados"],"Cada decisión lleva a la siguiente, como los bloques de la lámina 6."],
  ["vf",2,"Estrategia","La relación entre estrategia y talento es de doble vía.",true,"Si no hay talento disponible, la estrategia también se ajusta."],
  ["mc",2,"Estrategia","Si una empresa automatiza, ¿qué perfil probablemente necesitará más?",["Técnicos de mantenimiento y programación","Más operarios manuales","Vendedores puerta a puerta","Ninguno"],"Automatizar cambia los perfiles: menos tareas manuales, más técnicas."],
  ["mc",2,"Estrategia","La empresa va a duplicar la producción. ¿Qué debe preguntarse talento humano?",["Cuántos operarios, técnicos y supervisores más, y para cuándo","Qué color pintar la planta","Cuántas máquinas vender","Nada, no le compete"],"Fue el ejemplo de la lámina 6."],
  ["mc",3,"Estrategia","Si en el mercado no está el talento que la estrategia necesita, ¿qué pasa?",["La estrategia se ajusta en ritmo o alcance","Se sigue igual","Se cierra la empresa","Se despide a todos"],"Es la doble vía: el talento también condiciona la estrategia."],
  ["vf",3,"Estrategia","Talento humano debería enterarse de la estrategia después de que se decide.",false,"Debe estar en la mesa donde se planea la empresa."],
  ["mc",3,"Estrategia","Productividad, calidad, costos y continuidad son…",["Los resultados del plan de talento","Las brechas","Las fases","Las herramientas"],"Son el último bloque de la cadena estrategia → resultados."],

  // ---- Fases ----
  ["mc",1,"Proceso","Las fases del proceso forman un ciclo parecido al…",["PHVA","5S","Kanban","Pareto"],"Planear, hacer, verificar y actuar, y volver a empezar."],
  ["ord",2,"Proceso","Ordena las primeras cuatro fases",["Diagnóstico","Oferta y demanda","Objetivos y brechas","Estrategias"],"Del diagnóstico se pasa a comparar, luego a las brechas y a las estrategias."],
  ["ord",3,"Proceso","Ordena las seis fases del proceso",["Diagnóstico","Oferta y demanda","Objetivos y brechas","Estrategias","Implementación","Seguimiento y ajuste"],"Es un ciclo: después de la 6 se vuelve a la 1."],
  ["mc",3,"Proceso","Comparar la oferta con la demanda muestra…",["Las brechas: qué falta, qué sobra y qué desarrollar","El salario promedio","La lista de clientes","El presupuesto de marketing"],"Con las brechas se fijan los objetivos."],
  ["vf",2,"Proceso","El plan de talento se hace una vez y se archiva.",false,"Es un ciclo que se repite."],
  ["mc",2,"Proceso","Contratar, capacitar y reubicar son ejemplos de…",["Estrategias para cerrar brechas","Indicadores","Diagnósticos","Brechas"],"Cada estrategia tiene su costo y su tiempo."],
  ["vf",3,"Proceso","En el diagnóstico se revisan la rotación y el ausentismo actuales.",true,"También la plantilla, las competencias y las edades."],
  ["mc",3,"Proceso","¿Qué se hace con los resultados del seguimiento?",["Ajustar el siguiente ciclo","Nada","Archivarlos","Despedir al jefe"],"Por eso el proceso es un ciclo."],

  // ---- Herramientas ----
  ["mc",1,"Herramientas","¿Cuál es una herramienta de la planeación del talento?",["Análisis DOFA","Diagrama de Gantt","Hoja de vida","Factura"],"DOFA, perfil de cargos, inventario, matriz de sucesión e indicadores."],
  ["mc",2,"Herramientas","¿Qué herramienta muestra quién puede reemplazar a quién?",["Matriz de sucesión","Análisis DOFA","Perfil de cargos","Inventario de talento"],"Sirve para los cargos críticos."],
  ["mc",2,"Herramientas","¿Qué herramienta describe funciones y requisitos de cada puesto?",["Perfil de cargos","Matriz de sucesión","Análisis DOFA","Indicadores"],"Sin perfiles claros no se selecciona bien."],
  ["mc",2,"Herramientas","¿Qué herramienta funciona como un archivador de las capacidades de la plantilla?",["Inventario de talento","Perfil de cargos","Análisis DOFA","Matriz de sucesión"],"Muestra qué capacidades hay y dónde están."],
  ["mc",1,"Herramientas","En DOFA, ¿qué significa la F?",["Fortalezas","Finanzas","Fábrica","Formación"],"Debilidades, Oportunidades, Fortalezas y Amenazas."],
  ["mc",2,"Herramientas","En un DOFA de talento, “escasez de técnicos en la región” es…",["Una amenaza","Una fortaleza","Una oportunidad","Una debilidad"],"Es un factor externo negativo."],
  ["mc",3,"Herramientas","En un DOFA, “personal clave a punto de pensionarse” es sobre todo…",["Una debilidad interna","Una oportunidad externa","Una amenaza externa","Una fortaleza sin riesgo"],"Es interno y pone en riesgo el conocimiento."],
  ["mc",1,"Herramientas","KPI significa…",["Indicador clave de desempeño","Plan de inversión","Proceso de calidad","Informe de personal"],"Key Performance Indicator."],
  ["mc",2,"Herramientas","¿Cuál es la fórmula de la rotación?",["Salidas ÷ plantilla promedio × 100","Plantilla ÷ salidas","Ingresos − salidas","Salidas × plantilla"],"Se expresa en porcentaje."],
  ["vf",3,"Herramientas","Un indicador de rotación solo dice algo cuando se compara con una meta o un periodo.",true,"Un número suelto no dice si vamos bien o mal."],
  ["mc",2,"Herramientas","¿Cuál NO es un indicador de talento humano?",["Precio de venta del producto","Rotación","Ausentismo","Tiempo de contratación"],"El precio es un indicador comercial."],

  // ---- Cadena ----
  ["ord",2,"Cadena","Ordena los primeros cuatro procesos de la cadena",["Atraer","Seleccionar","Integrar","Formar"],"Del ingreso a la formación."],
  ["ord",3,"Cadena","Ordena los seis procesos de la cadena",["Atraer","Seleccionar","Integrar","Formar","Desarrollar","Retener"],"Del ingreso a la retención."],
  ["mc",2,"Cadena","Una buena inducción ayuda a…",["Bajar la rotación temprana","Subir los precios","Evitar capacitaciones","Contratar más"],"Los primeros meses son cuando más gente se va."],
  ["vf",2,"Cadena","Desarrollar es exactamente lo mismo que capacitar.",false,"Desarrollar prepara para más responsabilidades: planes de carrera y sucesión."],
  ["mc",3,"Cadena","¿Por qué “retener” es el eslabón clave?",["Recupera lo invertido en los anteriores","Es el más barato","Es el primero","No es clave"],"Formar a alguien y que se vaya es perder la inversión."],
  ["mc",2,"Cadena","Clima laboral, reconocimiento y oportunidades de crecer son parte de…",["Retener","Atraer","Seleccionar","Integrar"],"Son lo que hace que la gente quiera quedarse."],
  ["vf",1,"Cadena","Si falla un eslabón de la cadena, se afecta todo el proceso.",true,"Por eso se dibujó como una cadena."],
  ["mc",3,"Cadena","Elegir al candidato que encaja con el cargo y con la cultura es…",["Seleccionar","Atraer","Integrar","Desarrollar"],"Se hace con criterios claros."],

  // ---- Casos ----
  ["mc",2,"Casos","¿Qué empresa es famosa por usar People Analytics?",["Google","Toyota","Bancolombia","Ninguna"],"Decide sobre su gente con datos."],
  ["mc",3,"Casos","People Analytics significa…",["Tomar decisiones de talento con datos","Hacer encuestas a clientes","Analizar las ventas","Contratar por intuición"],"Contratación, promoción y retención con datos."],
  ["vf",3,"Casos","Las horas de formación, por sí solas, demuestran que la formación sirvió.",false,"Hay que cruzarlas con desempeño y movilidad interna."],
  ["mc",3,"Casos","Para medir el impacto de la formación, las horas se cruzan con…",["Desempeño y movilidad interna","El precio de las acciones","El número de oficinas","Nada más"],"Así se ve si la formación cambió algo."],

  // ---- Tendencias ----
  ["mc",2,"Tendencias","Ante la automatización, la idea es…",["Reentrenar a la gente","Despedir a todos","No hacer nada","Contratar solo máquinas"],"Reentrenar, no solo reemplazar."],
  ["mc",2,"Tendencias","El trabajo híbrido exige liderar por…",["Objetivos y resultados","Horas en la oficina","Cámaras de vigilancia","Antigüedad"],"No por control de presencia."],
  ["mc",3,"Tendencias","Al usar datos para predecir quién se va a ir, hay que cuidar…",["La privacidad y la calidad de los datos","El color del gráfico","El precio del software","Nada"],"Es información de las personas."],
  ["vf",2,"Tendencias","El bienestar y la salud mental ayudan a atraer y retener talento.",true,"Ya no son un extra."],
  ["mc",3,"Tendencias","“La tecnología cambia las tareas; la planeación redefine…”",["las capacidades","los precios","los clientes","las máquinas"],"Era el título de la lámina de tendencias."],
  ["mc",2,"Tendencias","La inteligencia artificial hace que…",["Aparezcan perfiles nuevos y otras tareas se automaticen","Desaparezca la planeación","No se necesite formar a nadie","Nada cambie"],"Hay que planear qué competencias vendrán."],

  // ---- Actividad y cierre ----
  ["mc",2,"Decisión","La producción subirá 20 % en 3 meses. ¿Qué haces primero?",["Diagnosticar capacidad y brechas","Contratar de inmediato","Horas extra indefinidas","Esperar a ver qué pasa"],"Primero se mide, después se decide."],
  ["mc",3,"Decisión","¿Por qué las horas extra indefinidas no son buena solución?",["Traen cansancio, accidentes y rotación","Siempre son ilegales","Son muy baratas","No tienen ningún problema"],"Sirven solo como medida temporal."],
  ["vf",1,"Decisión","Antes de decidir cómo cubrir una necesidad de personal hay que medirla.",true,"Es la fase 1: diagnóstico."],
  ["mc",3,"Decisión","Contratar de inmediato sin calcular la carga puede llevar a…",["Contratar de más o el perfil equivocado","Ahorrar siempre","Bajar la rotación","Nada malo"],"Por eso la respuesta correcta era diagnosticar."],
  ["vf",2,"Cierre","Como ingenieros industriales, liderar equipos también incluye planear el talento.",true,"Cuarta conclusión."],
  ["mc",2,"Cierre","¿En qué se apoya la planeación del talento?",["En datos y herramientas","En la intuición","En la suerte","En los rumores"],"Tercera conclusión."],
  ["ord",3,"Cierre","Ordena las cuatro conclusiones como se presentaron",["Anticiparse","Alinear","Medir","Liderar"],"Las cuatro columnas que sostienen el techo."]
];

/**
 * Normaliza las preguntas estáticas con su ID determinista y estructura completa.
 */
const STATIC_BANK = RAW_BANCO.map((r) => {
  const type = r[0];
  const level = r[1];
  const category = r[2];
  const text = r[3];
  const rawAns = r[4];
  const explanation = r[5];

  const id = hid(text);

  return {
    id,
    type,
    level,
    category,
    question: text,
    // Para mc: opciones originales (la 0 es la correcta)
    // Para vf: null
    // Para ord: array en orden correcto
    options: type === "vf" ? null : rawAns,
    // Para vf: booleano true/false
    correctAnswer: type === "vf" ? rawAns : (type === "mc" ? rawAns[0] : rawAns),
    explanation
  };
});

module.exports = {
  hid,
  STATIC_BANK,
  TOTAL_STATIC_QUESTIONS: STATIC_BANK.length
};


# GUÍA DE PRUEBA REAL EN VIVO (PILOTO) — TORNEO DEL TALENTO

Esta guía describe el procedimiento paso a paso para realizar una prueba piloto presencial o por videollamada con usuarios reales.

---

## 1. EQUIPAMIENTO RECOMENDADO

1. **Computador del Organizador:** Laptop con navegador (Chrome, Edge o Firefox) para gestionar el panel `/organizador`.
2. **Pantalla Principal / Proyector:** Televisor, proyector de auditorio o segunda pantalla abierta en `/proyeccion`.
3. **Dispositivos de los Competidores:** 2 a 8 teléfonos celulares conectados a la misma red Wi-Fi o con acceso a internet abriendo `/jugar`.

---

## 2. CHECKLIST PASO A PASO PARA EL ORGANIZADOR

### Paso 1: Configurar y Crear la Sala
- [ ] Ingresar a `http://<IP_O_DOMINIO>:3000/organizador`.
- [ ] En la pestaña **Crear Torneo**, escribir el nombre del torneo y la contraseña de organizador (`ADMIN_SECRET`).
- [ ] Seleccionar:
  - Preguntas por duelo: `2` (recomendado para prueba ágil).
  - Tiempo por pregunta: `20` segundos.
  - Activar casilla: `Duelo por el Tercer Puesto`.
- [ ] Hacer clic en **Crear Torneo**. Se generará el código de sala (ejemplo: `ABCD`).

### Paso 2: Conectar la Pantalla de Proyección
- [ ] En el computador del proyector o pantalla de auditorio, abrir `http://<IP_O_DOMINIO>:3000/proyeccion`.
- [ ] Ingresar el código generado (ejemplo: `ABCD`).
- [ ] La pantalla mostrará el código en gigante, el código QR y el mosaico de participantes vacíos.
- [ ] Presionar el botón `[ ⛶ ]` para poner la proyección en **Pantalla Completa**.

### Paso 3: Registro de Participantes
- [ ] Los estudiantes escanean el código QR con sus teléfonos o abren `http://<IP_O_DOMINIO>:3000/jugar?code=ABCD`.
- [ ] Cada estudiante escribe su nombre real y presiona **Entrar al Torneo**.
- [ ] Verificar que cada nombre aparezca inmediatamente en el mosaico de la pantalla de proyección y en la tabla del organizador.

### Paso 4: Iniciar el Torneo
- [ ] Con al menos 2 o 4 participantes listos, el organizador hace clic en **Iniciar Torneo Oficial**.
- [ ] Confirmar en el modal. La pantalla de proyección emitirá sonido de fanfarria y presentará el **Bracket de Eliminación**.

### Paso 5: Ejecución de un Duelo
- [ ] En la pestaña **Cuadro de Duelos** del organizador, buscar el enfrentamiento con etiqueta `ready` y hacer clic en **▶ Activar Duelo**.
- [ ] La pantalla de proyección y los dos teléfonos asignados cambiarán a la **Arena de Duelo**.
- [ ] El organizador hace clic en **🎯 Lanzar Pregunta**.
- [ ] Los dos competidores ven la pregunta y el temporizador en sus teléfonos.
- [ ] Cada competidor presiona su opción. Al responder, la pantalla de proyección mostrará una marca de "Respuesta recibida" para ese competidor, sin desvelar la opción marcada.
- [ ] El organizador hace clic en **🔍 Revelar Respuesta** (o espera que concluya el cronómetro).
- [ ] La pantalla muestra la respuesta correcta y los puntos. Los participantes ven en su pantalla si acertaron o fallaron.
- [ ] El organizador hace clic en **⏭ Siguiente**. Si quedan preguntas en el duelo, lanza la siguiente; si concluyeron las preguntas, el duelo finaliza y el ganador avanza automáticamente.

### Paso 6: Rondas Finales y Podio
- [ ] Se repite la dinámica para las semifinales, el partido por el tercer puesto y la gran final.
- [ ] Al concluir la gran final, el organizador hace clic en **🏁 Finalizar Torneo**.
- [ ] La pantalla de proyección desplegará el **Podio de Premiación (1°, 2° y 3° puesto)** con animación de confeti.

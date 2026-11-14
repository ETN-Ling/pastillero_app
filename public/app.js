/* Pastillero inteligente - app para familiares y enfermeros */
(function () {
  "use strict";

  // ---------------------------------------------------------------- utilidades
  var DIAS = ["L", "M", "X", "J", "V", "S", "D"];                 // orden del pastillero semanal
  var DIA_JS = ["D", "L", "M", "X", "J", "V", "S"];               // Date.getDay()
  var NOMBRE_DIA = { L: "lunes", M: "martes", X: "miércoles", J: "jueves", V: "viernes", S: "sábado", D: "domingo" };
  var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  var TIPOS_ALERTA = {
    tomada: "Retiró su medicamento",
    no_tomada: "No retiró su medicamento a tiempo",
    recipiente_bajo: "Quedan pocas pastillas",
    ambiente: "Temperatura o humedad fuera de rango",
    sin_conexion: "Pastillero sin conexión",
    fallo_dispensado: "Falla al dispensar"
  };
  var ETIQUETA_ALERTA = Object.assign({ prueba: "Aviso de prueba" }, TIPOS_ALERTA);
  var ROLES = { familiar: "Familiar", enfermero: "Enfermero(a)", medico: "Médico(a)", otro: "Otro" };
  var EN_LINEA_MS = 3 * 60 * 1000;
  var HUMEDAD_MAX = 60, TEMP_MAX = 30;

  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function dos(n) { return String(n).padStart(2, "0"); }
  function fechaISO(d) { return d.getFullYear() + "-" + dos(d.getMonth() + 1) + "-" + dos(d.getDate()); }
  function horaDe(ms) { var d = new Date(ms); return dos(d.getHours()) + ":" + dos(d.getMinutes()); }
  function fechaCorta(d) { return d.getDate() + " " + MESES[d.getMonth()]; }
  function ahora() { return Date.now() + (estado.desfase || 0); }
  function haceCuanto(ms) {
    var s = Math.max(0, Math.round((ahora() - ms) / 1000));
    if (s < 60) return "hace " + s + " s";
    var m = Math.round(s / 60);
    if (m < 60) return "hace " + m + " min";
    var h = Math.round(m / 60);
    if (h < 48) return "hace " + h + " h";
    return "hace " + Math.round(h / 24) + " días";
  }
  function faltan(ms) {
    var m = Math.round((ms - Date.now()) / 60000);
    if (m < 1) return "ahora";
    if (m < 60) return "en " + m + " min";
    var h = Math.floor(m / 60), r = m % 60;
    return "en " + h + " h" + (r ? " " + r + " min" : "");
  }
  function etiquetaDia(d) {
    var hoy = new Date();
    var ayer = new Date(Date.now() - 86400000);
    if (fechaISO(d) === fechaISO(hoy)) return "Hoy, " + fechaCorta(d);
    if (fechaISO(d) === fechaISO(ayer)) return "Ayer, " + fechaCorta(d);
    var nom = NOMBRE_DIA[DIA_JS[d.getDay()]];
    return nom.charAt(0).toUpperCase() + nom.slice(1) + ", " + fechaCorta(d);
  }
  function lista(obj) { return obj ? Object.keys(obj).map(function (k) { var v = obj[k] || {}; v._id = k; return v; }) : []; }
  function recNombre(n) { var r = (estado.recipientes || {})["r" + n] || {}; return r.medicamento || "Recipiente " + n; }
  function recChip(n, sm) { return '<span class="rec r' + n + (sm ? " sm" : "") + '" aria-label="Recipiente ' + n + '">' + n + "</span>"; }
  function textoDias(d) {
    d = d || "";
    if (d.length === 7) return "Todos los días";
    if (d === "LMXJV") return "Lunes a viernes";
    if (d === "SD") return "Fines de semana";
    return DIAS.filter(function (x) { return d.indexOf(x) >= 0; }).map(function (x) { return NOMBRE_DIA[x].slice(0, 3); }).join(", ");
  }
  function semana(dias, rec) {
    return '<span class="week" style="--rc: var(--r' + rec + ')" aria-label="' + esc(textoDias(dias)) + '">' +
      DIAS.map(function (x) { return '<span class="' + ((dias || "").indexOf(x) >= 0 ? "on" : "") + '">' + x + "</span>"; }).join("") + "</span>";
  }
  function errorTexto(e) {
    var c = (e && (e.code || e.message)) || "";
    if (/PERMISSION_DENIED|permission/i.test(c)) return "No tienes permiso. Revisa que este pastillero esté vinculado a tu cuenta.";
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/i.test(c)) return "Correo o contraseña incorrectos.";
    if (/email-already-in-use/.test(c)) return "Ya existe una cuenta con ese correo. Inicia sesión.";
    if (/weak-password/.test(c)) return "La contraseña debe tener al menos 6 caracteres.";
    if (/invalid-email/.test(c)) return "Ese correo no es válido.";
    if (/network/i.test(c)) return "Sin conexión a internet. Intenta de nuevo.";
    if (/too-many-requests/.test(c)) return "Demasiados intentos. Espera unos minutos.";
    return "No se pudo completar: " + c;
  }
  var toastT;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function guardarLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function leerLocal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // ---------------------------------------------------------------- estado
  var be = null;
  var estado = {
    usuario: null, perfil: null, dispositivos: null, dev: null,
    info: null, estadoDev: null, recipientes: null, horarios: null, comandos: null,
    paciente: null, pacienteId: null, historial: null, alertas: null,
    vista: "inicio", historialTab: "tomas", desfase: 0
  };
  var bajas = [];        // funciones para dejar de escuchar
  var bajaPaciente = null;

  function dejarDeEscuchar() {
    bajas.forEach(function (f) { try { f(); } catch (e) {} });
    bajas = [];
    if (bajaPaciente) { try { bajaPaciente(); } catch (e) {} bajaPaciente = null; }
  }

  // ---------------------------------------------------------------- arranque
  async function iniciar() {
    var cfg = window.FIREBASE_CONFIG || {};
    var demo = window.PASTILLERO_DEMO || /[?&]demo\b/.test(location.search) || !cfg.apiKey || /PEGA/.test(cfg.apiKey);
    try {
      be = demo ? crearBackendDemo() : await crearBackendFirebase(cfg);
    } catch (e) {
      $("#app").innerHTML = '<div class="auth"><div class="banner bad">No se pudo cargar Firebase. Revisa tu conexión a internet y recarga la página.</div></div>';
      return;
    }
    var h = (location.hash || "").replace("#", "");
    if (["inicio", "horarios", "historial", "contactos", "ajustes"].indexOf(h) >= 0) estado.vista = h;
    be.alCambiarSesion(alCambiarSesion);
    if (!demo && "serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
    setInterval(function () { if (estado.dev && estado.vista === "inicio" && !document.querySelector("dialog[open]")) pintar(); }, 30000);
  }

  function alCambiarSesion(u) {
    dejarDeEscuchar();
    estado.usuario = u;
    estado.dispositivos = null;
    estado.dev = null;
    if (!u) { estado.vista = "inicio"; estado.historialTab = "tomas"; pintarAcceso("entrar"); return; }
    $("#app").innerHTML = '<div class="loading">Cargando tu pastillero…</div>';
    bajas.push(be.escuchar(".info/serverTimeOffset", function (v) { estado.desfase = v || 0; }));
    bajas.push(be.escuchar("usuarios/" + u.uid + "/perfil", function (v) { estado.perfil = v; }));
    bajas.push(be.escuchar("usuarios/" + u.uid + "/dispositivos", function (v) {
      estado.dispositivos = v ? Object.keys(v) : [];
      if (!estado.dispositivos.length) { estado.dev = null; pintarVincular(); return; }
      var preferido = leerLocal("pastillero_dev");
      var dev = estado.dispositivos.indexOf(preferido) >= 0 ? preferido : estado.dispositivos[0];
      if (dev !== estado.dev) escucharDispositivo(dev);
    }, { alError: function (e) { $("#app").innerHTML = '<div class="auth"><div class="banner bad">' + esc(errorTexto(e)) + "</div></div>"; } }));
  }

  function escucharDispositivo(dev) {
    // conserva las suscripciones de sesion (las 3 primeras) y reemplaza las del dispositivo
    var deSesion = bajas.slice(0, 3);
    bajas.slice(3).forEach(function (f) { try { f(); } catch (e) {} });
    bajas = deSesion;
    if (bajaPaciente) { bajaPaciente(); bajaPaciente = null; }
    estado.dev = dev;
    guardarLocal("pastillero_dev", dev);
    ["info", "estadoDev", "recipientes", "horarios", "comandos", "paciente", "historial", "alertas"].forEach(function (k) { estado[k] = null; });
    var base = "dispositivos/" + dev;
    var err = { alError: function (e) { toast(errorTexto(e)); } };
    bajas.push(be.escuchar(base + "/info", function (v) {
      estado.info = v || {};
      var pid = estado.info.paciente || null;
      if (pid !== estado.pacienteId) {
        if (bajaPaciente) { bajaPaciente(); bajaPaciente = null; }
        estado.pacienteId = pid;
        estado.paciente = null;
        if (pid) bajaPaciente = be.escuchar("pacientes/" + pid, function (p) { estado.paciente = p || {}; pintar(); }, err);
      }
      pintar();
    }, err));
    bajas.push(be.escuchar(base + "/estado", function (v) { estado.estadoDev = v || {}; pintar(); }, err));
    bajas.push(be.escuchar(base + "/recipientes", function (v) { estado.recipientes = v || {}; pintar(); }, err));
    bajas.push(be.escuchar(base + "/horarios", function (v) { estado.horarios = v || {}; pintar(); }, err));
    bajas.push(be.escuchar(base + "/comandos", function (v) { estado.comandos = v || {}; pintar(); }, err));
    bajas.push(be.escuchar("historial_dosis/" + dev, function (v) { estado.historial = v || {}; pintar(); }, { ordenarPor: "dispensada", ultimos: 200, alError: err.alError }));
    bajas.push(be.escuchar("historial_alertas/" + dev, function (v) { estado.alertas = v || {}; pintar(); }, { ordenarPor: "fecha", ultimos: 100, alError: err.alError }));
  }

  // ---------------------------------------------------------------- acceso
  var LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="6" y="11" width="20" height="10" rx="5" fill="#fff"/><path d="M16 11v10" stroke="currentColor" stroke-width="2.2" style="color:var(--accent)"/><rect x="16" y="11" width="10" height="10" rx="5" fill="#fff" opacity=".55"/></svg>';

  function pintarAcceso(modo) {
    var esRegistro = modo === "registro", esRecuperar = modo === "recuperar";
    $("#app").innerHTML =
      '<div class="auth">' +
      '<div class="brand"><div class="brand-mark">' + LOGO + '</div><div><h1>Pastillero</h1><div class="muted">Para familiares y enfermeros</div></div></div>' +
      (be.modo === "demo" ? '<div class="banner info">Modo demostración: entra con cualquier correo para ver datos de ejemplo.</div>' : "") +
      '<form class="card form" id="f-acceso" novalidate>' +
      "<h2>" + (esRegistro ? "Crear cuenta" : esRecuperar ? "Recuperar contraseña" : "Iniciar sesión") + "</h2>" +
      (esRegistro ? '<div class="field"><label for="a-nombre">Tu nombre</label><input id="a-nombre" autocomplete="name" placeholder="María López"></div>' : "") +
      '<div class="field"><label for="a-email">Correo</label><input id="a-email" type="email" autocomplete="email" inputmode="email" placeholder="nombre@gmail.com"></div>' +
      (esRecuperar ? "" : '<div class="field"><label for="a-clave">Contraseña</label><input id="a-clave" type="password" autocomplete="' + (esRegistro ? "new-password" : "current-password") + '" placeholder="Mínimo 6 caracteres"></div>') +
      '<div class="err" id="a-err" role="alert" style="color:var(--bad)"></div>' +
      '<button class="btn primary block" type="submit">' + (esRegistro ? "Crear cuenta" : esRecuperar ? "Enviar enlace" : "Entrar") + "</button>" +
      "</form>" +
      '<div class="center small">' +
      (esRegistro || esRecuperar ? '<button class="linkish" data-modo="entrar">Ya tengo cuenta</button>'
        : '<button class="linkish" data-modo="registro">Crear una cuenta</button> · <button class="linkish" data-modo="recuperar">Olvidé mi contraseña</button>') +
      "</div></div>";
    $$("[data-modo]").forEach(function (b) { b.onclick = function () { pintarAcceso(b.dataset.modo); }; });
    $$("#f-acceso input").forEach(function (i) { i.oninput = function () { $("#a-err").textContent = ""; }; });
    $("#f-acceso").onsubmit = async function (ev) {
      ev.preventDefault();
      var email = $("#a-email").value.trim();
      var clave = $("#a-clave") ? $("#a-clave").value : "";
      var nombre = $("#a-nombre") ? $("#a-nombre").value.trim() : "";
      var e = $("#a-err");
      if (esRegistro && !nombre) { e.textContent = "Escribe tu nombre."; return; }
      if (!/^\S+@\S+\.\S+$/.test(email)) { e.textContent = "Escribe un correo válido."; return; }
      if (!esRecuperar && clave.length < 6) { e.textContent = "La contraseña debe tener al menos 6 caracteres."; return; }
      var btn = $("#f-acceso button[type=submit]");
      btn.disabled = true;
      try {
        if (esRegistro) await be.registrar(nombre, email, clave);
        else if (esRecuperar) { await be.recuperar(email); toast("Te enviamos un enlace a " + email); pintarAcceso("entrar"); }
        else await be.entrar(email, clave);
      } catch (x) { e.textContent = errorTexto(x); btn.disabled = false; }
    };
  }

  function pintarVincular(desdeAjustes) {
    $("#app").innerHTML =
      '<div class="auth">' +
      '<div class="brand"><div class="brand-mark">' + LOGO + '</div><div><h1>Vincula el pastillero</h1><div class="muted">Solo se hace una vez por cuenta</div></div></div>' +
      '<form class="card form" id="f-vinc" novalidate>' +
      '<div class="field"><label for="v-id">ID del pastillero</label><input id="v-id" value="pastillero_01" autocapitalize="off" autocomplete="off"><span class="hint">Viene en la etiqueta de la base del pastillero.</span></div>' +
      '<div class="field"><label for="v-cod">Código de vinculación</label><input id="v-cod" inputmode="numeric" autocomplete="one-time-code" placeholder="6 dígitos"><span class="hint">Te lo da quien instaló el pastillero.' + (be.modo === "demo" ? " En la demostración es 482915." : "") + "</span></div>" +
      '<div class="err" id="v-err" role="alert" style="color:var(--bad)"></div>' +
      '<button class="btn primary block" type="submit">Vincular</button>' +
      "</form>" +
      '<div class="center small">' + (desdeAjustes ? '<button class="linkish" id="v-volver">Volver</button> · ' : "") + '<button class="linkish" id="v-salir">Cerrar sesión</button></div></div>';
    $("#v-salir").onclick = function () { be.salir(); };
    if (desdeAjustes) $("#v-volver").onclick = function () { estado.vista = "ajustes"; pintar(); };
    $("#f-vinc").onsubmit = async function (ev) {
      ev.preventDefault();
      var id = $("#v-id").value.trim(), cod = $("#v-cod").value.trim();
      if (!/^[A-Za-z0-9_-]+$/.test(id)) { $("#v-err").textContent = "El ID solo lleva letras, números, - y _."; return; }
      if (!cod) { $("#v-err").textContent = "Escribe el código."; return; }
      try {
        await be.poner("usuarios/" + estado.usuario.uid + "/dispositivos/" + id, cod);
        guardarLocal("pastillero_dev", id);
        toast("Pastillero vinculado");
        estado.vista = "inicio";
      } catch (x) {
        $("#v-err").textContent = /PERMISSION/i.test(x.code || x.message || "") ? "El ID o el código no coinciden." : errorTexto(x);
      }
    };
  }

  // ---------------------------------------------------------------- estructura principal
  var ICONOS = {
    inicio: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
    horarios: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    historial: '<path d="M5 5h14M5 12h14M5 19h9"/>',
    contactos: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 6a3 3 0 0 1 0 5.6M17.5 14.3c1.6.6 2.7 2.2 3 4.7"/>',
    ajustes: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1"/>'
  };
  var TITULOS = { inicio: "Inicio", horarios: "Horarios", historial: "Historial", contactos: "Avisos", ajustes: "Ajustes" };

  function listo() {
    return estado.info && estado.estadoDev && estado.recipientes && estado.horarios && estado.historial && estado.alertas;
  }

  function pintar() {
    if (!estado.usuario || !estado.dev) return;
    if (!listo()) { $("#app").innerHTML = '<div class="loading">Cargando tu pastillero…</div>'; return; }
    var scroll = window.scrollY;
    var activo = document.activeElement && document.activeElement.id;
    var p = estado.paciente || {};
    var html =
      '<div class="shell">' +
      '<header class="topbar"><div class="who"><small>' + esc(TITULOS[estado.vista]) + "</small><strong>" + esc(p.nombre || estado.info.nombre || estado.dev) + "</strong></div>" + chipConexion() + "</header>" +
      '<main id="main">' + (be.modo === "demo" ? '<div class="banner info small">Modo demostración: todos los datos son de ejemplo y no se guardan.</div>' : "") +
      ({ inicio: vistaInicio, horarios: vistaHorarios, historial: vistaHistorial, contactos: vistaContactos, ajustes: vistaAjustes }[estado.vista])() +
      "</main>" +
      '<div class="tabs"><nav aria-label="Secciones">' +
      Object.keys(ICONOS).map(function (k) {
        return '<button data-vista="' + k + '"' + (k === estado.vista ? ' aria-current="page"' : "") + '><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONOS[k] + "</svg>" + TITULOS[k] + "</button>";
      }).join("") +
      "</nav></div></div>";
    $("#app").innerHTML = html;
    $$(".tabs [data-vista]").forEach(function (b) {
      b.onclick = function () {
        estado.vista = b.dataset.vista;
        try { history.replaceState(null, "", "#" + estado.vista); } catch (e) {}
        pintar();
        window.scrollTo(0, 0);
      };
    });
    enlazar();
    window.scrollTo(0, scroll);
    if (activo && document.getElementById(activo)) document.getElementById(activo).focus();
  }

  function enLinea() {
    var u = (estado.estadoDev || {}).ultima_conexion || 0;
    return u && ahora() - u < EN_LINEA_MS;
  }
  function chipConexion() {
    var u = (estado.estadoDev || {}).ultima_conexion || 0;
    if (!u) return '<span class="chip idle">Sin datos</span>';
    return enLinea() ? '<span class="chip ok">En línea</span>' : '<span class="chip bad">Sin conexión</span>';
  }

  // ---------------------------------------------------------------- calculos
  function horariosActivos() { return lista(estado.horarios).filter(function (h) { return h.activo && h.hora && h.dias; }); }
  function proximaToma() {
    var hs = horariosActivos(), mejor = null, base = new Date();
    for (var d = 0; d < 8 && !mejor; d++) {
      var dia = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
      var letra = DIA_JS[dia.getDay()];
      hs.forEach(function (h) {
        if (h.dias.indexOf(letra) < 0) return;
        var p = h.hora.split(":");
        var t = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), +p[0], +p[1]).getTime();
        if (t > Date.now() && (!mejor || t < mejor.t)) mejor = { t: t, h: h };
      });
    }
    return mejor;
  }
  function registroDe(fechaHora, rec) {
    var r = null;
    lista(estado.historial).forEach(function (x) { if (x.programada === fechaHora && +x.recipiente === +rec) r = x; });
    return r;
  }
  function chipDosis(x, programadaMs) {
    if (!x) {
      if (programadaMs && Date.now() > programadaMs + 2 * 60000) return '<span class="chip warn">Sin registro</span>';
      return '<span class="chip idle">Programada</span>';
    }
    if (x.estado === "tomada") return '<span class="chip ok">Retirada ' + (x.retirada ? horaDe(x.retirada) : "") + "</span>";
    if (x.estado === "no_tomada") return '<span class="chip bad">No retirada</span>';
    if (x.estado === "pendiente") return '<span class="chip info">En el vaso</span>';
    if (x.estado === "fallo") return '<span class="chip bad">Falló al dispensar</span>';
    return '<span class="chip idle">' + esc(x.estado || "—") + "</span>";
  }

  // ---------------------------------------------------------------- INICIO
  function vistaInicio() {
    var out = "";
    var ed = estado.estadoDev || {};
    if (!enLinea()) {
      out += '<div class="banner bad"><div><strong>El pastillero no se ha conectado' + (ed.ultima_conexion ? " desde " + esc(haceCuanto(ed.ultima_conexion)) : "") + ".</strong><br>Revisa que esté enchufado y que el WiFi funcione. Sin conexión sigue dispensando, pero no podrás ver lo que pasa.</div></div>";
    }
    // avisos de recipientes
    var avisos = [];
    [1, 2, 3].forEach(function (n) {
      var r = estado.recipientes["r" + n];
      if (!r) return;
      var min = r.aviso_minimo || 10;
      if (r.pastillas != null && r.pastillas <= min) avisos.push(recChip(n, true) + "<span>Quedan <b>" + r.pastillas + "</b> pastillas de " + esc(r.medicamento || "recipiente " + n) + ". Rellénalo pronto.</span>");
      if (r.humedad_pct > HUMEDAD_MAX) avisos.push(recChip(n, true) + "<span>Humedad alta (" + Math.round(r.humedad_pct) + " %) en " + esc(r.medicamento || "recipiente " + n) + ". Cambia la sílica gel.</span>");
      if (r.temperatura_c > TEMP_MAX) avisos.push(recChip(n, true) + "<span>Temperatura alta (" + r.temperatura_c.toFixed(1) + " °C) en " + esc(r.medicamento || "recipiente " + n) + ".</span>");
    });
    if (avisos.length) out += '<div class="banner warn"><div style="display:flex;flex-direction:column;gap:6px">' + avisos.map(function (a) { return '<div style="display:flex;gap:8px;align-items:center">' + a + "</div>"; }).join("") + "</div></div>";

    // proxima toma
    var px = proximaToma();
    out += '<section class="section"><div class="eyebrow">Próxima toma</div>';
    if (px) {
      out += '<div class="card next"><div class="time">' + esc(px.h.hora) + '</div><div class="med">' + recChip(px.h.recipiente, true) + "<span>" + esc(recNombre(px.h.recipiente)) +
        (px.h.cantidad > 1 ? " ×" + px.h.cantidad : "") + '</span></div><div class="when">' + (fechaISO(new Date(px.t)) === fechaISO(new Date()) ? "Hoy" : etiquetaDia(new Date(px.t))) + ", " + faltan(px.t) + "</div></div>";
    } else {
      out += '<div class="card empty">No hay horarios activos. <button class="linkish" data-ir="horarios">Agregar un horario</button></div>';
    }
    out += "</section>";

    // hoy
    var hoy = new Date();
    var letra = DIA_JS[hoy.getDay()];
    var deHoy = horariosActivos().filter(function (h) { return h.dias.indexOf(letra) >= 0; }).sort(function (a, b) { return a.hora < b.hora ? -1 : 1; });
    var manuales = lista(estado.historial).filter(function (x) { return x.dispensada && fechaISO(new Date(x.dispensada)) === fechaISO(hoy) && /manual/.test(x.programada || ""); });
    out += '<section class="section"><div class="section-head"><h2>Hoy</h2><span class="muted small">' + esc(etiquetaDia(hoy)) + "</span></div>";
    if (!deHoy.length && !manuales.length) out += '<div class="list"><div class="empty">Hoy no hay tomas programadas.</div></div>';
    else {
      out += '<div class="list today">';
      deHoy.forEach(function (h) {
        var p = h.hora.split(":");
        var ms = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), +p[0], +p[1]).getTime();
        var reg = registroDe(fechaISO(hoy) + " " + h.hora, h.recipiente);
        out += '<div class="row"><span class="t">' + esc(h.hora) + "</span>" + recChip(h.recipiente, true) + '<div class="grow"><div class="title">' + esc(recNombre(h.recipiente)) + '</div><div class="chiprow">' + chipDosis(reg, ms) + "</div></div></div>";
      });
      manuales.forEach(function (x) {
        out += '<div class="row"><span class="t">' + horaDe(x.dispensada) + "</span>" + recChip(x.recipiente, true) + '<div class="grow"><div class="title">' + esc(x.medicamento || recNombre(x.recipiente)) + '</div><div class="sub">Dispensada manualmente</div><div class="chiprow">' + chipDosis(x) + "</div></div></div>";
      });
      out += "</div>";
    }
    out += "</section>";

    // recipientes
    out += '<section class="section"><div class="section-head"><h2>Recipientes</h2><span class="muted small">' + (ed.ultima_conexion ? "Actualizado " + esc(haceCuanto(ed.ultima_conexion)) : "") + '</span></div><div class="bins">';
    var pendiente = +(estado.comandos || {}).dispensar_ahora || 0;
    [1, 2, 3].forEach(function (n) {
      var r = estado.recipientes["r" + n] || {};
      var cap = r.capacidad || 60;
      var pz = r.pastillas != null ? r.pastillas : null;
      var pct = pz == null ? 0 : Math.max(0, Math.min(100, Math.round(pz / cap * 100)));
      var bajo = pz != null && pz <= (r.aviso_minimo || 10);
      var humAlta = r.humedad_pct > HUMEDAD_MAX, tAlta = r.temperatura_c > TEMP_MAX;
      out += '<div class="card bin" style="--rc: var(--r' + n + ')"><div class="bin-head">' + recChip(n) + '<div class="grow"><div class="title">' + esc(r.medicamento || "Sin medicamento") + '</div><div class="muted small">' + esc(r.dosis || "") + "</div></div>" +
        (bajo ? '<span class="chip warn">Rellenar</span>' : "") + "</div>" +
        '<div><div class="bin-stats" style="justify-content:space-between"><span><b>' + (pz == null ? "—" : pz) + '</b> <span class="muted">de ' + cap + ' pastillas</span></span></div>' +
        '<div class="meter' + (bajo ? " low" : "") + '" role="img" aria-label="' + pct + ' por ciento lleno" style="margin-top:6px"><i style="width:' + pct + '%"></i></div></div>' +
        '<div class="bin-foot"><div class="bin-stats"><span' + (tAlta ? ' style="color:var(--warn)"' : "") + '><b>' + (r.temperatura_c != null ? Number(r.temperatura_c).toFixed(1) : "—") + '</b> °C</span><span' + (humAlta ? ' style="color:var(--warn)"' : "") + '><b>' + (r.humedad_pct != null ? Math.round(r.humedad_pct) : "—") + "</b> % humedad</span></div>" +
        '<button class="btn small" data-dispensar="' + n + '"' + (pendiente ? " disabled" : "") + ">" + (pendiente === n ? "Enviando…" : "Dispensar ahora") + "</button></div></div>";
    });
    out += "</div></section>";

    // ultima alerta
    var al = lista(estado.alertas).sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); })[0];
    if (al) {
      out += '<section class="section"><div class="section-head"><h2>Último aviso</h2><button class="linkish small" data-ir="historial" data-tab="alertas">Ver todos</button></div>' +
        '<div class="list"><div class="row"><div class="grow"><div class="title">' + esc(ETIQUETA_ALERTA[al.tipo] || al.tipo) + '</div><div class="sub">' + esc(al.mensaje || "") + '</div></div><span class="muted small">' + (al.fecha ? esc(haceCuanto(al.fecha)) : "") + "</span></div></div></section>";
    }
    return out;
  }

  // ---------------------------------------------------------------- HORARIOS
  function vistaHorarios() {
    var hs = lista(estado.horarios).sort(function (a, b) { return (a.hora || "") < (b.hora || "") ? -1 : 1; });
    var out = '<section class="section"><div class="section-head"><h2>Tomas programadas</h2><button class="btn primary small" id="h-nuevo">Agregar</button></div>';
    if (!hs.length) out += '<div class="list"><div class="empty">Todavía no hay horarios. Agrega el primero para que el pastillero sepa cuándo dispensar.</div></div>';
    else {
      out += '<div class="list sched">';
      hs.forEach(function (h) {
        out += '<div class="row' + (h.activo ? "" : " off") + '"><button class="icon-btn" style="display:flex;gap:12px;align-items:center;flex:1;min-width:0;text-align:left;color:inherit;padding:0" data-editar-h="' + esc(h._id) + '" aria-label="Editar horario de las ' + esc(h.hora) + '">' +
          '<span class="t">' + esc(h.hora) + '</span><span class="grow" style="display:flex;flex-direction:column;gap:6px;min-width:0"><span style="display:flex;gap:8px;align-items:center;font-weight:700;min-width:0">' + recChip(h.recipiente, true) + '<span style="overflow-wrap:anywhere">' + esc(recNombre(h.recipiente)) + (h.cantidad > 1 ? " ×" + h.cantidad : "") + "</span></span>" + semana(h.dias, h.recipiente) + "</span></button>" +
          '<label class="switch" title="' + (h.activo ? "Activo" : "Pausado") + '"><input type="checkbox" data-activo="' + esc(h._id) + '"' + (h.activo ? " checked" : "") + ' aria-label="Horario activo"><span></span></label></div>';
      });
      out += "</div>";
    }
    out += '<p class="muted small">El pastillero guarda una copia de los horarios, así que sigue dispensando aunque se vaya el internet. Los cambios le llegan en cuanto se conecta.</p></section>';
    return out;
  }

  function formHorario(h) {
    var nuevo = !h;
    h = h || { recipiente: 1, hora: "08:00", dias: "LMXJVSD", cantidad: 1, activo: true };
    abrirDialogo(nuevo ? "Nuevo horario" : "Editar horario",
      '<form class="form" id="f-h" novalidate>' +
      '<div class="field"><span style="font-weight:700">Recipiente</span><div class="recpick" role="radiogroup">' +
      [1, 2, 3].map(function (n) {
        return '<label><input type="radio" name="h-rec" id="h-rec-' + n + '" value="' + n + '"' + (+h.recipiente === n ? " checked" : "") + '><span class="opt">' + recChip(n) + "<span>" + esc(recNombre(n)) + "</span></span></label>";
      }).join("") + "</div></div>" +
      '<div class="grid2"><div class="field"><label for="h-hora">Hora</label><input id="h-hora" type="time" value="' + esc(h.hora) + '" required></div>' +
      '<div class="field"><label for="h-cant">Pastillas</label><select id="h-cant">' + [1, 2, 3].map(function (c) { return "<option" + (+h.cantidad === c ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select></div></div>" +
      '<div class="field"><span style="font-weight:700">Días</span><div class="daypick">' +
      DIAS.map(function (d) { return '<label title="' + NOMBRE_DIA[d] + '"><input type="checkbox" id="h-d-' + d + '" value="' + d + '"' + (h.dias.indexOf(d) >= 0 ? " checked" : "") + ' aria-label="' + NOMBRE_DIA[d] + '"><span>' + d + "</span></label>"; }).join("") +
      '</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn small" data-dias="LMXJVSD">Todos</button><button type="button" class="btn small" data-dias="LMXJV">Lunes a viernes</button></div><div class="err" id="h-err" role="alert"></div></div>' +
      "</form>",
      (nuevo ? "" : '<button class="btn danger" id="h-borrar" type="button">Eliminar</button>') + '<button class="btn primary" id="h-guardar" type="button">Guardar</button>');
    $$("[data-dias]").forEach(function (b) { b.onclick = function () { DIAS.forEach(function (d) { $("#h-d-" + d).checked = b.dataset.dias.indexOf(d) >= 0; }); $("#h-err").textContent = ""; }; });
    $$('#f-h input').forEach(function (i) { i.addEventListener("change", function () { $("#h-err").textContent = ""; }); });
    $("#h-guardar").onclick = async function () {
      var dias = DIAS.filter(function (d) { return $("#h-d-" + d).checked; }).join("");
      var hora = $("#h-hora").value;
      if (!/^\d{2}:\d{2}$/.test(hora)) { $("#h-err").textContent = "Elige la hora."; return; }
      if (!dias) { $("#h-err").textContent = "Elige al menos un día."; return; }
      var datos = { recipiente: +$('input[name="h-rec"]:checked').value, hora: hora, dias: dias, cantidad: +$("#h-cant").value, activo: nuevo ? true : !!h.activo };
      var id = nuevo ? be.nuevaClave("dispositivos/" + estado.dev + "/horarios") : h._id;
      try { await be.poner("dispositivos/" + estado.dev + "/horarios/" + id, datos); cerrarDialogo(); toast("Horario guardado"); }
      catch (x) { $("#h-err").textContent = errorTexto(x); }
    };
    if (!nuevo) $("#h-borrar").onclick = function () {
      confirmar("¿Eliminar el horario de las " + h.hora + "?", "El pastillero dejará de dispensar " + recNombre(h.recipiente) + " a esa hora.", "Eliminar", async function () {
        await be.borrar("dispositivos/" + estado.dev + "/horarios/" + h._id); toast("Horario eliminado");
      });
    };
  }

  // ---------------------------------------------------------------- HISTORIAL
  function vistaHistorial() {
    var t = estado.historialTab;
    var out = '<div class="seg" role="group" aria-label="Ver"><button data-tab="tomas" aria-pressed="' + (t === "tomas") + '">Tomas</button><button data-tab="alertas" aria-pressed="' + (t === "alertas") + '">Avisos enviados</button></div>';
    if (t === "tomas") {
      var xs = lista(estado.historial).filter(function (x) { return x.estado !== "ejemplo"; }).sort(function (a, b) { return (b.dispensada || 0) - (a.dispensada || 0); });
      // resumen de 7 dias
      var desde = Date.now() - 7 * 86400000, tot = 0, ok = 0, no = 0;
      xs.forEach(function (x) { if ((x.dispensada || 0) >= desde && x.estado !== "prueba") { tot++; if (x.estado === "tomada") ok++; if (x.estado === "no_tomada") no++; } });
      if (tot) out += '<div class="card" style="padding:14px 16px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><div class="eyebrow">Últimos 7 días</div><div style="font-size:1.05rem"><b class="num">' + ok + "</b> de <b class=\"num\">" + tot + "</b> tomas retiradas</div></div>" +
        (no ? '<span class="chip bad">' + no + " sin retirar</span>" : '<span class="chip ok">Sin faltas</span>') + "</div>";
      if (!xs.length) out += '<div class="list"><div class="empty">Aquí aparecerá cada toma que dispense el pastillero.</div></div>';
      var diaActual = "";
      xs.forEach(function (x, i) {
        var d = new Date(x.dispensada || Date.now());
        var clave = fechaISO(d);
        if (clave !== diaActual) {
          if (diaActual) out += "</div>";
          out += '<div class="day-label">' + esc(etiquetaDia(d)) + '</div><div class="list">';
          diaActual = clave;
        }
        var prog = (x.programada || "").split(" ")[1] || (x.dispensada ? horaDe(x.dispensada) : "");
        var detalle = x.estado === "tomada" && x.retirada && x.dispensada ? "Retirada " + Math.max(0, Math.round((x.retirada - x.dispensada) / 60000)) + " min después de dispensar" : (x.estado === "prueba" ? "Registro de prueba" : (/manual/.test(x.programada || "") ? "Dispensada manualmente" : ""));
        out += '<div class="row"><span class="num" style="font-weight:600;width:3.2em;flex:none">' + esc(prog) + "</span>" + recChip(x.recipiente || 1, true) + '<div class="grow"><div class="title">' + esc(x.medicamento || recNombre(x.recipiente)) + "</div>" + (detalle ? '<div class="sub">' + esc(detalle) + "</div>" : "") + '<div class="chiprow">' + chipDosis(x) + "</div></div></div>";
      });
      if (diaActual) out += "</div>";
      out += '<p class="muted small">"Retirada" significa que la celda de peso detectó que sacaron las pastillas del vaso. No confirma que se las haya tomado.</p>';
    } else {
      var as = lista(estado.alertas).filter(function (a) { return a.tipo !== "ejemplo"; }).sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); });
      if (!as.length) out += '<div class="list"><div class="empty">Aquí aparecerán los avisos enviados por Telegram y correo.</div></div>';
      else {
        out += '<div class="list">';
        as.forEach(function (a) {
          var sev = { no_tomada: "bad", fallo_dispensado: "bad", sin_conexion: "bad", recipiente_bajo: "warn", ambiente: "warn", tomada: "ok" }[a.tipo] || "idle";
          out += '<div class="row" style="align-items:flex-start"><div class="grow"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="chip ' + sev + '">' + esc(ETIQUETA_ALERTA[a.tipo] || a.tipo || "Aviso") + '</span></div><div class="sub" style="margin-top:6px;color:var(--fg)">' + esc(a.mensaje || "") + '</div><div class="sub small">' +
            (a.fecha ? esc(etiquetaDia(new Date(a.fecha)) + ", " + horaDe(a.fecha)) : "") + " · " + (a.enviado ? "Enviado" + (a.resultado ? " (" + a.resultado + ")" : "") : "En cola para enviar") + "</div></div></div>";
        });
        out += "</div>";
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- CONTACTOS
  function rutaContactos() { return "pacientes/" + asegurarPacienteId() + "/contactos"; }
  function asegurarPacienteId() { return estado.pacienteId || ("paciente_" + estado.dev); }

  function vistaContactos() {
    var cs = lista((estado.paciente || {}).contactos);
    var out = '<section class="section"><div class="section-head"><h2>Quién recibe los avisos</h2><button class="btn primary small" id="c-nuevo">Agregar</button></div>';
    if (!cs.length) out += '<div class="list"><div class="empty">Agrega a un familiar o enfermero para que reciba avisos por Telegram o correo cuando el paciente no retire su medicamento.</div></div>';
    else {
      out += '<div class="list">';
      cs.forEach(function (c) {
        var canales = [];
        if (c.telegram_chat_id) canales.push("Telegram");
        if (c.email) canales.push(esc(c.email));
        var n = Object.keys(c.avisos || {}).filter(function (k) { return c.avisos[k]; }).length;
        out += '<button class="row" data-editar-c="' + esc(c._id) + '"><div class="grow"><div class="title">' + esc(c.nombre) + ' <span class="muted" style="font-weight:400">· ' + esc(ROLES[c.rol] || c.rol || "") + '</span></div><div class="sub">' + (canales.join(" · ") || "Sin canal") + '</div><div class="sub">' + n + " de 6 tipos de aviso</div></div>" +
          '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="stroke:var(--muted);fill:none;stroke-width:2"><path d="m9 6 6 6-6 6"/></svg></button>';
      });
      out += "</div>";
    }
    out += "</section>" +
      '<section class="section"><div class="section-head"><h2>Probar los avisos</h2></div><div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">' +
      '<p style="margin:0">Envía un aviso de prueba a todos los contactos, sin importar qué avisos tengan activados. Llega en menos de un minuto.</p>' +
      '<button class="btn" id="c-prueba"' + (cs.length ? "" : " disabled") + '>Enviar aviso de prueba</button></div></section>' +
      '<section class="section"><h2>Cómo obtener el ID de Telegram</h2><div class="card" style="padding:16px"><ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">' +
      "<li>En Telegram, abre el bot del pastillero" + (window.TELEGRAM_BOT ? ' (<a href="https://t.me/' + esc(window.TELEGRAM_BOT) + '" target="_blank" rel="noopener">@' + esc(window.TELEGRAM_BOT) + "</a>)" : "") + " y toca <b>Iniciar</b> o envíale <b>/start</b>.</li>" +
      "<li>El bot te contesta con tu ID: un número como 123456789.</li>" +
      "<li>Cópialo y pégalo en el contacto, en el campo ID de Telegram.</li></ol>" +
      '<p class="muted small" style="margin:12px 0 0">Si el bot no contesta en un minuto, el servicio de avisos todavía no está instalado.</p></div></section>';
    return out;
  }

  function formContacto(c) {
    var nuevo = !c;
    c = c || { nombre: "", rol: "familiar", telegram_chat_id: "", email: "", avisos: { tomada: false, no_tomada: true, recipiente_bajo: true, ambiente: true, sin_conexion: true, fallo_dispensado: true } };
    var av = c.avisos || {};
    abrirDialogo(nuevo ? "Nuevo contacto" : "Editar contacto",
      '<form class="form" id="f-c" novalidate>' +
      '<div class="field"><label for="c-nombre">Nombre</label><input id="c-nombre" value="' + esc(c.nombre) + '" autocomplete="name" placeholder="María López"></div>' +
      '<div class="field"><label for="c-rol">Relación con el paciente</label><select id="c-rol">' + Object.keys(ROLES).map(function (k) { return '<option value="' + k + '"' + (c.rol === k ? " selected" : "") + ">" + ROLES[k] + "</option>"; }).join("") + "</select></div>" +
      '<div class="field"><label for="c-tg">ID de Telegram</label><input id="c-tg" inputmode="numeric" value="' + esc(c.telegram_chat_id) + '" placeholder="123456789"><span class="hint">El bot del pastillero te lo envía cuando le escribes /start. Déjalo vacío si solo quieres correo.</span></div>' +
      '<div class="field"><label for="c-email">Correo</label><input id="c-email" type="email" inputmode="email" value="' + esc(c.email) + '" placeholder="nombre@gmail.com"></div>' +
      '<div class="field"><span style="font-weight:700">Avisar cuando…</span><div>' +
      Object.keys(TIPOS_ALERTA).map(function (k) { return '<label class="check"><input type="checkbox" id="c-av-' + k + '"' + (av[k] ? " checked" : "") + "><span>" + TIPOS_ALERTA[k] + "</span></label>"; }).join("") +
      '</div></div><div class="err" id="c-err" role="alert"></div></form>',
      (nuevo ? "" : '<button class="btn danger" id="c-borrar" type="button">Eliminar</button>') + '<button class="btn primary" id="c-guardar" type="button">Guardar</button>');
    $$("#f-c input, #f-c select").forEach(function (i) { i.addEventListener("input", function () { $("#c-err").textContent = ""; }); });
    $("#c-guardar").onclick = async function () {
      var nombre = $("#c-nombre").value.trim(), tg = $("#c-tg").value.trim(), email = $("#c-email").value.trim();
      var err = $("#c-err");
      if (!nombre) { err.textContent = "Escribe el nombre."; $("#c-nombre").focus(); return; }
      if (!tg && !email) { err.textContent = "Agrega un ID de Telegram, un correo o los dos."; return; }
      if (tg && !/^-?\d{5,15}$/.test(tg)) { err.textContent = "El ID de Telegram es solo números (por ejemplo 123456789)."; $("#c-tg").focus(); return; }
      if (email && !/^\S+@\S+\.\S+$/.test(email)) { err.textContent = "Ese correo no es válido."; $("#c-email").focus(); return; }
      var avisos = {};
      Object.keys(TIPOS_ALERTA).forEach(function (k) { avisos[k] = $("#c-av-" + k).checked; });
      var datos = { nombre: nombre, rol: $("#c-rol").value, telegram_chat_id: tg, email: email, avisos: avisos };
      try {
        await asegurarPaciente();
        var id = nuevo ? be.nuevaClave(rutaContactos()) : c._id;
        await be.poner(rutaContactos() + "/" + id, datos);
        cerrarDialogo(); toast("Contacto guardado");
      } catch (x) { err.textContent = errorTexto(x); }
    };
    if (!nuevo) $("#c-borrar").onclick = function () {
      confirmar("¿Eliminar a " + c.nombre + "?", "Dejará de recibir avisos del pastillero.", "Eliminar", async function () {
        await be.borrar(rutaContactos() + "/" + c._id); toast("Contacto eliminado");
      });
    };
  }

  async function asegurarPaciente() {
    if (estado.pacienteId) return;
    var pid = asegurarPacienteId();
    await be.actualizar("pacientes/" + pid, { dispositivo: estado.dev, nombre: (estado.paciente || {}).nombre || "Paciente" });
    await be.actualizar("dispositivos/" + estado.dev + "/info", { paciente: pid });
  }

  // ---------------------------------------------------------------- AJUSTES
  function vistaAjustes() {
    var p = estado.paciente || {};
    var ed = estado.estadoDev || {};
    var out = '<section class="section"><div class="section-head"><h2>Paciente</h2><button class="btn small" id="p-editar">Editar</button></div><div class="card" style="padding:16px"><dl class="kv">' +
      "<dt>Nombre</dt><dd>" + esc(p.nombre || "Sin nombre") + "</dd><dt>Edad</dt><dd>" + (p.edad ? esc(p.edad) + " años" : "—") + "</dd><dt>Notas</dt><dd>" + esc(p.notas || "—") + "</dd></dl></div></section>";
    out += '<section class="section"><h2>Medicamentos</h2><div class="list">' + [1, 2, 3].map(function (n) {
      var r = estado.recipientes["r" + n] || {};
      return '<button class="row" data-editar-r="' + n + '">' + recChip(n) + '<div class="grow"><div class="title">' + esc(r.medicamento || "Sin medicamento") + '</div><div class="sub">' + esc(r.dosis || "") + (r.peso_pastilla_g ? " · " + r.peso_pastilla_g + " g por pastilla" : "") + '</div></div><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="stroke:var(--muted);fill:none;stroke-width:2"><path d="m9 6 6 6-6 6"/></svg></button>';
    }).join("") + "</div></section>";
    out += '<section class="section"><h2>Pastillero</h2><div class="card" style="padding:16px;display:flex;flex-direction:column;gap:14px"><dl class="kv">' +
      '<dt>ID</dt><dd class="num">' + esc(estado.dev) + "</dd><dt>Estado</dt><dd>" + chipConexion() + "</dd><dt>Última conexión</dt><dd>" + (ed.ultima_conexion ? esc(haceCuanto(ed.ultima_conexion)) : "—") + "</dd>" +
      "<dt>Señal WiFi</dt><dd>" + (ed.rssi_dbm ? esc(ed.rssi_dbm) + " dBm" : "—") + "</dd><dt>Versión</dt><dd>" + esc((estado.info || {}).firmware || "—") + "</dd></dl>" +
      (estado.dispositivos && estado.dispositivos.length > 1 ? '<div class="field"><label for="s-dev">Ver otro pastillero</label><select id="s-dev">' + estado.dispositivos.map(function (d) { return "<option" + (d === estado.dev ? " selected" : "") + ">" + esc(d) + "</option>"; }).join("") + "</select></div>" : "") +
      '<button class="btn" id="s-vincular">Vincular otro pastillero</button></div></section>';
    out += '<section class="section"><h2>Tu cuenta</h2><div class="card" style="padding:16px;display:flex;flex-direction:column;gap:14px"><dl class="kv"><dt>Nombre</dt><dd>' + esc((estado.perfil || {}).nombre || "—") + "</dd><dt>Correo</dt><dd>" + esc(estado.usuario.email || "") + '</dd></dl><button class="btn danger" id="s-salir">Cerrar sesión</button></div></section>';
    return out;
  }

  function formPaciente() {
    var p = estado.paciente || {};
    abrirDialogo("Datos del paciente",
      '<form class="form" id="f-p" novalidate><div class="field"><label for="p-nombre">Nombre</label><input id="p-nombre" value="' + esc(p.nombre || "") + '"></div>' +
      '<div class="field"><label for="p-edad">Edad</label><input id="p-edad" type="number" min="0" max="120" inputmode="numeric" value="' + esc(p.edad || "") + '"></div>' +
      '<div class="field"><label for="p-notas">Notas médicas</label><textarea id="p-notas" placeholder="Padecimientos, alergias, indicaciones del médico">' + esc(p.notas || "") + '</textarea></div><div class="err" id="p-err" role="alert"></div></form>',
      '<button class="btn primary" id="p-guardar" type="button">Guardar</button>');
    $("#p-guardar").onclick = async function () {
      var nombre = $("#p-nombre").value.trim();
      if (!nombre) { $("#p-err").textContent = "Escribe el nombre del paciente."; return; }
      var edad = $("#p-edad").value ? +$("#p-edad").value : null;
      try {
        var pid = asegurarPacienteId();
        await be.actualizar("pacientes/" + pid, { nombre: nombre, edad: edad, notas: $("#p-notas").value.trim(), dispositivo: estado.dev });
        if (!estado.pacienteId) await be.actualizar("dispositivos/" + estado.dev + "/info", { paciente: pid });
        cerrarDialogo(); toast("Datos guardados");
      } catch (x) { $("#p-err").textContent = errorTexto(x); }
    };
  }

  function formRecipiente(n) {
    var r = estado.recipientes["r" + n] || {};
    abrirDialogo("Recipiente " + n,
      '<form class="form" id="f-r" novalidate>' +
      '<div class="field"><label for="r-med">Medicamento</label><input id="r-med" value="' + esc(r.medicamento || "") + '" placeholder="Metformina 850 mg"></div>' +
      '<div class="field"><label for="r-dosis">Dosis</label><input id="r-dosis" value="' + esc(r.dosis || "") + '" placeholder="1 tableta"></div>' +
      '<div class="grid2"><div class="field"><label for="r-peso">Peso por pastilla (g)</label><input id="r-peso" type="number" step="0.01" min="0.05" inputmode="decimal" value="' + esc(r.peso_pastilla_g || "") + '"></div>' +
      '<div class="field"><label for="r-pz">Pastillas actuales</label><input id="r-pz" type="number" min="0" inputmode="numeric" value="' + esc(r.pastillas != null ? r.pastillas : "") + '"></div></div>' +
      '<div class="grid2"><div class="field"><label for="r-cap">Capacidad</label><input id="r-cap" type="number" min="1" inputmode="numeric" value="' + esc(r.capacidad || 60) + '"></div>' +
      '<div class="field"><label for="r-min">Avisar al quedar</label><input id="r-min" type="number" min="0" inputmode="numeric" value="' + esc(r.aviso_minimo != null ? r.aviso_minimo : 10) + '"></div></div>' +
      '<p class="muted small" style="margin:0">El peso por pastilla lo mide el pastillero (comando W del sketch de prueba). Con él calcula cuántas pastillas quedan; el número que escribas aquí se corrige solo con la siguiente lectura de peso.</p>' +
      '<div class="err" id="r-err" role="alert"></div></form>',
      '<button class="btn primary" id="r-guardar" type="button">Guardar</button>');
    $("#r-guardar").onclick = async function () {
      var med = $("#r-med").value.trim();
      if (!med) { $("#r-err").textContent = "Escribe el nombre del medicamento."; return; }
      var num = function (id) { var v = $(id).value; return v === "" ? null : +v; };
      var datos = { medicamento: med, dosis: $("#r-dosis").value.trim(), capacidad: num("#r-cap") || 60, aviso_minimo: num("#r-min") == null ? 10 : num("#r-min") };
      if (num("#r-peso")) datos.peso_pastilla_g = num("#r-peso");
      if (num("#r-pz") != null) datos.pastillas = num("#r-pz");
      try { await be.actualizar("dispositivos/" + estado.dev + "/recipientes/r" + n, datos); cerrarDialogo(); toast("Recipiente " + n + " guardado"); }
      catch (x) { $("#r-err").textContent = errorTexto(x); }
    };
  }

  // ---------------------------------------------------------------- dialogos
  function abrirDialogo(titulo, cuerpo, pie) {
    var d = $("#dlg");
    d.innerHTML = '<div class="sheet"><div class="sheet-head"><h2 id="dlg-title">' + esc(titulo) + '</h2><button class="icon-btn" id="dlg-x" aria-label="Cerrar"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="stroke:currentColor;fill:none;stroke-width:2"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
      '<div class="sheet-body">' + cuerpo + '</div><div class="sheet-foot">' + pie + "</div></div>";
    $("#dlg-x").onclick = cerrarDialogo;
    d.onclick = function (e) { if (e.target === d) cerrarDialogo(); };
    if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute("open", ""); } }
    var primero = d.querySelector(".sheet-body input:not([type=radio]):not([type=checkbox]), .sheet-body select");
    if (primero && window.matchMedia("(min-width: 600px)").matches) primero.focus();
  }
  function cerrarDialogo() { var d = $("#dlg"); if (d.open) d.close(); d.innerHTML = ""; pintar(); }
  function confirmar(titulo, texto, accion, alAceptar) {
    abrirDialogo(titulo, "<p style=\"margin:0\">" + esc(texto) + '</p><div class="err" id="cf-err" role="alert" style="color:var(--bad)"></div>',
      '<button class="btn" id="cf-no" type="button">Cancelar</button><button class="btn primary" id="cf-si" type="button">' + esc(accion) + "</button>");
    $("#cf-no").onclick = cerrarDialogo;
    $("#cf-si").onclick = async function () {
      this.disabled = true;
      try { await alAceptar(); cerrarDialogo(); } catch (x) { $("#cf-err").textContent = errorTexto(x); this.disabled = false; }
    };
  }

  // ---------------------------------------------------------------- eventos de cada vista
  function enlazar() {
    $$("[data-ir]").forEach(function (b) { b.onclick = function () { estado.vista = b.dataset.ir; if (b.dataset.tab) estado.historialTab = b.dataset.tab; pintar(); window.scrollTo(0, 0); }; });
    $$("[data-dispensar]").forEach(function (b) {
      b.onclick = function () {
        var n = +b.dataset.dispensar;
        var aviso = enLinea() ? "" : " El pastillero aparece sin conexión: la orden se cumplirá cuando se conecte.";
        confirmar("¿Dispensar " + recNombre(n) + " ahora?", "El pastillero soltará 1 pastilla del recipiente " + n + " y avisará al paciente. Usa esto solo si el médico lo indicó o para probar." + aviso, "Dispensar", async function () {
          await be.actualizar("dispositivos/" + estado.dev + "/comandos", { dispensar_ahora: n, dispensar_solicitado: be.marcaTiempo(), solicitado_por: estado.usuario.uid });
          toast("Orden enviada al pastillero");
        });
      };
    });
    if ($("#h-nuevo")) $("#h-nuevo").onclick = function () { formHorario(null); };
    $$("[data-editar-h]").forEach(function (b) { b.onclick = function () { formHorario(lista(estado.horarios).filter(function (h) { return h._id === b.dataset.editarH; })[0]); }; });
    $$("[data-activo]").forEach(function (i) {
      i.onchange = async function () {
        try { await be.poner("dispositivos/" + estado.dev + "/horarios/" + i.dataset.activo + "/activo", i.checked); toast(i.checked ? "Horario activado" : "Horario pausado"); }
        catch (x) { toast(errorTexto(x)); i.checked = !i.checked; }
      };
    });
    $$(".seg [data-tab]").forEach(function (b) { b.onclick = function () { estado.historialTab = b.dataset.tab; pintar(); }; });
    if ($("#c-nuevo")) $("#c-nuevo").onclick = function () { formContacto(null); };
    if ($("#c-prueba")) $("#c-prueba").onclick = async function () {
      var b = this;
      b.disabled = true;
      try {
        var id = be.nuevaClave("historial_alertas/" + estado.dev);
        await be.poner("historial_alertas/" + estado.dev + "/" + id, { tipo: "prueba", mensaje: "Aviso de prueba enviado desde la app por " + (((estado.perfil || {}).nombre) || estado.usuario.email) + ".", fecha: be.marcaTiempo(), enviado: false });
        toast("Aviso en cola: llegará en menos de un minuto");
      } catch (x) { toast(errorTexto(x)); b.disabled = false; }
    };
    $$("[data-editar-c]").forEach(function (b) { b.onclick = function () { formContacto(lista((estado.paciente || {}).contactos).filter(function (c) { return c._id === b.dataset.editarC; })[0]); }; });
    if ($("#p-editar")) $("#p-editar").onclick = formPaciente;
    $$("[data-editar-r]").forEach(function (b) { b.onclick = function () { formRecipiente(+b.dataset.editarR); }; });
    if ($("#s-salir")) $("#s-salir").onclick = function () { confirmar("¿Cerrar sesión?", "Tendrás que volver a escribir tu correo y contraseña.", "Cerrar sesión", async function () { await be.salir(); }); };
    if ($("#s-vincular")) $("#s-vincular").onclick = function () { pintarVincular(true); };
    if ($("#s-dev")) $("#s-dev").onchange = function () { escucharDispositivo(this.value); };
  }

  iniciar();
})();
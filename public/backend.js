/* Pastillero inteligente - conexion con la base de datos.
   Dos versiones con la misma interfaz:
   - Firebase real (Realtime Database + Authentication)
   - Demostracion: datos de ejemplo en memoria, para probar la app sin conexion. */

var FIREBASE_SDK = "10.12.2";

async function crearBackendFirebase(config) {
  var base = "https://www.gstatic.com/firebasejs/" + FIREBASE_SDK + "/";
  var appM = await import(base + "firebase-app.js");
  var authM = await import(base + "firebase-auth.js");
  var dbM = await import(base + "firebase-database.js");
  var app = appM.initializeApp(config);
  var auth = authM.getAuth(app);
  var db = dbM.getDatabase(app);
  var R = function (ruta) { return dbM.ref(db, ruta); };
  return {
    modo: "firebase",
    alCambiarSesion: function (cb) {
      return authM.onAuthStateChanged(auth, function (u) { cb(u ? { uid: u.uid, email: u.email } : null); });
    },
    entrar: function (email, clave) { return authM.signInWithEmailAndPassword(auth, email, clave); },
    registrar: async function (nombre, email, clave) {
      var c = await authM.createUserWithEmailAndPassword(auth, email, clave);
      await dbM.set(R("usuarios/" + c.user.uid + "/perfil"), { nombre: nombre, email: email });
    },
    recuperar: function (email) { return authM.sendPasswordResetEmail(auth, email); },
    salir: function () { return authM.signOut(auth); },
    escuchar: function (ruta, cb, opc) {
      opc = opc || {};
      var r = R(ruta);
      if (opc.ordenarPor) r = dbM.query(r, dbM.orderByChild(opc.ordenarPor), dbM.limitToLast(opc.ultimos || 150));
      return dbM.onValue(r, function (s) { cb(s.val()); }, function (e) { if (opc.alError) opc.alError(e); });
    },
    leer: async function (ruta) { return (await dbM.get(R(ruta))).val(); },
    poner: function (ruta, v) { return dbM.set(R(ruta), v); },
    actualizar: function (ruta, obj) { return dbM.update(R(ruta), obj); },
    nuevaClave: function (ruta) { return dbM.push(R(ruta)).key; },
    borrar: function (ruta) { return dbM.remove(R(ruta)); },
    marcaTiempo: function () { return dbM.serverTimestamp(); }
  };
}

/* ---------------------- Modo demostracion ---------------------- */
function crearBackendDemo() {
  var arbol = {};
  var oyentes = [];
  var usuario = { uid: "demo", email: "cuidador@ejemplo.com" };
  var sesionCbs = [];
  var contadorClave = 0;

  function partes(ruta) { return ruta.split("/").filter(Boolean); }
  function obtener(ruta) {
    var n = arbol;
    var p = partes(ruta);
    for (var i = 0; i < p.length; i++) { if (n == null || typeof n !== "object") return null; n = n[p[i]]; }
    return n === undefined ? null : JSON.parse(JSON.stringify(n));
  }
  function resolver(v) {
    if (v && typeof v === "object") {
      if (v[".sv"] === "timestamp") return Date.now();
      var o = Array.isArray(v) ? [] : {};
      for (var k in v) o[k] = resolver(v[k]);
      return o;
    }
    return v;
  }
  function fijar(ruta, v) {
    var p = partes(ruta);
    if (!p.length) { arbol = resolver(v) || {}; return; }
    var n = arbol;
    for (var i = 0; i < p.length - 1; i++) {
      if (n[p[i]] == null || typeof n[p[i]] !== "object") n[p[i]] = {};
      n = n[p[i]];
    }
    if (v === null || v === undefined) delete n[p[p.length - 1]];
    else n[p[p.length - 1]] = resolver(v);
  }
  function avisar() {
    oyentes.slice().forEach(function (o) { o.cb(consultar(o)); });
  }
  function consultar(o) {
    var v = obtener(o.ruta);
    if (!o.opc.ordenarPor || !v) return v;
    var campo = o.opc.ordenarPor;
    var claves = Object.keys(v).sort(function (a, b) { return ((v[a] || {})[campo] || 0) - ((v[b] || {})[campo] || 0); });
    claves = claves.slice(-(o.opc.ultimos || 150));
    var r = {};
    claves.forEach(function (k) { r[k] = v[k]; });
    return r;
  }
  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nueva() {
    contadorClave++;
    return "-D" + Date.now().toString(36) + String(contadorClave).padStart(4, "0");
  }

  sembrarDemo(fijar);

  // el pastillero "reporta" cada 10 s
  setInterval(function () {
    fijar("dispositivos/pastillero_01/estado/ultima_conexion", Date.now());
    [1, 2, 3].forEach(function (i) {
      var r = obtener("dispositivos/pastillero_01/recipientes/r" + i);
      if (!r) return;
      fijar("dispositivos/pastillero_01/recipientes/r" + i + "/temperatura_c", Math.round((r.temperatura_c + (Math.random() - 0.5) * 0.2) * 10) / 10);
    });
    avisar();
  }, 10000);

  // el pastillero atiende la orden "dispensar ahora"
  function simularDispensado(rec) {
    setTimeout(function () {
      var base = "dispositivos/pastillero_01";
      var r = obtener(base + "/recipientes/r" + rec) || {};
      var ahora = new Date();
      var idToma = nueva();
      fijar("historial_dosis/pastillero_01/" + idToma, {
        recipiente: rec, medicamento: r.medicamento || "", programada: fechaHoraTexto(ahora) + " (manual)",
        dispensada: Date.now(), retirada: 0, estado: "pendiente", peso_vaso_g: r.peso_pastilla_g || 0.3, intentos: 1
      });
      fijar(base + "/recipientes/r" + rec + "/pastillas", Math.max(0, (r.pastillas || 0) - 1));
      fijar(base + "/comandos/dispensar_ahora", 0);
      avisar();
      simularFoto(null, "dispensada", idToma);
    }, 2500);
  }

  // la "camara" atiende los pedidos de foto
  function simularFoto(clavePedido, motivo, toma) {
    setTimeout(function () {
      var base = "dispositivos/pastillero_01/camara";
      var slot = ((obtener(base + "/slot") || 0) + 1) % 20;
      var clave = "f" + String(slot).padStart(2, "0");
      var vaso = obtener("dispositivos/pastillero_01/vaso/peso_g") || 0;
      fijar("fotos/pastillero_01/" + clave, fotoDemo(motivo, toma, Date.now(), motivo === "retirada" ? 0 : (motivo === "dispensada" || vaso > 0.1 ? 1 : 0)));
      fijar(base + "/slot", slot);
      fijar(base + "/ultima_foto", clave);
      fijar(base + "/ultima_fecha", Date.now());
      if (clavePedido) fijar(base + "/pedidos/" + clavePedido, null);
      if (toma) fijar("historial_dosis/pastillero_01/" + toma + "/foto_" + motivo, clave);
      avisar();
    }, 2500);
  }
  function simularAutoprueba(motores) {
    var base = "dispositivos/pastillero_01";
    setTimeout(function () { fijar(base + "/comandos/autoprueba", 0); fijar(base + "/autoprueba/en_curso", true); avisar(); }, 1200);
    setTimeout(function () {
      var it = {
        "01_wifi": ["WiFi", "ok", "Conectado, señal -58 dBm"], "02_firebase": ["Firebase", "ok", "Sesión iniciada con la cuenta del pastillero"],
        "03_reloj": ["Reloj DS3231", "ok", "Hora guardada: " + fechaHoraTexto(new Date())], "04_tca": ["Multiplexor TCA9548A", "ok", "Responde en 0x70"],
        "05_htu1": ["Sensor HTU21D rec. 1", "ok", "24.1 C, 38 % humedad"], "06_htu2": ["Sensor HTU21D rec. 2", "ok", "24.3 C, 41 % humedad"],
        "07_htu3": ["Sensor HTU21D rec. 3", "falla", "No responde en el canal 2 del TCA9548A (SD2/SC2)"],
        "08_celda1": ["Celda Recipiente 1", "ok", "37.8 g = 42 pastillas"], "09_celda2": ["Celda Recipiente 2", "ok", "2.0 g = 8 pastillas"],
        "10_celda3": ["Celda Recipiente 3", "ok", "10.2 g = 51 pastillas"], "11_celda4": ["Celda Vaso", "ok", "0.0 g"],
        "12_buzzer": ["Buzzer", "revisar", "Sonaron 2 pitidos: confirma que se escucharon"], "13_luces": ["Luz del vaso y LED", "revisar", "Se prendieron 2 s: confirma que se vieron"],
        "14_boton": ["Botón", "ok", "Se detectó al presionarlo"]
      };
      [1, 2, 3].forEach(function (m) { it[(14 + m) + "_motor" + m] = ["Motor " + m, motores ? "revisar" : "omitido", motores ? "Giró a la salida y regresó a casa: confirma que el disco giró" : "No se pidió probar motores"]; });
      var items = {}, res = { ok: 0, revisar: 0, falla: 0 };
      Object.keys(it).forEach(function (k) { items[k] = { nombre: it[k][0], estado: it[k][1], detalle: it[k][2] }; if (res[it[k][1]] != null) res[it[k][1]]++; });
      simularFoto(null, "prueba", "");
      setTimeout(function () {
        items["18_camara"] = { nombre: "Cámara ESP32-CAM", estado: "ok", detalle: "Tomó y subió la foto " + obtener(base + "/camara/ultima_foto"), foto: obtener(base + "/camara/ultima_foto") };
        res.ok++;
        fijar(base + "/autoprueba", { en_curso: false, fecha: Date.now(), origen: "app", motores: motores, resumen: res, items: items });
        avisar();
      }, 2800);
    }, 5000);
  }

  return {
    modo: "demo",
    alCambiarSesion: function (cb) { sesionCbs.push(cb); setTimeout(function () { cb(usuario); }, 0); return function () {}; },
    entrar: async function (email) { await espera(300); usuario = { uid: "demo", email: email }; sesionCbs.forEach(function (c) { c(usuario); }); },
    registrar: async function (nombre, email) { await espera(300); usuario = { uid: "demo", email: email }; sesionCbs.forEach(function (c) { c(usuario); }); },
    recuperar: async function () { await espera(300); },
    salir: async function () { usuario = null; sesionCbs.forEach(function (c) { c(null); }); },
    escuchar: function (ruta, cb, opc) {
      var o = { ruta: ruta, cb: cb, opc: opc || {} };
      oyentes.push(o);
      setTimeout(function () { cb(consultar(o)); }, 0);
      return function () { oyentes = oyentes.filter(function (x) { return x !== o; }); };
    },
    leer: async function (ruta) { return obtener(ruta); },
    poner: async function (ruta, v) {
      await espera(150);
      if (/^usuarios\/[^/]+\/dispositivos\//.test(ruta) && v !== "482915") { var e = new Error("PERMISSION_DENIED"); e.code = "PERMISSION_DENIED"; throw e; }
      fijar(ruta, v); avisar();
      if (/dispensar_ahora$/.test(ruta) && v) simularDispensado(v);
      var mp = /camara\/pedidos\/([^/]+)$/.exec(ruta);
      if (mp && v) simularFoto(mp[1], v.motivo || "app", v.toma || "");
      if (/^historial_alertas\//.test(ruta) && v && v.enviado === false) {
        setTimeout(function () { fijar(ruta + "/enviado", true); fijar(ruta + "/resultado", "Telegram: 1, correo: 2"); avisar(); }, 3000);
      }
    },
    actualizar: async function (ruta, obj) {
      await espera(150);
      for (var k in obj) fijar(ruta + "/" + k, obj[k]);
      avisar();
      if (obj.dispensar_ahora) simularDispensado(obj.dispensar_ahora);
      if (obj.autoprueba) simularAutoprueba(obj.autoprueba === 2);
      if (obj.desatascar) {
        var nr = obj.desatascar;
        setTimeout(function () { fijar("dispositivos/pastillero_01/comandos/desatascar", 0); fijar("dispositivos/pastillero_01/recipientes/r" + nr + "/salida", "ok"); avisar(); }, 3000);
      }
    },
    nuevaClave: function () { return nueva(); },
    borrar: async function (ruta) { await espera(150); fijar(ruta, null); avisar(); },
    marcaTiempo: function () { return { ".sv": "timestamp" }; }
  };
}

function fechaISO(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function fechaHoraTexto(d) {
  return fechaISO(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function sembrarDemo(fijar) {
  var ahora = Date.now();
  var dev = "pastillero_01";
  fijar("usuarios/demo", { perfil: { nombre: "Cuidador de ejemplo", email: "cuidador@ejemplo.com" }, dispositivos: { pastillero_01: "482915" } });
  fijar("dispositivos/" + dev, {
    info: { nombre: "Pastillero de la sala", paciente: "paciente_01", firmware: "0.6-camara" },
    estado: { en_linea: true, ultima_conexion: ahora, ip: "192.168.1.48", rssi_dbm: -58, hora_local: "" },
    recipientes: {
      r1: { medicamento: "Metformina 850 mg", dosis: "1 tableta", peso_pastilla_g: 0.9, pastillas: 42, capacidad: 60, aviso_minimo: 10, temperatura_c: 24.1, humedad_pct: 38, actualizado: ahora },
      r2: { medicamento: "Losartán 50 mg", dosis: "1 tableta", peso_pastilla_g: 0.25, pastillas: 8, salida: "atascado", capacidad: 60, aviso_minimo: 10, temperatura_c: 24.3, humedad_pct: 41, actualizado: ahora },
      r3: { medicamento: "Atorvastatina 20 mg", dosis: "1 tableta", peso_pastilla_g: 0.2, pastillas: 51, capacidad: 60, aviso_minimo: 10, temperatura_c: 24.0, humedad_pct: 63, actualizado: ahora }
    },
    vaso: { peso_g: 0, actualizado: ahora },
    horarios: {
      h1: { recipiente: 1, hora: "08:00", dias: "LMXJVSD", cantidad: 1, activo: true },
      h2: { recipiente: 2, hora: "09:00", dias: "LMXJVSD", cantidad: 1, activo: true },
      h3: { recipiente: 1, hora: "20:00", dias: "LMXJVSD", cantidad: 1, activo: true },
      h4: { recipiente: 3, hora: "21:30", dias: "LMXJVSD", cantidad: 1, activo: true },
      h5: { recipiente: 2, hora: "14:00", dias: "LXV", cantidad: 1, activo: false }
    },
    comandos: { dispensar_ahora: 0 }
  });
  fijar("pacientes/paciente_01", {
    nombre: "Roberto Sánchez (ejemplo)", edad: 78, notas: "Diabetes tipo 2 e hipertensión. Alérgico a la penicilina.", dispositivo: dev,
    contactos: {
      c1: { nombre: "María (hija, ejemplo)", rol: "familiar", telegram_chat_id: "123456789", email: "maria.ejemplo@gmail.com",
            avisos: { tomada: true, no_tomada: true, recipiente_bajo: true, ambiente: false, sin_conexion: true, fallo_dispensado: true } },
      c2: { nombre: "Enf. Laura (ejemplo)", rol: "enfermero", telegram_chat_id: "", email: "laura.ejemplo@gmail.com",
            avisos: { tomada: false, no_tomada: true, recipiente_bajo: false, ambiente: true, sin_conexion: false, fallo_dispensado: true } }
    }
  });
  // historial de los ultimos 6 dias
  var horas = [["08:00", 1, "Metformina 850 mg"], ["09:00", 2, "Losartán 50 mg"], ["20:00", 1, "Metformina 850 mg"], ["21:30", 3, "Atorvastatina 20 mg"]];
  var n = 0;
  var alertas = [];
  for (var d = 5; d >= 0; d--) {
    var dia = new Date(ahora - d * 86400000);
    horas.forEach(function (h) {
      var p = h[0].split(":");
      var prog = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), +p[0], +p[1]);
      if (prog.getTime() > ahora - 60000) return;
      n++;
      var estado = "tomada";
      if (d === 3 && h[0] === "21:30") estado = "no_tomada";
      var retraso = (n * 37) % 9 + 1;
      var disp = prog.getTime() + 4000;
      var ret = estado === "tomada" ? disp + retraso * 60000 : 0;
      if (d === 0 && prog.getTime() > ahora - 4 * 60000) { estado = "pendiente"; ret = 0; }
      fijar("historial_dosis/" + dev + "/-H" + String(n).padStart(4, "0"), {
        recipiente: h[1], medicamento: h[2], programada: fechaHoraTexto(prog), dispensada: disp, retirada: ret,
        estado: estado, peso_vaso_g: 0, intentos: 1
      });
      if (estado === "no_tomada") alertas.push({ tipo: "no_tomada", mensaje: "No retiró " + h[2] + " de las " + h[0] + " después de 10 min.", fecha: disp + 600000, enviado: true });
      else if (estado === "tomada" && d <= 1) alertas.push({ tipo: "tomada", mensaje: "Retiró " + h[2] + " de las " + h[0] + ".", fecha: ret, enviado: true });
    });
  }
  alertas.push({ tipo: "recipiente_bajo", mensaje: "Quedan 8 pastillas de Losartán 50 mg en el recipiente 2.", fecha: ahora - 5 * 3600000, enviado: true });
  alertas.push({ tipo: "ambiente", mensaje: "Humedad de 63 % en el recipiente 3 (Atorvastatina 20 mg).", fecha: ahora - 40 * 60000, enviado: false });
  alertas.forEach(function (a, i) { fijar("historial_alertas/" + dev + "/-A" + String(i).padStart(4, "0"), a); });

  // camara y fotos de las 2 tomas mas recientes
  var tomas = [];
  for (var i = n; i >= 1 && tomas.length < 2; i--) tomas.push("-H" + String(i).padStart(4, "0"));
  var slot = 0;
  tomas.reverse();
  fijar("dispositivos/" + dev + "/camara", { en_linea: true, ultima_conexion: ahora, ip: "192.168.1.52", rssi_dbm: -61, firmware: "0.6-camara", camara_ok: true, psram: true });
  tomas.forEach(function (id, k) {
    var t0 = ahora - (tomas.length - k) * 5 * 3600000;
    fijar("fotos/" + dev + "/f" + String(slot).padStart(2, "0"), fotoDemo("dispensada", id, t0, 1));
    fijar("historial_dosis/" + dev + "/" + id + "/foto_dispensada", "f" + String(slot).padStart(2, "0"));
    slot++;
    fijar("fotos/" + dev + "/f" + String(slot).padStart(2, "0"), fotoDemo("retirada", id, t0 + 6 * 60000, 0));
    fijar("historial_dosis/" + dev + "/" + id + "/foto_retirada", "f" + String(slot).padStart(2, "0"));
    slot++;
  });
  fijar("dispositivos/" + dev + "/camara/slot", slot - 1);
  fijar("dispositivos/" + dev + "/camara/ultima_foto", "f" + String(slot - 1).padStart(2, "0"));
}

// Imagen de ejemplo (SVG) que imita la foto de la camara: vaso visto desde arriba
function fotoDemo(motivo, toma, fecha, pastillas) {
  var d = new Date(fecha);
  var hora = fechaHoraTexto(d);
  var p = "";
  if (pastillas) p = '<ellipse cx="300" cy="250" rx="34" ry="17" fill="#F4F1EA" transform="rotate(-18 300 250)"/><path d="M270 258 L330 242" stroke="#D9D3C6" stroke-width="2"/>' +
    '<ellipse cx="350" cy="275" rx="30" ry="15" fill="#F7D9A8" transform="rotate(24 350 275)"/>';
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">' +
    '<defs><radialGradient id="l" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#5b6563"/><stop offset="1" stop-color="#1c2221"/></radialGradient>' +
    '<radialGradient id="v" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#e9eef0"/><stop offset="1" stop-color="#9aa6aa"/></radialGradient></defs>' +
    '<rect width="640" height="480" fill="url(#l)"/>' +
    '<circle cx="320" cy="260" r="190" fill="#1F7A72" opacity=".85"/>' +
    '<circle cx="320" cy="260" r="150" fill="url(#v)"/><circle cx="320" cy="260" r="128" fill="#d7dfe2"/>' + p +
    '<rect x="0" y="440" width="640" height="40" fill="#000" opacity=".45"/>' +
    '<text x="16" y="467" font-family="monospace" font-size="20" fill="#fff">' + hora + "  " + motivo.toUpperCase() + "</text></svg>";
  return { fecha: fecha, motivo: motivo, toma: toma || "", ancho: 640, alto: 480, bytes: svg.length, tipo: "image/svg+xml", img: btoa(svg) };
}

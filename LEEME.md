# App del pastillero (para familiares y enfermeros)

App web instalable. Se publica gratis en Firebase Hosting y se agrega a la pantalla de inicio del celular.

## Carpetas
- `public/`: la app. Lo único que se publica.
- `base_de_datos/reglas.json`: reglas de seguridad para Realtime Database.
- `base_de_datos/estructura_inicial.json`: estructura de la base de datos, incluye el código de vinculación.

## Pasos
1. **Registra la app web en Firebase:** engrane > Configuración del proyecto > General > Tus apps > botón `</>`. Ponle "Pastillero app" y NO marques Hosting ahí. Copia el bloque `firebaseConfig` y pega sus valores en `public/firebase-config.js`.
2. **Código de vinculación:** abre `base_de_datos/estructura_inicial.json` y cambia `730514` (aparece 2 veces) por un código propio de 6 dígitos.
3. **Vincula el ESP32:** en el mismo archivo cambia `UID_DEL_ESP32_AQUI` por el UID del usuario del ESP32 (sale en el Monitor Serie del sketch FirebasePrueba, o en Authentication > Usuarios).
4. **Importa la estructura:** Realtime Database > Datos > menú ⋮ > Importar JSON. Reemplaza lo que hay (son datos de prueba).
5. **Publica las reglas:** Realtime Database > Reglas > pega `base_de_datos/reglas.json` > Publicar.
6. **Publica la app** (necesitas Node.js instalado, https://nodejs.org):
   ```
   npm install -g firebase-tools
   firebase login
   cd pastillero_app
   firebase deploy --only hosting
   ```
   Al terminar te da la dirección: https://pastillero-automatico-3c529.web.app
7. **En el celular:** abre esa dirección en Chrome > menú ⋮ > "Agregar a pantalla principal" (o "Instalar app").
8. **Primera vez:** crea tu cuenta, luego escribe el ID `pastillero_01` y tu código de vinculación.

Mientras `public/firebase-config.js` diga `PEGA_AQUI`, la app abre en modo demostración con datos de ejemplo.

## Lo que el ESP32 debe escribir para que la app lo muestre
- `dispositivos/pastillero_01/estado/ultima_conexion`: marca de tiempo del servidor, al menos cada 2 minutos.
- `dispositivos/pastillero_01/recipientes/rN`: `pastillas`, `temperatura_c`, `humedad_pct`.
- `historial_dosis/pastillero_01/{id}`: `recipiente`, `medicamento`, `programada` ("AAAA-MM-DD HH:MM", igual al horario), `dispensada` (marca de tiempo), `retirada` (marca de tiempo o 0) y `estado` ("pendiente", "tomada", "no_tomada" o "fallo").
- Leer `dispositivos/pastillero_01/horarios` y `comandos/dispensar_ahora` (1, 2 o 3; regresarlo a 0 al terminar).

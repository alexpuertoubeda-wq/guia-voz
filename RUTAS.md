# Paso Firme · módulo «llévame a…» (`rutas.js`)

Interpreta la orden hablada, busca el destino en OpenStreetMap, calcula una ruta a pie y la guía con frases en español. Todo gratuito, sin claves y llamado desde el navegador.

**Estado: las pruebas sin red pasan (`node pruebas/rutas.test.js`, 28 de 28). Ningún servicio real se ha podido llamar desde el entorno de desarrollo. Antes de publicar hay que ejecutar las tres comprobaciones del apartado 5 en un navegador.**

## 1. Servicios elegidos

| Para qué | Servicio | Dirección que usa el módulo | Documentación | Condiciones de uso |
|---|---|---|---|---|
| Ruta a pie con pasos | OSRM de FOSSGIS, perfil «foot» | `https://routing.openstreetmap.de/routed-foot/route/v1/driving/{lon},{lat};{lon},{lat}` | [API de OSRM 5.24](https://project-osrm.org/docs/v5.24.0/api/) | [Resumen en la web del servidor](https://routing.openstreetmap.de/about.html) · [texto completo, en alemán](https://fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/) |
| Lugares por categoría | Overpass API | `https://overpass-api.de/api/interpreter` (POST) | [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL) · [formato JSON](https://dev.overpass-api.de/output_formats.html) | [Normas de uso](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) · [wiki](https://wiki.openstreetmap.org/wiki/Overpass_API) |
| Lugares por nombre o dirección | Nominatim | `https://nominatim.openstreetmap.org/search` | [Search](https://nominatim.org/release-docs/latest/api/Search/) | [Política de uso de Nominatim](https://operations.osmfoundation.org/policies/nominatim/) |

Límites y obligaciones, tal como constan en esas páginas:

- **OSRM de FOSSGIS**: una petición por segundo como máximo; sin uso intensivo ni descargas masivas; identificarse con agente de usuario válido y, si procede, «referer» correcto; mostrar la atribución y un enlace para corregir el mapa. Las peticiones quedan registradas en el servidor. Los datos se renuevan cada dos días aproximadamente. Sin garantía de disponibilidad.
- **Overpass (overpass-api.de)**: unas 10 000 peticiones y 1 GB al día como máximo. Si se supera el ritmo responde 429; si el servidor no tiene recursos, 504. Ante un 429 o 406 hay que esperar 30 segundos. La propia wiki avisa de que no cabe esperar alta fiabilidad.
- **Nominatim**: máximo absoluto de una petición por segundo **sumando a todos los usuarios de la aplicación**; identificarse con «referer» o agente de usuario; mostrar la atribución; prohibido el autocompletado y las consultas sistemáticas; hay que guardar los resultados; la aplicación debe poder desactivar el servicio si la OSMF lo pide; no enviar datos personales; la política puede cambiar sin aviso. La política exige además que el código generado por IA cumpla todo lo anterior y que se advierta de ello: queda advertido aquí.

Cómo lo cumple el módulo: separa 1,1 s las llamadas a un mismo servicio, guarda 5 minutos los resultados de búsqueda, solo llama cuando el usuario da una orden (nunca de forma periódica ni mientras habla), y cada servicio se puede apagar con `PFRutas.config.<servicio>.activo = false`. El navegador envía por sí mismo el «referer» de la página.

**Atribución obligatoria** (ODbL): la app y la web deben decir «Datos de mapas © colaboradores de OpenStreetMap» con enlace a `https://www.openstreetmap.org/copyright`, y un enlace para corregir el mapa (`https://www.openstreetmap.org/fixthemap`). Falta añadirlo en `index.html` y en la ayuda hablada.

**Aviso de escala**: estos servidores los mantienen voluntarios y están pensados para un uso moderado. Sirven para arrancar y para una base de usuarios pequeña. Si el servicio se comercializa y crece, el límite de Nominatim (1 petición por segundo entre todos) y el de FOSSGIS obligan a pasar a un servidor propio o a un proveedor de pago. Otros candidatos descartados: el Valhalla público de FOSSGIS (`https://valhalla1.openstreetmap.de/route`, mismas condiciones, sin ventaja clara y con otro formato), y GraphHopper y openrouteservice, que piden clave.

## 2. API del módulo (`window.PFRutas`)

- `interpretar(frase)` → `{ tipo: 'categoria'|'nombre'|null, categoria, etiquetasOSM, nombre, hablado, esDireccion }`. Pura. Admite las alternativas del reconocedor separadas por `|`. Con `tipo: 'nombre'`, `categoria` es solo orientativa («bar Pepe» → `bar`). 73 categorías en `PFRutas.CATEGORIAS`.
- `await buscarCercanos(lat, lon, interpretacion, radioMetros)` → lista por distancia de `{ nombre, lat, lon, distancia, direccion, sinNombre }`, como mucho 8. Categoría: Overpass, radios 500 → 1500 → 4500 m. Nombre: Nominatim, siempre acotado a un recuadro (2 → 6 → 18 km) para no devolver una calle del mismo nombre en otra ciudad. Lista vacía si no hay nada.
- `await calcularRuta({lat, lon}, {lat, lon})` → `{ distanciaTotal, duracion, pasos: [{ lat, lon, distancia, duracion, tipo, modificador, calle, salida, rumboAntes, rumboDespues, texto }], geometria: [[lat, lon], …], separacionOrigen, separacionDestino }`.
- `instruccion(paso, { sinAviso })` → frase. Pura. Cubre los 18 tipos y 8 modificadores de OSRM; un tipo desconocido se trata como giro. Toda maniobra termina en «Si tienes que cruzar, comprueba antes el tráfico.»
- `crearSeguimiento(ruta, opciones)` → `{ actualizar, estado }`. `actualizar({ lat, lon, precision, rumbo, tiempo })` devuelve `null` o:

  ```
  { texto, tipo, recalcular, llegada, indicePaso, distanciaManiobra, distanciaRestante }
  ```
  `tipo`: `inicio`, `preaviso` (25 m antes), `maniobra`, `recto` (tras cada giro y cada 60 m), `sentido` (camina al revés), `gps` (precisión peor de 30 m: avisa y no da giros), `desvio` (`recalcular: true`; se repite cada 30 s mientras siga fuera), `vuelta`, `llegada` (`llegada: true`). Desvío = 3 lecturas seguidas a más de 20 m + precisión de la ruta.
- Utilidades puras: `distancia`, `rumbo`, `diferenciaRumbo`, `distanciaPuntoSegmento`, `formatearDistancia`, `formatearDuracion`, `puntoCardinal`, `fraseResultado`, `normalizarTexto`.
- Errores: las funciones de red lanzan un `Error` con `codigo` (`parametros`, `desactivado`, `red`, `tiempo`, `limite`, `servidor`, `formato`, `sin_ruta`) y un `message` en español que se puede decir tal cual.

## 3. Integración en `index.html` (pendiente; este módulo no toca ningún archivo existente)

1. Cargar el script antes del principal: `<script src="rutas.js"></script>`.
2. En `sw.js`: añadir `'rutas.js'` a `SHELL` y subir `CACHE` a `paso-firme-v8`.
3. En `handle(text)`, **antes** de `command(text)`: hoy «llévame a la calle Mayor» se entendería como «dónde estoy» (por la palabra «calle») y «quiero ir a un bar para comer» como «para».

```js
let ruta = null, seguimiento = null, vigilancia = null, recalculando = false;

function handle(text) {
  const destino = PFRutas.interpretar(text);
  if (destino.tipo) { irA(destino); return; }
  if (seguimiento && command(text) === 'stop') { pararRuta(); say('Ruta cancelada.', 'urgent'); return; }
  /* …switch actual… */
}
function posicion() {
  return new Promise((ok, ko) => navigator.geolocation.getCurrentPosition(ok, ko,
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }));
}
async function irA(destino) {
  pararRuta();
  say('Busco ' + destino.hablado + '.', 'urgent');
  try {
    const c = (await posicion()).coords;
    const lista = await PFRutas.buscarCercanos(c.latitude, c.longitude, destino);
    if (!lista.length) { say('No he encontrado ' + destino.hablado + ' cerca de aquí.', 'queue'); return; }
    const sitio = lista[0];
    say('Te llevo a ' + PFRutas.fraseResultado(sitio), 'queue');
    await empezarRuta(c, sitio, false);
  } catch (e) {
    say(e.codigo ? e.message : e.code === 1 ? 'No tengo permiso para usar la ubicación.' : 'No he podido calcular la ruta.', 'queue');
  }
}
async function empezarRuta(c, sitio, esRecalculo) {
  ruta = await PFRutas.calcularRuta({ lat: c.latitude, lon: c.longitude }, sitio);
  ruta.destino = sitio;
  seguimiento = PFRutas.crearSeguimiento(ruta, { sinAvisoInicial: esRecalculo });
  if (vigilancia === null) vigilancia = navigator.geolocation.watchPosition(alMoverse, () => {},
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}
async function alMoverse(pos) {
  if (!seguimiento) return;
  const c = pos.coords;
  const aviso = seguimiento.actualizar({ lat: c.latitude, lon: c.longitude, precision: c.accuracy,
    rumbo: c.heading === null ? undefined : c.heading, tiempo: pos.timestamp });
  if (!aviso) return;
  say(aviso.texto, aviso.tipo === 'recto' ? 'skip' : 'queue');
  if (aviso.tipo === 'maniobra' || aviso.tipo === 'desvio') buzz([120, 80, 120]);
  if (aviso.llegada) { buzz([200, 100, 200, 100, 400]); pararRuta(); }
  else if (aviso.recalcular && !recalculando) {
    recalculando = true;
    try { await empezarRuta(c, ruta.destino, true); }
    catch (e) { say(e.codigo ? e.message : 'No he podido recalcular la ruta.', 'queue'); }
    finally { recalculando = false; }
  }
}
function pararRuta() {
  if (vigilancia !== null) navigator.geolocation.clearWatch(vigilancia);
  vigilancia = null; seguimiento = null; ruta = null;
}
```

4. Añadir las órdenes nuevas a la ayuda hablada y la atribución de OpenStreetMap.
5. Decisiones que quedan para quien integre: si se elige siempre el resultado más cercano o se leen dos o tres para que el usuario escoja (las farmacias sin nombre llegan con `sinNombre: true`); y mantener la pantalla encendida durante la ruta (el GPS del navegador se detiene con la pantalla apagada).

## 4. Límites conocidos (para decírselos al usuario)

- La ruta **no sabe** dónde hay semáforos, pasos de peatones, aceras, obras, escalones ni obstáculos. El módulo nunca dice que se pueda cruzar; solo recuerda comprobar el tráfico. No sustituye al bastón ni al perro guía.
- OSRM traza por el eje de la calle: «a la derecha» o «a la izquierda» del destino es el lado de la calle, y puede exigir cruzar.
- El GPS del móvil en ciudad falla entre 5 y 30 m; entre edificios altos, más. Con precisión peor de 30 m el módulo deja de dar giros.
- Los datos dependen de lo que haya en OpenStreetMap: puede faltar un comercio, estar cerrado o no tener nombre. No se comprueban horarios.
- «Iglesia» busca cualquier lugar de culto; «centro de salud» incluye clínicas y consultas privadas; «parada de autobús» solo las etiquetadas `highway=bus_stop`.
- «Llévame a casa» y otros sitios personales no están resueltos (haría falta guardar favoritos).

## 5. Lo NO verificado y cómo verificarlo

No se ha podido hacer ninguna llamada real a los servicios. Lo siguiente sale de la documentación o queda sin confirmar:

| Punto | Estado |
|---|---|
| CORS (que el navegador deje leer la respuesta) en los tres servicios | **Sin verificar** en documentación. Indicio: la web openstreetmap.org los llama desde el navegador ([su configuración](https://github.com/openstreetmap/openstreetmap-website/blob/master/config/settings.yml)). |
| Ruta `routed-foot/route/v1/driving/` del servidor FOSSGIS | No aparece en la documentación oficial; tomada del [código del paquete stplanr](https://rdrr.io/cran/stplanr/src/R/route_osrm.R) y de la configuración de openstreetmap.org. **Sin verificar** en vivo. |
| Condiciones completas de FOSSGIS (página en alemán) | No se pudo abrir (bloqueo antirrobots). Solo consta el resumen de `about.html`. |
| Forma `center: { lat, lon }` de vías y relaciones en el JSON de Overpass con `out center` | `out center` está documentado; la forma exacta del campo, **sin verificar**. |
| Cabecera `Content-Type: application/x-www-form-urlencoded` en el POST a Overpass | La wiki muestra POST con `data=`; la cabecera, **sin verificar**. |
| Subcampos de `address` en Nominatim (`road`, `house_number`, `city`…) | La página de Search remite a otra que no se consultó. Son los mismos que ya usa `whereAmI()` en `index.html`. |
| Segundo servidor Overpass | Retirado: sus condiciones no constan y no respondió en la prueba del 16/11/2026. Si Overpass falla o tarda más de 15 s, la búsqueda por categoría pasa a Nominatim (parámetro estructurado `amenity`, comprobado desde el navegador el 16/11/2026). |
| Convivencia con `Cross-Origin-Embedder-Policy: credentialless` que pone `sw.js` | **Sin verificar**. |
| Calidad de las rutas a pie en Castellón y Benicàssim, y del reconocimiento de voz con nombres propios | **Sin verificar**: requiere prueba en la calle con acompañante vidente. |
| `healthcare=centre` | Existe en la wiki, que desaconseja usarla sola; se mantiene junto a `amenity=clinic` y `amenity=doctors`. |

Las etiquetas del catálogo se comprobaron en [Map features](https://wiki.openstreetmap.org/wiki/Map_features), [Key:shop](https://wiki.openstreetmap.org/wiki/Key:shop), [Key:healthcare](https://wiki.openstreetmap.org/wiki/Key:healthcare) y [highway=bus_stop](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dbus_stop). Las de `tourism=` (hotel, hostel, guest_house, museum) aparecen listadas sin descripción.

### Tres comprobaciones para la consola del navegador

Abrir la app publicada (así se prueba también el CORS desde su origen), pulsar F12 y pegar una a una. Coordenadas: Castellón de la Plana (39.9864, -0.0513).

**1. OSRM (ruta a pie).** Debe dar `Ok`, una distancia en metros y una lista de `tipo/modificador/calle`:

```js
fetch('https://routing.openstreetmap.de/routed-foot/route/v1/driving/-0.051300,39.986400;-0.045000,39.990000?steps=true&geometries=geojson&overview=full&alternatives=false')
  .then(r => r.json()).then(j => console.log(j.code, j.routes[0].distance, j.routes[0].geometry.type,
    j.routes[0].legs[0].steps.map(s => s.maneuver.type + '/' + s.maneuver.modifier + '/' + s.name)));
```

**2. Nominatim (nombre o dirección).** Debe dar una lista con `lat`, `lon` (texto), `name`, `display_name` y `address`:

```js
fetch('https://nominatim.openstreetmap.org/search?q=calle%20Mayor&format=jsonv2&limit=10&addressdetails=1&accept-language=es&viewbox=-0.07475,39.96843,-0.02785,40.00437&bounded=1')
  .then(r => r.json()).then(j => console.log(j.length, j[0]));
```

**3. Overpass (farmacias a 500 m).** Debe dar `elements` con `lat`/`lon` en los nodos y `center` en las vías:

```js
fetch('https://overpass-api.de/api/interpreter', { method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'data=%5Bout%3Ajson%5D%5Btimeout%3A20%5D%3B%0A(%0A%20%20nwr%5B%22amenity%22%3D%22pharmacy%22%5D(around%3A500%2C39.986400%2C-0.051300)%3B%0A)%3B%0Aout%20center%3B' })
  .then(r => r.json()).then(j => console.log(j.elements.length, j.elements.slice(0, 3)));
```

Como URL sola (forma GET, **sin verificar** en la documentación consultada): `https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%5Btimeout%3A20%5D%3B%0A(%0A%20%20nwr%5B%22amenity%22%3D%22pharmacy%22%5D(around%3A500%2C39.986400%2C-0.051300)%3B%0A)%3B%0Aout%20center%3B`

Y la prueba completa del módulo, con la app ya integrada:

```js
const d = PFRutas.interpretar('llévame a la farmacia más cercana');
const l = await PFRutas.buscarCercanos(39.9864, -0.0513, d); console.log(l);
const r = await PFRutas.calcularRuta({ lat: 39.9864, lon: -0.0513 }, l[0]); console.log(r.pasos.map(p => p.texto));
```

## 6. Pruebas

`node --check rutas.js` y `node pruebas/rutas.test.js` (sin red): 58 frases de interpretación, catálogo completo, formato de distancias, geometría, todas las combinaciones de maniobra, URL y consultas, simulación de un recorrido (avance, desvío, vuelta, GPS malo, llegada) y los servicios con un `fetch` simulado (ampliación de radio, caché, errores, tiempo de espera, límite de frecuencia).

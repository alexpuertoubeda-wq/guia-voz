// Pruebas de rutas.js. Se ejecutan con:  node pruebas/rutas.test.js
// No usan la red: los servicios se sustituyen por un fetch falso.
'use strict';
const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, '..', 'rutas.js'));

// Las pruebas se apuntan y se ejecutan al final una detrás de otra (las de
// los servicios comparten la configuración y no pueden solaparse).
const lista = [];
function prueba(nombre, fn) { lista.push({ nombre, fn }); }

// ---------------------------------------------------------------- interpretar
const FRASES = [
  // [frase, tipo, categoria, nombre]
  ['llévame a la farmacia más cercana', 'categoria', 'farmacia', null],
  ['llevame a la farmacia mas cercana', 'categoria', 'farmacia', null],
  ['quiero ir a un bar', 'categoria', 'bar', null],
  ['Llévame al bar Pepe', 'nombre', 'bar', 'bar Pepe'],
  ['llévame a la calle Mayor 5', 'nombre', null, 'calle Mayor 5'],
  ['necesito una farmacia', 'categoria', 'farmacia', null],
  ['¿Dónde hay un cajero automático?', 'categoria', 'cajero', null],
  ['quiero ir a una cafetería', 'categoria', 'cafeteria', null],
  ['llévame a un restaurante cerca de aquí, por favor', 'categoria', 'restaurante', null],
  ['vamos al supermercado', 'categoria', 'supermercado', null],
  ['busca una panadería', 'categoria', 'panaderia', null],
  ['llévame al banco más próximo', 'categoria', 'banco', null],
  ['quiero ir al hospital', 'categoria', 'hospital', null],
  ['llévame al centro de salud', 'categoria', 'centro_salud', null],
  ['cómo llego al ambulatorio', 'categoria', 'centro_salud', null],
  ['llévame a la parada de autobús más cercana', 'categoria', 'parada_autobus', null],
  ['quiero ir a la estación de tren', 'categoria', 'estacion_tren', null],
  ['llévame a la estación de autobuses', 'categoria', 'estacion_autobuses', null],
  ['necesito un taxi', 'categoria', 'taxi', null],
  ['llévame a la parada de taxis', 'categoria', 'taxi', null],
  ['guíame hasta un estanco', 'categoria', 'estanco', null],
  ['quiero ir a correos', 'categoria', 'correos', null],
  ['llévame a la policía', 'categoria', 'policia', null],
  ['llévame a la comisaría', 'categoria', 'policia', null],
  ['quiero ir al ayuntamiento', 'categoria', 'ayuntamiento', null],
  ['llévame a una iglesia', 'categoria', 'iglesia', null],
  ['vamos a un parque', 'categoria', 'parque', null],
  ['necesito un baño', 'categoria', 'bano', null],
  ['dónde hay baños públicos', 'categoria', 'bano', null],
  ['busco unos aseos', 'categoria', 'bano', null],
  ['llévame a una gasolinera', 'categoria', 'gasolinera', null],
  ['quiero ir a la peluquería', 'categoria', 'peluqueria', null],
  ['llévame a la estación de servicio', 'categoria', 'gasolinera', null],
  ['dónde está la farmacia que está más cerca', 'categoria', 'farmacia', null],
  ['la farmacia más cercana', 'categoria', 'farmacia', null],
  ['bares cerca', 'categoria', 'bar', null],
  ['quiero ir a una frutería', 'categoria', 'fruteria', null],
  ['llévame a la boca de metro', 'categoria', 'metro', null],
  ['llévame al parque infantil', 'categoria', 'parque_infantil', null],
  ['llévame a la biblioteca andando', 'categoria', 'biblioteca', null],
  ['quiero ir al parque Ribalta', 'nombre', 'parque', 'parque Ribalta'],
  ['llévame a la plaza Santa Clara', 'nombre', null, 'plaza Santa Clara'],
  ['cómo voy a la avenida Rey Don Jaime 20', 'nombre', null, 'avenida Rey Don Jaime 20'],
  ['dónde está el Mercado Central de Castellón', 'nombre', 'mercado', 'Mercado Central de Castellón'],
  ['vamos al bar Manolo', 'nombre', 'bar', 'bar Manolo'],
  ['oye, llévame a El Corte Inglés, gracias', 'nombre', null, 'Corte Inglés'],
  ['no sé | llévame a una óptica', 'categoria', 'optica', null],
  // No piden ir a ningún sitio
  ['dónde estoy', null, null, null],
  ['guíame', null, null, null],
  ['para', null, null, null],
  ['lee esto', null, null, null],
  ['qué hay delante', null, null, null],
  ['vamos', null, null, null],
  ['en qué calle estoy', null, null, null],
  ['farmacia', null, null, null],
  ['llévame a', null, null, null],
  ['ayuda', null, null, null],
  ['', null, null, null]
];
prueba('interpretar: ' + FRASES.length + ' frases', () => {
  assert.ok(FRASES.length >= 30);
  FRASES.forEach(([frase, tipo, cat, nombre]) => {
    const r = R.interpretar(frase);
    assert.strictEqual(r.tipo, tipo, 'tipo de «' + frase + '»: ' + JSON.stringify(r));
    assert.strictEqual(r.categoria, cat, 'categoría de «' + frase + '»: ' + JSON.stringify(r));
    assert.strictEqual(r.nombre, nombre, 'nombre de «' + frase + '»: ' + JSON.stringify(r));
    if (tipo === 'categoria') assert.deepStrictEqual(r.etiquetasOSM, R.CATEGORIAS[cat].etiquetasOSM);
    if (tipo === null) assert.strictEqual(r.etiquetasOSM, null);
  });
});
prueba('interpretar: es pura y marca las direcciones', () => {
  const a = R.interpretar('llévame a la calle Mayor 5'), b = R.interpretar('llévame a la calle Mayor 5');
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.esDireccion, true);
  assert.strictEqual(R.interpretar('llévame al bar Pepe').esDireccion, false);
  a.etiquetasOSM = ['x'];
  const c = R.interpretar('quiero ir a un bar'); c.etiquetasOSM.push('roto');
  assert.deepStrictEqual(R.interpretar('quiero ir a un bar').etiquetasOSM, ['amenity=bar', 'amenity=pub']);
});
prueba('catálogo: etiquetas bien formadas y sinónimos sin repetir', () => {
  const vistos = {};
  const ids = Object.keys(R.CATEGORIAS);
  assert.ok(ids.length >= 60);
  ids.forEach(id => {
    const c = R.CATEGORIAS[id];
    assert.ok(c.etiquetasOSM.length > 0);
    c.etiquetasOSM.forEach(e => assert.ok(/^(amenity|shop|highway|railway|leisure|tourism|healthcare)=[a-z_]+$/.test(e), e));
    c.sinonimos.forEach(s => {
      assert.strictEqual(s, R.normalizarTexto(s), 'sinónimo sin normalizar: ' + s);
      assert.ok(!vistos[s], 'sinónimo repetido: ' + s + ' (' + vistos[s] + ', ' + id + ')');
      vistos[s] = id;
      // Cada sinónimo, dicho con «llévame a», debe dar su categoría.
      assert.strictEqual(R.interpretar('llévame a ' + s).categoria, id, s);
    });
  });
  assert.deepStrictEqual(R.CATEGORIAS.farmacia.etiquetasOSM, ['amenity=pharmacy']);
  assert.deepStrictEqual(R.CATEGORIAS.estanco.etiquetasOSM, ['shop=tobacco']);
  assert.deepStrictEqual(R.CATEGORIAS.parada_autobus.etiquetasOSM, ['highway=bus_stop']);
});

// ---------------------------------------------------------------- formato y geometría
prueba('formatearDistancia', () => {
  const casos = [[0.4, 'menos de un metro'], [1, 'un metro'], [7.4, '7 metros'], [23, '25 metros'], [120, '120 metros'],
    [124, '120 metros'], [989, '990 metros'], [1000, 'un kilómetro'], [1040, 'un kilómetro'], [1200, 'un kilómetro y 200 metros'],
    [1500, 'un kilómetro y medio'], [2000, '2 kilómetros'], [2480, '2 kilómetros y medio'], [3300, '3 kilómetros y 300 metros'],
    [7600, '7 kilómetros y medio'], [8000, '8 kilómetros'], [25400, '25 kilómetros'], [-5, 'menos de un metro'], [NaN, 'menos de un metro']];
  casos.forEach(([m, t]) => assert.strictEqual(R.formatearDistancia(m), t, String(m)));
});
prueba('formatearDuracion y puntoCardinal', () => {
  assert.strictEqual(R.formatearDuracion(20), 'menos de un minuto');
  assert.strictEqual(R.formatearDuracion(60), 'un minuto');
  assert.strictEqual(R.formatearDuracion(370), 'unos 6 minutos');
  assert.strictEqual(R.formatearDuracion(3600), 'una hora');
  assert.strictEqual(R.formatearDuracion(4200), 'una hora y 10 minutos');
  assert.strictEqual(R.puntoCardinal(0), 'el norte');
  assert.strictEqual(R.puntoCardinal(359), 'el norte');
  assert.strictEqual(R.puntoCardinal(92), 'el este');
  assert.strictEqual(R.puntoCardinal(225), 'el suroeste');
});
prueba('distancia haversine y rumbo', () => {
  // Un grado de latitud ≈ 111,2 km.
  assert.ok(Math.abs(R.distancia(39, 0, 40, 0) - 111195) < 60);
  assert.strictEqual(R.distancia(39.9864, -0.0513, 39.9864, -0.0513), 0);
  // Castellón – Valencia: unos 64 km en línea recta.
  const d = R.distancia(39.9864, -0.0513, 39.4699, -0.3763);
  assert.ok(d > 62000 && d < 66000, String(d));
  assert.ok(Math.abs(R.rumbo(39, 0, 40, 0) - 0) < 0.01);
  assert.ok(Math.abs(R.rumbo(39, 0, 39, 1) - 90) < 0.5);
  assert.ok(Math.abs(R.rumbo(40, 0, 39, 0) - 180) < 0.01);
  assert.ok(Math.abs(R.rumbo(39, 1, 39, 0) - 270) < 0.5);
  assert.strictEqual(R.diferenciaRumbo(350, 10), 20);
  assert.strictEqual(R.diferenciaRumbo(10, 350), -20);
  assert.strictEqual(R.diferenciaRumbo(0, 180), 180);
});
prueba('distanciaPuntoSegmento', () => {
  const lat = 39.9864, lon = -0.0513, n = 0.0009;        // segmento de ~100 m hacia el norte
  const k = 111195 * Math.cos(lat * Math.PI / 180);
  let r = R.distanciaPuntoSegmento(lat + n / 2, lon + 30 / k, lat, lon, lat + n, lon);
  assert.ok(Math.abs(r.distancia - 30) < 0.5, String(r.distancia));
  assert.ok(Math.abs(r.t - 0.5) < 0.01);
  r = R.distanciaPuntoSegmento(lat - 0.00045, lon, lat, lon, lat + n, lon);   // antes del inicio
  assert.strictEqual(r.t, 0);
  assert.ok(Math.abs(r.distancia - 50) < 0.5, String(r.distancia));
  r = R.distanciaPuntoSegmento(lat + 2 * n, lon, lat, lon, lat + n, lon);     // después del final
  assert.strictEqual(r.t, 1);
  r = R.distanciaPuntoSegmento(lat, lon, lat, lon, lat, lon);                 // segmento degenerado
  assert.strictEqual(r.distancia, 0);
});

// ---------------------------------------------------------------- instrucciones
const TIPOS = ['turn', 'new name', 'depart', 'arrive', 'merge', 'ramp', 'on ramp', 'off ramp', 'fork', 'end of road',
  'use lane', 'continue', 'roundabout', 'rotary', 'roundabout turn', 'notification', 'exit roundabout', 'exit rotary'];
const MODS = [null, 'uturn', 'sharp right', 'right', 'slight right', 'straight', 'slight left', 'left', 'sharp left'];
prueba('instruccion: todos los tipos y modificadores de OSRM', () => {
  TIPOS.concat(['tipo inventado']).forEach(tipo => MODS.forEach(mod => ['', 'Calle Mayor'].forEach(calle => {
    const t = R.instruccion({ tipo, modificador: mod, calle, salida: 2, rumboDespues: 90 });
    const id = tipo + '/' + mod + '/' + calle + ': ' + t;
    assert.ok(typeof t === 'string' && t.length > 8, id);
    assert.ok(!/undefined|null|NaN| {2}|\.\.|,\./.test(t), id);
    assert.ok(/^[A-ZÁÉÍÓÚ]/.test(t) && /\.$/.test(t), id);
    assert.ok(!/es seguro|puedes cruzar|cruza ahora|cruza la/i.test(t), id);
    if (tipo !== 'depart' && tipo !== 'arrive') assert.ok(/comprueba antes el tráfico/.test(t), id);
    if (calle && tipo !== 'arrive') assert.ok(t.includes('Calle Mayor'), id);
    // En las rotondas OSRM identifica la salida por su número, no por el lado.
    const conLado = tipo !== 'depart' && !/roundabout$|rotary$/.test(tipo);
    if (conLado && /left/.test(mod || '')) assert.ok(/izquierda/.test(t), id);
    if (conLado && /right/.test(mod || '')) assert.ok(/derecha/.test(t), id);
  })));
});
prueba('instruccion: frases concretas', () => {
  const I = (p, o) => R.instruccion(p, o);
  assert.strictEqual(I({ tipo: 'turn', modificador: 'right', calle: 'Calle Mayor' }),
    'Gira a la derecha por Calle Mayor. Si tienes que cruzar, comprueba antes el tráfico.');
  assert.strictEqual(I({ tipo: 'turn', modificador: 'right', calle: 'Calle Mayor' }, { sinAviso: true }), 'Gira a la derecha por Calle Mayor.');
  assert.strictEqual(I({ tipo: 'turn', modificador: 'slight left', calle: '' }, { sinAviso: true }), 'Gira ligeramente a la izquierda.');
  assert.strictEqual(I({ tipo: 'turn', modificador: 'uturn' }, { sinAviso: true }), 'Da media vuelta.');
  assert.strictEqual(I({ tipo: 'end of road', modificador: 'left', calle: 'Calle Enmedio' }, { sinAviso: true }), 'Al final de la calle, gira a la izquierda por Calle Enmedio.');
  assert.strictEqual(I({ tipo: 'new name', modificador: 'straight', calle: 'Calle Alloza' }, { sinAviso: true }), 'Sigue recto. La calle pasa a llamarse Calle Alloza.');
  assert.strictEqual(I({ tipo: 'roundabout', salida: 3, calle: 'Avenida del Mar' }, { sinAviso: true }), 'En la rotonda, toma la tercera salida, por Avenida del Mar.');
  assert.strictEqual(I({ tipo: 'fork', modificador: 'slight right' }, { sinAviso: true }), 'En la bifurcación, sigue por la derecha.');
  assert.strictEqual(I({ tipo: 'depart', calle: 'Calle Mayor', rumboDespues: 0 }), 'Empieza a caminar hacia el norte por Calle Mayor.');
  assert.strictEqual(I({ tipo: 'depart', calle: '' }), 'Empieza a caminar.');
  assert.strictEqual(I({ tipo: 'arrive', modificador: 'left' }), 'Has llegado. El destino está a tu izquierda.');
  assert.strictEqual(I({ tipo: 'arrive', modificador: 'right' }), 'Has llegado. El destino está a tu derecha.');
  assert.strictEqual(I({ tipo: 'arrive' }), 'Has llegado a tu destino.');
});

// ---------------------------------------------------------------- ruta de ejemplo (formato documentado de OSRM)
// Recorrido en Castellón de la Plana: 200 m al norte, giro a la derecha,
// 150 m al este, giro a la izquierda, 100 m al norte; destino a la derecha.
const LAT0 = 39.9864, LON0 = -0.0513;
const M_LAT = 1 / 111195, M_LON = 1 / (111195 * Math.cos(LAT0 * Math.PI / 180));
const pt = (norte, este) => [LON0 + este * M_LON, LAT0 + norte * M_LAT];          // [lon, lat], como OSRM
const A = pt(0, 0), B = pt(200, 0), C = pt(200, 150), D = pt(300, 150);
const RESPUESTA_OSRM = {
  code: 'Ok',
  routes: [{
    distance: 450, duration: 324, weight: 324, weight_name: 'duration',
    geometry: { type: 'LineString', coordinates: [A, pt(100, 0), B, pt(200, 75), C, D] },
    legs: [{
      distance: 450, duration: 324, weight: 324, summary: 'Calle A, Calle B',
      steps: [
        { distance: 200, duration: 144, weight: 144, name: 'Calle A', mode: 'walking', driving_side: 'right',
          geometry: { type: 'LineString', coordinates: [A, pt(100, 0), B] },
          maneuver: { location: A, bearing_before: 0, bearing_after: 0, type: 'depart' }, intersections: [] },
        { distance: 150, duration: 108, weight: 108, name: 'Calle B', mode: 'walking', driving_side: 'right',
          geometry: { type: 'LineString', coordinates: [B, pt(200, 75), C] },
          maneuver: { location: B, bearing_before: 0, bearing_after: 90, type: 'turn', modifier: 'right' }, intersections: [] },
        { distance: 100, duration: 72, weight: 72, name: 'Calle C', mode: 'walking', driving_side: 'right',
          geometry: { type: 'LineString', coordinates: [C, D] },
          maneuver: { location: C, bearing_before: 90, bearing_after: 0, type: 'end of road', modifier: 'left' }, intersections: [] },
        { distance: 0, duration: 0, weight: 0, name: 'Calle C', mode: 'walking', driving_side: 'right',
          geometry: { type: 'LineString', coordinates: [D, D] },
          maneuver: { location: D, bearing_before: 0, bearing_after: 0, type: 'arrive', modifier: 'right' }, intersections: [] }
      ]
    }]
  }],
  waypoints: [
    { name: 'Calle A', location: A, distance: 3.2, hint: 'x' },
    { name: 'Calle C', location: D, distance: 6.5, hint: 'y' }
  ]
};

prueba('normalizarRuta: respuesta de OSRM', () => {
  const r = R.normalizarRuta(RESPUESTA_OSRM);
  assert.strictEqual(r.distanciaTotal, 450);
  assert.strictEqual(r.duracion, 324);
  assert.strictEqual(r.pasos.length, 4);
  assert.strictEqual(r.geometria.length, 6);
  assert.deepStrictEqual(r.geometria[0], [A[1], A[0]]);             // [lat, lon]
  const p = r.pasos[1];
  assert.deepStrictEqual(Object.keys(p).sort(), ['calle', 'distancia', 'duracion', 'lat', 'lon', 'modificador', 'rumboAntes', 'rumboDespues', 'salida', 'texto', 'tipo'].sort());
  assert.strictEqual(p.lat, B[1]); assert.strictEqual(p.lon, B[0]);
  assert.strictEqual(p.tipo, 'turn'); assert.strictEqual(p.modificador, 'right'); assert.strictEqual(p.calle, 'Calle B');
  assert.strictEqual(p.distancia, 150);
  assert.strictEqual(p.texto, 'Gira a la derecha por Calle B. Si tienes que cruzar, comprueba antes el tráfico.');
  assert.strictEqual(r.pasos[0].modificador, null);
  assert.strictEqual(r.pasos[0].texto, 'Empieza a caminar hacia el norte por Calle A.');
  assert.strictEqual(r.pasos[3].texto, 'Has llegado. El destino está a tu derecha.');
  assert.strictEqual(r.separacionDestino, 6.5);
});
prueba('normalizarRuta: errores documentados', () => {
  assert.throws(() => R.normalizarRuta({ code: 'NoRoute', message: 'x' }), e => e.codigo === 'sin_ruta');
  assert.throws(() => R.normalizarRuta({ code: 'NoSegment' }), e => e.codigo === 'sin_ruta');
  assert.throws(() => R.normalizarRuta({ code: 'InvalidQuery' }), e => e.codigo === 'servidor');
  assert.throws(() => R.normalizarRuta(null), e => e.codigo === 'formato');
  assert.throws(() => R.normalizarRuta({ code: 'Ok', routes: [] }), e => e.codigo === 'servidor');
});
prueba('URL y consultas con el formato documentado', () => {
  assert.strictEqual(R.urlRuta({ lat: 39.9864, lon: -0.0513 }, { lat: 39.9894, lon: -0.0495 }),
    'https://routing.openstreetmap.de/routed-foot/route/v1/driving/-0.051300,39.986400;-0.049500,39.989400?steps=true&geometries=geojson&overview=full&alternatives=false');
  const u = R.urlNominatim(39.9864, -0.0513, 'calle Mayor 5', 2000);
  assert.ok(u.startsWith('https://nominatim.openstreetmap.org/search?q=calle%20Mayor%205&format=jsonv2&limit=10&addressdetails=1&accept-language=es&viewbox='), u);
  assert.ok(u.endsWith('&bounded=1'), u);
  const caja = /viewbox=([^&]+)/.exec(u)[1].split(',').map(Number);     // x1,y1,x2,y2 = lon,lat,lon,lat
  assert.ok(caja[0] < -0.0513 && caja[2] > -0.0513 && caja[1] < 39.9864 && caja[3] > 39.9864, u);
  assert.ok(Math.abs(R.distancia(caja[1], -0.0513, caja[3], -0.0513) - 4000) < 20);
  assert.ok(Math.abs(R.distancia(39.9864, caja[0], 39.9864, caja[2]) - 4000) < 20);
  assert.strictEqual(R.consultaOverpass(39.9864, -0.0513, ['amenity=bar', 'amenity=pub'], 500),
    '[out:json][timeout:20];\n(\n  nwr["amenity"="bar"](around:500,39.986400,-0.051300);\n  nwr["amenity"="pub"](around:500,39.986400,-0.051300);\n);\nout center;');
});

// ---------------------------------------------------------------- simulación del recorrido
function simular(seg, reloj, desde, hasta, opc) {
  // Camina en línea recta de «desde» a «hasta» ([norte, este] en metros) a 1,4 m por lectura y segundo.
  const o = Object.assign({ precision: 8 }, opc), sal = [];
  const dn = hasta[0] - desde[0], de = hasta[1] - desde[1], largo = Math.hypot(dn, de), n = Math.max(1, Math.ceil(largo / 1.4));
  for (let k = 1; k <= n; k++) {
    const c = pt(desde[0] + dn * k / n, desde[1] + de * k / n);
    reloj.t += 1000;
    const r = seg.actualizar({ lat: c[1], lon: c[0], precision: o.precision, tiempo: reloj.t });
    if (r !== null) {
      assert.deepStrictEqual(Object.keys(r).sort(), ['distanciaManiobra', 'distanciaRestante', 'indicePaso', 'llegada', 'recalcular', 'texto', 'tipo']);
      assert.ok(typeof r.texto === 'string' && r.texto.length > 5);
      sal.push(r);
    }
  }
  return sal;
}
const tipos = l => l.map(x => x.tipo).join(',');

prueba('seguimiento: recorrido completo con desvío, GPS malo y llegada', () => {
  const ruta = R.normalizarRuta(RESPUESTA_OSRM);
  const seg = R.crearSeguimiento(ruta);
  const reloj = { t: 1000000 }, todo = [];
  let e;

  // Primera lectura: presentación.
  const c0 = pt(0, 2);
  e = seg.actualizar({ lat: c0[1], lon: c0[0], precision: 8, rumbo: 90, tiempo: reloj.t });
  assert.strictEqual(e.tipo, 'inicio');
  assert.ok(e.texto.startsWith('Ruta de 450 metros, unos 5 minutos andando. '), e.texto);
  assert.ok(e.texto.includes(R.AVISO_SEGURIDAD), e.texto);
  assert.ok(e.texto.includes('Empieza a caminar hacia el norte por Calle A. Esa dirección queda a tu izquierda. Sigue recto 200 metros.'), e.texto);
  assert.strictEqual(e.recalcular, false); assert.strictEqual(e.llegada, false);
  assert.strictEqual(e.indicePaso, 1); assert.strictEqual(e.distanciaRestante, 450);
  todo.push(e);
  // Quieto en el mismo sitio: no repite.
  assert.strictEqual(seg.actualizar({ lat: c0[1], lon: c0[0], precision: 8, tiempo: reloj.t + 500 }), null);

  // Tramo 1: 200 m al norte por Calle A.
  e = simular(seg, reloj, [0, 0], [200, 0]);
  assert.strictEqual(tipos(e), 'recto,recto,preaviso,maniobra', JSON.stringify(e.map(x => x.texto)));
  assert.ok(/^Sigue recto 1[34]0 metros\.$/.test(e[0].texto), e[0].texto);
  assert.ok(/^En (20|25) metros, gira a la derecha por Calle B\.$/.test(e[2].texto), e[2].texto);
  assert.ok(!/tráfico/.test(e[2].texto));
  assert.strictEqual(e[3].texto, 'Gira a la derecha por Calle B. Si tienes que cruzar, comprueba antes el tráfico.');
  assert.ok(e[2].distanciaManiobra <= 25 && e[2].distanciaManiobra > 15);
  assert.ok(e[3].distanciaRestante <= 260 && e[3].distanciaRestante >= 250);
  todo.push(...e);

  // Tramo 2 (primera mitad): 70 m al este por Calle B.
  e = simular(seg, reloj, [200, 0], [200, 70]);
  assert.strictEqual(tipos(e), 'recto,recto', JSON.stringify(e.map(x => x.texto)));
  assert.ok(/^Sigue recto 1[345]0 metros por Calle B\.$/.test(e[0].texto), e[0].texto);
  todo.push(...e);

  // Desvío: se mete 70 m hacia el sur por una calle que no es de la ruta.
  e = simular(seg, reloj, [200, 70], [130, 70]);
  assert.strictEqual(tipos(e), 'desvio', JSON.stringify(e.map(x => x.texto)));
  assert.strictEqual(e[0].recalcular, true);
  assert.ok(/^Te has salido de la ruta\./.test(e[0].texto));
  assert.strictEqual(seg.estado().fueraDeRuta, true);
  todo.push(...e);

  // Vuelve sobre sus pasos hasta la ruta (tarda 50 s: a los 30 s se repite la
  // petición de recalcular, que esta simulación no atiende).
  e = simular(seg, reloj, [130, 70], [200, 72]);
  assert.strictEqual(tipos(e), 'desvio,vuelta', JSON.stringify(e.map(x => x.texto)));
  assert.strictEqual(e[0].recalcular, true);
  assert.ok(/^Has vuelto a la ruta\. Sigue recto \d+ metros\.$/.test(e[1].texto), e[1].texto);
  assert.strictEqual(e[1].recalcular, false);
  assert.strictEqual(seg.estado().fueraDeRuta, false);
  todo.push(...e);

  // GPS malo (50 m) durante 18 lecturas, con posiciones que se salen de la ruta: un solo aviso, ningún giro ni desvío.
  e = simular(seg, reloj, [200, 72], [180, 86], { precision: 50 });
  assert.strictEqual(tipos(e), 'gps', JSON.stringify(e.map(x => x.texto)));
  assert.ok(/poco precisa, de unos 50 metros/.test(e[0].texto), e[0].texto);
  assert.ok(!/gira/i.test(e[0].texto));
  assert.strictEqual(seg.estado().gpsImpreciso, true);
  todo.push(...e);

  // Se recupera la señal en la ruta y sigue hasta el final de Calle B.
  e = simular(seg, reloj, [200, 100], [200, 150]);
  assert.strictEqual(tipos(e), 'gps,preaviso,maniobra', JSON.stringify(e.map(x => x.texto)));
  assert.ok(/^La señal de GPS ha mejorado\. Sigue recto \d+ metros\.$/.test(e[0].texto), e[0].texto);
  assert.ok(/^En (20|25) metros, al final de la calle, gira a la izquierda por Calle C\.$/.test(e[1].texto), e[1].texto);
  assert.strictEqual(e[2].texto, 'Al final de la calle, gira a la izquierda por Calle C. Si tienes que cruzar, comprueba antes el tráfico.');
  todo.push(...e);

  // Tramo 3: 100 m al norte por Calle C y llegada.
  e = simular(seg, reloj, [200, 150], [300, 150]);
  assert.strictEqual(tipos(e), 'recto,preaviso,llegada', JSON.stringify(e.map(x => x.texto)));
  assert.ok(/^En (20|25) metros llegarás a tu destino, que queda a tu derecha\.$/.test(e[1].texto), e[1].texto);
  assert.strictEqual(e[2].texto, 'Has llegado. El destino está a tu derecha.');
  assert.strictEqual(e[2].llegada, true); assert.strictEqual(e[2].distanciaRestante, 0);
  todo.push(...e);

  // Después de llegar no dice nada más.
  assert.strictEqual(simular(seg, reloj, [300, 150], [320, 150]).length, 0);
  assert.strictEqual(seg.estado().terminado, true);

  // Nunca dos frases seguidas iguales, y ninguna frase promete seguridad al cruzar.
  for (let k = 1; k < todo.length; k++) assert.notStrictEqual(todo[k].texto, todo[k - 1].texto);
  todo.forEach(x => assert.ok(!/es seguro|puedes cruzar|cruza ahora/i.test(x.texto), x.texto));
  assert.strictEqual(todo.filter(x => x.recalcular).length, 2);
});

prueba('seguimiento: fuera de ruta mucho tiempo, repite la señal cada 30 s y no antes', () => {
  const seg = R.crearSeguimiento(R.normalizarRuta(RESPUESTA_OSRM));
  const reloj = { t: 0 };
  simular(seg, reloj, [0, 0], [60, 0]);
  const e = simular(seg, reloj, [60, 0], [60, -140]);            // 100 lecturas (100 s) alejándose
  assert.strictEqual(tipos(e), 'desvio,desvio,desvio', JSON.stringify(e.map(x => x.texto)));
  assert.ok(e.every(x => x.recalcular));
  assert.ok(/^Sigues fuera de la ruta/.test(e[1].texto));
});
prueba('seguimiento: un salto aislado del GPS no dispara el desvío', () => {
  const seg = R.crearSeguimiento(R.normalizarRuta(RESPUESTA_OSRM));
  const reloj = { t: 0 };
  simular(seg, reloj, [0, 0], [50, 0]);
  const lejos = pt(50, 80);
  assert.strictEqual(seg.actualizar({ lat: lejos[1], lon: lejos[0], precision: 10, tiempo: (reloj.t += 1000) }), null);
  assert.strictEqual(seg.actualizar({ lat: lejos[1], lon: lejos[0], precision: 10, tiempo: (reloj.t += 1000) }), null);
  const e = simular(seg, reloj, [52, 0], [100, 0]);
  assert.ok(e.every(x => x.tipo === 'recto'), tipos(e));
  // Con precisión de 28 m (aún válida), 40 m de separación no es desvío: el umbral crece con la precisión.
  const seg2 = R.crearSeguimiento(R.normalizarRuta(RESPUESTA_OSRM));
  const e2 = simular(seg2, { t: 0 }, [0, 40], [100, 40], { precision: 28 });
  assert.ok(!e2.some(x => x.recalcular), tipos(e2));
  // …pero con precisión de 5 m, sí.
  const seg3 = R.crearSeguimiento(R.normalizarRuta(RESPUESTA_OSRM));
  const e3 = simular(seg3, { t: 0 }, [0, 40], [100, 40], { precision: 5 });
  assert.ok(e3.some(x => x.recalcular), tipos(e3));
});
prueba('seguimiento: sentido contrario', () => {
  const seg = R.crearSeguimiento(R.normalizarRuta(RESPUESTA_OSRM));
  const reloj = { t: 0 };
  simular(seg, reloj, [0, 0], [120, 0]);
  const e = simular(seg, reloj, [120, 0], [60, 0]);
  assert.strictEqual(tipos(e), 'sentido', JSON.stringify(e.map(x => x.texto)));
  assert.ok(/sentido contrario/.test(e[0].texto));
});
prueba('seguimiento: GPS malo desde el principio y aviso repetido cada 30 s', () => {
  const seg = R.crearSeguimiento(R.normalizarRuta(RESPUESTA_OSRM));
  const reloj = { t: 0 };
  const e = simular(seg, reloj, [0, 0], [60, 0], { precision: 45 });     // 43 lecturas = 43 s
  assert.strictEqual(tipos(e), 'gps,gps');
  assert.strictEqual(e[0].distanciaRestante, null);
  const e2 = simular(seg, reloj, [60, 0], [62, 0]);
  assert.strictEqual(e2[0].tipo, 'inicio');
  assert.ok(/^Ruta de 450 metros/.test(e2[0].texto));
});
prueba('seguimiento: maniobras muy seguidas se encadenan; opciones; entradas inválidas', () => {
  const j = JSON.parse(JSON.stringify(RESPUESTA_OSRM));
  // Calle B de solo 20 m: giro a la derecha y enseguida a la izquierda.
  const C2 = pt(200, 20), D2 = pt(300, 20), r = j.routes[0], s = r.legs[0].steps;
  r.geometry.coordinates = [A, B, C2, D2]; r.distance = 320;
  s[1].distance = 20; s[2].maneuver.location = C2; s[3].maneuver.location = D2;
  const seg = R.crearSeguimiento(R.normalizarRuta(j), { sinAvisoInicial: true });
  const reloj = { t: 0 };
  const ini = seg.actualizar({ lat: A[1], lon: A[0], tiempo: 0 });          // sin precisión ni rumbo
  assert.ok(!ini.texto.includes(R.AVISO_SEGURIDAD));
  const e = simular(seg, reloj, [0, 0], [200, 0]);
  const man = e[e.length - 1];
  assert.strictEqual(man.tipo, 'maniobra');
  assert.ok(/^Gira a la derecha por Calle B\. Si tienes que cruzar, comprueba antes el tráfico\. Enseguida, en \d+ metros, al final de la calle, gira a la izquierda por Calle C\.$/.test(man.texto), man.texto);
  const e2 = simular(seg, reloj, [200, 0], [200, 20]);
  assert.strictEqual(tipos(e2), 'maniobra', JSON.stringify(e2.map(x => x.texto)));   // sin preaviso repetido
  assert.strictEqual(seg.actualizar(null), null);
  assert.strictEqual(seg.actualizar({ lat: NaN, lon: 0 }), null);
  assert.throws(() => R.crearSeguimiento(null), e => e.codigo === 'parametros');
  assert.throws(() => R.crearSeguimiento({ pasos: [], geometria: [] }), e => e.codigo === 'parametros');
});

// ---------------------------------------------------------------- servicios con fetch falso
function respuesta(status, cuerpo) {
  return { ok: status >= 200 && status < 300, status, json: async () => { if (cuerpo === undefined) throw new Error('no es JSON'); return cuerpo; } };
}
function conFetch(fn, cuerpoPrueba) {
  return async () => {
    const llamadas = [];
    R.vaciarCache();
    R.config.intervaloMinimoMs = 0;
    R.config.fetch = async (url, init) => { llamadas.push({ url, init }); return fn(url, init, llamadas.length); };
    try { await cuerpoPrueba(llamadas); } finally { R.config.fetch = null; }
  };
}
const OVERPASS_OK = {
  version: 0.6, generator: 'Overpass API', osm3s: {},
  elements: [
    { type: 'node', id: 1, lat: LAT0 + 300 * M_LAT, lon: LON0, tags: { amenity: 'pharmacy', name: 'Farmacia Lejana' } },
    { type: 'way', id: 2, center: { lat: LAT0 + 100 * M_LAT, lon: LON0 }, nodes: [1, 2, 3], tags: { amenity: 'pharmacy', name: 'Farmacia Cercana', 'addr:street': 'Calle Mayor', 'addr:housenumber': '5' } },
    { type: 'node', id: 3, lat: LAT0 + 100.5 * M_LAT, lon: LON0, tags: { amenity: 'pharmacy', name: 'Farmacia Cercana' } },   // duplicado nodo+edificio
    { type: 'node', id: 4, lat: LAT0 - 200 * M_LAT, lon: LON0, tags: { amenity: 'pharmacy' } },
    { type: 'relation', id: 5, tags: { amenity: 'pharmacy', name: 'Sin coordenadas' } }
  ]
};
const FARMACIA = R.interpretar('llévame a la farmacia más cercana');

prueba('buscarCercanos: categoría con Overpass', conFetch(() => respuesta(200, OVERPASS_OK), async llamadas => {
  const l = await R.buscarCercanos(LAT0, LON0, FARMACIA);
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].url, 'https://overpass-api.de/api/interpreter');
  assert.strictEqual(llamadas[0].init.method, 'POST');
  assert.strictEqual(llamadas[0].init.body, 'data=' + encodeURIComponent(R.consultaOverpass(LAT0, LON0, ['amenity=pharmacy'], 500)));
  assert.deepStrictEqual(l.map(x => x.nombre), ['Farmacia Cercana', 'Farmacia sin nombre', 'Farmacia Lejana']);
  assert.deepStrictEqual(Object.keys(l[0]).sort(), ['direccion', 'distancia', 'lat', 'lon', 'nombre', 'sinNombre']);
  assert.strictEqual(l[0].distancia, 100); assert.strictEqual(l[0].direccion, 'Calle Mayor 5');
  assert.strictEqual(l[1].sinNombre, true);
  assert.strictEqual(R.fraseResultado(l[0]), 'Farmacia Cercana, a 100 metros en línea recta, en Calle Mayor 5.');
  await R.buscarCercanos(LAT0, LON0, FARMACIA);                         // repetida: sale de la caché
  assert.strictEqual(llamadas.length, 1);
}));
prueba('buscarCercanos: amplía el radio si no hay resultados', conFetch((u, init, n) =>
  respuesta(200, n < 3 ? { elements: [] } : OVERPASS_OK), async llamadas => {
  const l = await R.buscarCercanos(LAT0, LON0, FARMACIA, 400);
  assert.strictEqual(llamadas.length, 3);
  assert.deepStrictEqual(llamadas.map(c => /around%3A(\d+)/.exec(c.init.body)[1]), ['400', '1200', '3600']);
  assert.strictEqual(l.length, 3);
}));
prueba('buscarCercanos: lista vacía si no hay nada', conFetch(() => respuesta(200, { elements: [] }), async llamadas => {
  assert.deepStrictEqual(await R.buscarCercanos(LAT0, LON0, FARMACIA), []);
  assert.strictEqual(llamadas.length, 3);
}));
prueba('buscarCercanos: si falla un servidor Overpass prueba el siguiente', conFetch((u) =>
  u.includes('overpass-api.de') ? respuesta(429) : respuesta(200, OVERPASS_OK), async llamadas => {
  const l = await R.buscarCercanos(LAT0, LON0, FARMACIA);
  assert.strictEqual(l.length, 3);
  assert.deepStrictEqual(llamadas.map(c => c.url), ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']);
}));
prueba('buscarCercanos: errores claros (saturado, red, formato, parámetros)', async () => {
  await conFetch(() => respuesta(429), async () => {
    await assert.rejects(R.buscarCercanos(LAT0, LON0, FARMACIA), e => e.codigo === 'limite' && /saturado/.test(e.message));
  })();
  await conFetch(() => { throw new TypeError('Failed to fetch'); }, async () => {
    await assert.rejects(R.buscarCercanos(LAT0, LON0, FARMACIA), e => e.codigo === 'red' && /conexión/.test(e.message));
  })();
  await conFetch(() => respuesta(200, { remark: 'sin elements' }), async () => {
    await assert.rejects(R.buscarCercanos(LAT0, LON0, FARMACIA), e => e.codigo === 'formato');
  })();
  await conFetch(() => respuesta(200, undefined), async () => {
    await assert.rejects(R.buscarCercanos(LAT0, LON0, FARMACIA), e => e.codigo === 'formato');
  })();
  await conFetch(() => respuesta(200, OVERPASS_OK), async llamadas => {
    await assert.rejects(R.buscarCercanos(NaN, LON0, FARMACIA), e => e.codigo === 'parametros');
    await assert.rejects(R.buscarCercanos(LAT0, LON0, R.interpretar('hola')), e => e.codigo === 'parametros');
    R.config.overpass.activo = false;
    try { await assert.rejects(R.buscarCercanos(LAT0, LON0, FARMACIA), e => e.codigo === 'desactivado'); }
    finally { R.config.overpass.activo = true; }
    assert.strictEqual(llamadas.length, 0);
  })();
});
prueba('buscarCercanos: tiempo de espera agotado', async () => {
  const antes = R.config.overpass.esperaMs, urls = R.config.overpass.urls;
  R.config.overpass.esperaMs = 40; R.config.overpass.urls = [urls[0]];
  try {
    await conFetch(() => new Promise(() => {}), async () => {
      await assert.rejects(R.buscarCercanos(LAT0, LON0, FARMACIA), e => e.codigo === 'tiempo' && /tarda demasiado/.test(e.message));
    })();
  } finally { R.config.overpass.esperaMs = antes; R.config.overpass.urls = urls; }
});
const NOMINATIM_OK = [
  { place_id: 1, licence: 'x', osm_type: 'way', osm_id: 9, lat: String(LAT0 + 900 * M_LAT), lon: String(LON0), category: 'amenity', type: 'bar',
    place_rank: 30, importance: 0.1, addresstype: 'amenity', name: 'Bar Pepe', display_name: 'Bar Pepe, Calle Lejos, Castellón de la Plana, España',
    address: { amenity: 'Bar Pepe', road: 'Calle Lejos', city: 'Castellón de la Plana' }, boundingbox: ['1', '2', '3', '4'] },
  { place_id: 2, licence: 'x', osm_type: 'node', osm_id: 8, lat: String(LAT0 + 250 * M_LAT), lon: String(LON0), category: 'amenity', type: 'bar',
    place_rank: 30, importance: 0.1, addresstype: 'amenity', name: 'Bar Pepe', display_name: 'Bar Pepe, 12, Calle Enmedio, Castellón de la Plana, España',
    address: { amenity: 'Bar Pepe', road: 'Calle Enmedio', house_number: '12', city: 'Castellón de la Plana' }, boundingbox: ['1', '2', '3', '4'] }
];
prueba('buscarCercanos: nombre con Nominatim, acotado a la zona', conFetch((u) =>
  respuesta(200, /viewbox/.test(u) && !u.includes('ninguno') ? NOMINATIM_OK : []), async llamadas => {
  const l = await R.buscarCercanos(LAT0, LON0, R.interpretar('llévame al bar Pepe'));
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].url, R.urlNominatim(LAT0, LON0, 'bar Pepe', 2000));
  assert.ok(!llamadas[0].init.method || llamadas[0].init.method === 'GET');
  assert.deepStrictEqual(l.map(x => x.distancia), [250, 900]);
  assert.strictEqual(l[0].direccion, 'Calle Enmedio 12, Castellón de la Plana');
  assert.strictEqual(l[0].lat, LAT0 + 250 * M_LAT);
  const vacia = await R.buscarCercanos(LAT0, LON0, R.interpretar('llévame a la calle ninguno'));
  assert.deepStrictEqual(vacia, []);
  assert.strictEqual(llamadas.length, 4);                              // 2 km, 6 km y 18 km: siempre con recuadro
  assert.ok(llamadas.every(c => /&bounded=1$/.test(c.url)));
}));
prueba('calcularRuta: petición y normalización', conFetch(() => respuesta(200, RESPUESTA_OSRM), async llamadas => {
  const r = await R.calcularRuta({ lat: A[1], lon: A[0] }, { lat: D[1], lon: D[0] });
  assert.strictEqual(llamadas[0].url, R.urlRuta({ lat: A[1], lon: A[0] }, { lat: D[1], lon: D[0] }));
  assert.deepStrictEqual(Object.keys(r).sort(), ['distanciaTotal', 'duracion', 'geometria', 'pasos', 'separacionDestino', 'separacionOrigen']);
  assert.strictEqual(r.pasos.length, 4);
  await assert.rejects(R.calcularRuta({ lat: 1 }, { lat: 2, lon: 3 }), e => e.codigo === 'parametros');
}));
prueba('calcularRuta: sin ruta (HTTP 400 con code NoRoute) y servidor caído', async () => {
  await conFetch(() => respuesta(400, { code: 'NoRoute', message: 'Impossible route between points' }), async () => {
    await assert.rejects(R.calcularRuta({ lat: A[1], lon: A[0] }, { lat: D[1], lon: D[0] }), e => e.codigo === 'sin_ruta' && /camino a pie/.test(e.message));
  })();
  await conFetch(() => respuesta(502), async () => {
    await assert.rejects(R.calcularRuta({ lat: A[1], lon: A[0] }, { lat: D[1], lon: D[0] }), e => e.codigo === 'servidor');
  })();
});
prueba('respeta la separación mínima entre llamadas al mismo servicio', conFetch(() => respuesta(200, RESPUESTA_OSRM), async () => {
  R.config.intervaloMinimoMs = 120;
  const t0 = Date.now();
  await R.calcularRuta({ lat: A[1], lon: A[0] }, { lat: D[1], lon: D[0] });
  await R.calcularRuta({ lat: A[1], lon: A[0] }, { lat: D[1], lon: D[0] });
  assert.ok(Date.now() - t0 >= 110, String(Date.now() - t0));
  R.config.intervaloMinimoMs = 0;
}));

// ---------------------------------------------------------------- ejecución
(async () => {
  let fallos = 0;
  for (const p of lista) {
    try { await p.fn(); console.log('  ok  ' + p.nombre); }
    catch (e) { fallos++; console.log('FALLO ' + p.nombre + '\n      ' + (e && e.message)); }
  }
  console.log('\n' + (lista.length - fallos) + ' de ' + lista.length + ' pruebas correctas.');
  if (fallos) { console.log(fallos + ' con fallos.'); process.exit(1); }
})();

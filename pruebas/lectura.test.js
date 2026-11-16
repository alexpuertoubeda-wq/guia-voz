/*
 * Pruebas del lector de textos de Paso Firme (lectura.js).
 *
 *   node pruebas/lectura.test.js
 *
 * Parte 1: funciones puras (texto y calidad de imagen). No necesita nada más.
 * Parte 2: reconocimiento real de extremo a extremo con Tesseract.js y los
 *          datos de idioma de ocr/. Necesita:
 *            - python3 con Pillow y NumPy (genera las imágenes de prueba);
 *            - el paquete tesseract.js instalado FUERA del repositorio, p. ej.:
 *                mkdir -p /tmp/ocrw && cd /tmp/ocrw && npm i tesseract.js@7.0.0 tesseract.js-core@7.0.0
 *              y, si no está en /tmp/ocrw, indicar dónde:
 *                PF_NODE_MODULES=/ruta/node_modules node pruebas/lectura.test.js
 *          Con PF_SIN_OCR=1 se salta la parte 2 (queda anotado como OMITIDA).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const L = require(path.join(RAIZ, 'lectura.js'));

let hechas = 0, fallos = 0;
const pendientes = [];
function prueba(nombre, fn) { pendientes.push({ nombre, fn }); }
async function ejecutar() {
  for (const p of pendientes) {
    try { await p.fn(); hechas++; console.log('  bien  ' + p.nombre); }
    catch (e) { fallos++; console.log('  FALLO ' + p.nombre + '\n        ' + String(e && e.message || e).split('\n').join('\n        ')); }
  }
  pendientes.length = 0;
}

// ---------------------------------------------------------------- utilidades
function gris(ancho, alto, f) {
  const d = new Uint8Array(ancho * alto);
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) d[y * ancho + x] = f(x, y);
  return { data: d, width: ancho, height: alto };
}
function azar(semilla) { let s = semilla >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const palabrasDe = (t) => t.split(/\s+/).filter(Boolean);

// Distancia de edición entre dos listas (palabras) o dos cadenas (caracteres).
function distancia(a, b) {
  let previa = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) previa[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previa = fila;
  }
  return previa[b.length];
}
// Tasa de acierto por palabras: 1 - (sustituciones + omisiones + inserciones) / palabras reales.
// Comparación estricta: cuentan mayúsculas, tildes, eñes y signos de puntuación.
function aciertoPalabras(real, leido) {
  const r = palabrasDe(real), l = palabrasDe(leido);
  return Math.max(0, 1 - distancia(r, l) / r.length);
}
function aciertoCaracteres(real, leido) {
  const r = palabrasDe(real).join(' '), l = palabrasDe(leido).join(' ');
  return Math.max(0, 1 - distancia(r, l) / r.length);
}
const pct = (x) => (100 * x).toFixed(1) + ' %';

// =============================================================== PARTE 1
function parte1() {
  console.log('\nParte 1 · funciones puras');

  // ---- limpiar
  prueba('limpiar: une palabras partidas con guion a final de línea', () => {
    assert.strictEqual(L.limpiar('las asocia-\nciones vecinales'), 'las asociaciones vecinales');
    assert.strictEqual(L.limpiar('la ofi-\ncina de turismo'), 'la oficina de turismo');
    assert.strictEqual(L.limpiar('una peti-  \n  ción'), 'una petición');
  });
  prueba('limpiar: conserva el guion ante mayúscula o cifra', () => {
    assert.strictEqual(L.limpiar('Castilla-\nLa Mancha'), 'Castilla-La Mancha');
    assert.strictEqual(L.limpiar('el A-\n7 está cortada'), 'el A-7 está cortada');
  });
  prueba('limpiar: une las líneas de un párrafo y conserva los párrafos', () => {
    const t = 'Primera línea del\npárrafo uno.\n\nSegundo párrafo,\nque sigue aquí.';
    assert.strictEqual(L.limpiar(t), 'Primera línea del párrafo uno.\n\nSegundo párrafo, que sigue aquí.');
  });
  prueba('limpiar: quita líneas de símbolos sueltos y símbolos aislados', () => {
    const t = '| _ ~ —\nEl niño comió | paella.\n.. ,, ;;\n=====\ni l I 1 |\nxq\nFin del texto.';
    assert.strictEqual(L.limpiar(t), 'El niño comió paella. Fin del texto.');
  });
  prueba('limpiar: no borra líneas cortas legítimas (números, palabras cortas)', () => {
    assert.strictEqual(L.limpiar('Página\n12'), 'Página 12');
    assert.strictEqual(L.limpiar('¿Vienes?\n\nNo.'), '¿Vienes?\n\nNo.');
    assert.strictEqual(L.limpiar('WC'), '');           // dos letras sueltas se tratan como ruido (límite conocido)
    assert.strictEqual(L.limpiar('BAR'), 'BAR');
  });
  prueba('limpiar: punto y aparte sin línea en blanco (línea corta que acaba frase)', () => {
    const t = [
      'El primer párrafo ocupa varias líneas de un ancho',
      'parecido, como en cualquier columna de periódico,',
      'y termina aquí.',
      'El segundo párrafo empieza en la línea siguiente',
      'y también ocupa más de una línea completa.'
    ].join('\n');
    assert.deepStrictEqual(L.limpiar(t).split('\n\n').length, 2);
  });
  prueba('limpiar: espacios, tildes descompuestas y signos', () => {
    assert.strictEqual(L.limpiar('  Hola ,   mundo .  ¿ Qué tal ?  '), 'Hola, mundo. ¿Qué tal?');
    assert.strictEqual(L.limpiar('canción y año'), 'canción y año');
    assert.strictEqual(L.limpiar('uno\r\ndos\r\n\r\ntres'), 'uno dos\n\ntres');
  });
  prueba('limpiar: entradas vacías o no válidas', () => {
    assert.strictEqual(L.limpiar(''), '');
    assert.strictEqual(L.limpiar(null), '');
    assert.strictEqual(L.limpiar(undefined), '');
    assert.strictEqual(L.limpiar('\n\n  \n'), '');
  });
  prueba('limpiar: es pura e idempotente', () => {
    const t = 'Las asocia-\nciones | piden\nmás luz.\n\n~~~\nOtro párrafo.';
    const una = L.limpiar(t);
    assert.strictEqual(L.limpiar(t), una);
    assert.strictEqual(L.limpiar(una), una);
  });
  prueba('esBasura: clasifica líneas', () => {
    for (const s of ['|||', '— — —', '.,;', 'i l I 1 l', '~~ a ~~ __', 'xq']) assert.strictEqual(L.esBasura(s), true, s);
    for (const s of ['El niño', '2024', 'Sí.', 'FARMACIA', '340.000 euros', 'y', '«No»']) assert.strictEqual(L.esBasura(s), false, s);
  });

  // ---- trocear
  const comprobarTrozos = (texto, max) => {
    const trozos = L.trocear(texto, max);
    assert.deepStrictEqual(palabrasDe(trozos.join(' ')), palabrasDe(texto), 'los trozos unidos deben dar el texto original');
    for (const t of trozos) {
      assert.ok(t.length > 0 && t === t.trim(), 'trozo vacío o con espacios sobrantes');
      const palabraLarga = palabrasDe(t).some((p) => p.length > max);
      assert.ok(t.length <= max || palabraLarga, `trozo de ${t.length} caracteres supera el máximo ${max}: «${t}»`);
    }
    return trozos;
  };
  prueba('trocear: corta por frases y no supera el máximo', () => {
    const t = 'Primera frase corta. Segunda frase, algo más larga que la primera. ¿Y la tercera? ¡Aquí está!';
    assert.deepStrictEqual(comprobarTrozos(t, 40), [
      'Primera frase corta.', 'Segunda frase, algo más larga que la', 'primera. ¿Y la tercera? ¡Aquí está!'
    ]);
    assert.deepStrictEqual(comprobarTrozos(t, 200), [t]);
  });
  prueba('trocear: los párrafos van en trozos distintos', () => {
    assert.deepStrictEqual(L.trocear('Titular sin punto\n\nCuerpo de la noticia.', 200), ['Titular sin punto', 'Cuerpo de la noticia.']);
  });
  prueba('trocear: frase larga, corta mejor tras una coma y nunca dentro de una palabra', () => {
    const t = 'Los vecinos del barrio antiguo, que llevaban años esperando, celebraron ayer la reapertura de la biblioteca municipal con una fiesta en la plaza';
    const trozos = comprobarTrozos(t, 70);
    assert.ok(trozos.length >= 2);
    assert.ok(/,$/.test(trozos[0]), 'el primer corte debería caer tras una coma: «' + trozos[0] + '»');
  });
  prueba('trocear: no corta tras abreviaturas ni iniciales', () => {
    assert.deepStrictEqual(L.trocear('El Sr. García y la Dra. Ruiz llegaron. Luego se fueron.', 45),
      ['El Sr. García y la Dra. Ruiz llegaron.', 'Luego se fueron.']);
    assert.deepStrictEqual(L.trocear('Lo dijo J. R. Jiménez. Era verdad.', 25), ['Lo dijo J. R. Jiménez.', 'Era verdad.']);
  });
  prueba('trocear: una palabra más larga que el máximo se parte solo en ese caso', () => {
    const larga = 'x'.repeat(95);
    const trozos = L.trocear('antes ' + larga + ' después', 40);
    assert.strictEqual(trozos.join(' ').replace(/ /g, ''), 'antes' + larga + 'después');
    assert.strictEqual(trozos[0], 'antes');
    assert.ok(trozos.every((t) => t.length <= 40));
  });
  prueba('trocear: valores límite', () => {
    assert.deepStrictEqual(L.trocear('', 100), []);
    assert.deepStrictEqual(L.trocear('   \n\n  ', 100), []);
    assert.deepStrictEqual(L.trocear(null, 100), []);
    assert.deepStrictEqual(L.trocear('Hola.'), ['Hola.']);                 // máximo por defecto
    assert.ok(L.trocear('uno dos tres cuatro cinco seis siete ocho', 5).every((t) => t.length <= 20)); // máximo mínimo: 20
  });
  prueba('trocear: propiedad con 300 textos aleatorios (no pierde ni corta palabras)', () => {
    const r = azar(12345);
    const voc = ['el', 'niño', 'comió', 'paella,', 'años.', '¿Qué?', 'cigüeña', 'a', 'ayuntamiento;', 'Sr.', 'sí:', 'extraordinariamente', '«no»', '340.000', 'euros.', '¡Ya!', 'y'];
    for (let n = 0; n < 300; n++) {
      const largo = 1 + Math.floor(r() * 120);
      let t = '';
      for (let i = 0; i < largo; i++) t += voc[Math.floor(r() * voc.length)] + (r() < 0.04 ? '\n\n' : ' ');
      comprobarTrozos(t, 20 + Math.floor(r() * 230));
    }
  });

  // ---- calidad de imagen
  prueba('aGrises: convierte RGBA y respeta una imagen ya en gris', () => {
    const rgba = { data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]), width: 2, height: 2 };
    const g = L.aGrises(rgba);
    assert.deepStrictEqual(Array.from(g.datos), [255, 0, 76, 149]);
    const ya = gris(3, 2, () => 7);
    assert.strictEqual(L.aGrises(ya).datos, ya.data);
  });
  prueba('brilloMedio, contraste y fraccionClara', () => {
    const plano = L.aGrises(gris(40, 30, () => 100));
    assert.strictEqual(L.brilloMedio(plano), 100);
    assert.strictEqual(L.contraste(plano), 0);
    const mitad = L.aGrises(gris(40, 30, (x) => (x < 20 ? 0 : 255)));
    assert.strictEqual(L.brilloMedio(mitad), 127.5);
    assert.strictEqual(L.contraste(mitad), 127.5);
    assert.strictEqual(L.fraccionClara(mitad, 253), 0.5);
    assert.strictEqual(L.brilloMedio({ datos: new Uint8Array(0), ancho: 0, alto: 0 }), 0);
  });
  prueba('nitidez: laplaciano nulo en imagen lisa y en rampa; alto en damero', () => {
    assert.strictEqual(L.nitidez(L.aGrises(gris(50, 50, () => 90))), 0);
    assert.strictEqual(L.nitidez(L.aGrises(gris(50, 50, (x) => x * 3))), 0);
    const damero = L.nitidez(L.aGrises(gris(50, 50, (x, y) => ((x + y) % 2 ? 255 : 0))));
    assert.ok(damero > 100000, 'damero: ' + damero);
    assert.strictEqual(L.nitidez(L.aGrises(gris(2, 2, () => 9))), 0);
  });
  prueba('nitidezDireccional: detecta el movimiento que el laplaciano no ve', () => {
    // Texto simulado: bloques oscuros de 3x5 sobre blanco.
    const nitida = gris(240, 180, (x, y) => ((x % 8 < 3 && y % 12 < 5) ? 20 : 235));
    // La misma imagen "movida" en horizontal: media de 16 píxeles vecinos.
    const movida = gris(240, 180, (x, y) => {
      let s = 0; for (let d = -8; d < 8; d++) { const xx = (x + d + 240) % 240; s += (xx % 8 < 3 && y % 12 < 5) ? 20 : 235; }
      return Math.round(s / 16);
    });
    const a = L.medirCalidad(nitida), b = L.medirCalidad(movida);
    // La nítida debe quedar muy por encima del umbral de imagen movida (al menos 5 veces).
    assert.ok(a.nitidezMinima > L.UMBRALES.nitidezMovida * 5, 'nítida: ' + a.nitidezMinima);
    assert.ok(b.nitidezMinima < L.UMBRALES.nitidezMovida, 'movida: ' + b.nitidezMinima);
    assert.ok(b.nitidez > 500, 'el laplaciano sigue alto en la movida: ' + b.nitidez);
    // Texto solo en una esquina: la nitidez la da la zona con texto, no el margen vacío.
    const esquina = gris(240, 180, (x, y) => ((x < 120 && y < 90 && x % 8 < 3 && y % 12 < 5) ? 20 : 235));
    assert.ok(L.medirCalidad(esquina).nitidezMinima > L.UMBRALES.nitidezMovida * 5);
    assert.strictEqual(L.nitidezDireccional(L.aGrises(gris(2, 2, () => 1))), 0);
  });
  prueba('textoCortado: líneas que tocan un borde lateral', () => {
    const W = 1000, H = 800;
    const dentro = [{ x0: 80, y0: 50, x1: 900, y1: 80 }, { x0: 80, y0: 90, x1: 910, y1: 120 }, { x0: 80, y0: 130, x1: 600, y1: 160 }];
    assert.strictEqual(L.textoCortado(dentro, W, H), false);
    const izquierda = dentro.map((c) => Object.assign({}, c, { x0: 2 }));
    assert.strictEqual(L.textoCortado(izquierda, W, H), true);
    const derecha = dentro.map((c, i) => Object.assign({}, c, { x1: i < 2 ? 998 : c.x1 }));
    assert.strictEqual(L.textoCortado(derecha, W, H), true);
    const soloUna = dentro.concat([{ x0: 0, y0: 300, x1: 400, y1: 330 }, { x0: 80, y0: 350, x1: 400, y1: 380 }, { x0: 80, y0: 390, x1: 400, y1: 420 }]);
    assert.strictEqual(L.textoCortado(soloUna, W, H), false, 'una sola línea de seis no basta');
    assert.strictEqual(L.textoCortado([{ x0: 0, y0: 10, x1: 500, y1: 60 }], W, H), true, 'cartel de una línea cortado');
    assert.strictEqual(L.textoCortado([], W, H), false);
    assert.strictEqual(L.textoCortado(null, W, H), false);
  });
  prueba('diagnosticar: elige el aviso con criterios medibles', () => {
    const A = L.AVISOS;
    const buena = { brillo: 200, contraste: 40, quemado: 0, nitidez: 2000, nitidezMinima: 900 };
    const oscura = Object.assign({}, buena, { brillo: 25 });
    const movida = Object.assign({}, buena, { nitidezMinima: 10 });
    const quemada = Object.assign({}, buena, { brillo: 252, quemado: 0.9 });
    const d = (letras, confianza, calidad, cortado) => L.diagnosticar({ letras, confianza, calidad, cortado: !!cortado });
    assert.strictEqual(d(500, 93, buena), null);
    assert.strictEqual(d(500, 93, buena, true), A.cortado);
    assert.strictEqual(d(500, 93, oscura), null, 'si se lee muy bien, no se molesta aunque haya poca luz');
    assert.strictEqual(d(500, 85, oscura), A.pocaLuz, 'leído con dudas y a oscuras: se avisa');
    assert.strictEqual(d(500, 85, movida), A.movida);
    assert.strictEqual(d(500, 85, buena), null);
    assert.strictEqual(d(0, 0, buena), A.sinTexto);
    assert.strictEqual(d(0, 0, null), A.sinTexto);
    assert.strictEqual(d(0, 0, oscura), A.pocaLuz);
    assert.strictEqual(d(200, 40, oscura), A.pocaLuz);
    assert.strictEqual(d(200, 40, movida), A.movida);
    assert.strictEqual(d(0, 0, movida), A.movida);
    assert.strictEqual(d(0, 0, quemada), A.muchaLuz);
    assert.strictEqual(d(200, 40, buena), A.dudoso);
    assert.strictEqual(d(200, 40, buena, true), A.cortado);
    assert.strictEqual(d(3, 99, buena), A.sinTexto, 'menos de cuatro letras no es un texto');
    // Una pared lisa no está "movida": no hay contraste suficiente para afirmarlo.
    assert.strictEqual(d(0, 0, Object.assign({}, buena, { contraste: 5, nitidezMinima: 1 })), A.sinTexto);
    for (const k of Object.keys(A)) assert.ok(/^[A-ZÁÉÍÓÚÑ¿¡].*\.$/.test(A[k]), 'aviso mal escrito: ' + A[k]);
  });
  prueba('resumirBloques: texto, confianza de todas las palabras y cajas', () => {
    const w = (text, confidence) => ({ text, confidence, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } });
    const bloques = [{ paragraphs: [
      { lines: [
        { words: [w('Hola', 90), w('mundo', 80), w('~~', 10)], bbox: { x0: 10, y0: 10, x1: 200, y1: 30 } },
        { words: [w('|', 5)], bbox: { x0: 0, y0: 40, x1: 5, y1: 60 } }
      ] },
      { lines: [{ words: [w('adiós', 20), w('Fin.', 95)], bbox: { x0: 10, y0: 80, x1: 200, y1: 100 } }] }
    ] }];
    const r = L.resumirBloques(bloques);
    assert.strictEqual(r.bruto, 'Hola mundo\n\nFin.');
    assert.strictEqual(r.letras, 12);
    assert.strictEqual(r.palabras, 3);
    assert.strictEqual(r.palabrasVistas, 4);
    // (90*4 + 80*5 + 20*5 + 95*3) / 17
    assert.ok(Math.abs(r.confianza - 1145 / 17) < 1e-9, String(r.confianza));
    assert.strictEqual(r.cajas.length, 2);
    const vacio = L.resumirBloques(null);
    assert.deepStrictEqual([vacio.bruto, vacio.confianza, vacio.letras], ['', 0, 0]);
  });
}

// =============================================================== PARTE 2
function buscarTesseract() {
  const sitios = [process.env.PF_NODE_MODULES, '/tmp/ocrw/node_modules', path.join(RAIZ, 'node_modules')].filter(Boolean);
  for (const s of sitios) {
    try {
      const ruta = require.resolve('tesseract.js', { paths: [s, path.dirname(s)] });
      const pkg = (m) => JSON.parse(fs.readFileSync(require.resolve(m + '/package.json', { paths: [s, path.dirname(s)] }), 'utf8')).version;
      return { modulo: require(ruta), version: pkg('tesseract.js'), nucleo: pkg('tesseract.js-core') };
    } catch (e) { /* siguiente */ }
  }
  return null;
}

async function parte2() {
  console.log('\nParte 2 · reconocimiento real (Tesseract.js + ocr/spa.traineddata.gz)');
  if (process.env.PF_SIN_OCR === '1') { console.log('  OMITIDA (PF_SIN_OCR=1)'); return; }

  const T = buscarTesseract();
  if (!T) {
    fallos++;
    console.log('  FALLO no encuentro el paquete tesseract.js. Instálalo fuera del repositorio:\n' +
      '        mkdir -p /tmp/ocrw && cd /tmp/ocrw && npm i tesseract.js@7.0.0 tesseract.js-core@7.0.0');
    return;
  }
  const datos = path.join(RAIZ, 'ocr', 'spa.traineddata.gz');
  if (!fs.existsSync(datos)) { fallos++; console.log('  FALLO falta ' + datos); return; }

  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-lectura-'));
  const gen = spawnSync('python3', [path.join(__dirname, 'genera_imagenes.py'), carpeta], { encoding: 'utf8' });
  if (gen.status !== 0) { fallos++; console.log('  FALLO no se pudieron generar las imágenes con Python:\n' + (gen.stderr || gen.error)); return; }
  const casos = JSON.parse(fs.readFileSync(path.join(carpeta, 'casos.json'), 'utf8'));
  console.log(`  tesseract.js ${T.version}, tesseract.js-core ${T.nucleo}, datos ${(fs.statSync(datos).size / 1048576).toFixed(2)} MB`);

  // cacheMethod 'none': no deja copias del idioma en el directorio de trabajo.
  await L.preparar(null, { tesseract: T.modulo, langPath: path.join(RAIZ, 'ocr'), cacheMethod: 'none' });

  const resultados = {};
  const leerCaso = async (nombre) => {
    if (resultados[nombre]) return resultados[nombre];
    const c = casos[nombre];
    const archivo = path.join(carpeta, c.archivo);
    const pix = new Uint8Array(fs.readFileSync(path.join(carpeta, c.gris)));
    const girar = async (grados) => {
      const salida = path.join(carpeta, `${nombre}_girada_${grados}.png`);
      const g = spawnSync('python3', ['-c', 'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).rotate(int(sys.argv[2]), expand=True).save(sys.argv[3])', archivo, String(grados), salida]);
      if (g.status !== 0) throw new Error('no se pudo girar la imagen');
      return salida;
    };
    const r = await L.leer(archivo, { imageData: { data: pix, width: c.gris_ancho, height: c.gris_alto }, ancho: c.ancho, alto: c.alto, girar });
    r.palabras = aciertoPalabras(c.texto, r.texto);
    r.caracteres = aciertoCaracteres(c.texto, r.texto);
    resultados[nombre] = r;
    return r;
  };

  const legible = (nombre, minimo, extra) => prueba(`${nombre}: se lee con acierto por palabras ≥ ${pct(minimo)}`, async () => {
    const r = await leerCaso(nombre);
    assert.ok(r.palabras >= minimo, `acierto ${pct(r.palabras)} (confianza ${r.confianza}): «${r.texto.slice(0, 200)}»`);
    assert.ok(r.confianza >= L.UMBRALES.confianzaBuena);
    if (extra) extra(r, casos[nombre]);
  });
  const sinAviso = (r) => assert.strictEqual(r.aviso, null);

  legible('periodico', 0.97, (r, c) => {
    sinAviso(r);
    assert.strictEqual(r.texto.split('\n\n').length, 4, 'titular y tres párrafos');
    assert.ok(!/-\s/.test(r.texto), 'no deben quedar guiones de corte de línea');
    for (const p of ['amplía', 'concejalía', 'años', 'señor', 'Ibáñez', 'niños', '¿Qué', 'asociaciones']) assert.ok(r.texto.includes(p), 'falta «' + p + '»');
    assert.ok(L.trocear(r.texto, 200).every((t) => t.length <= 200));
  });
  legible('columnas', 0.97, (r, c) => {
    sinAviso(r);
    // Orden de lectura: toda la columna izquierda antes que la derecha.
    const i1 = r.texto.indexOf('ratón de campo'), i2 = r.texto.indexOf('El próximo sábado');
    assert.ok(i1 > 0 && i2 > i1, 'las columnas se han mezclado');
    assert.ok(r.texto.includes('oficina'), 'falta unir «ofi-cina»');
  });
  legible('foto', 0.95, sinAviso);
  legible('pequena', 0.95, sinAviso);
  // Poca luz y ruido: se lee solo en parte; se entrega el texto y además el aviso.
  legible('oscura', 0.75, (r) => assert.strictEqual(r.aviso, L.AVISOS.pocaLuz));
  legible('cartel', 0.99, (r) => { sinAviso(r); assert.ok(r.texto.startsWith('FARMACIA')); });
  legible('girada180', 0.97, (r) => { sinAviso(r); assert.strictEqual(r.giro, 180); });
  legible('girada90', 0.97, sinAviso);

  const conAviso = (nombre, clave) => prueba(`${nombre}: aviso «${L.AVISOS[clave]}»`, async () => {
    const r = await leerCaso(nombre);
    assert.strictEqual(r.aviso, L.AVISOS[clave], `confianza ${r.confianza}, calidad ${JSON.stringify(r.calidad)}`);
    if (clave === 'cortado') assert.ok(r.texto.length > 100, 'el texto cortado se entrega igualmente');
    else assert.strictEqual(r.texto, '', 'no debe leerse en voz un texto no fiable');
  });
  conAviso('blanca', 'sinTexto');
  conAviso('negra', 'pocaLuz');
  conAviso('quemada', 'muchaLuz');
  conAviso('movida', 'movida');
  conAviso('movida_vertical', 'movida');
  conAviso('movida_ruido', 'movida');
  conAviso('desenfocada', 'movida');
  conAviso('lejana', 'dudoso');
  conAviso('cortada', 'cortado');

  prueba('leer: una segunda llamada simultánea avisa de que está ocupado', async () => {
    const c = casos.cartel, archivo = path.join(carpeta, c.archivo);
    const [a, b] = await Promise.all([L.leer(archivo), L.leer(archivo)]);
    assert.ok(a.texto.includes('FARMACIA'));
    assert.strictEqual(b.aviso, L.AVISOS.ocupado);
    const despues = await L.leer(archivo);
    assert.ok(despues.texto.includes('FARMACIA'), 'tras terminar, vuelve a leer');
  });
  prueba('preparar: avisa del progreso en español y se puede repetir tras liberar', async () => {
    await L.liberar();
    const fases = [];
    await L.preparar((p) => fases.push(p), { tesseract: T.modulo, langPath: path.join(RAIZ, 'ocr'), cacheMethod: 'none' });
    assert.ok(fases.length > 0 && fases.every((f) => typeof f.mensaje === 'string' && f.progreso >= 0 && f.progreso <= 1));
    assert.ok(fases.some((f) => f.mensaje === 'Cargando el idioma español'));
    const r = await L.leer(path.join(carpeta, casos.cartel.archivo));
    assert.ok(r.texto.includes('FARMACIA'));
  });

  await ejecutar();
  await L.liberar();

  console.log('\n  Resultados medidos (comparación estricta con el texto verdadero):');
  console.log('  ' + 'caso'.padEnd(17) + 'palabras'.padStart(9) + 'caracteres'.padStart(12) + '  conf  giro    ms  aviso');
  for (const n of Object.keys(casos)) {
    const r = resultados[n]; if (!r) continue;
    const vacio = !casos[n].texto;
    console.log('  ' + n.padEnd(17) + (vacio ? '—' : pct(r.palabras)).padStart(9) + (vacio ? '—' : pct(r.caracteres)).padStart(12) +
      String(r.confianza).padStart(6) + String(r.giro).padStart(6) + String(r.ms).padStart(6) + '  ' + (r.aviso || '—'));
  }
  if (!process.env.PF_CONSERVAR) fs.rmSync(carpeta, { recursive: true, force: true });
  else console.log('  Imágenes conservadas en ' + carpeta);
}

(async () => {
  parte1();
  await ejecutar();
  await parte2();
  console.log(`\n${hechas} pruebas bien, ${fallos} con fallo.`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

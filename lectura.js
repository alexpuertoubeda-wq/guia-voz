/*
 * Paso Firme · lectura.js
 * Lector de textos: reconoce en el propio móvil (sin servidor) el texto en
 * español de un fotograma de la cámara y lo prepara para leerlo en voz alta.
 *
 * Script clásico: define window.PFLectura. En Node exporta lo mismo con
 * module.exports para las pruebas (pruebas/lectura.test.js).
 *
 * Motor: Tesseract.js, alojado en la carpeta ocr/ del propio sitio.
 * Documentación y límites: LECTURA.md
 */
(function (raiz) {
  'use strict';

  // ------------------------------------------------------------------
  // Umbrales (medibles y ajustables con PFLectura.configurar)
  // ------------------------------------------------------------------
  var UMBRALES = {
    brilloOscuro: 60,        // brillo medio (0-255) por debajo del cual "hay poca luz"
    brilloNegro: 20,         // por debajo de esto ni se intenta leer
    nivelQuemado: 253,       // gris a partir del cual un píxel se considera quemado (blanco sin detalle)
    fraccionQuemada: 0.5,    // fracción de píxeles quemados a partir de la cual "hay demasiada luz"
    nitidezMovida: 35,       // nitidez direccional mínima por debajo de la cual la imagen está movida o desenfocada
    contrasteMovida: 12,     // contraste mínimo para poder afirmar que está movida (si no, es que no hay nada)
    contrastePlano: 3,       // desviación típica del gris por debajo de la cual no hay nada que leer
    confianzaPalabra: 30,    // se descartan las palabras con menos confianza (0-100)
    confianzaBuena: 70,      // confianza media mínima (de todas las palabras) para dar la lectura por buena
    confianzaExcelente: 90,  // por encima de esto no se avisa de poca luz o imagen movida aunque se midan
    letrasMinimas: 4,        // letras o cifras mínimas para considerar que hay texto
    margenBorde: 0.006,      // fracción del lado: una línea "toca el borde" si llega a esta distancia
    fraccionCortada: 0.3     // fracción de líneas tocando un borde lateral para avisar de texto cortado
  };

  var AVISOS = {
    sinTexto: 'No veo texto. Acerca el móvil al papel.',
    pocaLuz: 'Hay poca luz. Busca un sitio más iluminado.',
    muchaLuz: 'Hay demasiada luz o un reflejo. Inclina un poco el papel.',
    movida: 'La imagen está movida. Mantén el móvil quieto.',
    cortado: 'El texto está cortado por el borde. Aleja un poco el móvil.',
    dudoso: 'No lo leo bien. Acerca el móvil al papel y mantenlo quieto.',
    ocupado: 'Todavía estoy leyendo. Espera un momento.',
    sinImagen: 'La cámara todavía no está lista.'
  };

  var CONFIG = {
    rutaOcr: null,          // carpeta con los archivos del motor; por defecto, "ocr/" junto a este script
    idioma: 'spa',
    ladoMaximo: 2200,       // el fotograma se reduce si su lado mayor supera esto (memoria del móvil)
    ladoCalidad: 1000,      // lado mayor de la copia reducida con la que se mide la calidad de imagen
    ladoDeseado: 1600,      // los fotogramas pequeños se amplían hasta aquí (como mucho al doble)
    probarGiros: true       // si no se lee bien, probar con la imagen girada 180 grados (papel del revés)
  };

  // ------------------------------------------------------------------
  // Funciones puras de calidad de imagen
  // ------------------------------------------------------------------

  // Convierte un ImageData (RGBA) en gris. También acepta una imagen ya en gris:
  // { data, width, height } con un byte por píxel.
  function aGrises(imagen) {
    var ancho = imagen.width, alto = imagen.height, datos = imagen.data;
    var n = ancho * alto;
    if (datos.length === n) return { datos: datos, ancho: ancho, alto: alto };
    var gris = new Uint8Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      // Luminancia Rec. 601 con enteros.
      gris[i] = (datos[j] * 77 + datos[j + 1] * 150 + datos[j + 2] * 29) >> 8;
    }
    return { datos: gris, ancho: ancho, alto: alto };
  }

  // Brillo medio, de 0 (negro) a 255 (blanco).
  function brilloMedio(gris) {
    var d = gris.datos, n = d.length, suma = 0;
    if (!n) return 0;
    for (var i = 0; i < n; i++) suma += d[i];
    return suma / n;
  }

  // Contraste: desviación típica del gris.
  function contraste(gris) {
    var d = gris.datos, n = d.length, suma = 0, suma2 = 0;
    if (!n) return 0;
    for (var i = 0; i < n; i++) { suma += d[i]; suma2 += d[i] * d[i]; }
    var media = suma / n;
    return Math.sqrt(Math.max(0, suma2 / n - media * media));
  }

  // Fracción (0-1) de píxeles con gris igual o superior a "nivel" (zonas quemadas).
  function fraccionClara(gris, nivel) {
    var d = gris.datos, n = d.length, cuenta = 0;
    if (!n) return 0;
    for (var i = 0; i < n; i++) if (d[i] >= nivel) cuenta++;
    return cuenta / n;
  }

  // Nitidez: varianza del laplaciano (4 vecinos). Alta = bordes nítidos;
  // baja = imagen movida, desenfocada o sin detalle.
  function nitidez(gris) {
    var d = gris.datos, w = gris.ancho, h = gris.alto;
    if (w < 3 || h < 3) return 0;
    var suma = 0, suma2 = 0, n = 0;
    for (var y = 1; y < h - 1; y++) {
      var f = y * w;
      for (var x = 1; x < w - 1; x++) {
        var i = f + x;
        var l = d[i - 1] + d[i + 1] + d[i - w] + d[i + w] - 4 * d[i];
        suma += l; suma2 += l * l; n++;
      }
    }
    var media = suma / n;
    return suma2 / n - media * media;
  }

  // Media de cada píxel con sus 8 vecinos (filtro de caja 3x3). Quita el ruido
  // del sensor, que si no se confunde con nitidez. Devuelve una imagen nueva.
  function suavizar(gris) {
    var d = gris.datos, w = gris.ancho, h = gris.alto;
    var salida = new Uint8Array(d.length);
    if (w < 3 || h < 3) { salida.set(d); return { datos: salida, ancho: w, alto: h }; }
    var filas = new Uint16Array(d.length);
    for (var y = 0; y < h; y++) {
      var f = y * w;
      filas[f] = d[f] * 2 + d[f + 1];
      for (var x = 1; x < w - 1; x++) filas[f + x] = d[f + x - 1] + d[f + x] + d[f + x + 1];
      filas[f + w - 1] = d[f + w - 2] + d[f + w - 1] * 2;
    }
    for (var y2 = 0; y2 < h; y2++) {
      var arriba = (y2 > 0 ? y2 - 1 : 0) * w, centro = y2 * w, abajo = (y2 < h - 1 ? y2 + 1 : h - 1) * w;
      for (var x2 = 0; x2 < w; x2++) {
        salida[centro + x2] = (filas[arriba + x2] + filas[centro + x2] + filas[abajo + x2] + 4) / 9;
      }
    }
    return { datos: salida, ancho: w, alto: h };
  }

  // Nitidez direccional: la imagen se divide en una rejilla de celdas; en cada
  // celda se calcula la varianza de la segunda derivada en horizontal y en
  // vertical y se toma la menor de las dos (un texto nítido tiene bordes en las
  // dos direcciones; una imagen movida los pierde en la dirección del movimiento,
  // cosa que el laplaciano solo no detecta). Devuelve el tercer valor más alto
  // de las celdas, para que cuente la zona con texto y no los márgenes vacíos.
  function nitidezDireccional(gris, celdas) {
    var d = suavizar(gris).datos, w = gris.ancho, h = gris.alto;
    var n = celdas || 6;
    if (w < 3 * n || h < 3 * n) n = 1;
    if (w < 3 || h < 3) return 0;
    var valores = [];
    for (var cy = 0; cy < n; cy++) {
      var y0 = Math.max(1, Math.floor(cy * h / n)), y1 = Math.min(h - 1, Math.floor((cy + 1) * h / n));
      for (var cx = 0; cx < n; cx++) {
        var x0 = Math.max(1, Math.floor(cx * w / n)), x1 = Math.min(w - 1, Math.floor((cx + 1) * w / n));
        var sx = 0, sx2 = 0, sy = 0, sy2 = 0, m = 0;
        for (var y = y0; y < y1; y++) {
          var f = y * w;
          for (var x = x0; x < x1; x++) {
            var i = f + x, c2 = 2 * d[i];
            var dx = d[i - 1] + d[i + 1] - c2, dy = d[i - w] + d[i + w] - c2;
            sx += dx; sx2 += dx * dx; sy += dy; sy2 += dy * dy; m++;
          }
        }
        if (!m) continue;
        var vx = sx2 / m - (sx / m) * (sx / m), vy = sy2 / m - (sy / m) * (sy / m);
        valores.push(Math.min(vx, vy));
      }
    }
    if (!valores.length) return 0;
    valores.sort(function (a, b) { return b - a; });
    return valores[Math.min(2, valores.length - 1)];
  }

  // Mide de una vez brillo, contraste y nitidez de un ImageData o imagen en gris.
  // Los umbrales están pensados para una imagen de unos 1000 píxeles de lado mayor.
  function medirCalidad(imagen) {
    var g = aGrises(imagen);
    return {
      brillo: brilloMedio(g),
      contraste: contraste(g),
      quemado: fraccionClara(g, UMBRALES.nivelQuemado),
      nitidez: nitidez(g),
      nitidezMinima: nitidezDireccional(g)
    };
  }

  // ¿Está el texto cortado por un borde lateral? Recibe las cajas de las líneas
  // reconocidas ({x0, y0, x1, y1}) y el tamaño de la imagen.
  function textoCortado(lineas, ancho, alto, umbrales) {
    var u = umbrales || UMBRALES;
    if (!lineas || !lineas.length || !ancho || !alto) return false;
    var margen = Math.max(3, ancho * u.margenBorde);
    var tocan = 0;
    for (var i = 0; i < lineas.length; i++) {
      var c = lineas[i];
      if (c.x0 <= margen || c.x1 >= ancho - margen) tocan++;
    }
    return tocan >= Math.min(2, lineas.length) && tocan / lineas.length >= u.fraccionCortada;
  }

  // Decide el aviso (o null) a partir de datos medidos.
  //   d.letras     letras y cifras reconocidas con confianza suficiente
  //   d.confianza  confianza media (0-100) de las palabras aceptadas
  //   d.calidad    resultado de medirCalidad() o null si no se pudo medir
  //   d.cortado    resultado de textoCortado()
  function diagnosticar(d, umbrales) {
    var u = umbrales || UMBRALES;
    var c = d.calidad || null;
    var oscura = !!c && c.brillo < u.brilloOscuro;
    var quemada = !!c && c.quemado > u.fraccionQuemada;
    var movida = !!c && c.contraste >= u.contrasteMovida && c.nitidezMinima < u.nitidezMovida;
    var hayTexto = (d.letras || 0) >= u.letrasMinimas;
    var fiable = hayTexto && (d.confianza || 0) >= u.confianzaBuena;
    if (fiable) {
      if (d.cortado) return AVISOS.cortado;
      // Se ha leído, pero con dudas y en malas condiciones: se dice para la próxima.
      if (d.confianza < u.confianzaExcelente) {
        if (oscura) return AVISOS.pocaLuz;
        if (movida) return AVISOS.movida;
      }
      return null;
    }
    if (oscura) return AVISOS.pocaLuz;
    if (movida) return AVISOS.movida;
    if (quemada) return AVISOS.muchaLuz;
    if (hayTexto) return d.cortado ? AVISOS.cortado : AVISOS.dudoso;
    return AVISOS.sinTexto;
  }

  // ------------------------------------------------------------------
  // Funciones puras de texto
  // ------------------------------------------------------------------

  var PALABRAS_CORTAS = {
    a: 1, e: 1, o: 1, u: 1, y: 1, al: 1, da: 1, de: 1, el: 1, en: 1, es: 1, fe: 1, ha: 1, he: 1,
    ir: 1, la: 1, le: 1, lo: 1, me: 1, mi: 1, ni: 1, no: 1, os: 1, se: 1, si: 1, su: 1, te: 1,
    tu: 1, un: 1, va: 1, ve: 1, ya: 1, yo: 1, 'sí': 1, 'él': 1, 'tú': 1, 'mí': 1, 'té': 1, 'sé': 1,
    'dé': 1, 'ó': 1, 'ú': 1, 'é': 1
  };
  var RE_SIMBOLOS_SUELTOS = /^[|~_^`\\<>{}\[\]¬¦•·■□▪●○◦®©™°*=+#]+$/;
  var RE_ALFANUM = /[\p{L}\p{N}]/gu;

  // ¿Es la línea basura de OCR (símbolos sueltos, rayas, manchas)?
  function esBasura(linea) {
    var s = linea.trim();
    if (!s) return false;
    var sinEspacios = s.replace(/\s+/g, '');
    var alfanum = (sinEspacios.match(RE_ALFANUM) || []).length;
    if (alfanum === 0) return true;
    if (alfanum / sinEspacios.length < 0.5) return true;
    if (alfanum <= 2) {
      var nucleo = s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      if (/^\p{N}+$/u.test(nucleo)) return false;
      return !PALABRAS_CORTAS[nucleo];
    }
    // Varias "palabras" de una sola letra seguidas: "i l I 1 l".
    var trozos = s.split(/\s+/);
    if (trozos.length >= 3) {
      var sueltas = 0;
      for (var i = 0; i < trozos.length; i++) {
        var t = trozos[i].replace(/[^\p{L}\p{N}]/gu, '');
        if (t.length <= 1) sueltas++;
      }
      if (sueltas / trozos.length > 0.6) return true;
    }
    return false;
  }

  function limpiarLinea(linea) {
    var trozos = linea.replace(/[\t ]/g, ' ').split(/ +/);
    var buenos = [];
    for (var i = 0; i < trozos.length; i++) {
      var t = trozos[i];
      if (!t || RE_SIMBOLOS_SUELTOS.test(t)) continue;
      t = t.replace(/^[|¦]+|[|¦]+$/g, '');
      if (t) buenos.push(t);
    }
    return buenos.join(' ').trim();
  }

  function mediana(numeros) {
    if (!numeros.length) return 0;
    var o = numeros.slice().sort(function (a, b) { return a - b; });
    var m = o.length >> 1;
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
  }

  // Une las líneas de un párrafo en una sola, resolviendo los guiones de corte.
  function unirLineas(lineas) {
    var texto = '';
    for (var i = 0; i < lineas.length; i++) {
      var l = lineas[i];
      if (!texto) { texto = l; continue; }
      var guion = /[\p{L}][-‐­¬]$/u.test(texto);
      if (guion && /^\p{Ll}/u.test(l)) {
        texto = texto.slice(0, -1) + l;            // "asocia-" + "ciones" -> "asociaciones"
      } else if (guion && /^[\p{Lu}\p{N}]/u.test(l)) {
        texto = texto.slice(0, -1) + '-' + l;      // "Castilla-" + "La Mancha" -> "Castilla-La Mancha"
      } else {
        texto += ' ' + l;
      }
    }
    return texto;
  }

  function retocar(parrafo) {
    return parrafo
      .replace(/\s+/g, ' ')
      .replace(/ ([,.;:!?»)\]%])/g, '$1')
      .replace(/([¿¡«(\[]) /g, '$1')
      .trim();
  }

  // Prepara el texto reconocido para leerlo en voz alta. Función pura.
  //  - une las palabras partidas con guion a final de línea;
  //  - une las líneas de un mismo párrafo;
  //  - quita la basura de OCR (líneas de símbolos sueltos);
  //  - conserva los párrafos, separados por una línea en blanco.
  function limpiar(texto) {
    if (typeof texto !== 'string' || !texto) return '';
    var t = texto;
    if (t.normalize) t = t.normalize('NFC');
    var lineas = t.replace(/\r\n?/g, '\n').replace(/[\u000b\u000c]/g, '\n').split('\n');

    // 1) Bloques separados por líneas en blanco, ya sin basura.
    var bloques = [], actual = [];
    for (var i = 0; i < lineas.length; i++) {
      var enBlanco = !lineas[i].trim();
      var l = limpiarLinea(lineas[i]);
      if (enBlanco) { if (actual.length) { bloques.push(actual); actual = []; } continue; }
      if (!l || esBasura(l)) continue;      // basura: se quita sin partir el párrafo
      actual.push(l);
    }
    if (actual.length) bloques.push(actual);

    // 2) Dentro de cada bloque, punto y aparte si una línea termina frase, es
    //    claramente más corta que las demás y la siguiente empieza en mayúscula.
    var parrafos = [];
    for (var b = 0; b < bloques.length; b++) {
      var bloque = bloques[b];
      var largos = bloque.map(function (x) { return x.length; });
      var tipica = mediana(largos);
      var grupo = [];
      for (var k = 0; k < bloque.length; k++) {
        grupo.push(bloque[k]);
        var siguiente = bloque[k + 1];
        if (!siguiente) break;
        var terminaFrase = /[.!?…:]["»”’)]*$/.test(bloque[k]);
        var corta = bloque.length >= 3 && bloque[k].length < tipica * 0.7;
        var empiezaFrase = /^["«“‘(¿¡—–-]*[\p{Lu}\p{N}]/u.test(siguiente);
        if (terminaFrase && corta && empiezaFrase) { parrafos.push(grupo); grupo = []; }
      }
      if (grupo.length) parrafos.push(grupo);
    }

    var salida = [];
    for (var p = 0; p < parrafos.length; p++) {
      var parrafo = retocar(unirLineas(parrafos[p]));
      if (parrafo) salida.push(parrafo);
    }
    return salida.join('\n\n');
  }

  var ABREVIATURAS = {
    'sr.': 1, 'sra.': 1, 'srta.': 1, 'sres.': 1, 'dr.': 1, 'dra.': 1, 'd.': 1, 'dña.': 1, 'ud.': 1,
    'uds.': 1, 'vd.': 1, 'vds.': 1, 'pág.': 1, 'págs.': 1, 'núm.': 1, 'art.': 1, 'tel.': 1,
    'telf.': 1, 'avda.': 1, 'av.': 1, 'c.': 1, 'pl.': 1, 'p.': 1, 'ej.': 1, 'aprox.': 1, 'ee.': 1,
    'prof.': 1, 'ilmo.': 1, 'excmo.': 1, 'sto.': 1, 'sta.': 1, 'fdo.': 1, 'n.º': 1, 'nº': 1
  };

  function terminaFraseEn(palabra) {
    if (!/[.!?…]["»”’)\]]*$/.test(palabra)) return false;
    var p = palabra.toLowerCase().replace(/^["«“‘(\[¿¡]+/, '');
    if (ABREVIATURAS[p]) return false;
    if (/^\p{L}\.$/u.test(p)) return false;       // iniciales: "J. R. Jiménez"
    return true;
  }

  // Divide un texto largo sin espacios (caso extremo) en trozos de tamaño máximo.
  function cortarDuro(palabra, max) {
    var piezas = [];
    for (var i = 0; i < palabra.length; i += max) piezas.push(palabra.slice(i, i + max));
    return piezas;
  }

  // Divide el texto en trozos de como mucho maxCaracteres para la síntesis de
  // voz. Corta por párrafos y frases; si una frase no cabe, por comas y, en
  // último caso, entre palabras. Nunca corta una palabra (salvo que una sola
  // "palabra" sin espacios supere el máximo). Función pura.
  function trocear(texto, maxCaracteres) {
    var max = Math.max(20, Math.floor(maxCaracteres) || 200);
    if (typeof texto !== 'string') return [];
    var trozos = [];
    var parrafos = texto.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
    for (var p = 0; p < parrafos.length; p++) {
      var palabras = parrafos[p].split(/\s+/).filter(Boolean);
      if (!palabras.length) continue;

      // Frases del párrafo.
      var frases = [], frase = [];
      for (var i = 0; i < palabras.length; i++) {
        frase.push(palabras[i]);
        if (terminaFraseEn(palabras[i])) { frases.push(frase); frase = []; }
      }
      if (frase.length) frases.push(frase);

      var actual = '';
      var cerrar = function () { if (actual) { trozos.push(actual); actual = ''; } };
      for (var f = 0; f < frases.length; f++) {
        var textoFrase = frases[f].join(' ');
        if (textoFrase.length <= max) {
          if (actual && actual.length + 1 + textoFrase.length > max) cerrar();
          actual = actual ? actual + ' ' + textoFrase : textoFrase;
          continue;
        }
        // Frase demasiado larga: se parte entre palabras, mejor tras una coma.
        cerrar();
        var w = frases[f], linea = '', ultimaPausa = -1, inicio = 0;
        for (var k = 0; k < w.length; k++) {
          var palabra = w[k];
          if (palabra.length > max) {
            if (linea) { trozos.push(linea); linea = ''; }
            var piezas = cortarDuro(palabra, max);
            for (var q = 0; q < piezas.length - 1; q++) trozos.push(piezas[q]);
            linea = piezas[piezas.length - 1];
            inicio = k; ultimaPausa = -1;
            continue;
          }
          if (linea && linea.length + 1 + palabra.length > max) {
            if (ultimaPausa >= inicio && ultimaPausa < k - 1) {
              // Retrocede hasta la última coma si queda en la segunda mitad del trozo.
              var hastaPausa = w.slice(inicio, ultimaPausa + 1).join(' ');
              if (hastaPausa.length >= max * 0.5) {
                trozos.push(hastaPausa);
                linea = w.slice(ultimaPausa + 1, k).join(' ');
                inicio = ultimaPausa + 1; ultimaPausa = -1;
              }
            }
            if (linea && linea.length + 1 + palabra.length > max) {
              trozos.push(linea); linea = ''; inicio = k; ultimaPausa = -1;
            }
          }
          linea = linea ? linea + ' ' + palabra : palabra;
          if (/[,;:]["»”’)]*$/.test(palabra)) ultimaPausa = k;
        }
        actual = linea;
      }
      cerrar();
    }
    return trozos;
  }

  // ------------------------------------------------------------------
  // Del resultado de Tesseract al texto
  // ------------------------------------------------------------------

  // Recorre los bloques que devuelve Tesseract.js (salida "blocks") y devuelve
  // el texto en bruto, la confianza media y las cajas de las líneas. Función pura.
  function resumirBloques(bloques, umbrales) {
    var u = umbrales || UMBRALES;
    var parrafos = [], cajas = [], sumaConf = 0, peso = 0, letras = 0, palabras = 0, vistas = 0;
    var lista = bloques || [];
    for (var b = 0; b < lista.length; b++) {
      var ps = lista[b].paragraphs || [];
      for (var p = 0; p < ps.length; p++) {
        var lineas = [];
        var ls = ps[p].lines || [];
        for (var l = 0; l < ls.length; l++) {
          var ws = ls[l].words || [];
          var buenas = [];
          for (var w = 0; w < ws.length; w++) {
            var palabra = ws[w];
            var textoPalabra = (palabra.text || '').trim();
            if (!textoPalabra) continue;
            var n = (textoPalabra.match(RE_ALFANUM) || []).length;
            // La confianza media cuenta todas las palabras, también las malas:
            // así un texto del revés o movido no pasa por bueno.
            if (n) { sumaConf += palabra.confidence * n; peso += n; vistas++; }
            if (palabra.confidence < u.confianzaPalabra) continue;
            buenas.push(textoPalabra);
            if (n) { letras += n; palabras++; }
          }
          if (buenas.length) {
            var textoLinea = buenas.join(' ');
            lineas.push(textoLinea);
            if (ls[l].bbox && !esBasura(limpiarLinea(textoLinea))) cajas.push(ls[l].bbox);
          }
        }
        if (lineas.length) parrafos.push(lineas.join('\n'));
      }
    }
    return {
      bruto: parrafos.join('\n\n'),
      confianza: peso ? sumaConf / peso : 0,
      letras: letras,
      palabras: palabras,          // palabras aceptadas
      palabrasVistas: vistas,      // todas las que el motor creyó ver
      cajas: cajas
    };
  }

  // ------------------------------------------------------------------
  // Motor (Tesseract.js)
  // ------------------------------------------------------------------

  var enNavegador = typeof document !== 'undefined' && typeof window !== 'undefined';
  var rutaPropia = (function () {
    try {
      if (enNavegador && document.currentScript && document.currentScript.src) {
        return new URL('ocr/', document.currentScript.src).href;
      }
      if (enNavegador) return new URL('ocr/', document.baseURI).href;
    } catch (e) { /* se usará la ruta relativa */ }
    return 'ocr/';
  })();

  var trabajador = null, promesaPreparar = null, ocupado = false, oyentes = [];

  var MENSAJES_FASE = {
    'loading tesseract core': 'Cargando el lector',
    'initializing tesseract': 'Preparando el lector',
    'loading language traineddata': 'Cargando el idioma español',
    'initializing api': 'Preparando el idioma español',
    'recognizing text': 'Leyendo el texto'
  };

  function avisarProgreso(m) {
    if (!m || !oyentes.length) return;
    var dato = {
      fase: m.status || '',
      mensaje: MENSAJES_FASE[m.status] || 'Preparando el lector',
      progreso: typeof m.progress === 'number' ? m.progress : 0
    };
    for (var i = 0; i < oyentes.length; i++) {
      try { oyentes[i](dato); } catch (e) { /* un oyente roto no debe parar la lectura */ }
    }
  }

  function rutaOcr() {
    var r = CONFIG.rutaOcr || rutaPropia;
    return r.replace(/\/+$/, '');
  }

  function cargarScript(url) {
    return new Promise(function (resolver, rechazar) {
      var s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = function () { resolver(); };
      s.onerror = function () { s.remove(); rechazar(new Error('No se pudo cargar ' + url)); };
      document.head.appendChild(s);
    });
  }

  // Carga perezosa del motor. Se puede llamar muchas veces: solo carga una.
  // onProgreso({ fase, mensaje, progreso }) recibe el avance (progreso de 0 a 1).
  // opciones (solo para pruebas en Node): { tesseract, langPath }.
  function preparar(onProgreso, opciones) {
    if (typeof onProgreso === 'function' && oyentes.indexOf(onProgreso) < 0) oyentes.push(onProgreso);
    if (promesaPreparar) return promesaPreparar;
    var op = opciones || {};
    promesaPreparar = (async function () {
      var T = op.tesseract || raiz.Tesseract;
      if (!T) {
        if (!enNavegador) throw new Error('Falta opciones.tesseract (módulo tesseract.js) fuera del navegador.');
        await cargarScript(rutaOcr() + '/tesseract.min.js');
        T = raiz.Tesseract;
        if (!T) throw new Error('tesseract.min.js no ha definido Tesseract.');
      }
      var base = rutaOcr();
      var ajustes = {
        langPath: op.langPath || base,   // langPath + '/spa.traineddata.gz'
        gzip: true,
        logger: avisarProgreso,
        errorHandler: function () { /* los errores llegan por la promesa de cada trabajo */ }
      };
      if (enNavegador && !op.tesseract) {
        ajustes.workerPath = base + '/worker.min.js';
        ajustes.corePath = base;         // carpeta: el motor elige la variante según el móvil
      }
      if (op.cacheMethod) ajustes.cacheMethod = op.cacheMethod;
      // OEM 1 = solo red neuronal LSTM (es lo que contienen los datos de ocr/).
      var t = await T.createWorker(CONFIG.idioma, 1, ajustes);
      // 3 = segmentación automática de página (necesaria para varias columnas).
      // user_defined_dpi no cambia el resultado (medido); solo evita un mensaje en la consola.
      await t.setParameters({ tessedit_pageseg_mode: '3', user_defined_dpi: '200' });
      trabajador = t;
      return true;
    })();
    promesaPreparar.catch(function () { promesaPreparar = null; trabajador = null; });
    return promesaPreparar;
  }

  // Libera la memoria del motor (decenas de MB). preparar() lo vuelve a cargar.
  async function liberar() {
    var t = trabajador;
    trabajador = null; promesaPreparar = null; oyentes = [];
    if (t) { try { await t.terminate(); } catch (e) { /* ya estaba cerrado */ } }
  }

  function configurar(cambios) {
    var c = cambios || {};
    for (var k in c) {
      if (k === 'umbrales') { for (var u in c.umbrales) if (u in UMBRALES) UMBRALES[u] = c.umbrales[u]; }
      else if (k in CONFIG) CONFIG[k] = c[k];
    }
    return { config: CONFIG, umbrales: UMBRALES };
  }

  // ---- Imagen de entrada (solo navegador) ----

  function tamanoFuente(fuente) {
    var ancho = fuente.videoWidth || fuente.naturalWidth || fuente.width || 0;
    var alto = fuente.videoHeight || fuente.naturalHeight || fuente.height || 0;
    return { ancho: ancho, alto: alto };
  }

  // Dibuja la fuente (vídeo, canvas, imagen, ImageBitmap) en un canvas nuevo,
  // a un tamaño adecuado para leer y con el giro pedido (0 o 180; admite 90 y 270).
  function aLienzo(fuente, grados) {
    var t = tamanoFuente(fuente);
    if (!t.ancho || !t.alto) return null;
    var mayor = Math.max(t.ancho, t.alto);
    var escala = 1;
    if (mayor > CONFIG.ladoMaximo) escala = CONFIG.ladoMaximo / mayor;
    else if (mayor < CONFIG.ladoDeseado) escala = Math.min(2, CONFIG.ladoDeseado / mayor);
    var w = Math.max(1, Math.round(t.ancho * escala)), h = Math.max(1, Math.round(t.alto * escala));
    var g = ((grados || 0) % 360 + 360) % 360;
    var lienzo = document.createElement('canvas');
    var ladeado = g === 90 || g === 270;
    lienzo.width = ladeado ? h : w;
    lienzo.height = ladeado ? w : h;
    var ctx = lienzo.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(lienzo.width / 2, lienzo.height / 2);
    ctx.rotate(g * Math.PI / 180);
    ctx.drawImage(fuente, -w / 2, -h / 2, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return lienzo;
  }

  // Mide la calidad sobre una copia reducida (siempre a la misma escala, para
  // que los umbrales signifiquen lo mismo con cualquier cámara).
  function calidadDeFuente(fuente) {
    var t = tamanoFuente(fuente);
    var escala = Math.min(1, CONFIG.ladoCalidad / Math.max(t.ancho, t.alto));
    var w = Math.max(1, Math.round(t.ancho * escala)), h = Math.max(1, Math.round(t.alto * escala));
    var lienzo = document.createElement('canvas');
    lienzo.width = w; lienzo.height = h;
    var ctx = lienzo.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(fuente, 0, 0, w, h);
    var calidad = medirCalidad(ctx.getImageData(0, 0, w, h));
    soltarLienzo(lienzo);
    return calidad;
  }

  function soltarLienzo(lienzo) {
    if (lienzo && typeof lienzo.getContext === 'function') { lienzo.width = 1; lienzo.height = 1; }
  }

  async function reconocer(imagen, ancho, alto) {
    var r = await trabajador.recognize(imagen, {}, { text: true, blocks: true });
    var datos = r.data || {};
    var resumen = resumirBloques(datos.blocks);
    resumen.texto = limpiar(resumen.bruto);
    resumen.cortado = textoCortado(resumen.cajas, ancho, alto);
    return resumen;
  }

  function esPobre(r) {
    return r.letras < UMBRALES.letrasMinimas || r.confianza < UMBRALES.confianzaBuena;
  }

  // Lee el texto de un vídeo, canvas, imagen o ImageBitmap.
  // Devuelve { texto, confianza, aviso, giro, calidad, ms }:
  //   texto      listo para leer en voz ('' si no hay nada fiable)
  //   confianza  de 0 a 100
  //   aviso      null, o una frase para decir al usuario qué corregir. Puede venir
  //              junto con texto (p. ej. texto cortado por el borde): entonces se
  //              lee el texto y después se dice el aviso.
  //   giro       180 si hubo que dar la vuelta a la imagen para leerla; si no, 0
  // Nunca lanza por una mala imagen; solo si el motor no se puede cargar.
  //
  // opciones (pensadas para las pruebas en Node, donde no hay canvas):
  //   imageData        { data, width, height } para medir la calidad
  //   ancho, alto      tamaño de la imagen
  //   girar(grados)    función async que devuelve la imagen girada (se llama con 180)
  async function leer(fuente, opciones) {
    var op = opciones || {};
    if (ocupado) return { texto: '', confianza: 0, aviso: AVISOS.ocupado, giro: 0, calidad: null, ms: 0 };
    ocupado = true;
    var t0 = Date.now();
    var lienzos = [];
    try {
      await preparar();

      var esElemento = enNavegador && fuente && typeof fuente === 'object' &&
        !(typeof Blob !== 'undefined' && fuente instanceof Blob);
      var imagen = fuente, ancho = op.ancho || 0, alto = op.alto || 0, calidad = null;
      if (esElemento) {
        imagen = aLienzo(fuente, 0);
        if (!imagen) return { texto: '', confianza: 0, aviso: AVISOS.sinImagen, giro: 0, calidad: null, ms: Date.now() - t0 };
        lienzos.push(imagen);
        ancho = imagen.width; alto = imagen.height;
        calidad = calidadDeFuente(fuente);
      } else if (op.imageData) {
        calidad = medirCalidad(op.imageData);
        ancho = ancho || op.imageData.width; alto = alto || op.imageData.height;
      }

      var fin = function (r, giro) {
        var aviso = diagnosticar({ letras: r.letras, confianza: r.confianza, calidad: calidad, cortado: r.cortado });
        var fiable = r.letras >= UMBRALES.letrasMinimas && r.confianza >= UMBRALES.confianzaBuena;
        return {
          texto: fiable ? r.texto : '',
          confianza: Math.round(r.confianza),
          aviso: aviso,
          giro: giro,
          calidad: calidad,
          ms: Date.now() - t0
        };
      };
      var vacio = { texto: '', confianza: 0, letras: 0, palabras: 0, palabrasVistas: 0, cortado: false };

      // Sin luz o sin ningún detalle: no merece la pena gastar segundos en leer.
      if (calidad && (calidad.brillo < UMBRALES.brilloNegro || calidad.contraste < UMBRALES.contrastePlano)) {
        return fin(vacio, 0);
      }

      var mejor = await reconocer(imagen, ancho, alto), giroMejor = 0;

      // Un ciego no sabe si el papel está del derecho. Tesseract ya lee por sí
      // solo el texto tumbado, pero el que está del revés sale como palabras de
      // poca confianza: en ese caso se prueba una vez con la imagen girada 180
      // grados. No se prueba si la causa ya se conoce (poca luz, imagen movida)
      // o si no hay nada parecido a un texto, para no hacer esperar al usuario.
      var puedeGirar = esElemento || typeof op.girar === 'function';
      var oscura = !!calidad && calidad.brillo < UMBRALES.brilloOscuro;
      var movida = !!calidad && calidad.contraste >= UMBRALES.contrasteMovida &&
        calidad.nitidezMinima < UMBRALES.nitidezMovida;
      if (esPobre(mejor) && mejor.palabrasVistas >= 3 && !oscura && !movida &&
          CONFIG.probarGiros && op.probarGiros !== false && puedeGirar) {
        var girada;
        if (esElemento) { girada = aLienzo(fuente, 180); lienzos.push(girada); }
        else girada = await op.girar(180);
        var r = await reconocer(girada, ancho, alto);
        if (!esPobre(r)) { mejor = r; giroMejor = 180; }
      }
      return fin(mejor, giroMejor);
    } finally {
      for (var j = 0; j < lienzos.length; j++) soltarLienzo(lienzos[j]);
      ocupado = false;
    }
  }

  // Intenta hacer una foto a resolución completa con la cámara del vídeo
  // (ImageCapture, disponible en Chrome para Android). Si no se puede, devuelve
  // el propio vídeo para leer el fotograma actual. El resultado se pasa a leer().
  async function capturar(video) {
    try {
      var pista = video && video.srcObject && video.srcObject.getVideoTracks && video.srcObject.getVideoTracks()[0];
      if (pista && typeof raiz.ImageCapture === 'function' && typeof raiz.createImageBitmap === 'function') {
        var foto = await new raiz.ImageCapture(pista).takePhoto();
        return await raiz.createImageBitmap(foto);
      }
    } catch (e) { /* se usa el fotograma del vídeo */ }
    return video;
  }

  var api = {
    // Motor
    preparar: preparar,
    leer: leer,
    capturar: capturar,
    liberar: liberar,
    configurar: configurar,
    // Texto (puras)
    limpiar: limpiar,
    trocear: trocear,
    esBasura: esBasura,
    // Calidad de imagen (puras)
    aGrises: aGrises,
    brilloMedio: brilloMedio,
    contraste: contraste,
    fraccionClara: fraccionClara,
    nitidez: nitidez,
    nitidezDireccional: nitidezDireccional,
    suavizar: suavizar,
    medirCalidad: medirCalidad,
    textoCortado: textoCortado,
    diagnosticar: diagnosticar,
    resumirBloques: resumirBloques,
    // Datos
    AVISOS: AVISOS,
    UMBRALES: UMBRALES
  };

  raiz.PFLectura = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

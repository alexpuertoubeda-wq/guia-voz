/* Paso Firme · rutas.js
 * Módulo «llévame a…»: interpreta la orden, busca el destino con datos de
 * OpenStreetMap, calcula una ruta a pie y la convierte en frases habladas.
 *
 * Script clásico (no módulo ES). Define window.PFRutas. Sin dependencias.
 * Servicios (gratuitos, sin clave; condiciones y enlaces en RUTAS.md):
 *   - Overpass API   : lugares por categoría cerca de una coordenada.
 *   - Nominatim      : lugares por nombre o dirección.
 *   - OSRM de FOSSGIS: ruta a pie con pasos (perfil «foot»).
 *
 * SEGURIDAD: las rutas no saben nada de semáforos, pasos de peatones, obras ni
 * obstáculos. Ninguna frase de este módulo afirma que se pueda cruzar; todas
 * las maniobras recuerdan comprobar el tráfico.
 */
(function (raiz) {
  'use strict';

  // ------------------------------------------------------------------
  // Configuración (modificable desde fuera: PFRutas.config.…)
  // ------------------------------------------------------------------
  var config = {
    // Función fetch que se usará; null = la global. Las pruebas inyectan una falsa.
    fetch: null,
    // Separación mínima entre llamadas a un mismo servicio (1 petición/segundo
    // como máximo en Nominatim y en el OSRM de FOSSGIS; dejamos margen).
    intervaloMinimoMs: 1100,
    cacheMs: 5 * 60 * 1000,
    maxResultados: 8,
    overpass: {
      activo: true,
      // Se prueban en orden si el anterior falla.
      // Solo el servidor principal: las condiciones de otros servidores públicos no constan.
      urls: ['https://overpass-api.de/api/interpreter'],
      // Overpass se satura a menudo: se espera poco y, si no responde, se busca en Nominatim.
      esperaMs: 15000,
      radioInicial: 500,
      radioMaximo: 5000
    },
    nominatim: {
      activo: true,
      url: 'https://nominatim.openstreetmap.org/search',
      esperaMs: 12000,
      radioInicial: 2000,
      radioMaximo: 30000,
      idioma: 'es'
    },
    osrm: {
      activo: true,
      // En el servidor de FOSSGIS el perfil va en la ruta («routed-foot») y el
      // segmento de perfil de la API de OSRM es siempre «driving».
      url: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/',
      esperaMs: 15000
    }
  };

  var AVISO_SEGURIDAD = 'Las indicaciones no conocen los semáforos, los pasos de peatones, ' +
    'las obras ni los obstáculos. Usa tu bastón o tu perro guía y comprueba siempre el tráfico antes de cruzar.';
  var AVISO_CRUCE = ' Si tienes que cruzar, comprueba antes el tráfico.';

  // ------------------------------------------------------------------
  // Errores
  // ------------------------------------------------------------------
  // codigo: 'parametros' | 'desactivado' | 'red' | 'tiempo' | 'limite' |
  //         'servidor' | 'formato' | 'sin_ruta'
  // message: frase en español que se puede decir tal cual al usuario.
  function ErrorRutas(codigo, mensaje) {
    var e = new Error(mensaje);
    e.name = 'ErrorRutas';
    e.codigo = codigo;
    return e;
  }

  // ------------------------------------------------------------------
  // Utilidades puras: geometría
  // ------------------------------------------------------------------
  var R_TIERRA = 6371008.8; // metros
  function rad(g) { return g * Math.PI / 180; }

  /** Distancia en metros entre dos puntos (fórmula del haversine). */
  function distancia(lat1, lon1, lat2, lon2) {
    var dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_TIERRA * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Rumbo inicial de 1 a 2 en grados (0 = norte, 90 = este), en [0, 360). */
  function rumbo(lat1, lon1, lat2, lon2) {
    var f1 = rad(lat1), f2 = rad(lat2), dL = rad(lon2 - lon1);
    var y = Math.sin(dL) * Math.cos(f2);
    var x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dL);
    var g = Math.atan2(y, x) * 180 / Math.PI;
    return (g + 360) % 360;
  }

  /** Diferencia con signo entre dos rumbos, en (-180, 180]. Positivo = a la derecha. */
  function diferenciaRumbo(desde, hacia) {
    var d = ((hacia - desde) % 360 + 540) % 360 - 180;
    return d === -180 ? 180 : d;
  }

  /**
   * Distancia de un punto P al segmento A-B (proyección plana local, válida
   * para segmentos de calle). Devuelve { distancia, t, lat, lon }: t en [0,1]
   * es la posición del punto más cercano dentro del segmento.
   */
  function distanciaPuntoSegmento(lat, lon, latA, lonA, latB, lonB) {
    var k = Math.cos(rad((latA + latB) / 2));
    var mx = rad(1) * R_TIERRA * k, my = rad(1) * R_TIERRA;
    var bx = (lonB - lonA) * mx, by = (latB - latA) * my;
    var px = (lon - lonA) * mx, py = (lat - latA) * my;
    var l2 = bx * bx + by * by;
    var t = l2 === 0 ? 0 : (px * bx + py * by) / l2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var dx = px - t * bx, dy = py - t * by;
    return {
      distancia: Math.sqrt(dx * dx + dy * dy),
      t: t,
      lat: latA + (latB - latA) * t,
      lon: lonA + (lonB - lonA) * t
    };
  }

  // ------------------------------------------------------------------
  // Utilidades puras: texto
  // ------------------------------------------------------------------
  /** «120 metros», «un metro», «un kilómetro y medio», «2 kilómetros y 300 metros». */
  function formatearDistancia(metros) {
    var m = Number(metros);
    if (!isFinite(m) || m < 0) m = 0;
    if (m < 1) return 'menos de un metro';
    if (m < 995) {
      var n = m < 20 ? Math.round(m) : m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10;
      return n === 1 ? 'un metro' : n + ' metros';
    }
    var km, resto;
    if (m < 4950) {
      var cientos = Math.round(m / 100);       // precisión de 100 m
      km = Math.floor(cientos / 10); resto = cientos % 10;
    } else if (m < 19750) {
      var medios = Math.round(m / 500);        // precisión de medio kilómetro
      km = Math.floor(medios / 2); resto = (medios % 2) * 5;
    } else {
      km = Math.round(m / 1000); resto = 0;
    }
    var t = km === 1 ? 'un kilómetro' : km + ' kilómetros';
    if (resto === 5) return t + ' y medio';
    if (resto > 0) return t + ' y ' + (resto * 100) + ' metros';
    return t;
  }

  /** «menos de un minuto», «unos 6 minutos», «una hora y 10 minutos». */
  function formatearDuracion(segundos) {
    var s = Number(segundos);
    if (!isFinite(s) || s < 45) return 'menos de un minuto';
    var min = Math.round(s / 60);
    if (min === 1) return 'un minuto';
    if (min < 60) return 'unos ' + min + ' minutos';
    var h = Math.floor(min / 60), r = min % 60;
    var t = h === 1 ? 'una hora' : h + ' horas';
    if (r === 0) return t;
    return t + ' y ' + (r === 1 ? 'un minuto' : r + ' minutos');
  }

  var CARDINALES = ['el norte', 'el noreste', 'el este', 'el sureste', 'el sur', 'el suroeste', 'el oeste', 'el noroeste'];
  /** «el norte», «el sureste»… para un rumbo en grados. */
  function puntoCardinal(grados) {
    var g = ((Number(grados) % 360) + 360) % 360;
    return CARDINALES[Math.round(g / 45) % 8];
  }

  /** Minúsculas, sin tildes ni signos, espacios simples. (La ñ queda como n.) */
  function normalizarTexto(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function normalizarPalabra(s) { return normalizarTexto(s).replace(/ /g, ''); }
  function minusculaInicial(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

  // ------------------------------------------------------------------
  // Catálogo de categorías
  // ------------------------------------------------------------------
  // [id, forma hablada, sinónimos ya normalizados (singular), etiquetas OSM]
  // Todas las etiquetas están comprobadas en la wiki de OSM (ver RUTAS.md).
  var CATALOGO = [
    ['farmacia', 'una farmacia', ['farmacia', 'farmacia de guardia', 'botica'], ['amenity=pharmacy']],
    ['bar', 'un bar', ['bar', 'bareto', 'taberna', 'tasca', 'cerveceria', 'pub'], ['amenity=bar', 'amenity=pub']],
    ['cafeteria', 'una cafetería', ['cafeteria', 'cafe', 'sitio para desayunar', 'sitio para tomar cafe'], ['amenity=cafe']],
    ['restaurante', 'un restaurante', ['restaurante', 'meson', 'sitio para comer', 'sitio para cenar', 'sitio donde comer'], ['amenity=restaurant']],
    ['comida_rapida', 'un sitio de comida rápida', ['comida rapida', 'hamburgueseria', 'pizzeria', 'kebab', 'sitio de comida rapida'], ['amenity=fast_food']],
    ['heladeria', 'una heladería', ['heladeria'], ['amenity=ice_cream']],
    ['supermercado', 'un supermercado', ['supermercado', 'super', 'hipermercado'], ['shop=supermarket']],
    ['tienda', 'una tienda de alimentación', ['tienda', 'tienda de alimentacion', 'tienda de comestibles', 'ultramarinos', 'colmado'], ['shop=convenience']],
    ['panaderia', 'una panadería', ['panaderia', 'horno', 'horno de pan', 'tahona'], ['shop=bakery']],
    ['pasteleria', 'una pastelería', ['pasteleria', 'confiteria'], ['shop=pastry']],
    ['carniceria', 'una carnicería', ['carniceria', 'charcuteria'], ['shop=butcher']],
    ['pescaderia', 'una pescadería', ['pescaderia'], ['shop=seafood']],
    ['fruteria', 'una frutería', ['fruteria', 'verduleria'], ['shop=greengrocer']],
    ['mercado', 'un mercado', ['mercado', 'mercado municipal', 'mercado central', 'mercadillo', 'plaza de abastos'], ['amenity=marketplace']],
    ['banco', 'un banco', ['banco', 'sucursal bancaria', 'oficina bancaria', 'caja de ahorros'], ['amenity=bank']],
    ['cajero', 'un cajero automático', ['cajero', 'cajero automatico'], ['amenity=atm']],
    ['hospital', 'un hospital', ['hospital', 'urgencias'], ['amenity=hospital']],
    ['centro_salud', 'un centro de salud', ['centro de salud', 'ambulatorio', 'consultorio', 'consultorio medico', 'centro medico', 'medico', 'clinica', 'consulta medica'], ['amenity=clinic', 'amenity=doctors', 'healthcare=centre']],
    ['dentista', 'un dentista', ['dentista', 'clinica dental', 'odontologo'], ['amenity=dentist']],
    ['veterinario', 'un veterinario', ['veterinario', 'clinica veterinaria'], ['amenity=veterinary']],
    ['optica', 'una óptica', ['optica'], ['shop=optician']],
    ['parada_autobus', 'una parada de autobús', ['parada de autobus', 'parada del autobus', 'parada de bus', 'parada del bus', 'parada', 'marquesina', 'parada de guagua'], ['highway=bus_stop']],
    ['estacion_autobuses', 'una estación de autobuses', ['estacion de autobus', 'estacion de bus'], ['amenity=bus_station']],
    ['estacion_tren', 'una estación de tren', ['estacion de tren', 'estacion del tren', 'estacion', 'estacion de ferrocarril', 'estacion de cercania', 'estacion de renfe', 'renfe', 'apeadero'], ['railway=station', 'railway=halt']],
    ['tranvia', 'una parada de tranvía', ['parada de tranvia', 'parada del tranvia', 'tranvia', 'parada del tram', 'tram'], ['railway=tram_stop']],
    ['metro', 'una boca de metro', ['metro', 'boca de metro', 'estacion de metro', 'parada de metro', 'entrada de metro'], ['railway=subway_entrance']],
    ['taxi', 'una parada de taxis', ['taxi', 'parada de taxi'], ['amenity=taxi']],
    ['estanco', 'un estanco', ['estanco', 'expendeduria', 'expendeduria de tabaco'], ['shop=tobacco']],
    ['quiosco', 'un quiosco', ['quiosco', 'kiosco', 'quiosco de prensa', 'kiosco de prensa'], ['shop=kiosk', 'shop=newsagent']],
    ['loteria', 'una administración de lotería', ['loteria', 'administracion de loteria'], ['shop=lottery']],
    ['correos', 'una oficina de correos', ['correo', 'oficina de correo', 'correos'], ['amenity=post_office']],
    ['buzon', 'un buzón', ['buzon', 'buzon de correo'], ['amenity=post_box']],
    ['policia', 'una comisaría de policía', ['policia', 'comisaria', 'comisaria de policia', 'policia local', 'policia nacional', 'guardia civil', 'cuartel de la guardia civil'], ['amenity=police']],
    ['bomberos', 'un parque de bomberos', ['bombero', 'parque de bombero'], ['amenity=fire_station']],
    ['ayuntamiento', 'el ayuntamiento', ['ayuntamiento', 'casa consistorial', 'consistorio'], ['amenity=townhall']],
    ['juzgado', 'un juzgado', ['juzgado', 'tribunal', 'palacio de justicia', 'ciudad de la justicia'], ['amenity=courthouse']],
    ['iglesia', 'una iglesia', ['iglesia', 'parroquia', 'templo', 'capilla', 'catedral', 'ermita', 'mezquita', 'sinagoga', 'lugar de culto'], ['amenity=place_of_worship']],
    ['parque', 'un parque', ['parque', 'jardin', 'jardin publico', 'zona verde'], ['leisure=park', 'leisure=garden']],
    ['parque_infantil', 'un parque infantil', ['parque infantil', 'columpio', 'zona de juego', 'zona infantil'], ['leisure=playground']],
    ['bano', 'un baño público', ['bano', 'bano publico', 'aseo', 'aseo publico', 'servicio', 'servicio publico', 'lavabo', 'vater', 'water', 'wc', 'retrete', 'urinario'], ['amenity=toilets']],
    ['fuente', 'una fuente de agua potable', ['fuente', 'fuente de agua', 'fuente de agua potable', 'fuente para beber', 'agua potable'], ['amenity=drinking_water']],
    ['gasolinera', 'una gasolinera', ['gasolinera', 'estacion de servicio'], ['amenity=fuel']],
    ['peluqueria', 'una peluquería', ['peluqueria', 'barberia', 'barbero', 'peluquero'], ['shop=hairdresser']],
    ['estetica', 'un centro de estética', ['centro de estetica', 'salon de belleza', 'estetica'], ['shop=beauty']],
    ['biblioteca', 'una biblioteca', ['biblioteca'], ['amenity=library']],
    ['colegio', 'un colegio', ['colegio', 'escuela', 'instituto'], ['amenity=school']],
    ['universidad', 'una universidad', ['universidad', 'facultad', 'campus'], ['amenity=university']],
    ['guarderia', 'una guardería', ['guarderia', 'escuela infantil'], ['amenity=kindergarten']],
    ['cine', 'un cine', ['cine'], ['amenity=cinema']],
    ['teatro', 'un teatro', ['teatro'], ['amenity=theatre']],
    ['museo', 'un museo', ['museo'], ['tourism=museum']],
    ['hotel', 'un hotel', ['hotel', 'hostal', 'pension', 'alojamiento'], ['tourism=hotel', 'tourism=hostel', 'tourism=guest_house']],
    ['gimnasio', 'un gimnasio', ['gimnasio'], ['leisure=fitness_centre']],
    ['polideportivo', 'un polideportivo', ['polideportivo', 'centro deportivo', 'pabellon deportivo'], ['leisure=sports_centre']],
    ['piscina', 'una piscina', ['piscina'], ['leisure=swimming_pool']],
    ['ferreteria', 'una ferretería', ['ferreteria', 'tienda de bricolaje'], ['shop=hardware', 'shop=doityourself']],
    ['libreria', 'una librería', ['libreria'], ['shop=books']],
    ['papeleria', 'una papelería', ['papeleria'], ['shop=stationery']],
    ['copisteria', 'una copistería', ['copisteria', 'reprografia'], ['shop=copyshop']],
    ['floristeria', 'una floristería', ['floristeria'], ['shop=florist']],
    ['lavanderia', 'una lavandería', ['lavanderia'], ['shop=laundry']],
    ['tintoreria', 'una tintorería', ['tintoreria'], ['shop=dry_cleaning']],
    ['zapateria', 'una zapatería', ['zapateria'], ['shop=shoes']],
    ['ropa', 'una tienda de ropa', ['tienda de ropa'], ['shop=clothes']],
    ['centro_comercial', 'un centro comercial', ['centro comercial', 'gran almacen'], ['shop=mall', 'shop=department_store']],
    ['drogueria', 'una droguería', ['drogueria', 'perfumeria'], ['shop=chemist']],
    ['moviles', 'una tienda de móviles', ['tienda de movil', 'tienda de telefono', 'tienda de telefonia'], ['shop=mobile_phone']],
    ['jugueteria', 'una juguetería', ['jugueteria', 'tienda de juguete'], ['shop=toys']],
    ['animales', 'una tienda de animales', ['tienda de animal', 'tienda de mascota'], ['shop=pet']],
    ['agencia_viajes', 'una agencia de viajes', ['agencia de viaje'], ['shop=travel_agency']],
    ['aparcamiento', 'un aparcamiento', ['aparcamiento', 'parking'], ['amenity=parking']],
    ['centro_civico', 'un centro cívico', ['centro civico', 'centro social', 'casa de la cultura', 'centro cultural'], ['amenity=community_centre']],
    ['reciclaje', 'un punto de reciclaje', ['contenedor de reciclaje', 'punto de reciclaje', 'contenedor de vidrio', 'punto limpio'], ['amenity=recycling']]
  ];

  var CATEGORIAS = {};       // id -> { id, hablado, sinonimos, etiquetasOSM }
  var SINONIMOS = {};        // sinónimo normalizado -> id
  var MAX_PALABRAS_SINONIMO = 1;
  CATALOGO.forEach(function (c) {
    CATEGORIAS[c[0]] = { id: c[0], hablado: c[1], sinonimos: c[2].slice(), etiquetasOSM: c[3].slice() };
    c[2].forEach(function (s) {
      if (!(s in SINONIMOS)) SINONIMOS[s] = c[0];
      MAX_PALABRAS_SINONIMO = Math.max(MAX_PALABRAS_SINONIMO, s.split(' ').length);
    });
  });

  // Variantes en singular de una palabra normalizada («bares» -> bar, bare, bares).
  function singulares(p) {
    var v = [p];
    if (p.length > 3 && /s$/.test(p)) v.push(p.slice(0, -1));
    if (p.length > 4 && /es$/.test(p)) v.push(p.slice(0, -2));
    return v;
  }
  // ¿Es esta lista de palabras (normalizadas) un sinónimo exacto? Devuelve id o null.
  function categoriaExacta(palabras) {
    if (!palabras.length || palabras.length > MAX_PALABRAS_SINONIMO) return null;
    var opciones = palabras.map(singulares), hallado = null;
    (function combinar(i, acc) {
      if (hallado) return;
      if (i === opciones.length) { var k = acc.join(' '); if (k in SINONIMOS) hallado = SINONIMOS[k]; return; }
      for (var j = 0; j < opciones[i].length && !hallado; j++) combinar(i + 1, acc.concat(opciones[i][j]));
    })(0, []);
    return hallado;
  }
  // Categoría con la que EMPIEZA la lista (prefijo más largo). { id, n } o null.
  function categoriaPrefijo(palabras) {
    for (var n = Math.min(MAX_PALABRAS_SINONIMO, palabras.length); n >= 1; n--) {
      var id = categoriaExacta(palabras.slice(0, n));
      if (id) return { id: id, n: n };
    }
    return null;
  }

  // ------------------------------------------------------------------
  // interpretar(frase)  — PURA
  // ------------------------------------------------------------------
  var PREP = '(?: (?:a|al|hasta|hacia|para|por))?';
  // Disparadores fuertes: lo que sigue es un destino aunque no sea una categoría.
  var FUERTES = [
    new RegExp('(?:^| )(?:llevame|llevanos|llevarme|lleveme|llevadme|acompaname|dirigeme|conduceme|guiame|guianos)' + PREP + '(?= |$)'),
    new RegExp('(?:^| )(?:quiero|quisiera|queremos|necesito|tengo que|me gustaria|deseo|hay que|puedo|podemos) (?:ir|llegar|acercarme|pasar|caminar|andar)' + PREP + '(?= |$)'),
    new RegExp('(?:^| )como (?:llego|llegar|voy|ir|se va|se llega|puedo ir|puedo llegar)' + PREP + '(?= |$)'),
    /(?:^| )(?:ruta|camino|indicaciones) (?:a|al|hasta|hacia|para ir a|para ir al|para llegar a|para llegar al)(?= |$)/,
    /(?:^| )(?:navega|navegar) (?:a|al|hasta|hacia)(?= |$)/,
    /(?:^| )(?:busca|buscame|buscar|encuentra|encuentrame|localiza|localizame)(?= |$)/,
    /(?:^| )donde (?:esta|estan|queda|quedan|se encuentra|se encuentran)(?= |$)/
  ];
  // Disparadores débiles: solo valen si lo que sigue empieza por una categoría.
  var DEBILES = [
    /(?:^| )(?:vamos|vayamos|ve|voy|ir|vete) (?:a|al|hasta|hacia)(?= |$)/,
    /(?:^| )(?:donde hay|hay|necesito|busco|quiero|me hace falta|tengo que encontrar|quiero encontrar|necesito encontrar)(?= |$)/
  ];
  var INICIALES = { a: 1, al: 1, hasta: 1, hacia: 1, el: 1, la: 1, los: 1, las: 1, un: 1, una: 1, unos: 1, unas: 1, algun: 1, alguna: 1, algunos: 1, algunas: 1 };
  // Coletillas finales que no forman parte del destino (las de cercanía, marcadas).
  var FINALES = [
    ['que', 'este', 'mas', 'cerca', 1], ['que', 'esta', 'mas', 'cerca', 1], ['que', 'haya', 'mas', 'cerca', 1], ['que', 'tenga', 'mas', 'cerca', 1],
    ['cerca', 'de', 'aqui', 1], ['cerca', 'de', 'mi', 1], ['mas', 'cerca', 1], ['mas', 'cercano', 1], ['mas', 'cercana', 1],
    ['mas', 'cercanos', 1], ['mas', 'cercanas', 1], ['mas', 'proximo', 1], ['mas', 'proxima', 1],
    ['por', 'favor', 0], ['de', 'aqui', 0], ['por', 'aqui', 1], ['por', 'la', 'zona', 1], ['de', 'la', 'zona', 1],
    ['a', 'pie', 0], ['que', 'haya', 0], ['que', 'este', 0], ['que', 'esta', 0], ['que', 'hay', 0],
    ['cerca', 1], ['cercano', 1], ['cercana', 1], ['proximo', 1], ['proxima', 1],
    ['aqui', 0], ['ahora', 0], ['andando', 0], ['caminando', 0], ['gracias', 0]
  ];
  var VIA = /^(calle|avenida|avda|av|plaza|plazoleta|paseo|ronda|camino|carretera|travesia|pasaje|glorieta|callejon|carrer|avinguda|placa|passeig|cami)$/;

  function vacio() { return { tipo: null, categoria: null, etiquetasOSM: null, nombre: null, hablado: null, esDireccion: false }; }

  function interpretarUna(frase) {
    // Palabras originales (para conservar la grafía del nombre) y normalizadas.
    var orig = String(frase == null ? '' : frase).replace(/[.,;:!?¿¡"()]/g, ' ').split(/\s+/);
    var po = [], pn = [];
    orig.forEach(function (w) { var n = normalizarPalabra(w); if (n) { po.push(w); pn.push(n); } });
    if (!pn.length) return vacio();
    var texto = pn.join(' ');

    function buscar(lista) {
      var mejor = null;
      lista.forEach(function (re) {
        var m = re.exec(texto);
        if (m && (!mejor || m.index < mejor.index)) mejor = { index: m.index, fin: m.index + m[0].length };
      });
      return mejor;
    }
    var m = buscar(FUERTES), fuerte = !!m;
    if (!m) m = buscar(DEBILES);
    var desde = 0;
    if (m) { var antes = texto.slice(0, m.fin).trim(); desde = antes ? antes.split(' ').length : 0; }

    var ro = po.slice(desde), rn = pn.slice(desde), cercania = false;
    function quitarIniciales() { while (rn.length && INICIALES[rn[0]]) { rn.shift(); ro.shift(); } }
    function quitarFinales() {
      var cambiado = true;
      while (cambiado && rn.length) {
        cambiado = false;
        for (var i = 0; i < FINALES.length; i++) {
          var f = FINALES[i], n = f.length - 1;
          if (rn.length >= n && rn.slice(rn.length - n).join(' ') === f.slice(0, n).join(' ')) {
            rn.length -= n; ro.length -= n; if (f[n]) cercania = true; cambiado = true; break;
          }
        }
      }
    }
    quitarIniciales(); quitarFinales(); quitarIniciales();
    if (!rn.length) return vacio();

    var exacta = categoriaExacta(rn);
    if (exacta && (m || cercania)) {
      var c = CATEGORIAS[exacta];
      return { tipo: 'categoria', categoria: c.id, etiquetasOSM: c.etiquetasOSM.slice(), nombre: null, hablado: c.hablado, esDireccion: false };
    }
    if (!m) return vacio();
    var pref = categoriaPrefijo(rn);
    if (!fuerte && !pref) return vacio();
    var esDir = VIA.test(rn[0]);
    return {
      tipo: 'nombre',
      categoria: pref ? pref.id : null,                       // solo orientativa
      etiquetasOSM: pref ? CATEGORIAS[pref.id].etiquetasOSM.slice() : null,
      nombre: ro.join(' '),
      hablado: ro.join(' '),
      esDireccion: esDir
    };
  }

  /**
   * Interpreta una orden hablada. Admite varias alternativas del reconocedor
   * separadas por «|» y se queda con la primera que pida ir a algún sitio.
   * Devuelve { tipo: 'categoria'|'nombre'|null, categoria, etiquetasOSM, nombre,
   *            hablado, esDireccion }.
   */
  function interpretar(frase) {
    var alternativas = String(frase == null ? '' : frase).split('|');
    for (var i = 0; i < alternativas.length; i++) {
      var r = interpretarUna(alternativas[i]);
      if (r.tipo) return r;
    }
    return vacio();
  }

  // ------------------------------------------------------------------
  // Red: límite de frecuencia, tiempo de espera, caché
  // ------------------------------------------------------------------
  var ultimaLlamada = {};   // servicio -> instante de la última petición
  var cache = {};           // clave -> { t, datos }
  function esperar(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function vaciarCache() { cache = {}; ultimaLlamada = {}; }

  async function pedirJSON(servicio, url, init, esperaMs) {
    var f = config.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!f) throw ErrorRutas('red', 'Este navegador no puede conectarse al servicio de mapas.');
    var ahora = Date.now(), falta = (ultimaLlamada[servicio] || 0) + config.intervaloMinimoMs - ahora;
    ultimaLlamada[servicio] = ahora + Math.max(0, falta);
    if (falta > 0) await esperar(falta);

    var control = typeof AbortController === 'function' ? new AbortController() : null;
    var opciones = Object.assign({}, init || {});
    if (control) opciones.signal = control.signal;
    var vencido = false, reloj = null, resp;
    var limite = new Promise(function (_, ko) {
      reloj = setTimeout(function () { vencido = true; if (control) control.abort(); ko(new Error('tiempo')); }, esperaMs);
    });
    try {
      resp = await Promise.race([f(url, opciones), limite]);
    } catch (e) {
      if (vencido) throw ErrorRutas('tiempo', 'El servicio de mapas tarda demasiado en responder. Inténtalo de nuevo.');
      throw ErrorRutas('red', 'No hay conexión con el servicio de mapas. Comprueba tu conexión a internet.');
    } finally {
      clearTimeout(reloj);
    }
    var cuerpo = null;
    try { cuerpo = await resp.json(); } catch (e) { cuerpo = null; }
    if (!resp.ok) {
      // OSRM responde 400 con un JSON que lleva «code»; se devuelve para tratarlo.
      if (resp.status === 400 && cuerpo && cuerpo.code) return cuerpo;
      if (resp.status === 429 || resp.status === 406 || resp.status === 504) {
        throw ErrorRutas('limite', 'El servicio de mapas está saturado. Espera medio minuto y vuelve a intentarlo.');
      }
      throw ErrorRutas('servidor', 'El servicio de mapas ha dado un error. Inténtalo de nuevo dentro de un momento.');
    }
    if (cuerpo === null) throw ErrorRutas('formato', 'El servicio de mapas ha dado una respuesta que no entiendo.');
    return cuerpo;
  }

  function validarCoordenada(lat, lon) {
    return typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon) &&
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  // ------------------------------------------------------------------
  // Búsqueda por categoría: Overpass
  // ------------------------------------------------------------------
  /** Consulta Overpass QL para unas etiquetas ('clave=valor') alrededor de un punto. PURA. */
  function consultaOverpass(lat, lon, etiquetas, radio) {
    var r = Math.round(radio), s = Math.ceil(config.overpass.esperaMs / 1000) - 5;
    var filas = etiquetas.map(function (e) {
      var i = e.indexOf('=');
      return '  nwr["' + e.slice(0, i) + '"="' + e.slice(i + 1) + '"](around:' + r + ',' + lat.toFixed(6) + ',' + lon.toFixed(6) + ');';
    });
    return '[out:json][timeout:' + Math.max(5, s) + '];\n(\n' + filas.join('\n') + '\n);\nout center;';
  }

  function direccionDeEtiquetas(t) {
    var calle = t['addr:street'], num = t['addr:housenumber'];
    if (!calle) return '';
    return calle + (num ? ' ' + num : '');
  }

  /** Convierte la respuesta JSON de Overpass en la lista normalizada. PURA. */
  function normalizarOverpass(json, lat, lon, interpretacion) {
    if (!json || !Array.isArray(json.elements)) throw ErrorRutas('formato', 'El servicio de mapas ha dado una respuesta que no entiendo.');
    var generico = interpretacion && interpretacion.hablado ? interpretacion.hablado.replace(/^(una?|el|la) /, '') : 'lugar';
    var vistos = {}, lista = [];
    json.elements.forEach(function (el) {
      var la = typeof el.lat === 'number' ? el.lat : el.center && el.center.lat;
      var lo = typeof el.lon === 'number' ? el.lon : el.center && el.center.lon;
      if (typeof la !== 'number' || typeof lo !== 'number') return;
      var t = el.tags || {};
      var nombre = t.name || t['name:es'] || t.brand || t.operator || '';
      var item = {
        nombre: nombre || generico.charAt(0).toUpperCase() + generico.slice(1) + ' sin nombre',
        lat: la, lon: lo,
        distancia: Math.round(distancia(lat, lon, la, lo)),
        direccion: direccionDeEtiquetas(t),
        sinNombre: !nombre
      };
      // El mismo sitio puede venir como nodo y como edificio: se deja uno.
      var clave = normalizarTexto(item.nombre) + '@' + Math.round(la * 2000) + ',' + Math.round(lo * 2000);
      if (vistos[clave]) return;
      vistos[clave] = 1;
      lista.push(item);
    });
    lista.sort(function (a, b) { return a.distancia - b.distancia; });
    return lista;
  }

  async function buscarOverpass(lat, lon, interpretacion, radio) {
    var q = consultaOverpass(lat, lon, interpretacion.etiquetasOSM, radio);
    var urls = config.overpass.urls, ultimo = null;
    for (var i = 0; i < urls.length; i++) {
      try {
        var json = await pedirJSON('overpass' + i, urls[i], {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q)
        }, config.overpass.esperaMs);
        return normalizarOverpass(json, lat, lon, interpretacion);
      } catch (e) { ultimo = e; }
    }
    // Reserva: búsqueda estructurada de Nominatim por tipo de lugar (parámetro «amenity»).
    if (config.nominatim.activo) {
      try { return await buscarCategoriaNominatim(lat, lon, interpretacion, radio); }
      catch (e) { ultimo = ultimo || e; }
    }
    throw ultimo || ErrorRutas('desactivado', 'La búsqueda de lugares está desactivada.');
  }

  /** URL de búsqueda estructurada de Nominatim por tipo de lugar dentro de un recuadro. PURA. */
  function urlNominatimCategoria(lat, lon, valor, radio) {
    var dLat = radio / 111320, dLon = radio / (111320 * Math.max(0.01, Math.cos(rad(lat))));
    var caja = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(function (v) { return v.toFixed(5); }).join(',');
    return config.nominatim.url + '?amenity=' + encodeURIComponent(valor) + '&format=jsonv2&limit=20&addressdetails=1' +
      '&accept-language=' + encodeURIComponent(config.nominatim.idioma) + '&viewbox=' + caja + '&bounded=1';
  }

  /** Se quedan solo los resultados cuya clase y tipo coinciden con alguna etiqueta pedida. PURA. */
  function filtrarPorEtiquetas(json, etiquetas) {
    if (!Array.isArray(json)) return json;
    var validas = {};
    etiquetas.forEach(function (e) { var kv = String(e).split('='); if (kv.length === 2) validas[kv[0] + '=' + kv[1]] = true; });
    return json.filter(function (it) { return validas[it.category + '=' + it.type]; });
  }

  async function buscarCategoriaNominatim(lat, lon, interpretacion, radio) {
    var etiquetas = interpretacion.etiquetasOSM || [], vistos = {}, todos = [];
    for (var i = 0; i < etiquetas.length; i++) {
      var kv = String(etiquetas[i]).split('=');
      if (kv.length !== 2 || kv[1] === '*' || vistos[kv[1]]) continue;
      vistos[kv[1]] = true;
      var json = await pedirJSON('nominatim', urlNominatimCategoria(lat, lon, kv[1].replace(/_/g, ' '), radio),
        { headers: { 'Accept': 'application/json' } }, config.nominatim.esperaMs);
      if (!Array.isArray(json)) throw ErrorRutas('formato', 'El servicio de mapas ha dado una respuesta que no entiendo.');
      todos = todos.concat(filtrarPorEtiquetas(json, etiquetas));
    }
    var lista = normalizarNominatim(todos, lat, lon), unicos = [];
    lista.forEach(function (x) {
      if (!unicos.some(function (u) { return u.nombre === x.nombre && distancia(u.lat, u.lon, x.lat, x.lon) < 15; })) unicos.push(x);
    });
    return unicos;
  }

  // ------------------------------------------------------------------
  // Búsqueda por nombre o dirección: Nominatim
  // ------------------------------------------------------------------
  /** URL de búsqueda de Nominatim limitada a un recuadro alrededor del punto. PURA. */
  function urlNominatim(lat, lon, nombre, radio) {
    var dLat = radio / 111320, dLon = radio / (111320 * Math.max(0.01, Math.cos(rad(lat))));
    var caja = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(function (v) { return v.toFixed(5); }).join(',');
    return config.nominatim.url + '?q=' + encodeURIComponent(nombre) + '&format=jsonv2&limit=10&addressdetails=1' +
      '&accept-language=' + encodeURIComponent(config.nominatim.idioma) + '&viewbox=' + caja + '&bounded=1';
  }

  /** Convierte la respuesta jsonv2 de Nominatim en la lista normalizada. PURA. */
  function normalizarNominatim(json, lat, lon) {
    if (!Array.isArray(json)) throw ErrorRutas('formato', 'El servicio de mapas ha dado una respuesta que no entiendo.');
    var lista = [];
    json.forEach(function (it) {
      var la = parseFloat(it.lat), lo = parseFloat(it.lon);
      if (!isFinite(la) || !isFinite(lo)) return;
      var a = it.address || {}, largo = String(it.display_name || '');
      var calle = a.road || a.pedestrian || a.footway || a.square || '';
      var pueblo = a.city || a.town || a.village || a.municipality || '';
      var dir = calle ? calle + (a.house_number ? ' ' + a.house_number : '') + (pueblo ? ', ' + pueblo : '')
                      : largo.split(',').slice(0, 3).join(',').trim();
      lista.push({
        nombre: it.name || largo.split(',')[0].trim() || 'Lugar sin nombre',
        lat: la, lon: lo,
        distancia: Math.round(distancia(lat, lon, la, lo)),
        direccion: dir,
        sinNombre: false
      });
    });
    lista.sort(function (a, b) { return a.distancia - b.distancia; });
    return lista;
  }

  async function buscarNominatim(lat, lon, interpretacion, radio) {
    var url = urlNominatim(lat, lon, interpretacion.nombre, radio);
    var json = await pedirJSON('nominatim', url, { headers: { 'Accept': 'application/json' } }, config.nominatim.esperaMs);
    return normalizarNominatim(json, lat, lon);
  }

  // ------------------------------------------------------------------
  // buscarCercanos
  // ------------------------------------------------------------------
  /**
   * Busca destinos cerca de (lat, lon). Devuelve una lista ordenada por
   * distancia de { nombre, lat, lon, distancia, direccion, sinNombre }
   * (distancia en metros en línea recta). Lista vacía si no hay nada ni
   * siquiera ampliando el radio. Lanza ErrorRutas si falla el servicio.
   */
  async function buscarCercanos(lat, lon, interpretacion, radioMetros) {
    if (!validarCoordenada(lat, lon)) throw ErrorRutas('parametros', 'No tengo una ubicación válida para buscar.');
    var it = interpretacion || {};
    var porCategoria = it.tipo === 'categoria' && Array.isArray(it.etiquetasOSM) && it.etiquetasOSM.length > 0;
    var porNombre = it.tipo === 'nombre' && typeof it.nombre === 'string' && it.nombre.trim() !== '';
    if (!porCategoria && !porNombre) throw ErrorRutas('parametros', 'No he entendido a qué sitio quieres ir.');
    var cfg = porCategoria ? config.overpass : config.nominatim;
    if (!cfg.activo) throw ErrorRutas('desactivado', 'La búsqueda de lugares está desactivada.');

    var r = radioMetros > 0 ? radioMetros : cfg.radioInicial, radios = [];
    for (var k = 0; k < 3; k++) {
      var v = Math.min(r, Math.max(cfg.radioMaximo, radioMetros || 0));
      if (radios.indexOf(v) < 0) radios.push(v);
      r *= 3;
    }
    for (var i = 0; i < radios.length; i++) {
      var clave = (porCategoria ? 'c:' + it.etiquetasOSM.join(',') : 'n:' + normalizarTexto(it.nombre)) +
        '@' + lat.toFixed(4) + ',' + lon.toFixed(4) + ',' + radios[i];
      var guardado = cache[clave], lista;
      if (guardado && Date.now() - guardado.t < config.cacheMs) lista = guardado.datos;
      else {
        lista = porCategoria ? await buscarOverpass(lat, lon, it, radios[i]) : await buscarNominatim(lat, lon, it, radios[i]);
        cache[clave] = { t: Date.now(), datos: lista };
      }
      lista = lista.filter(function (x) { return x.distancia <= radios[i] * 1.5; });
      if (lista.length) return lista.slice(0, config.maxResultados);
    }
    return [];
  }

  /** «Farmacia García, a 230 metros, en Calle Mayor 5». PURA. */
  function fraseResultado(r) {
    var t = r.nombre + ', a ' + formatearDistancia(r.distancia) + ' en línea recta';
    if (r.direccion) t += ', en ' + r.direccion;
    return t + '.';
  }

  // ------------------------------------------------------------------
  // Ruta a pie: OSRM
  // ------------------------------------------------------------------
  /** URL de la petición de ruta. origen y destino: { lat, lon }. PURA. */
  function urlRuta(origen, destino) {
    function c(p) { return p.lon.toFixed(6) + ',' + p.lat.toFixed(6); }   // OSRM: longitud,latitud
    return config.osrm.url + c(origen) + ';' + c(destino) + '?steps=true&geometries=geojson&overview=full&alternatives=false';
  }

  var ORDINALES = ['', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava', 'novena', 'décima'];
  function lado(mod) { return /left/.test(mod || '') ? 'izquierda' : /right/.test(mod || '') ? 'derecha' : null; }
  function por(calle) { return calle ? ' por ' + calle : ''; }
  function giro(mod) {
    switch (mod) {
      case 'left': return 'Gira a la izquierda';
      case 'right': return 'Gira a la derecha';
      case 'slight left': return 'Gira ligeramente a la izquierda';
      case 'slight right': return 'Gira ligeramente a la derecha';
      case 'sharp left': return 'Haz un giro cerrado a la izquierda';
      case 'sharp right': return 'Haz un giro cerrado a la derecha';
      case 'uturn': return 'Da media vuelta';
      default: return 'Sigue recto';
    }
  }

  /**
   * Frase en español para un paso normalizado. PURA.
   * opciones.sinAviso = true omite el recordatorio del tráfico (se usa solo en
   * los avisos previos; la maniobra en sí siempre lo lleva).
   * Cubre todos los tipos de maniobra documentados por OSRM; un tipo
   * desconocido se trata como «turn», tal como indica su documentación.
   */
  function instruccion(paso, opciones) {
    var p = paso || {}, mod = p.modificador || null, calle = p.calle || '', l = lado(mod), base;
    switch (p.tipo) {
      case 'depart':
        base = 'Empieza a caminar' + (isFinite(p.rumboDespues) && p.rumboDespues !== null ? ' hacia ' + puntoCardinal(p.rumboDespues) : '') + por(calle) + '.';
        return base;
      case 'arrive':
        return l ? 'Has llegado. El destino está a tu ' + l + '.' : 'Has llegado a tu destino.';
      case 'new name':
        base = (mod && mod !== 'straight' ? giro(mod) : 'Sigue recto') + (calle ? '. La calle pasa a llamarse ' + calle : '') + '.';
        break;
      case 'continue':
        if (!mod || mod === 'straight') base = 'Sigue recto' + por(calle) + '.';
        else if (mod === 'uturn') base = 'Da media vuelta' + (calle ? ' y sigue por ' + calle : '') + '.';
        else base = giro(mod) + (calle ? ' para seguir por ' + calle : '') + '.';
        break;
      case 'merge':
        base = (l ? 'Incorpórate por la ' + l : 'Incorpórate') + (calle ? ' a ' + calle : '') + '.';
        break;
      case 'ramp': case 'on ramp': case 'off ramp':
        base = (l ? 'Toma el ramal de la ' + l : 'Toma el ramal') + por(calle) + '.';
        break;
      case 'fork':
        base = 'En la bifurcación, sigue por ' + (l ? 'la ' + l : 'el centro') + (calle ? ', por ' + calle : '') + '.';
        break;
      case 'end of road':
        base = 'Al final de la calle, ' + minusculaInicial(giro(mod)) + por(calle) + '.';
        break;
      case 'use lane':
        base = (l ? 'Mantente a la ' + l : 'Sigue recto') + por(calle) + '.';
        break;
      case 'roundabout': case 'rotary':
        var n = p.salida;
        base = 'En la rotonda, ' + (n >= 1 && n <= 10 ? 'toma la ' + ORDINALES[n] + ' salida' : n > 10 ? 'toma la salida número ' + n : 'toma la salida') +
          (calle ? ', por ' + calle : '') + '.';
        break;
      case 'roundabout turn':
        base = 'En la rotonda pequeña, ' + minusculaInicial(giro(mod)) + por(calle) + '.';
        break;
      case 'exit roundabout': case 'exit rotary':
        base = 'Sal de la rotonda' + por(calle) + '.';
        break;
      case 'notification':
        base = (mod && mod !== 'straight' ? giro(mod) : 'Continúa') + por(calle) + '.';
        break;
      case 'turn':
      default:
        base = giro(mod) + por(calle) + '.';
    }
    return opciones && opciones.sinAviso ? base : base + AVISO_CRUCE;
  }

  /**
   * Convierte la respuesta JSON del servicio «route» de OSRM en la ruta
   * normalizada. PURA. Lanza ErrorRutas('sin_ruta') si no hay ruta.
   */
  function normalizarRuta(json) {
    if (!json || typeof json.code !== 'string') throw ErrorRutas('formato', 'El servicio de rutas ha dado una respuesta que no entiendo.');
    if (json.code === 'NoRoute') throw ErrorRutas('sin_ruta', 'No encuentro ningún camino a pie hasta ese sitio.');
    if (json.code === 'NoSegment') throw ErrorRutas('sin_ruta', 'No encuentro ninguna calle cerca de tu posición o del destino.');
    if (json.code !== 'Ok' || !Array.isArray(json.routes) || !json.routes.length) {
      throw ErrorRutas('servidor', 'El servicio de rutas no ha podido calcular el camino.');
    }
    var r = json.routes[0], pasos = [];
    (r.legs || []).forEach(function (tramo) {
      (tramo.steps || []).forEach(function (s) {
        var m = s.maneuver || {}, loc = m.location || [];
        if (typeof loc[0] !== 'number' || typeof loc[1] !== 'number') return;
        var p = {
          lat: loc[1], lon: loc[0],
          distancia: typeof s.distance === 'number' ? s.distance : 0,     // metros hasta la maniobra siguiente
          duracion: typeof s.duration === 'number' ? s.duration : 0,
          tipo: m.type || 'turn',
          modificador: m.modifier || null,
          calle: s.name || '',
          salida: typeof m.exit === 'number' ? m.exit : null,
          rumboAntes: typeof m.bearing_before === 'number' ? m.bearing_before : null,
          rumboDespues: typeof m.bearing_after === 'number' ? m.bearing_after : null,
          texto: ''
        };
        p.texto = instruccion(p);
        pasos.push(p);
      });
    });
    var geometria = [];
    if (r.geometry && Array.isArray(r.geometry.coordinates)) {
      r.geometry.coordinates.forEach(function (c) { if (typeof c[0] === 'number' && typeof c[1] === 'number') geometria.push([c[1], c[0]]); });
    }
    if (geometria.length < 2) geometria = pasos.map(function (p) { return [p.lat, p.lon]; });
    if (!pasos.length) throw ErrorRutas('formato', 'El servicio de rutas no ha devuelto los pasos del camino.');
    var w = Array.isArray(json.waypoints) ? json.waypoints : [];
    return {
      distanciaTotal: typeof r.distance === 'number' ? r.distance : 0,   // metros
      duracion: typeof r.duration === 'number' ? r.duration : 0,         // segundos
      pasos: pasos,
      geometria: geometria,                                              // [[lat, lon], …]
      // Metros entre el punto pedido y la calle a la que OSRM lo ha ajustado.
      separacionOrigen: w[0] && typeof w[0].distance === 'number' ? w[0].distance : 0,
      separacionDestino: w[1] && typeof w[1].distance === 'number' ? w[1].distance : 0
    };
  }

  /**
   * Calcula la ruta a pie. origen y destino: { lat, lon }.
   * Devuelve { distanciaTotal, duracion, pasos: [{ lat, lon, distancia, tipo,
   * modificador, calle, texto, … }], geometria, separacionOrigen, separacionDestino }.
   */
  async function calcularRuta(origen, destino) {
    if (!origen || !destino || !validarCoordenada(origen.lat, origen.lon) || !validarCoordenada(destino.lat, destino.lon)) {
      throw ErrorRutas('parametros', 'Me falta el punto de salida o el de llegada para calcular la ruta.');
    }
    if (!config.osrm.activo) throw ErrorRutas('desactivado', 'El cálculo de rutas está desactivado.');
    var json = await pedirJSON('osrm', urlRuta(origen, destino), { headers: { 'Accept': 'application/json' } }, config.osrm.esperaMs);
    return normalizarRuta(json);
  }

  // ------------------------------------------------------------------
  // Seguimiento de la ruta — PURO (sin red, sin reloj propio si se pasa «tiempo»)
  // ------------------------------------------------------------------
  /**
   * crearSeguimiento(ruta, opciones) -> { actualizar, estado }
   *
   * actualizar({ lat, lon, precision, rumbo, tiempo }) se llama con cada
   * lectura del GPS:
   *   lat, lon   grados
   *   precision  metros (coords.accuracy); si falta, se da por buena
   *   rumbo      grados (coords.heading); opcional; solo se usa al empezar
   *   tiempo     milisegundos (position.timestamp); si falta, Date.now()
   *
   * Devuelve null si no hay nada que decir, o un objeto con ESTA forma:
   *   {
   *     texto: string,          // frase para decir ahora
   *     tipo: 'inicio' | 'preaviso' | 'maniobra' | 'recto' | 'sentido' |
   *           'gps' | 'desvio' | 'vuelta' | 'llegada',
   *     recalcular: boolean,    // true: pide una ruta nueva desde la posición actual
   *     llegada: boolean,       // true: ruta terminada; no habrá más avisos
   *     indicePaso: number,     // índice en ruta.pasos de la próxima maniobra
   *     distanciaManiobra: number | null,  // metros hasta ella por la ruta
   *     distanciaRestante: number | null   // metros hasta el destino por la ruta
   *   }
   *
   * opciones (todas opcionales): preaviso (25 m), precisionMaxima (30 m),
   * intervaloRecto (60 m), margenDesvio (20 m), lecturasDesvio (3),
   * repetirMs (30000), sinAvisoInicial (false).
   */
  function crearSeguimiento(ruta, opciones) {
    var o = Object.assign({ preaviso: 25, precisionMaxima: 30, intervaloRecto: 60, margenDesvio: 20,
      lecturasDesvio: 3, repetirMs: 30000, sinAvisoInicial: false }, opciones || {});
    if (!ruta || !Array.isArray(ruta.pasos) || !ruta.pasos.length || !Array.isArray(ruta.geometria)) {
      throw ErrorRutas('parametros', 'La ruta no es válida.');
    }
    var geo = ruta.geometria.length >= 2 ? ruta.geometria : [ruta.geometria[0] || [ruta.pasos[0].lat, ruta.pasos[0].lon], ruta.geometria[0] || [ruta.pasos[0].lat, ruta.pasos[0].lon]];
    var pasos = ruta.pasos, ultimo = pasos.length - 1;

    // Distancia acumulada en cada vértice de la geometría.
    var acum = [0];
    for (var g = 1; g < geo.length; g++) acum.push(acum[g - 1] + distancia(geo[g - 1][0], geo[g - 1][1], geo[g][0], geo[g][1]));
    var total = acum[acum.length - 1];

    // Posición de cada maniobra a lo largo de la geometría (creciente).
    var sPaso = [], segDesde = 0, sMin = 0;
    pasos.forEach(function (p, idx) {
      if (idx === ultimo && p.tipo === 'arrive') { sPaso.push(total); return; }
      var mejor = null;
      for (var j = segDesde; j < geo.length - 1; j++) {
        var d = distanciaPuntoSegmento(p.lat, p.lon, geo[j][0], geo[j][1], geo[j + 1][0], geo[j + 1][1]);
        var s = acum[j] + d.t * (acum[j + 1] - acum[j]);
        if (s < sMin) continue;
        if (!mejor || d.distancia < mejor.d) mejor = { d: d.distancia, s: s, j: j };
        if (d.distancia < 2) break;                       // primer encaje bueno: no seguir (rutas que repiten calle)
      }
      if (mejor) { segDesde = mejor.j; sMin = mejor.s; }
      sPaso.push(sMin);
    });

    // Estado
    var i = Math.min(1, ultimo);     // próxima maniobra
    var iniciado = false, terminado = false, desviado = false, gpsMalo = false;
    var sActual = 0, sMax = 0, sRecto = 0, sManiobra = 0, pendienteRecto = false;
    var fuera = 0, contra = 0;
    var tGps = null, tDesvio = null, tContra = null;
    var avisado = {};
    var ultimoTexto = null, tUltimoTexto = -Infinity;

    function localizar(lat, lon, umbral) {
      var enVentana = null, global = null;
      for (var j = 0; j < geo.length - 1; j++) {
        var d = distanciaPuntoSegmento(lat, lon, geo[j][0], geo[j][1], geo[j + 1][0], geo[j + 1][1]);
        var c = { d: d.distancia, s: acum[j] + d.t * (acum[j + 1] - acum[j]) };
        if (!global || c.d < global.d) global = c;
        if (acum[j + 1] >= sActual - 40 && acum[j] <= sActual + 150 && (!enVentana || c.d < enVentana.d)) enVentana = c;
      }
      return enVentana && enVentana.d <= umbral ? enVentana : global;
    }
    function previo(paso, d) {
      if (paso.tipo === 'arrive') {
        var l = lado(paso.modificador);
        return 'En ' + formatearDistancia(d) + ' llegarás a tu destino' + (l ? ', que queda a tu ' + l : '') + '.';
      }
      return 'En ' + formatearDistancia(d) + ', ' + minusculaInicial(instruccion(paso, { sinAviso: true }));
    }
    function resumen() {
      var dm = sPaso[i] - sActual;
      if (dm <= o.preaviso) { avisado[i] = true; return previo(pasos[i], Math.max(dm, 1)); }
      return 'Sigue recto ' + formatearDistancia(dm) + '.';
    }
    function emitir(t, tipo, texto, extra) {
      var e = extra || {};
      if (texto === ultimoTexto && t - tUltimoTexto < 20000 && !e.llegada) return null;
      ultimoTexto = texto; tUltimoTexto = t;
      var fin = !!e.llegada;
      return {
        texto: texto, tipo: tipo, recalcular: !!e.recalcular, llegada: fin,
        indicePaso: Math.min(i, ultimo),
        distanciaManiobra: fin || e.sinPosicion ? null : Math.max(0, Math.round(sPaso[Math.min(i, ultimo)] - sActual)),
        distanciaRestante: e.sinPosicion ? null : fin ? 0 : Math.max(0, Math.round(total - sActual))
      };
    }
    function textoLlegada() {
      var t = instruccion(pasos[ultimo].tipo === 'arrive' ? pasos[ultimo] : { tipo: 'arrive' });
      if (ruta.separacionDestino > 15) {
        t += ' El lugar queda a unos ' + formatearDistancia(ruta.separacionDestino) + ' de este punto, fuera del camino que conozco.';
      }
      return t;
    }
    function acotar(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function actualizar(pos) {
      if (terminado || !pos || !validarCoordenada(pos.lat, pos.lon)) return null;
      var t = typeof pos.tiempo === 'number' && isFinite(pos.tiempo) ? pos.tiempo : Date.now();
      var prec = typeof pos.precision === 'number' && isFinite(pos.precision) && pos.precision >= 0 ? pos.precision : 0;

      // 1. GPS poco preciso: avisar y no dar giros.
      if (prec > o.precisionMaxima) {
        gpsMalo = true;
        if (tGps === null || t - tGps >= o.repetirMs) {
          tGps = t;
          ultimoTexto = null;
          return emitir(t, 'gps', 'La señal de GPS es poco precisa, de unos ' + formatearDistancia(prec) +
            '. No puedo indicarte los giros con seguridad. Avanza con precaución o espera a que mejore.', { sinPosicion: !iniciado });
        }
        return null;
      }
      var prefijo = '';
      if (gpsMalo) { gpsMalo = false; tGps = null; prefijo = 'La señal de GPS ha mejorado. '; }

      // 2. Posición sobre la ruta y desvío.
      var umbralDesvio = o.margenDesvio + prec;
      var loc = localizar(pos.lat, pos.lon, umbralDesvio);
      if (loc.d > umbralDesvio) {
        fuera++;
        if (fuera >= o.lecturasDesvio) {
          if (!desviado) {
            desviado = true; tDesvio = t;
            return emitir(t, 'desvio', 'Te has salido de la ruta. Párate en un lugar seguro mientras calculo un camino nuevo.', { recalcular: true });
          }
          if (t - tDesvio >= o.repetirMs) {
            tDesvio = t; ultimoTexto = null;
            return emitir(t, 'desvio', 'Sigues fuera de la ruta. Vuelvo a calcular el camino.', { recalcular: true });
          }
        }
        return null;
      }
      fuera = 0;
      sActual = loc.s;
      var tipoPrefijo = prefijo ? 'gps' : null;
      if (desviado) { desviado = false; prefijo = 'Has vuelto a la ruta. '; tipoPrefijo = 'vuelta'; sMax = sActual; sRecto = sActual; }

      var umbralLlegada = acotar(prec, 10, 20), umbralManiobra = acotar(prec, 8, 15);

      // 3. Primera lectura válida: presentación de la ruta.
      if (!iniciado) {
        iniciado = true; sMax = sActual; sRecto = sActual;
        while (i < ultimo && sPaso[i] <= sActual + umbralManiobra) i++;
        if (total - sActual <= umbralLlegada) { terminado = true; return emitir(t, 'llegada', textoLlegada(), { llegada: true }); }
        var ini = 'Ruta de ' + formatearDistancia(total) + ', ' + formatearDuracion(ruta.duracion) + ' andando. ';
        if (!o.sinAvisoInicial) ini += AVISO_SEGURIDAD + ' ';
        var p0 = pasos[0];
        ini += p0.tipo === 'depart' ? instruccion(p0) : 'Empieza a caminar.';
        if (typeof pos.rumbo === 'number' && isFinite(pos.rumbo) && p0.rumboDespues !== null && isFinite(p0.rumboDespues)) {
          var dif = diferenciaRumbo(pos.rumbo, p0.rumboDespues), a = Math.abs(dif);
          ini += a < 30 ? ' Esa dirección la tienes de frente.' : a > 150 ? ' Esa dirección queda detrás de ti.'
            : dif > 0 ? ' Esa dirección queda a tu derecha.' : ' Esa dirección queda a tu izquierda.';
        }
        return emitir(t, 'inicio', ini + ' ' + resumen());
      }

      // 4. Llegada.
      if (total - sActual <= umbralLlegada) {
        terminado = true; i = ultimo;
        return emitir(t, 'llegada', textoLlegada(), { llegada: true });
      }

      // 5. Maniobra intermedia alcanzada (o sobrepasada).
      if (i < ultimo && sPaso[i] - sActual <= umbralManiobra) {
        while (i + 1 < ultimo && sPaso[i + 1] - sActual <= umbralManiobra) i++;
        var texto = instruccion(pasos[i]);
        i++;
        var dSig = sPaso[i] - sActual;
        if (dSig <= o.preaviso + 10) { avisado[i] = true; texto += ' Enseguida, ' + minusculaInicial(previo(pasos[i], Math.max(dSig, 1))); pendienteRecto = false; }
        else { pendienteRecto = true; }
        sManiobra = sActual; sRecto = sActual; sMax = Math.max(sMax, sActual); contra = 0;
        return emitir(t, 'maniobra', prefijo + texto);
      }

      // 6. Aviso previo.
      var dm = sPaso[i] - sActual;
      if (dm <= o.preaviso && !avisado[i]) {
        avisado[i] = true;
        return emitir(t, 'preaviso', prefijo + previo(pasos[i], Math.max(dm, 1)));
      }

      // 7. Sentido contrario (se retrocede por la ruta).
      if (sActual > sMax) sMax = sActual;
      if (sMax - sActual > 25 + prec) {
        contra++;
        if (contra >= 3 && (tContra === null || t - tContra >= o.repetirMs)) {
          tContra = t; sMax = sActual; contra = 0; ultimoTexto = null;
          return emitir(t, 'sentido', prefijo + 'Parece que caminas en sentido contrario al de la ruta. Da media vuelta cuando puedas hacerlo con seguridad.');
        }
      } else contra = 0;

      // 8. «Sigue recto N metros»: tras una maniobra y luego cada cierto trecho.
      if (prefijo) return emitir(t, tipoPrefijo, prefijo + resumen());
      if (dm > o.preaviso + 15) {
        if (pendienteRecto && sActual - sManiobra >= 8) {
          pendienteRecto = false; sRecto = sActual;
          return emitir(t, 'recto', 'Sigue recto ' + formatearDistancia(dm) + por(pasos[i - 1] && pasos[i - 1].calle) + '.');
        }
        if (!pendienteRecto && sActual - sRecto >= o.intervaloRecto) {
          sRecto = sActual;
          return emitir(t, 'recto', 'Sigue recto ' + formatearDistancia(dm) + '.');
        }
      }
      return null;
    }

    function estado() {
      return { iniciado: iniciado, terminado: terminado, fueraDeRuta: desviado, gpsImpreciso: gpsMalo,
        indicePaso: Math.min(i, ultimo), recorrido: sActual, distanciaRestante: Math.max(0, total - sActual), longitud: total };
    }
    return { actualizar: actualizar, estado: estado };
  }

  // ------------------------------------------------------------------
  // API pública
  // ------------------------------------------------------------------
  var PFRutas = {
    config: config,
    AVISO_SEGURIDAD: AVISO_SEGURIDAD,
    CATEGORIAS: CATEGORIAS,
    // principales
    interpretar: interpretar,
    buscarCercanos: buscarCercanos,
    calcularRuta: calcularRuta,
    instruccion: instruccion,
    crearSeguimiento: crearSeguimiento,
    fraseResultado: fraseResultado,
    // utilidades puras
    distancia: distancia,
    rumbo: rumbo,
    diferenciaRumbo: diferenciaRumbo,
    distanciaPuntoSegmento: distanciaPuntoSegmento,
    formatearDistancia: formatearDistancia,
    formatearDuracion: formatearDuracion,
    puntoCardinal: puntoCardinal,
    normalizarTexto: normalizarTexto,
    // piezas puras de los servicios (útiles para pruebas y diagnóstico)
    consultaOverpass: consultaOverpass,
    normalizarOverpass: normalizarOverpass,
    urlNominatim: urlNominatim,
    normalizarNominatim: normalizarNominatim,
    urlNominatimCategoria: urlNominatimCategoria,
    filtrarPorEtiquetas: filtrarPorEtiquetas,
    urlRuta: urlRuta,
    normalizarRuta: normalizarRuta,
    vaciarCache: vaciarCache
  };

  raiz.PFRutas = PFRutas;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFRutas;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);

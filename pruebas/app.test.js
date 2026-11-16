// Pruebas de la lógica de la app (index.html) sin navegador: node pruebas/app.test.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace("'use strict';", '')
  .replace("if (typeof document !== 'undefined' && btnGuide) {", 'if (false) {');
const el = () => ({ getContext: () => ({}), addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {} });
const sandbox = `const document={getElementById:el,addEventListener(){},querySelector:el,createElement:el};
const window={addEventListener(){}};const navigator={};const localStorage={getItem(){return null},setItem(){}};
const PFRutas=require(${JSON.stringify(path.join(__dirname, '..', 'rutas.js'))});
${js}
return {command, extractName, isYes, isNo, nextLevel, analyzeDepth, depthAdvice, approaching, tiltAdvice, codeText, lightColor, lightLabel,
  estimateDistance, zoneOf, process, advice, metros, placeText, reportText, median, NAV_MODE, PRI, OPTIONS_TEXT, PFRutas,
  sim(levels){ const said=[]; say=(t,m)=>{said.push([t,m]);return true}; buzz=()=>{}; tones=()=>{}; depthPipe={}; let T=1e6; const real=Date.now; Date.now=()=>T;
    stopped=false; dangerRun=0; freeAt=0; introUntil=0; lastUrgent=0; lastSummary=0; lastWarn=0; lastClear=T; coming=null; tiltBeta=null;
    for(const l of levels){ depth={level:l,ts:T,ms:500,L:.3,R:.9,C:.8,B:.9}; announce([]); T+=500; } Date.now=real; return said; } };`;
const A = new Function('el', 'require', sandbox.replace('function say(', 'var say0=function(').replace('function buzz(', 'var buzz0=function(').replace('function tones(', 'var tones0=function(')
  .replace('const voice = makeVoice(', 'var say, buzz, tones; const voice = makeVoice('))(el, require);
let n = 0; const ok = name => console.log('  ok  ' + name, ++n);

// Qué entiende la app: primero destinos (como hace handle), después órdenes
const entiende = f => { const d = A.PFRutas.interpretar(f); return d.tipo ? 'ir:' + (d.categoria || d.nombre) : A.command(f); };
const frases = {
  'para': 'stop', 'Para.': 'stop', 'para ya': 'stop', 'para la guía': 'stop', 'para la lectura': 'stop', 'detente': 'stop', 'quiero parar': 'stop', 'cállate': 'stop', 'silencio': 'stop',
  'cuánto falta para llegar': 'remaining', 'cuánto falta': 'remaining', 'cuánto queda': 'remaining',
  'lee esto': 'read', 'léeme esto': 'read', 'lee esto para mí': 'read', 'quiero leer una carta': 'read', 'léelo': 'read', 'leer': 'read',
  'lee el código': 'code', 'código QR': 'code', 'lee el qr': 'code',
  'dónde estoy': 'where', 'en qué calle estoy': 'where', 'dónde me encuentro': 'where',
  'qué hay delante': 'describe', 'qué ves': 'describe',
  'inicia la guía': 'start', 'empieza': 'start', 'guíame': 'start', 'activa la guía': 'start',
  'opciones': 'options', 'qué puedes hacer': 'options', 'ayuda': 'help',
  'repite': 'repeat', 'otra vez': 'repeat', 'abrir': 'open', 'ábrela': 'open',
  'cambia mi nombre': 'rename', 'calibra': 'calibrate', 'diagnóstico': 'report',
  'siguiente': 'next', 'otro sitio': 'next', 'cancela la ruta': 'cancel', 'apaga la guía': 'stop',
  'hola qué tal': null, 'no sé': null,
  'lee esto | le esto | lea esto': 'read', 'para | pará | parra': 'stop',
  'llévame a la farmacia más cercana': 'ir:farmacia', 'quiero ir a un bar': 'ir:bar', 'llévame a la calle Mayor 5': 'ir:calle Mayor 5'
};
for (const f in frases) assert.strictEqual(entiende(f), frases[f], '«' + f + '» → ' + entiende(f) + ' (esperado ' + frases[f] + ')');
ok(Object.keys(frases).length + ' frases de voz entendidas correctamente');

for (const [k, v] of [['Me llamo Juan Carlos', 'Juan'], ['soy maría', 'María'], ['Ángel', 'Ángel'], ['hola, me llamo Pepe', 'Pepe'], ['', ''], ['a', '']]) assert.strictEqual(A.extractName(k), v, k);
assert(A.isYes('sí') && A.isYes('si, correcto') && !A.isYes('no') && A.isNo('no') && !A.isNo('sí'));
ok('nombre de pila y confirmación');

let lv = 'free';
assert.deepStrictEqual([0.5, 0.69, 0.71, 0.80, 0.85, 0.87, 0.80, 0.75, 0.73, 0.65, 0.61, 0.63, 0.59].map(c => lv = A.nextLevel(lv, c, false, 0.86)),
  ['free', 'free', 'warn', 'warn', 'warn', 'stop', 'stop', 'stop', 'warn', 'warn', 'free', 'free', 'free']);
lv = 'free'; assert(![0.70, 0.76, 0.71, 0.75, 0.69, 0.77, 0.72].map(c => lv = A.nextLevel(lv, c, false, 0.86)).includes('stop'));
assert.strictEqual(A.nextLevel('free', 0.2, true, 0.86), 'stop');
ok('estados del camino con histéresis');

const mk = (W, H, f) => { const d = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = f(x / W, y / H); return d; };
const W = 120, H = 160, floor = y => y > 0.5 ? Math.max(0.05, (y - 0.5) * 2) : 0.05;
assert(A.analyzeDepth(mk(W, H, (x, y) => floor(y)), W, H).C < 0.5);
assert(A.analyzeDepth(mk(W, H, (x, y) => Math.max(floor(y), 0.9)), W, H).C > 0.86);
assert(A.analyzeDepth(mk(W, H, () => 3), W, H).flat);
const mueble = A.analyzeDepth(mk(W, H, (x, y) => { let v = floor(y); if (x > 0.35 && x < 0.65 && y > 0.2 && y < 0.9) v = Math.max(v, 0.9); if (x > 0.67) v = Math.max(v, 0.7); return v; }), W, H);
assert.strictEqual(A.depthAdvice(mueble), 'Hay hueco a la izquierda.');
ok('análisis de profundidad con escenas simuladas');

const said = A.sim(['stop', 'free', 'stop', 'free', 'stop', 'stop', 'free', 'free', 'free', 'free', 'free', 'free']);
assert.strictEqual(said.filter(x => x[0].startsWith('Para')).length, 1); assert.strictEqual(said.filter(x => x[1] === 'alert').length, 1);
assert.strictEqual(said.filter(x => /libre|seguir/.test(x[0])).length, 1);
ok('paso oscilante: una orden de parar y un "camino libre"');

const P = (k, z, d) => ({ kind: k, zone: z, dist: d, name: k });
assert(A.approaching([P('person', 'cen', 5)], [P('person', 'cen', 3.5)], 1500) && !A.approaching([P('chair', 'cen', 5)], [P('chair', 'cen', 2)], 1500));
assert(A.tiltAdvice(30).includes('Levanta') && A.tiltAdvice(90) === null);
assert.strictEqual(A.codeText('https://www.ejemplo.es/x').url, 'https://www.ejemplo.es/x'); assert.strictEqual(A.codeText('Hola').text, 'El código dice: Hola');
const px = (r, g, b) => { const a = new Uint8ClampedArray(24 * 48 * 4); for (let i = 0; i < 24 * 48; i++) { const on = i < 120; a[i * 4] = on ? r : 30; a[i * 4 + 1] = on ? g : 30; a[i * 4 + 2] = on ? b : 30; } return a; };
assert.strictEqual(A.lightColor(px(230, 40, 40)), 'rojo'); assert.strictEqual(A.lightColor(px(40, 220, 150)), 'verde'); assert.strictEqual(A.lightColor(px(240, 170, 40)), 'ámbar');
assert(!/puedes cruzar/i.test(A.lightLabel('verde')));
assert(A.placeText({ address: { road: 'Calle Mayor', house_number: '5', city: 'Castellón' } }, 12).startsWith('Estás en Calle Mayor, número 5, Castellón.'));
ok('acercamiento, inclinación, códigos, semáforos y ubicación');

for (const t of ['inicio', 'maniobra', 'desvio', 'llegada', 'preaviso', 'sentido', 'gps', 'vuelta', 'recto']) assert(A.NAV_MODE[t] in A.PRI, t);
ok('todos los tipos de aviso de ruta tienen prioridad de voz');
console.log('\n' + n + ' de 7 bloques correctos.');

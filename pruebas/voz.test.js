const PRI = { alert: 3, urgent: 2, queue: 2, info: 1, skip: 0 };
function makeVoice(engine, now, setT, clearT) {
  let cur = null, q = [], gen = 0, dog = null;
  function next() {
    while (q.length) {
      const it = q.shift();
      if (it.ttl && now() - it.t > it.ttl) continue;
      play(it, 0); return;
    }
  }
  function play(it, delay) {
    cur = it;
    const g = ++gen;
    const end = () => {
      if (g !== gen || cur !== it) return;
      if (dog !== null) { clearT(dog); dog = null; }
      cur = null;
      next();
      if (it.onDone) it.onDone();
    };
    const go = () => {
      if (g !== gen || cur !== it) return;
      it.started = now();
      engine.speak(it.text, end);
      // Si el móvil no avisa de que la frase terminó, se da por terminada pasado su tiempo estimado.
      dog = setT(end, it.text.length * 110 + 4000);
    };
    if (delay) setT(go, delay); else go();
  }
  function interrupt() {
    gen++;
    if (dog !== null) { clearT(dog); dog = null; }
    const was = cur; cur = null;
    if (was) engine.cancel();
    return !!was;
  }
  function say(text, mode, onDone) {
    const pri = PRI[mode] === undefined ? 2 : PRI[mode];
    const it = { text, pri, mode, onDone, t: now(), ttl: mode === 'info' ? 4000 : 0, started: 0 };
    const idle = !cur && !q.length;
    if (idle) { play(it, 0); return true; }
    if (mode === 'skip') return false;
    if (mode === 'info') { q = q.filter(x => x.mode !== 'info'); q.push(it); return true; }
    if (mode === 'queue') { q.push(it); return true; }
    if (mode === 'alert') {
      q = q.filter(x => x.pri >= 2 && x.mode !== 'alert');
      if (cur && cur.mode === 'alert' && now() - (cur.started || cur.t) < 2500) { q.unshift(it); return true; }
      const cut = interrupt();
      play(it, cut ? 150 : 0);   // tras cortar una frase, el móvil necesita un instante antes de hablar
      return true;
    }
    // urgent
    q = q.filter(x => x.mode === 'alert');
    if (cur && cur.mode === 'alert') { q.push(it); return true; }
    const cut = interrupt();
    play(it, cut ? 150 : 0);
    return true;
  }
  return {
    say,
    shutUp() { q = []; interrupt(); },
    busy() { return !!cur || q.length > 0; },
    state() { return { cur: cur && cur.text, queued: q.map(x => x.text) }; }
  };
}

const assert = require('assert');
// Reloj y temporizadores virtuales
let T = 0, timers = [], tid = 0;
const setT = (f, ms) => { timers.push({ id: ++tid, at: T + ms, f }); return tid; };
const clearT = id => { timers = timers.filter(x => x.id !== id); };
function run(until) { for (;;) { timers.sort((a, b) => a.at - b.at); const n = timers[0]; if (!n || n.at > until) break; timers.shift(); T = n.at; n.f(); } T = until; }
// Motor de voz simulado: cada frase dura 60 ms por carácter. Detecta si dos frases suenan a la vez.
function fake(opts) {
  opts = opts || {};
  const log = []; let active = null, overlaps = 0;
  return { log, get overlaps() { return overlaps; },
    speak(text, onend) {
      if (active) overlaps++;
      const me = { text, start: T, end: null, cut: false }; active = me; log.push(me);
      if (!opts.mute) me.timer = setT(() => { if (active === me) { active = null; me.end = T; onend(); } }, text.length * 60);
    },
    cancel() { if (active) { active.cut = true; active.end = T; if (active.timer) clearT(active.timer); active = null; } } };
}
function fresh(opts) { T = 0; timers = []; const e = fake(opts); return [makeVoice(e, () => T, setT, clearT), e]; }
const texts = e => e.log.map(x => x.text + (x.cut ? ' [cortada]' : ''));
let n = 0; const ok = name => console.log('  ok  ' + name, ++n);

{ // 1. Lo que sufrió el usuario: parar / libre / parar / libre en ráfaga
  const [v, e] = fresh();
  v.say('Para. Obstáculo delante. Hay hueco a la izquierda.', 'alert'); run(400);
  v.say('Camino libre.', 'info'); run(800);
  v.say('Para. Persona delante. Pasa por la derecha.', 'alert'); run(1200);
  v.say('Puedes seguir, muy despacio.', 'info'); run(20000);
  assert.strictEqual(e.overlaps, 0);
  assert.deepStrictEqual(texts(e), ['Para. Obstáculo delante. Hay hueco a la izquierda.', 'Para. Persona delante. Pasa por la derecha.']);
  ok('ráfaga parar/libre: ninguna frase cortada ni solapada; los "libre" caducados no se dicen');
}
{ // 2. Una orden de parar corta una respuesta larga, y la respuesta en cola sigue después
  const [v, e] = fresh();
  v.say('Guía activada. Lleva el móvil a la altura del pecho.', 'urgent'); v.say('Estás en calle Mayor, Castellón.', 'queue'); run(500);
  v.say('Para. Obstáculo delante.', 'alert'); run(30000);
  assert.strictEqual(e.overlaps, 0);
  assert.deepStrictEqual(texts(e), ['Guía activada. Lleva el móvil a la altura del pecho. [cortada]', 'Para. Obstáculo delante.', 'Estás en calle Mayor, Castellón.']);
  assert.strictEqual(e.log[1].start, 650, 'pausa de 150 ms tras cortar');
  ok('parar corta la respuesta en curso y lo que estaba en cola se dice después');
}
{ // 3. Un comentario no interrumpe ni se cuela
  const [v, e] = fresh();
  assert.strictEqual(v.say('Estás en calle Mayor.', 'urgent'), true); run(100);
  assert.strictEqual(v.say('Silla a la derecha, a 2 metros.', 'skip'), false); run(30000);
  assert.strictEqual(v.say('Silla a la derecha, a 2 metros.', 'skip'), true); run(60000);
  assert.deepStrictEqual(texts(e), ['Estás en calle Mayor.', 'Silla a la derecha, a 2 metros.']);
  ok('skip solo suena con la voz libre');
}
{ // 4. Una lectura larga se dice entera y en orden
  const [v, e] = fresh();
  ['Uno uno uno.', 'Dos dos dos.', 'Tres tres tres.', 'Fin del texto.'].forEach(t => v.say(t, 'queue')); run(60000);
  assert.deepStrictEqual(texts(e), ['Uno uno uno.', 'Dos dos dos.', 'Tres tres tres.', 'Fin del texto.']); assert.strictEqual(e.overlaps, 0);
  ok('la cola respeta el orden');
}
{ // 5. Una respuesta nueva sustituye a la anterior y a su cola
  const [v, e] = fresh();
  v.say('Busco una farmacia.', 'urgent'); v.say('Te llevo a Farmacia Marco.', 'queue'); run(200);
  v.say('Ruta cancelada.', 'urgent'); run(30000);
  assert.deepStrictEqual(texts(e), ['Busco una farmacia. [cortada]', 'Ruta cancelada.']);
  ok('urgent corta y vacía la cola de respuestas');
}
{ // 6. Dos órdenes de parar seguidas no se pisan
  const [v, e] = fresh();
  v.say('Para. Obstáculo delante.', 'alert'); run(1000);
  v.say('Para. Persona delante.', 'alert'); run(30000);
  assert.deepStrictEqual(texts(e), ['Para. Obstáculo delante.', 'Para. Persona delante.']); assert.strictEqual(e.overlaps, 0);
  ok('una orden de parar recién empezada no se corta');
}
{ // 7. Respuesta del usuario mientras suena una orden de parar: espera, no corta
  const [v, e] = fresh();
  v.say('Para. Obstáculo delante.', 'alert'); run(300); v.say('Estás en calle Mayor.', 'urgent'); run(30000);
  assert.deepStrictEqual(texts(e), ['Para. Obstáculo delante.', 'Estás en calle Mayor.']);
  ok('urgent no corta una orden de parar');
}
{ // 8. El móvil no avisa del final: el temporizador de seguridad desbloquea la cola
  const [v, e] = fresh({ mute: true });
  v.say('Hola.', 'urgent'); v.say('Adiós.', 'queue'); run(100); assert.strictEqual(e.log.length, 1);
  run(60000); assert.deepStrictEqual(e.log.map(x => x.text), ['Hola.', 'Adiós.']);
  ok('sin aviso de fin, la cola no se queda colgada');
}
{ // 9. shutUp y onDone
  const [v, e] = fresh(); let done = 0;
  v.say('¿Cómo te llamas?', 'urgent', () => done++); run(30000); assert.strictEqual(done, 1);
  v.say('Frase larga que se va a cortar ahora mismo.', 'urgent', () => done++); v.say('Otra.', 'queue'); run(100); v.shutUp(); run(30000);
  assert.strictEqual(done, 1); assert.strictEqual(v.busy(), false); assert.strictEqual(e.log.length, 2);
  ok('shutUp calla todo y no llama al final de la frase cortada');
}
{ // 10. Prueba de estrés: 400 avisos aleatorios, jamás dos a la vez
  const [v, e] = fresh(); let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const modes = ['alert', 'urgent', 'queue', 'info', 'skip'];
  for (let i = 0; i < 400; i++) { v.say('Frase número ' + i + ' de prueba.', modes[Math.floor(rnd() * 5)]); run(T + Math.floor(rnd() * 900)); }
  run(T + 600000);
  assert.strictEqual(e.overlaps, 0); assert.strictEqual(v.busy(), false);
  for (let i = 1; i < e.log.length; i++) assert.ok(e.log[i].start >= e.log[i - 1].end, 'solape en ' + i);
  ok('estrés: ' + e.log.length + ' frases dichas, 0 solapes');
}
console.log('\n' + n + ' de 10 pruebas de voz correctas.');

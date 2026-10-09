// =============================================================================
//  Судоходный шлюз: двое ворот, камера, налив и слив
// =============================================================================
//
//  Снаружи шлюзом управляют двумя командами — «открыть верхний бьеф» и
//  «открыть нижний бьеф». Всё остальное (закрыть другие ворота, выровнять
//  уровень в камере, открыть нужные ворота) делает эта автоматика.
//  Для наладки — дашборд с ручным режимом.
//
//  ГЛАВНОЕ ПРАВИЛО: ОБЕ ВОРОТА НЕ МОГУТ БЫТЬ ОТКРЫТЫ ОДНОВРЕМЕННО — сквозной
//  поток повредит модель. Открыть ворота можно, только если у других ворот
//  горит концевик «закрыто». Проверяется по самому концевику, а не по тексту
//  состояния. Действует всегда: в авто, в ручном, при любой команде.
//
//  При любом сбое ворота ЗАКРЫВАЮТСЯ (закрытые ворота поток не пропустят):
//    - пропал Ethernet;
//    - контроллер перешёл на батарею;
//    - контроллер стартовал, а ни одни ворота не на концевике «закрыто»;
//    - мотор поехал на открытие при незакрытых других воротах.
//  Это работает в любом режиме, и в ручном тоже.
//
//  Неисправность мотора — только СТОП и ошибка, без попыток закрыть:
//    - мотор включён, а импульсов датчика оборотов нет (мотор не крутится);
//    - перебег: импульсов больше полного хода с запасом, а концевика нет;
//    - ток мотора выше порога;
//    - ход длится дольше общего таймаута (страховка на случай, если
//      отказал сам датчик оборотов).
//  Привод червячный: если ворота во что-то упрутся, мотор не встанет, а будет
//  давить дальше. Поэтому заклинивание ловят перебег и ток, а не «нет импульсов».
//
//  Ошибка сбрасывается ТОЛЬКО кнопкой на дашборде — человек должен увидеть
//  причину. Ни внешняя команда, ни следующий цикл её не снимают.
//
//  Железо одних ворот
//  ------------------
//    MAO4, канал 1 Switch  — мотор вкл/выкл
//    MAO4, канал 1 Dimming — скорость, %
//    MAO4, канал 2 Switch  — направление
//    MAO4, вход 1          — концевик «открыто»
//    MAO4, вход 2          — концевик «закрыто»
//    MCM8, счётчик входа   — импульсы датчика оборотов
//    MAI6, вход            — ток мотора (напряжение с датчика тока)
//  Концевики останавливают мотор и сами, в модуле MAO4 (локальные действия
//  входов, настроены в конфиге драйвера) — даже если правила не работают.
//
//  Камера: гидростатический датчик уровня 4–20 мА на MAI6, клапаны налива
//  и слива — релейные выходы (пока не подключены, см. VALVES_PRESENT).
//
//  Все числа, которые подбираются на месте (ход, скорости, пороги, уровни,
//  калибровка датчика), — на дашборде и переживают перезагрузку. Ниже, в
//  разделе «Подключение», — только то, что меняется вместе с проводами.
//
// =============================================================================


// -----------------------------------------------------------------------------
//  Подключение. Меняется, только если перекинули провода или модули.
// -----------------------------------------------------------------------------

// Имя устройства для внешней системы: /devices/<SHLUSES_ID>/controls/...
var SHLUSES_ID = "shluses";

// Каждый вход и выход — отдельной строкой: перекинули провод — правится
// одна строка здесь, код ниже не трогается.

// --- Верхние ворота (к верхнему бьефу) ---
var HI_MOTOR      = "wb-mao4_190/Channel 1 Switch";         // мотор вкл/выкл
var HI_SPEED      = "wb-mao4_190/Channel 1 Dimming Level";  // скорость, %
var HI_DIR        = "wb-mao4_190/Channel 2 Switch";         // направление
var HI_DIR_LEVEL  = "wb-mao4_190/Channel 2 Dimming Level";  // уровень выхода направления
var HI_LIM_OPEN   = "wb-mao4_190/Input 1";                  // концевик «открыто»
var HI_LIM_CLOSE  = "wb-mao4_190/Input 2";                  // концевик «закрыто»
var HI_PULSES     = "wb-mcm8_212/Input 2 counter";          // датчик оборотов
var HI_CURRENT    = "wb-mai6_16/IN 1 P Voltage";              // ток мотора

// --- Нижние ворота (к нижнему бьефу) ---
var LO_MOTOR      = "wb-mao4_172/Channel 1 Switch";
var LO_SPEED      = "wb-mao4_172/Channel 1 Dimming Level";
var LO_DIR        = "wb-mao4_172/Channel 2 Switch";
var LO_DIR_LEVEL  = "wb-mao4_172/Channel 2 Dimming Level";
var LO_LIM_OPEN   = "wb-mao4_172/Input 1";
var LO_LIM_CLOSE  = "wb-mao4_172/Input 2";
var LO_PULSES     = "wb-mcm8_212/Input 3 counter";
var LO_CURRENT    = "wb-mai6_16/IN 2 P Voltage";

// --- Камера ---
var LEVEL_SENSOR_MA = "wb-mai6_16/IN 3 P Current";            // ток датчика уровня, мА

var HW = {
  hi_gate: { title: "Верхние ворота", motor: HI_MOTOR, speed: HI_SPEED, dir: HI_DIR, dirLevel: HI_DIR_LEVEL,
             limOpen: HI_LIM_OPEN, limClose: HI_LIM_CLOSE, pulses: HI_PULSES, current: HI_CURRENT },
  lo_gate: { title: "Нижние ворота",  motor: LO_MOTOR, speed: LO_SPEED, dir: LO_DIR, dirLevel: LO_DIR_LEVEL,
             limOpen: LO_LIM_OPEN, limClose: LO_LIM_CLOSE, pulses: LO_PULSES, current: LO_CURRENT }
};

// Клапаны. Пока модуля нет — false: налив/слив пропускаются, ручные
// переключатели клапанов ничего не делают. Когда поставят — true и имена.
var VALVES_PRESENT = false;
var VALVE_FILL  = "wb-mrm2-mini_0/K1";         // налив (из верхнего бьефа)
var VALVE_DRAIN = "wb-mrm2-mini_0/K2";         // слив (в нижний бьеф)

var TICK_MS = 500;                             // шаг проверок автоматики
var INTERLOCK_SETTLE_MS = 300;                 // пауза сторожа «обе не открыты», см. makeGate
var SENSOR_BROKEN_MA = 3.5;                    // ниже — обрыв петли датчика уровня (норма 4–20 мА)


// -----------------------------------------------------------------------------
//  Мелочи
// -----------------------------------------------------------------------------

function now() { return Date.now(); }

// Параметр с дашборда (виртуальные устройства сохраняют значения сами).
function par(devName, cell) { return Number(dev[devName + "/" + cell]); }

// Значение топика как число; null, если топика ещё нет.
function num(topic) {
  var v = dev[topic];
  return (v === undefined || v === null || v === "") ? null : Number(v);
}

function setValves(fill, drain) {
  if (!VALVES_PRESENT) { return; }
  dev[VALVE_FILL] = fill;
  dev[VALVE_DRAIN] = drain;
}


// -----------------------------------------------------------------------------
//  Дашборд шлюза: режим, уровень, ошибка, параметры камеры
// -----------------------------------------------------------------------------
// forceDefault: true — для того, что вычисляется (не должно «вспоминаться»
// после перезагрузки). Без него — параметры: их значения сохраняются.

defineVirtualDevice("shluses_ctl", {
  title: "Шлюз — управление",
  cells: {
    manual:      { title: "Ручной режим", type: "switch", value: false, order: 1 },
    step:        { title: "Шаг автоматики", type: "text", value: "", readonly: true, forceDefault: true, order: 2 },
    error:       { title: "Ошибка", type: "text", value: "", readonly: true, forceDefault: true, order: 3 },
    reset_error: { title: "Сбросить ошибку", type: "pushbutton", order: 4 },
    level_mm:    { title: "Уровень от пола", type: "value", units: "mm", value: 0, readonly: true, forceDefault: true, order: 5 },
    level_rate:  { title: "Скорость уровня", type: "value", units: "mm/s", value: 0, readonly: true, forceDefault: true, order: 6 },
    chamber:     { title: "Камера", type: "text", value: "", readonly: true, forceDefault: true, order: 7 },
    valve_fill:  { title: "Клапан налива (ручной)", type: "switch", value: false, forceDefault: true, order: 8 },
    valve_drain: { title: "Клапан слива (ручной)", type: "switch", value: false, forceDefault: true, order: 9 },

    // --- уровни камеры, мм от пола ---
    empty_mm:     { title: "Пустая камера, мм", type: "value", value: 70,  readonly: false, order: 20 },
    full_mm:      { title: "Полная камера, мм", type: "value", value: 140, readonly: false, order: 21 },
    tolerance_mm: { title: "Допуск уровня, ±мм", type: "value", value: 15,  readonly: false, order: 22 },
    // Уровень «вышел на полку»: скорость ниже порога столько-то секунд.
    plateau_rate: { title: "Полка: скорость ниже, мм/с", type: "value", value: 0.5, readonly: false, order: 23 },
    plateau_s:    { title: "Полка: держится, с", type: "value", value: 5, readonly: false, order: 24 },
    // В начале налива уровень ещё не тронулся — это не полка. Столько ждём.
    valve_grace_s:{ title: "Не судить о полке первые, с", type: "value", value: 10, readonly: false, order: 25 },

    // --- калибровка датчика уровня: мм = (мА − ноль) × мм_на_мА + ось ---
    sensor_zero_ma:  { title: "Датчик: ток на воздухе, мА", type: "value", value: 4.0,  readonly: false, order: 30 },
    sensor_mm_per_ma:{ title: "Датчик: мм на 1 мА", type: "value", value: 62.5, readonly: false, order: 31 },
    sensor_axis_mm:  { title: "Датчик: ось мембраны над полом, мм", type: "value", value: 13.8, readonly: false, order: 32 },

    // --- общее ---
    travel_timeout_s:   { title: "Общий таймаут хода ворот, с", type: "value", value: 120, readonly: false, order: 40 },
    battery_shutdown:   { title: "Выключать контроллер от батареи", type: "switch", value: false, order: 41 },
    battery_shutdown_s: { title: "…через, с", type: "value", value: 60, readonly: false, order: 42 }
  }
});

// Ошибка уровня шлюза (камера, команды). У ворот — свои ошибки.
function shlusesFail(reason) {
  dev["shluses_ctl/error"] = reason;
  setValves(false, false);
  log.error("шлюз: {}", reason);
}


// -----------------------------------------------------------------------------
//  Ворота
// -----------------------------------------------------------------------------
// Состояния ворот (видны на дашборде):
//   closed / opened    — стоят на концевике
//   closing / opening  — едут
//   stopped            — остановлены посреди хода
//   unknown            — после старта не на концевике
//   error              — сработала защита, причина в «Ошибка»

function makeGate(id, hw, otherId) {
  var motor = hw.motor, speed = hw.speed, dir = hw.dir, dirLevel = hw.dirLevel;
  var limOpen = hw.limOpen, limClose = hw.limClose;
  var otherClosed = HW[otherId].limClose;     // концевик «закрыто» других ворот — для главного правила

  var startPulses = 0;       // счётчик в начале хода
  var lastPulses = null;     // последнее показание счётчика
  var lastPulseAt = 0;       // когда счётчик последний раз менялся
  var startedAt = 0;         // когда включился мотор

  defineVirtualDevice(id, {
    title: hw.title,
    cells: {
      state:    { title: "Состояние", type: "text", value: "unknown", readonly: true, forceDefault: true, order: 1 },
      position: { title: "Пройдено хода", type: "value", units: "%", value: 0, readonly: true, forceDefault: true, order: 2 },
      current:  { title: "Ток мотора", type: "value", value: 0, readonly: true, forceDefault: true, order: 3 },
      error:    { title: "Ошибка", type: "text", value: "", readonly: true, forceDefault: true, order: 4 },
      open:     { title: "Открыть (ручной)", type: "pushbutton", order: 5 },
      close:    { title: "Закрыть (ручной)", type: "pushbutton", order: 6 },
      stop:     { title: "Стоп", type: "pushbutton", order: 7 },

      // --- параметры: подбираются на месте, сохраняются ---
      full_travel:  { title: "Импульсов на полный ход", type: "value", value: id === "hi_gate" ? 23500 : 25000, readonly: false, order: 20 },
      fast_speed:   { title: "Скорость основная, %", type: "value", value: id === "hi_gate" ? 15 : 65, readonly: false, order: 21 },
      slow_speed:   { title: "Скорость у концевика, %", type: "value", value: id === "hi_gate" ? 7 : 15, readonly: false, order: 22 },
      slow_from:    { title: "Замедляться с, % хода", type: "value", value: 90, readonly: false, order: 23 },
      overrun_pct:  { title: "Перебег, % хода", type: "value", value: 2, readonly: false, order: 24 },
      no_pulse_s:   { title: "Нет импульсов дольше, с", type: "value", value: 2, readonly: false, order: 25 },
      max_current:  { title: "Порог тока", type: "value", value: 1.8, readonly: false, order: 26 },
      invert:       { title: "Направление наоборот", type: "switch", value: false, order: 27 }
    }
  });

  function p(cell) { return par(id, cell); }
  function state() { return dev[id + "/state"]; }
  // Ошибка держится, пока её не сбросят кнопкой, — даже если ворота потом
  // поехали аварийно закрываться (тогда state = closing, а текст ошибки остаётся).
  function hasError() { return state() === "error" || !!dev[id + "/error"]; }
  function setState(s) { dev[id + "/state"] = s; }
  function openingDir() { return dev[id + "/invert"] ? true : false; }
  function isClosed() { return dev[limClose] === true; }
  function isOpened() { return dev[limOpen] === true; }

  function motorOff() { dev[motor] = false; }

  // Неисправность мотора: только стоп. Ворота не двигаем.
  function fail(reason) {
    motorOff();
    setState("error");
    dev[id + "/error"] = reason;
    log.error("{}: {}", hw.title, reason);
  }

  function run(closing) {
    motorOff();
    dev[dirLevel] = 100;                        // направление — полный уровень выхода
    dev[dir] = closing ? !openingDir() : openingDir();
    startPulses = num(hw.pulses) || 0;
    lastPulses = startPulses;
    lastPulseAt = startedAt = now();
    dev[id + "/position"] = 0;
    dev[speed] = p("fast_speed");
    dev[motor] = true;
    setState(closing ? "closing" : "opening");
  }

  // Обычный ход. Возвращает "" при успехе или причину отказа.
  function move(closing) {
    if (hasError()) { return hw.title + ": ошибка, сбросьте на дашборде"; }
    if (closing && isClosed()) { setState("closed"); return ""; }
    if (!closing && isOpened()) { setState("opened"); return ""; }
    // ГЛАВНОЕ ПРАВИЛО.
    if (!closing && !dev[otherClosed]) { return HW[otherId].title + " не закрыты — открывать нельзя"; }
    run(closing);
    return "";
  }

  // Аварийное закрытие — при сбое. Работает и из ошибки: закрывать при
  // сбое нужно сразу, а не после того, как кто-то сбросит ошибку.
  // Если мотор неисправен, его остановит защита в tick().
  function closeNow(reason) {
    log.warning("{}: аварийное закрытие — {}", hw.title, reason);
    if (isClosed()) { motorOff(); if (state() !== "error") { setState("closed"); } return; }
    run(true);
  }

  function stop() {
    motorOff();
    if (state() === "opening" || state() === "closing") { setState("stopped"); }
  }

  function resetError() {
    dev[id + "/error"] = "";
    setState(isClosed() ? "closed" : isOpened() ? "opened" : "unknown");
  }

  // --- концевики: мотор остановит MAO4, здесь — состояние --------------------
  defineRule(id + "_limit_open", {
    whenChanged: limOpen,
    then: function (v) { if (v) { motorOff(); if (state() !== "error") { setState("opened"); dev[id + "/position"] = 100; } } }
  });
  defineRule(id + "_limit_close", {
    whenChanged: limClose,
    then: function (v) { if (v) { motorOff(); if (state() !== "error") { setState("closed"); dev[id + "/position"] = 100; } } }
  });

  // --- главное правило, сторож -------------------------------------------
  // Мотор едет «открывать», а другие ворота ушли с концевика «закрыто» —
  // разворачиваем на закрытие. Проверяем на каждое из трёх событий:
  // кто-то может включить мотор раньше, чем выставит направление.
  // Проверяем не сразу, а через INTERLOCK_SETTLE_MS после последнего события:
  // «мотор» и «направление» пишутся почти одновременно, а подтверждения от
  // модуля приходят в произвольном порядке. Без паузы сторож на мгновение
  // видит мотор включённым при старом направлении и срабатывает зря
  // (поймано при первом запуске 10.10). Пауза короткая — ворота за неё
  // не успевают сдвинуться заметно.
  var interlockTimer = null;
  defineRule(id + "_interlock", {
    whenChanged: [motor, dir, otherClosed],
    then: function () {
      if (interlockTimer) { clearTimeout(interlockTimer); }
      interlockTimer = setTimeout(function () {
        interlockTimer = null;
        if (dev[motor] && dev[dir] === openingDir() && !dev[otherClosed]) {
          closeNow("ход на открытие при незакрытых воротах «" + HW[otherId].title + "»");
        }
      }, INTERLOCK_SETTLE_MS);
    }
  });

  // --- ток ---------------------------------------------------------------
  defineRule(id + "_current", {
    whenChanged: hw.current,
    then: function (v) {
      dev[id + "/current"] = v;
      if (dev[motor] && v > p("max_current")) { fail("ток " + v + " выше порога " + p("max_current")); }
    }
  });

  // --- проверки по таймеру: импульсы, перебег, замедление, таймаут ---------
  function tick() {
    if (!dev[motor]) { return; }
    var t = now(), v = num(hw.pulses);
    if (v !== null && v !== lastPulses) { lastPulses = v; lastPulseAt = t; }

    if (t - lastPulseAt > p("no_pulse_s") * 1000) {
      fail("нет импульсов датчика оборотов дольше " + p("no_pulse_s") + " с — мотор не крутится");
      return;
    }
    var travel = p("full_travel"), done = (lastPulses - startPulses) / travel;
    dev[id + "/position"] = Math.max(0, Math.min(100, Math.round(done * 100)));
    if (done > 1 + p("overrun_pct") / 100) {
      fail("перебег: пройдено " + Math.round(done * 100) + " % хода, концевик не сработал");
      return;
    }
    if (done >= p("slow_from") / 100 && dev[speed] > p("slow_speed")) { dev[speed] = p("slow_speed"); }
    if (t - startedAt > par("shluses_ctl", "travel_timeout_s") * 1000) {
      fail("ход дольше " + par("shluses_ctl", "travel_timeout_s") + " с");
    }
  }

  // --- кнопки дашборда: открыть/закрыть — только в ручном, стоп — всегда ---
  defineRule(id + "_btn_open", {
    whenChanged: id + "/open",
    then: function () {
      if (!dev["shluses_ctl/manual"]) { return; }
      var r = move(false); if (r) { log.warning("{}", r); }
    }
  });
  defineRule(id + "_btn_close", {
    whenChanged: id + "/close",
    then: function () { if (dev["shluses_ctl/manual"]) { move(true); } }
  });
  defineRule(id + "_btn_stop", { whenChanged: id + "/stop", then: function () { stop(); } });

  // --- старт: стоим и смотрим, где мы. Закрывать или нет — решает шлюз. ---
  setTimeout(function () {
    motorOff();
    setState(isClosed() ? "closed" : isOpened() ? "opened" : "unknown");
  }, 5000);

  return {
    move: move, stop: stop, closeNow: closeNow, tick: tick, resetError: resetError,
    state: state, hasError: hasError, isClosed: isClosed, isOpened: isOpened
  };
}

var hi = makeGate("hi_gate", HW.hi_gate, "lo_gate");
var lo = makeGate("lo_gate", HW.lo_gate, "hi_gate");

function gateError() { return hi.hasError() || lo.hasError(); }
function stopAll() { hi.stop(); lo.stop(); setValves(false, false); }
function closeAll(reason) { setValves(false, false); hi.closeNow(reason); lo.closeNow(reason); }


// -----------------------------------------------------------------------------
//  Уровень в камере
// -----------------------------------------------------------------------------
// Уровень считается из тока датчика. Скорость изменения — по окну последних
// секунд: «полка» (уровень перестал меняться) — признак того, что налив или
// слив закончился.
// Камера готова = уровень в зоне допуска И полка.

var levelHistory = [];        // [время, мм] за последние несколько секунд
var plateauSince = 0;         // с какого момента скорость ниже порога

function updateLevel() {
  var ma = num(LEVEL_SENSOR_MA);
  if (ma === null) { dev["shluses_ctl/chamber"] = "нет датчика"; return null; }
  // 0 мА — это не «пустая камера», а оборванная петля или не подключённый датчик.
  if (ma < SENSOR_BROKEN_MA) {
    dev["shluses_ctl/chamber"] = "обрыв датчика (" + ma + " мА)";
    levelHistory = []; plateauSince = 0;
    return null;
  }
  var c = "shluses_ctl";
  var mm = (ma - par(c, "sensor_zero_ma")) * par(c, "sensor_mm_per_ma") + par(c, "sensor_axis_mm");
  var t = now();
  levelHistory.push([t, mm]);
  while (levelHistory.length > 2 && t - levelHistory[0][0] > 3000) { levelHistory.shift(); }
  var first = levelHistory[0], dt = (t - first[0]) / 1000;
  var rate = dt > 0.5 ? (mm - first[1]) / dt : 0;

  if (Math.abs(rate) < par(c, "plateau_rate")) { if (!plateauSince) { plateauSince = t; } }
  else { plateauSince = 0; }

  dev[c + "/level_mm"] = Math.round(mm * 10) / 10;
  dev[c + "/level_rate"] = Math.round(rate * 100) / 100;
  dev[c + "/chamber"] = chamberZone(mm);
  return mm;
}

function chamberZone(mm) {
  var c = "shluses_ctl", tol = par(c, "tolerance_mm");
  if (mm >= par(c, "full_mm") - tol) { return "полная"; }
  if (mm <= par(c, "empty_mm") + tol) { return "пустая"; }
  return "между";
}

function onPlateau() {
  return plateauSince && now() - plateauSince >= par("shluses_ctl", "plateau_s") * 1000;
}


// -----------------------------------------------------------------------------
//  Автоматика: цикл «открыть бьеф»
// -----------------------------------------------------------------------------
// Цель — "upstream" (открыть верхний бьеф) или "downstream" (нижний).
// Шаги цикла:
//   close   — закрыть ворота, которые не на концевике «закрыто»;
//   level   — выровнять уровень: налив до полной (вверх) или слив до пустой (вниз),
//             пропускается, пока клапанов нет (VALVES_PRESENT = false);
//   open    — открыть ворота к нужному бьефу;
//   done    — ворота открыты, стоим до противоположной команды.
// Новая команда посреди цикла бросает текущий и начинает свой.

var target = "";              // текущая цель или "" — цикла нет
var step = "";                // текущий шаг
var stepAt = 0;               // когда начался шаг

function setStep(s) {
  step = s; stepAt = now();
  dev["shluses_ctl/step"] = target ? (target + ": " + s) : "";
}

function startCycle(t) {
  if (dev["shluses_ctl/manual"]) { log.warning("шлюз: команда «{}» в ручном режиме не принимается", t); return; }
  if (dev["shluses_ctl/error"] || gateError()) { log.warning("шлюз: команда «{}» отклонена — ошибка не сброшена", t); return; }
  // Бьеф уже открыт как надо — ничего не двигаем.
  var g = t === "upstream" ? hi : lo, o = t === "upstream" ? lo : hi;
  if (!target && g.isOpened() && o.isClosed()) { return; }
  stopAll();
  target = t;
  setStep("close");
}

function abortCycle() { target = ""; setStep(""); }

function cycleTick() {
  if (!target) { return; }
  if (dev["shluses_ctl/manual"] || dev["shluses_ctl/error"] || gateError()) { setValves(false, false); abortCycle(); return; }

  var up = target === "upstream";
  var gate = up ? hi : lo;          // ворота, которые надо открыть
  var other = up ? lo : hi;

  if (step === "close") {
    // Закрываем всё, что не закрыто. Ворота, которые потом откроем, тоже:
    // их открывают только при выровненном уровне.
    if (!hi.isClosed() && hi.state() !== "closing") { hi.move(true); }
    if (!lo.isClosed() && lo.state() !== "closing") { lo.move(true); }
    if (hi.isClosed() && lo.isClosed()) { setStep(VALVES_PRESENT ? "level" : "open"); if (VALVES_PRESENT) { setValves(up, !up); } }
    return;
  }

  if (step === "level") {
    var mm = updateLevel();
    if (mm === null) { shlusesFail("нет данных с датчика уровня"); return; }
    if (now() - stepAt < par("shluses_ctl", "valve_grace_s") * 1000) { return; }
    if (!onPlateau()) { return; }                        // уровень ещё меняется — идёт
    var zone = chamberZone(mm);
    if ((up && zone === "полная") || (!up && zone === "пустая")) {
      setValves(false, false);
      setStep("open");
    } else {
      shlusesFail("уровень встал на " + Math.round(mm) + " мм, а нужна " + (up ? "полная" : "пустая") + " камера");
    }
    return;
  }

  if (step === "open") {
    if (gate.isOpened()) { setStep("done"); return; }
    if (gate.state() !== "opening") {
      var r = gate.move(false);
      if (r) { shlusesFail(r); }
    }
    return;
  }
  // "done" — ничего не делаем, ждём следующую команду.
}


// -----------------------------------------------------------------------------
//  Внешнее устройство: две команды и статус
// -----------------------------------------------------------------------------

defineVirtualDevice(SHLUSES_ID, {
  title: "Шлюз",
  cells: {
    open_upstream:   { title: "Открыть верхний бьеф", type: "pushbutton", order: 1 },
    open_downstream: { title: "Открыть нижний бьеф",  type: "pushbutton", order: 2 },
    // busy / upstream_open / downstream_open / error
    status:          { title: "Статус", type: "text", value: "busy", readonly: true, forceDefault: true, order: 3 }
  }
});

defineRule("shluses_cmd_upstream",   { whenChanged: SHLUSES_ID + "/open_upstream",   then: function () { startCycle("upstream"); } });
defineRule("shluses_cmd_downstream", { whenChanged: SHLUSES_ID + "/open_downstream", then: function () { startCycle("downstream"); } });

function externalStatus() {
  if (dev["shluses_ctl/error"] || gateError()) { return "error"; }
  var running = target && step !== "done";
  if (!running && hi.isOpened() && lo.isClosed()) { return "upstream_open"; }
  if (!running && lo.isOpened() && hi.isClosed()) { return "downstream_open"; }
  return "busy";
}


// -----------------------------------------------------------------------------
//  Ручной режим и сброс ошибки
// -----------------------------------------------------------------------------

defineRule("shluses_manual_switch", {
  whenChanged: "shluses_ctl/manual",
  then: function (manual) {
    // В ручной — бросаем цикл. Из ручного в авто — ничего не двигаем.
    if (manual) { abortCycle(); setValves(false, false); }
  }
});

defineRule("shluses_manual_valves", {
  whenChanged: ["shluses_ctl/valve_fill", "shluses_ctl/valve_drain"],
  then: function () {
    // В ручном уровень не проверяем — клапаны как есть.
    if (!dev["shluses_ctl/manual"]) { dev["shluses_ctl/valve_fill"] = false; dev["shluses_ctl/valve_drain"] = false; return; }
    setValves(dev["shluses_ctl/valve_fill"], dev["shluses_ctl/valve_drain"]);
  }
});

defineRule("shluses_reset_error", {
  whenChanged: "shluses_ctl/reset_error",
  then: function () {
    // Сброс НЕ двигает ворота.
    dev["shluses_ctl/error"] = "";
    hi.resetError(); lo.resetError();
    abortCycle();
  }
});


// -----------------------------------------------------------------------------
//  Сбои: закрыть ворота в любом режиме
// -----------------------------------------------------------------------------

function onFailure(reason) {
  log.warning("шлюз: сбой — {}, закрываю ворота", reason);
  abortCycle();
  closeAll(reason);
}

defineRule("shluses_network_lost", {
  whenChanged: "network/Ethernet IP Connection Enabled",
  then: function (up) { if (up === false) { onFailure("пропал Ethernet"); } }
});

var shutdownTimer = null;
defineRule("shluses_on_battery", {
  whenChanged: "power_status/working on battery",
  then: function (onBattery) {
    if (onBattery) {
      onFailure("работа от батареи");
      // Выключение контроллера — только если включено на дашборде: пока не
      // проверено, что контроллер сам включится, когда вернётся питание.
      if (dev["shluses_ctl/battery_shutdown"] && !shutdownTimer) {
        shutdownTimer = setTimeout(function () { runShellCommand("poweroff"); },
          par("shluses_ctl", "battery_shutdown_s") * 1000);
      }
    } else if (shutdownTimer) {
      clearTimeout(shutdownTimer); shutdownTimer = null;     // питание вернулось
      log.warning("шлюз: питание вернулось, выключение отменено");
    }
  }
});

// Старт контроллера: если ни одни ворота не на «закрыто» — закрыть обе.
// Если хотя бы одни закрыты — поток невозможен, ничего не трогаем.
setTimeout(function () {
  if (!hi.isClosed() && !lo.isClosed()) { onFailure("старт: ни одни ворота не закрыты"); }
}, 8000);


// -----------------------------------------------------------------------------
//  Главный цикл
// -----------------------------------------------------------------------------

setInterval(function () {
  hi.tick();
  lo.tick();
  if (step !== "level") { updateLevel(); }   // на шаге level уровень считает cycleTick
  cycleTick();
  var s = externalStatus();
  if (dev[SHLUSES_ID + "/status"] !== s) { dev[SHLUSES_ID + "/status"] = s; }
}, TICK_MS);

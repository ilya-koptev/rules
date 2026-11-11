// =============================================================================
//  shluses.js — судоходный шлюз: двое ворот, камера, налив и слив
// =============================================================================
//
//  Один и тот же файл на всех шлюзах (Дубна, Углич, Рыбинск 1). Это
//  возможно потому, что адреса модулей на всех шлюзах одинаковые:
//
//    WB-UPS v3     10   резерв питания
//    WB-MAO4       11   верхние ворота
//    WB-MAO4       12   нижние ворота
//    WB-MCM8       13   импульсы моторов (вход 1 — верхние, вход 2 — нижние)
//    WB-MAI6       14   IN1/IN2 — токи моторов (может не быть), IN5 — датчик уровня 4–20 мА
//    WB-MRM2-mini  15   K1 — налив камеры, K2 — слив
//
//  Шина RS485-2, 115200 8N2. Всё, что отличается от шлюза к шлюзу (таймауты,
//  уровни, калибровка), — параметры на панели «Шлюз — наладка», они
//  сохраняются на контроллере.
//
//  ВОРОТА (MAO4): мотор — Channel 1 Switch, направление — Channel 2 Switch
//  (0 — открывать, 1 — закрывать). Концевики — герконы на Input 1 «открыто»
//  и Input 2 «закрыто», входы в режиме Switch с локальными действиями:
//    геркон замкнулся  (switch_on)  → направление перекинуто
//                                     (вход 1 → Channel 2 = 1, вход 2 → 0);
//    геркон разомкнулся (switch_off) → мотор погашен (Channel 1 = 0).
//  Channel 2 идёт прямо на Z/F драйвера, поэтому мотор разворачивается на
//  ходу: ворота наезжают на магнит, отскакивают назад, сходят с магнита —
//  и мотор гаснет, около секунды после замыкания. Ворота стоят у края
//  магнита, направление уже на обратный ход: следующий пуск везёт обратно.
//  Останавливает модуль сам, даже если wb-rules лежит. Положение ворот
//  правило ЗАПОМИНАЕТ по последнему замыканию геркона.
//
//  ГЛАВНОЕ ПРАВИЛО: ОБЕ ВОРОТА НЕ МОГУТ БЫТЬ ОТКРЫТЫ ОДНОВРЕМЕННО, и вода не
//  должна идти насквозь. Мотор, поехавший на открытие, останавливается, если
//  другие ворота не подтверждены закрытыми или открыт любой клапан, — кто бы
//  его ни включил: эти правила, кнопка в веб-интерфейсе, внешняя система.
//  Закрывать можно всегда. Налив и слив — только при закрытых обоих воротах.
//
//  После старта контроллера положение ворот неизвестно — сначала
//  инициализация: обе ворота едут закрываться до концевика.
//
// =============================================================================

// --- Подключение (одинаковое на всех шлюзах) ---------------------------------
var GATES = {
  upper: { title: "Верхние ворота", mao: "wb-mao4_11", current: "wb-mai6_14/IN 1 Voltage", pulses: "wb-mcm8_13/Input 1 counter" },
  lower: { title: "Нижние ворота",  mao: "wb-mao4_12", current: "wb-mai6_14/IN 2 Voltage", pulses: "wb-mcm8_13/Input 2 counter" }
};
var DIR_OPEN    = false;            // Channel 2 Switch = 0 — ворота открываются
var LIM_OPEN    = "Input 1";        // концевик «открыто»
var LIM_CLOSED  = "Input 2";        // концевик «закрыто»
var VALVE_FILL  = "wb-mrm2-mini_15/K1";   // налив камеры из верхнего бьефа
var VALVE_DRAIN = "wb-mrm2-mini_15/K2";   // слив камеры в нижний бьеф
var LEVEL_MA    = "wb-mai6_14/IN 5 P Current";

var API = "shluz";            // пользователь и внешняя система
var SRV = "shluz_service";    // наладка: ручное управление, клапаны, параметры

var TICK_MS = 500;
var DIR_SETTLE_MS = 400;       // пауза перед проверкой смены направления
// От замыкания геркона до размыкания проходит 0,7–1,6 с: ворота отскакивают
// от магнита, мотор крутится на обратный ход. Это штатно. Сторож без этой
// паузы видел бы «мотор едет открывать» — первая версия так погнала закрытые
// ворота в упор. Поэтому столько времени после концевика верим концевику.
var LIMIT_HOLD_MS = 3000;
var CMD_HOLD_MS = 2000;        // после своей команды верим записанному направлению
var DIR_BEFORE_MOTOR_MS = 300; // пауза между записью направления и пуском мотора
var START_CONFIRM_S = 4;       // мотор не подтвердил пуск за столько — ворота «stopped»
var SENSOR_BROKEN_MA = 3.5;    // ниже — обрыв петли 4–20 мА

// -----------------------------------------------------------------------------
//  Устройства
// -----------------------------------------------------------------------------
// forceDefault — вычисляемое (после перезагрузки не вспоминается);
// без него — параметры, их значения сохраняются.

defineVirtualDevice(API, {
  title: "Шлюз",
  cells: {
    status:          { title: "Состояние", type: "text", value: "init", readonly: true, forceDefault: true, order: 1 },
    step:            { title: "Что делает", type: "text", value: "", readonly: true, forceDefault: true, order: 2 },
    error:           { title: "Ошибка", type: "text", value: "", readonly: true, forceDefault: true, order: 3 },
    open_upstream:   { title: "Открыть верхний бьеф", type: "pushbutton", order: 10 },
    open_downstream: { title: "Открыть нижний бьеф", type: "pushbutton", order: 11 },
    close_gates:     { title: "Закрыть ворота", type: "pushbutton", order: 12 },
    stop:            { title: "Стоп", type: "pushbutton", order: 13 },
    reset:           { title: "Сбросить ошибку", type: "pushbutton", order: 14 },
    init:            { title: "Инициализация", type: "pushbutton", order: 15 },
    upper_gate:      { title: "Верхние ворота", type: "text", value: "unknown", readonly: true, forceDefault: true, order: 20 },
    lower_gate:      { title: "Нижние ворота", type: "text", value: "unknown", readonly: true, forceDefault: true, order: 21 },
    upper_pos:       { title: "Верхние ворота открыты, % (−1 — неизвестно)", type: "value", units: "%", value: -1, readonly: true, forceDefault: true, order: 24 },
    lower_pos:       { title: "Нижние ворота открыты, % (−1 — неизвестно)", type: "value", units: "%", value: -1, readonly: true, forceDefault: true, order: 25 },
    chamber:         { title: "Камера", type: "text", value: "", readonly: true, forceDefault: true, order: 23 },
    chamber_pct:     { title: "Камера заполнена, % (−1 — нет датчика)", type: "value", units: "%", value: -1, readonly: true, forceDefault: true, order: 26 }
  }
});

defineVirtualDevice(SRV, {
  title: "Шлюз — наладка",
  cells: {
    upper_open:    { title: "Верхние: открыть", type: "pushbutton", order: 1 },
    upper_close:   { title: "Верхние: закрыть", type: "pushbutton", order: 2 },
    upper_current: { title: "Верхние: ток мотора", type: "value", value: 0, readonly: true, forceDefault: true, order: 3 },
    lower_open:    { title: "Нижние: открыть", type: "pushbutton", order: 4 },
    lower_close:   { title: "Нижние: закрыть", type: "pushbutton", order: 5 },
    lower_current: { title: "Нижние: ток мотора", type: "value", value: 0, readonly: true, forceDefault: true, order: 6 },
    fill:          { title: "Налив: открыть клапан", type: "pushbutton", order: 7 },
    drain:         { title: "Слив: открыть клапан", type: "pushbutton", order: 8 },
    valves_off:    { title: "Клапаны: закрыть", type: "pushbutton", order: 9 },
    valve_fill:    { title: "Клапан налива открыт", type: "switch", value: false, readonly: true, forceDefault: true, order: 10 },
    valve_drain:   { title: "Клапан слива открыт", type: "switch", value: false, readonly: true, forceDefault: true, order: 11 },
    level_ma:      { title: "Датчик уровня, мА", type: "value", value: 0, readonly: true, forceDefault: true, order: 12 },
    level_mm:      { title: "Уровень в камере, мм", type: "value", units: "mm", value: 0, readonly: true, forceDefault: true, order: 12 },
    last_block:    { title: "Последний запрет", type: "text", value: "", readonly: true, forceDefault: true, order: 13 },

    // --- ворота ---
    upper_timeout_s: { title: "Верхние: таймаут хода, с", type: "value", value: 30, readonly: false, order: 20 },
    lower_timeout_s: { title: "Нижние: таймаут хода, с", type: "value", value: 50, readonly: false, order: 21 },
    upper_pulses:    { title: "Верхние: импульсов на полный ход (уточняется само)", type: "value", value: 3240, readonly: false, order: 25 },
    lower_pulses:    { title: "Нижние: импульсов на полный ход (уточняется само)", type: "value", value: 17090, readonly: false, order: 26 },
    max_current:     { title: "Порог тока мотора (0 — не следить)", type: "value", value: 0, readonly: false, order: 22 },
    init_on_start:   { title: "Закрывать ворота после старта", type: "switch", value: true, order: 23 },

    // --- камера ---
    use_level:    { title: "Налив/слив по датчику уровня", type: "switch", value: false, order: 30 },
    empty_mm:     { title: "Пустая камера, мм", type: "value", value: 70, readonly: false, order: 31 },
    full_mm:      { title: "Полная камера, мм", type: "value", value: 140, readonly: false, order: 32 },
    tolerance_mm: { title: "Допуск уровня, ±мм", type: "value", value: 15, readonly: false, order: 33 },
    pct0_mm:      { title: "Заполнение камеры 0 % при, мм", type: "value", value: 70, readonly: false, order: 38 },
    pct100_mm:    { title: "Заполнение камеры 100 % при, мм", type: "value", value: 140, readonly: false, order: 39 },
    valve_max_s:  { title: "Налив/слив: время (без датчика) или предел, с", type: "value", value: 60, readonly: false, order: 34 },
    level_check_s:{ title: "Уровень проверять каждые, с", type: "value", value: 10, readonly: false, order: 35 },
    level_min_mm: { title: "Уровень должен сдвинуться хотя бы на, мм", type: "value", value: 3, readonly: false, order: 36 },
    crack_s:      { title: "Не идёт через клапан — приоткрыть ворота на, с хода (0 — не приоткрывать)", type: "value", value: 0, readonly: false, order: 37 },

    // --- датчик уровня: мм = (мА − ноль) × мм_на_мА + смещение ---
    sensor_zero_ma:   { title: "Датчик: ток на воздухе, мА", type: "value", value: 4.0, readonly: false, order: 40 },
    sensor_mm_per_ma: { title: "Датчик: мм на 1 мА", type: "value", value: 62.5, readonly: false, order: 41 },
    sensor_offset_mm: { title: "Датчик: смещение, мм", type: "value", value: 0, readonly: false, order: 42 },

    // --- питание ---
    battery_poweroff:   { title: "Выключать контроллер от батареи", type: "switch", value: false, order: 50 },
    battery_poweroff_s: { title: "…через, с", type: "value", value: 60, readonly: false, order: 51 },

    // --- заливочные насосы: питание клапанов идёт через реле на другом контроллере ---
    // Реле там и K1/K2 здесь включены последовательно: вода идёт, только когда включены оба.
    // Пусто — не используется.
    pump_host:   { title: "Контроллер реле заливочных насосов (адрес)", type: "text", value: "", readonly: false, order: 60 },
    pump_fill:   { title: "Топик реле налива", type: "text", value: "", readonly: false, order: 61 },
    pump_drain:  { title: "Топик реле слива", type: "text", value: "", readonly: false, order: 62 },
    pump_river:  { title: "Топик реле наполнения русла (выключать при сливе)", type: "text", value: "", readonly: false, order: 63 }
  }
});

// -----------------------------------------------------------------------------
//  Мелочи
// -----------------------------------------------------------------------------

function now() { return Date.now(); }
function par(cell) { return Number(dev[SRV + "/" + cell]); }
function other(k) { return k === "upper" ? "lower" : "upper"; }
function ctl(k, name) { return GATES[k].mao + "/" + name; }

// Число из топика или null: нет устройства, ошибка чтения, мусор.
// Ток мотора и уровень могут отсутствовать — тогда защита по ним просто молчит.
function reading(topic, maxAbs) {
  var v = dev[topic];
  if (v === undefined || v === null || v === "") { return null; }
  if (dev[topic + "#error"]) { return null; }
  v = Number(v);
  if (isNaN(v) || Math.abs(v) > maxAbs) { return null; }
  return v;
}

// Писать в топик только при изменении — иначе каждый такт уходит лишняя публикация.
function put(topic, v) { if (dev[topic] !== v) { dev[topic] = v; } }

// --- реле заливочных насосов на другом контроллере, по MQTT ---
function txt(cell) { var v = dev[SRV + "/" + cell]; return v ? String(v) : ""; }
function q(x) { return "'" + String(x).replace(/'/g, "") + "'"; }
var remoteSent = {};          // топик → что последним отправили
var riverWasOn = false;       // наполнение русла было включено до слива

function remoteSet(cell, on) {
  var host = txt("pump_host"), topic = txt(cell);
  if (!host || !topic) { return; }
  if (remoteSent[topic] === on) { return; }
  remoteSent[topic] = on;
  runShellCommand("mosquitto_pub -h " + q(host) + " -t " + q(topic + "/on") + " -m " + (on ? "1" : "0"), {
    captureOutput: true, captureErrorOutput: true,
    exitCallback: function (code) {
      if (code !== 0) { delete remoteSent[topic]; blockMsg("pump relay " + topic + " on " + host + ": mosquitto_pub exit " + code); }
    }
  });
}

// Слив начался — запомнить и выключить наполнение русла; кончился — вернуть.
function riverOnDrain(draining) {
  var host = txt("pump_host"), topic = txt("pump_river");
  if (!host || !topic) { return; }
  if (draining) {
    runShellCommand("mosquitto_sub -h " + q(host) + " -C 1 -W 3 -t " + q(topic), {
      captureOutput: true,
      exitCallback: function (code, out) {
        if (!drainOn) { return; }                        // слив уже кончился
        riverWasOn = code === 0 && String(out).replace(/\s/g, "") === "1";
        if (riverWasOn) { delete remoteSent[topic]; remoteSet("pump_river", false); }
      }
    });
  } else if (riverWasOn) {
    riverWasOn = false;
    delete remoteSent[topic];
    remoteSet("pump_river", true);
  }
}

var drainOn = false;
function valves(fill, drain) {          // пишем в реле только при изменении
  fill = !!fill; drain = !!drain;
  // закрываем — сначала здесь, потом питание; открываем — наоборот
  if (!fill)  { if (!!dev[VALVE_FILL])  { dev[VALVE_FILL] = false; }  remoteSet("pump_fill", false); }
  if (!drain) { if (!!dev[VALVE_DRAIN]) { dev[VALVE_DRAIN] = false; } remoteSet("pump_drain", false); }
  if (fill)   { remoteSet("pump_fill", true);  if (!dev[VALVE_FILL])  { dev[VALVE_FILL] = true; } }
  if (drain)  { remoteSet("pump_drain", true); if (!dev[VALVE_DRAIN]) { dev[VALVE_DRAIN] = true; } }
  if (drain !== drainOn) { drainOn = drain; riverOnDrain(drain); }
}

function blockMsg(msg) {
  dev[SRV + "/last_block"] = msg;
  log.warning("[shluz] " + msg);
}

// -----------------------------------------------------------------------------
//  Ворота
// -----------------------------------------------------------------------------
// Состояния: closed / open — стоят на концевике (запомнено); opening / closing
// — едут; stopped — остановлены посреди хода; unknown — после старта;
// error — сработала защита (таймаут, ток), причина в «Ошибка».

var gate = {
  upper: { state: "unknown", startedAt: 0, pending: null, limitAt: 0, cmdAt: 0, cmdOpening: false, pos: null, lastCnt: null, calFrom: null, calCnt: 0 },
  lower: { state: "unknown", startedAt: 0, pending: null, limitAt: 0, cmdAt: 0, cmdOpening: false, pos: null, lastCnt: null, calFrom: null, calCnt: 0 }
};

// Положение ворот, %: 0 — закрыты, 100 — открыты. Ставится на концевике, между
// концевиками считается по импульсам мотора (MCM8) от последнего концевика.
function setState(k, s) {
  var g = gate[k];
  g.state = s;
  if (s === "closed") { g.pos = 0; }
  if (s === "open") { g.pos = 100; }
  if (s === "unknown") { g.pos = null; }
  if (s === "stopped" || s === "error" || s === "unknown") { g.calFrom = null; }   // ход прерван — не калибровать
  dev[API + "/" + k + "_gate"] = s;
}
function pct(k) { return gate[k].pos === null ? "?%" : Math.round(gate[k].pos) + "%"; }

// Импульсы с прошлого такта → положение. После концевика (отскок) не считаем.
function trackPos(k) {
  var g = gate[k], c = reading(GATES[k].pulses, 1e12);
  if (c === null) { return; }
  if (g.lastCnt !== null && g.pos !== null && now() - g.limitAt >= LIMIT_HOLD_MS) {
    var d = c - g.lastCnt, full = par(k + "_pulses");
    if (d > 0 && full > 0) {
      g.pos = Math.max(0, Math.min(100, g.pos + (dirOpening(k) ? 1 : -1) * d * 100 / full));
    }
  }
  g.lastCnt = c;
}
function moving(k) { return gate[k].state === "opening" || gate[k].state === "closing"; }
function motorOn(k) { return !!dev[ctl(k, "Channel 1 Switch")]; }
function dirOpening(k) {
  if (now() - gate[k].cmdAt < CMD_HOLD_MS) { return gate[k].cmdOpening; }   // модуль ещё мог не подтвердить
  return !!dev[ctl(k, "Channel 2 Switch")] === DIR_OPEN;
}

function motorOff(k) {
  if (gate[k].pending) { clearTimeout(gate[k].pending); gate[k].pending = null; }
  dev[ctl(k, "Channel 1 Switch")] = false;
}

function gateFail(k, reason) {
  motorOff(k);
  setState(k, "error");
  fail(k + " gate: " + reason);
}

// Почему открывать нельзя ("" — можно).
function openForbidden(k) {
  var o = other(k);
  if (gate[o].state !== "closed") {
    return o + " gate not closed (" + gate[o].state + ")";
  }
  if (dev[VALVE_FILL])  { return "fill valve open"; }
  if (dev[VALVE_DRAIN]) { return "drain valve open"; }
  return "";
}

// Пустить ворота. Возвращает "" или причину отказа.
function moveGate(k, opening) {
  if (gate[k].state === "error") { return k + " gate: error, reset first"; }
  if (opening && gate[k].state === "open")    { return ""; }
  if (!opening && gate[k].state === "closed") { return ""; }
  if (opening) {
    var why = openForbidden(k);
    if (why) { return k + " gate open refused: " + why; }
  }
  motorOff(k);
  dev[ctl(k, "Channel 2 Switch")] = opening ? DIR_OPEN : !DIR_OPEN;
  gate[k].cmdAt = gate[k].startedAt = now();
  gate[k].cmdOpening = opening;
  gate[k].limitAt = 0;
  setState(k, opening ? "opening" : "closing");
  gate[k].pending = setTimeout(function () {
    gate[k].pending = null;
    dev[ctl(k, "Channel 1 Switch")] = true;
  }, DIR_BEFORE_MOTOR_MS);
  return "";
}

// Сторож: мотор работает — едет ли он туда, куда можно.
function check(k) {
  if (!motorOn(k)) { return; }
  // только что был концевик — модуль сам гасит мотор, направление уже перекинуто
  if (now() - gate[k].limitAt < LIMIT_HOLD_MS) { return; }
  if (!dirOpening(k)) {
    if (gate[k].state !== "closing") { gate[k].startedAt = now(); setState(k, "closing"); }
    return;
  }
  var why = openForbidden(k);
  if (why) {
    motorOff(k);
    setState(k, "stopped");
    blockMsg(k + " gate stopped: " + why);
    return;
  }
  if (gate[k].state !== "opening") { gate[k].startedAt = now(); setState(k, "opening"); }
}

Object.keys(GATES).forEach(function (k) {
  defineRule("shluz_motor_" + k, {
    whenChanged: ctl(k, "Channel 1 Switch"),
    then: function (on) {
      if (on) { check(k); return; }
      // мотор погас не на концевике — ворота где-то посередине
      if (moving(k) && !gate[k].pending) {
        setTimeout(function () { if (moving(k) && !motorOn(k) && !gate[k].pending) { setState(k, "stopped"); } }, 1500);
      }
    }
  });
  // смена направления на ходу — проверка после паузы: если это модуль
  // развернулся на концевике, мотор к этому времени уже погашен
  defineRule("shluz_dir_" + k, {
    whenChanged: ctl(k, "Channel 2 Switch"),
    then: function () { setTimeout(function () { check(k); }, DIR_SETTLE_MS); }
  });
  defineRule("shluz_limit_" + k, {
    whenChanged: [ctl(k, LIM_OPEN), ctl(k, LIM_CLOSED)],
    then: function (v, devName, cellName) {
      if (!v) { return; }
      var g = gate[k], at = cellName === LIM_CLOSED ? "closed" : "open";
      g.limitAt = now();
      // прошли от концевика до концевика без остановки — уточнить импульсы на полный ход
      var c = reading(GATES[k].pulses, 1e12);
      if (c !== null && g.calFrom && g.calFrom !== at) {
        var n = Math.abs(c - g.calCnt), was = par(k + "_pulses");
        if (n > 0 && (!(was > 0) || (n > was / 2 && n < was * 2))) { dev[SRV + "/" + k + "_pulses"] = n; }
      }
      if (c !== null) { g.calFrom = at; g.calCnt = c; g.lastCnt = c; }
      if (g.state === "error") { return; }
      setState(k, at);
    }
  });
  // ручные кнопки наладки
  defineRule("shluz_btn_open_" + k, {
    whenChanged: SRV + "/" + k + "_open",
    then: function () { manual(function () { return moveGate(k, true); }); }
  });
  defineRule("shluz_btn_close_" + k, {
    whenChanged: SRV + "/" + k + "_close",
    then: function () { manual(function () { return moveGate(k, false); }); }
  });
});

// -----------------------------------------------------------------------------
//  Шлюз: команды и автоматика
// -----------------------------------------------------------------------------
// cycle — что сейчас делаем: { kind: init|close|upstream|downstream, phase, phaseAt }

var cycle = null;

function setStep(s) { put(API + "/step", s); }

function fail(reason) {
  dev[API + "/error"] = reason;
  if (cycle) { valves(false, false); cycle = null; }
  setStep("");
  log.error("[shluz] " + reason);
}

function stopAll(why) {
  cycle = null;
  motorOff("upper");
  motorOff("lower");
  valves(false, false);
  setStep(why || "");
}

function hasError() {
  return !!dev[API + "/error"] || gate.upper.state === "error" || gate.lower.state === "error";
}

// Ручная команда наладки прерывает автоматику.
function manual(fn) {
  if (cycle) { stopAll("interrupted_manual"); }
  var r = fn();
  if (r) { blockMsg(r); }
}

function startCycle(kind) {
  if (hasError()) { blockMsg("command refused: error, reset first"); return; }
  stopAll("");
  cycle = { kind: kind, phase: "close", phaseAt: now() };
}

function phase(p) {
  cycle.phase = p; cycle.phaseAt = now();
  cycle.winAt = 0; cycle.winLvl = null; cycle.cracked = false; cycle.crackDone = false;
}

// Сдвинулся ли уровень в нужную сторону за окно level_check_s.
// Возвращает null, пока окно не кончилось; иначе true/false и начинает новое окно.
function levelMoved(lvl, up) {
  if (!cycle.winAt) { cycle.winAt = now(); cycle.winLvl = lvl; return null; }
  if ((now() - cycle.winAt) / 1000 < par("level_check_s")) { return null; }
  var moved = up ? lvl - cycle.winLvl : cycle.winLvl - lvl;
  cycle.winAt = now(); cycle.winLvl = lvl;
  return moved >= par("level_min_mm");
}
function phaseAge() { return (now() - cycle.phaseAt) / 1000; }

// Заполнение камеры, %: 0 — pct0_mm (70), 100 — pct100_mm (140). null — нет датчика.
function chamberPct() {
  var l = levelMm(), e = par("pct0_mm"), f = par("pct100_mm");
  if (l === null || !(f > e)) { return null; }
  return Math.max(0, Math.min(100, (l - e) * 100 / (f - e)));
}
function cpct() { var p = chamberPct(); return p === null ? "?%" : Math.round(p) + "%"; }

function levelMm() {
  var ma = reading(LEVEL_MA, 30);
  if (ma === null || ma < SENSOR_BROKEN_MA) { return null; }
  return (ma - par("sensor_zero_ma")) * par("sensor_mm_per_ma") + par("sensor_offset_mm");
}

function runCycle() {
  if (!cycle) { return; }
  var up = cycle.kind === "upstream", down = cycle.kind === "downstream";
  var target = up ? "upper" : down ? "lower" : null;
  var r;

  if (cycle.phase === "close") {
    // нужные ворота уже открыты, другие закрыты — делать нечего
    if (target && gate[target].state === "open" && gate[other(target)].state === "closed") { phase("done"); return; }
    ["upper", "lower"].forEach(function (k) {
      if (cycle && gate[k].state !== "closed" && !moving(k)) {
        r = moveGate(k, false);
        if (r) { fail(r); }
      }
    });
    if (!cycle) { return; }
    if (phaseAge() > Math.max(par("upper_timeout_s"), par("lower_timeout_s")) + 15) { fail("gates did not close"); return; }
    // закрываются — пишем, что едет: closing_upper 60% (обе — через пробел)
    var cl = ["upper", "lower"].filter(function (k) { return gate[k].state !== "closed"; })
      .map(function (k) { return "closing_" + k + " " + pct(k); });
    setStep(cl.join(" "));
    if (gate.upper.state === "closed" && gate.lower.state === "closed") { phase(target ? "water" : "done"); }
    return;
  }

  var useLevel = !!dev[SRV + "/use_level"], lvl = levelMm();
  var goal = up ? par("full_mm") : par("empty_mm"), tol = par("tolerance_mm");
  var reached = lvl !== null && (up ? lvl >= goal - tol : lvl <= goal + tol);

  if (cycle.phase === "water") {
    if (!useLevel) {                            // без датчика — по времени
      if (phaseAge() > par("valve_max_s")) { valves(false, false); phase("open"); return; }
      valves(up, down);
      setStep((up ? "filling " : "draining ") + cpct());
      return;
    }
    if (lvl === null) { valves(false, false); fail("no level sensor reading"); return; }
    if (reached) { valves(false, false); phase("open"); return; }
    // через клапан не идёт (уровень не сдвинулся) или идёт слишком долго —
    // пустить воду через приоткрытые ворота с той же стороны (crack_s > 0);
    // при crack_s = 0 приоткрытия нет: не дошли за valve_max_s — ошибка
    if (par("crack_s") > 0) {
      if (levelMoved(lvl, up) === false || phaseAge() > par("valve_max_s")) { valves(false, false); phase("crack"); return; }
    } else if (phaseAge() > par("valve_max_s")) {
      valves(false, false);
      fail((up ? "fill" : "drain") + ": level not reached within " + par("valve_max_s") + " s");
      return;
    }
    valves(up, down);
    setStep((up ? "filling " : "draining ") + cpct());
    return;
  }

  if (cycle.phase === "crack") {
    if (!cycle.cracked) {
      if (phaseAge() < 1.5) { return; }         // дать реле клапана отпасть
      r = moveGate(target, true);
      if (r) { fail(r); return; }
      cycle.cracked = true;
      setStep((up ? "crack_upper " : "crack_lower ") + pct(target));
      return;
    }
    if (!cycle.crackDone) {
      if (gate[target].state === "open") { phase("done"); return; }
      if (now() - gate[target].startedAt < par("crack_s") * 1000 + DIR_BEFORE_MOTOR_MS) { return; }
      motorOff(target);
      cycle.crackDone = true;
      cycle.winAt = 0;
      return;
    }
    // ворота приоткрыты: ждём, пока уровень дойдёт до порога или выровняется
    if (lvl === null || reached || levelMoved(lvl, up) === false || phaseAge() > par("valve_max_s")) { phase("open"); return; }
    setStep((up ? "filling_through_gate " : "draining_through_gate ") + pct(target));
    return;
  }

  if (cycle.phase === "open") {
    if (gate[target].state === "open") { phase("done"); return; }
    if (phaseAge() < 1.5) { return; }           // дать реле клапана отпасть
    if (!moving(target)) {
      r = moveGate(target, true);
      if (r) { fail(r); return; }
    }
    setStep((up ? "opening_upper " : "opening_lower ") + pct(target));
    return;
  }

  if (cycle.phase === "done") { cycle = null; setStep(""); }
}

defineRule("shluz_cmd_upstream",   { whenChanged: API + "/open_upstream",   then: function () { startCycle("upstream"); } });
defineRule("shluz_cmd_downstream", { whenChanged: API + "/open_downstream", then: function () { startCycle("downstream"); } });
defineRule("shluz_cmd_close",      { whenChanged: API + "/close_gates",     then: function () { startCycle("close"); } });
defineRule("shluz_cmd_stop",       { whenChanged: API + "/stop",            then: function () { stopAll("stopped"); } });
defineRule("shluz_cmd_reset", {
  whenChanged: API + "/reset",
  then: function () {
    dev[API + "/error"] = "";
    Object.keys(GATES).forEach(function (k) { if (gate[k].state === "error") { setState(k, "unknown"); } });
    setStep("");
  }
});

// Налив и слив — только при закрытых обоих воротах.
function bothClosed() { return gate.upper.state === "closed" && gate.lower.state === "closed"; }

// Инициализация: забыть положение ворот, сбросить ошибки, закрыть обе до концевика.
defineRule("shluz_cmd_init", {
  whenChanged: API + "/init",
  then: function () {
    stopAll("");
    dev[API + "/error"] = "";
    setState("upper", "unknown");
    setState("lower", "unknown");
    cycle = { kind: "init", phase: "close", phaseAt: now() };
  }
});

// Клапаны вручную — с теми же запретами, что у автоматики.
defineRule("shluz_btn_fill", {
  whenChanged: SRV + "/fill",
  then: function () {
    manual(function () {
      if (!bothClosed()) { return "fill refused: gates not closed"; }
      valves(true, false); return "";
    });
  }
});
defineRule("shluz_btn_drain", {
  whenChanged: SRV + "/drain",
  then: function () {
    manual(function () {
      if (!bothClosed()) { return "drain refused: gates not closed"; }
      valves(false, true); return "";
    });
  }
});
defineRule("shluz_btn_valves_off", { whenChanged: SRV + "/valves_off", then: function () { valves(false, false); } });
defineRule("shluz_valve_fill_state",  { whenChanged: VALVE_FILL,  then: function (v) { dev[SRV + "/valve_fill"] = !!v; } });
defineRule("shluz_valve_drain_state", { whenChanged: VALVE_DRAIN, then: function (v) { dev[SRV + "/valve_drain"] = !!v; } });

// -----------------------------------------------------------------------------
//  Такт: защиты, показания, автоматика, состояние
// -----------------------------------------------------------------------------

var manualStep = false;   // в step сейчас ход ворот без цикла (ручная кнопка, внешняя команда)

function tick() {
  Object.keys(GATES).forEach(function (k) {
    trackPos(k);
    put(API + "/" + k + "_pos", gate[k].pos === null ? -1 : Math.round(gate[k].pos));
    var cur = reading(GATES[k].current, 100);
    put(SRV + "/" + k + "_current", cur === null ? 0 : cur);
    var age = (now() - gate[k].startedAt) / 1000;
    if (!motorOn(k)) {
      // команду дали, а мотор так и не пошёл (модуль не ответил)
      if (moving(k) && !gate[k].pending && age > START_CONFIRM_S) { setState(k, "stopped"); }
      return;
    }
    if (now() - gate[k].limitAt < LIMIT_HOLD_MS) { return; }   // модуль гасит мотор на концевике
    if (age > par(k + "_timeout_s")) { gateFail(k, "no limit switch within " + par(k + "_timeout_s") + " s"); return; }
    var maxI = par("max_current");
    if (maxI > 0 && cur !== null && age > 1.5 && Math.abs(cur) > maxI) { gateFail(k, "motor current " + cur + " above " + maxI); }
  });

  // налив и слив — только при закрытых обоих воротах
  if ((dev[VALVE_FILL] || dev[VALVE_DRAIN]) && !bothClosed()) { valves(false, false); blockMsg("valves closed: gates not closed"); }

  var ma = reading(LEVEL_MA, 30), lvl = levelMm(), tol = par("tolerance_mm");
  put(SRV + "/level_ma", ma === null ? 0 : ma);
  put(SRV + "/level_mm", lvl === null ? 0 : Math.round(lvl));
  var cp = chamberPct();
  put(API + "/chamber_pct", cp === null ? -1 : Math.round(cp));
  put(API + "/chamber", lvl === null ? "no_sensor"
    : lvl >= par("full_mm") - tol ? "full" : lvl <= par("empty_mm") + tol ? "empty" : "between");

  runCycle();

  // ворота едут без цикла — тоже писать, что делают и на сколько открыты
  if (!cycle) {
    var mv = moving("upper") ? "upper" : moving("lower") ? "lower" : null;
    if (mv) { setStep(gate[mv].state + "_" + mv + " " + pct(mv)); manualStep = true; }
    else if (manualStep) { setStep(""); manualStep = false; }
  }

  var u = gate.upper.state, l = gate.lower.state, st;
  if (hasError()) { st = "error"; }
  else if (cycle) { st = cycle.kind === "init" ? "init" : "busy"; }
  else if (u === "open" && l === "closed") { st = "upstream_open"; }
  else if (l === "open" && u === "closed") { st = "downstream_open"; }
  else if (u === "closed" && l === "closed") { st = "closed"; }
  else if (moving("upper") || moving("lower")) { st = "busy"; }
  else { st = "unknown"; }
  put(API + "/status", st);
}

// -----------------------------------------------------------------------------
//  Сбои питания и сети: закрыть клапаны и ворота
// -----------------------------------------------------------------------------

function emergency(why) {
  log.warning("[shluz] " + why + ": closing gates");
  dev[API + "/error"] = "";
  Object.keys(GATES).forEach(function (k) { if (gate[k].state === "error") { setState(k, "unknown"); } });
  stopAll(why);
  cycle = { kind: "close", phase: "close", phaseAt: now() };
}

defineRule("shluz_battery", {
  whenChanged: "power_status/working on battery",
  then: function (v) {
    if (!v) { return; }
    emergency("on_battery");
    if (dev[SRV + "/battery_poweroff"]) {
      setTimeout(function () {
        if (dev["power_status/working on battery"]) { runShellCommand("poweroff"); }
      }, par("battery_poweroff_s") * 1000);
    }
  }
});

defineRule("shluz_network", {
  whenChanged: "network/Ethernet IP Connection Enabled",
  then: function (v) { if (!v) { emergency("ethernet_lost"); } }
});

// -----------------------------------------------------------------------------
//  Старт
// -----------------------------------------------------------------------------

setTimeout(function () {
  Object.keys(GATES).forEach(function (k) {
    if (dev[ctl(k, LIM_CLOSED)]) { setState(k, "closed"); }
    else if (dev[ctl(k, LIM_OPEN)]) { setState(k, "open"); }
    check(k);                                   // мотор уже крутится на открытие — остановить
  });
  valves(false, false);
  if (dev[SRV + "/init_on_start"]) { cycle = { kind: "init", phase: "close", phaseAt: now() }; }
  setInterval(tick, TICK_MS);
  log.info("[shluz] started");
}, 5000);

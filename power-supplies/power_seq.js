// power_seq.js — последовательное включение блоков питания макета «Живая вода».
//
// Пятнадцать блоков питания сидят на реле 101·K1…103·K3. Включать их разом
// нельзя: у импульсных блоков пусковой ток в разы больше рабочего, и все
// пятнадцать зарядных ёмкостей, поднятые одним щелчком, дают бросок,
// от которого выбивает автомат. Поэтому кнопка одна, а замыкание —
// по одному реле с паузой.
//
// Виртуальное устройство power_ctrl:
//   «Все блоки питания» — переключатель: включил — поднимаются с начала списка,
//                         выключил — гаснут с конца
//   «Включено блоков»   — сколько реле реально замкнуто, N из 15
//   «Состояние»         — ход выполнения, на каком блоке сейчас
//   «Идёт переключение» — признак, чтобы не запускать вторую последовательность
//   «Пауза между блоками» — мс, по умолчанию 500
//
// Блоки, уже стоящие в нужном положении, пропускаются без паузы — поэтому
// повторное нажатие безопасно и работает как «дозакрыть то, что осталось».
//
// Кроме паузы между блоками есть выдержка ПОСЛЕ ВЫКЛЮЧЕНИЯ: включать блок
// снова можно не раньше чем через MIN_OFF_MS. Горячий повторный пуск тяжелее
// холодного — входные ёмкости ещё заряжены. Последовательность в таком случае
// честно ждёт остаток, показывая это в «Состоянии».

var RELAYS = [
  { dev: "wb-mr6cv3_101", ctl: "K1", name: "БП 1"  },
  { dev: "wb-mr6cv3_101", ctl: "K2", name: "БП 2"  },
  { dev: "wb-mr6cv3_101", ctl: "K3", name: "БП 3"  },
  { dev: "wb-mr6cv3_101", ctl: "K4", name: "БП 4"  },
  { dev: "wb-mr6cv3_101", ctl: "K5", name: "БП 5"  },
  { dev: "wb-mr6cv3_101", ctl: "K6", name: "БП 6"  },
  { dev: "wb-mr6cu_102",  ctl: "K1", name: "БП 7"  },
  { dev: "wb-mr6cu_102",  ctl: "K2", name: "БП 8"  },
  { dev: "wb-mr6cu_102",  ctl: "K3", name: "БП 9"  },
  { dev: "wb-mr6cu_102",  ctl: "K4", name: "БП 10" },
  { dev: "wb-mr6cu_102",  ctl: "K5", name: "БП 11" },
  { dev: "wb-mr6cu_102",  ctl: "K6", name: "БП 12" },
  { dev: "wb-mr6c_103",   ctl: "K1", name: "БП 13" },
  { dev: "wb-mr6c_103",   ctl: "K2", name: "БП 14" },
  { dev: "wb-mr6c_103",   ctl: "K3", name: "БП 15" }
];

var STEP_MS_DEFAULT = 500;
var STEP_MS_MIN = 100;
var STEP_MS_MAX = 5000;

// Импульсному блоку тяжелее включаться «горячим»: входные ёмкости ещё не
// разрядились, и бросок при повторной подаче больше обычного. Поэтому между
// выключением блока и его следующим включением выдерживается пауза.
var MIN_OFF_MS = 30000;

var offAt = {};                                  // ключ реле -> когда выключили
function keyOf(r) { return r.dev + "/" + r.ctl; }
function now() { return new Date().getTime(); }

// сколько ещё ждать, прежде чем этот блок можно включать
function coolLeft(r) {
  var t = offAt[keyOf(r)];
  if (!t) { return 0; }
  var left = MIN_OFF_MS - (now() - t);
  return left > 0 ? left : 0;
}

defineVirtualDevice("power_ctrl", {
  title: { en: "Power Supplies", ru: "Блоки питания" },
  cells: {
    all_power: {
      type: "switch", value: false, order: 1,
      title: { en: "All Power Supplies", ru: "Все блоки питания" }
    },
    on_count: {
      type: "text", value: "", readonly: true, order: 2,
      title: { en: "Switched On", ru: "Включено блоков" }
    },
    status: {
      type: "text", value: "готово", readonly: true, order: 3,
      title: { en: "Status", ru: "Состояние" }
    },
    running: {
      type: "switch", value: false, readonly: true, order: 4,
      title: { en: "In Progress", ru: "Идёт переключение" }
    },
    step_ms: {
      type: "value", value: STEP_MS_DEFAULT, units: "ms", readonly: false, order: 5,
      title: { en: "Delay Between Units", ru: "Пауза между блоками" }
    }
  }
});

var seqIndex = 0;
var seqSwitched = 0;
var seqTimer = null;
var seqOn = true;          // что делаем: включаем или выключаем
var syncing = false;       // правим переключатель сами — не принимать это за команду

function countOn() {
  var n = 0;
  for (var i = 0; i < RELAYS.length; i++) {
    if (dev[RELAYS[i].dev][RELAYS[i].ctl]) { n++; }
  }
  return n;
}

var lastState = {};

// Следим за реле независимо от того, кто их щёлкнул: последовательность, дашборд
// или чужая рука. Момент выключения запоминаем — от него считается пауза.
// Включение раньше паузы перехватить нечем (команда уже дошла до реле), поэтому
// такое только отмечаем в состоянии и в журнале.
function watchRelays() {
  for (var i = 0; i < RELAYS.length; i++) {
    var r = RELAYS[i], k = keyOf(r), v = !!dev[r.dev][r.ctl], prev = lastState[k];
    if (prev !== undefined && prev !== v) {
      if (!v) {
        offAt[k] = now();
      } else {
        var left = coolLeft(r);
        if (left > 0 && !dev["power_ctrl"]["running"]) {
          dev["power_ctrl"]["status"] = r.name + " включили раньше паузы (оставалось " +
                                        Math.ceil(left / 1000) + " с)";
          log("power_seq: " + r.name + " включили горячим, оставалось " +
              Math.ceil(left / 1000) + " с паузы");
        }
      }
    }
    lastState[k] = v;
  }
}

function refreshCount() {
  watchRelays();
  var n = countOn();
  dev["power_ctrl"]["on_count"] = n + " из " + RELAYS.length;

  // Переключатель поднят, только когда включены ВСЕ. Стоит одному блоку выпасть —
  // он опускается, и его повторное включение снова запускает последовательность,
  // дозакрывая недостающее. Иначе рычаг «уже включён» и команду не отдать:
  // whenChanged на неизменившееся значение не срабатывает.
  // Сколько блоков включено на самом деле, показывает счётчик рядом.
  if (!dev["power_ctrl"]["running"]) {
    var want = (n === RELAYS.length);
    if (!!dev["power_ctrl"]["all_power"] !== want) {
      syncing = true;
      dev["power_ctrl"]["all_power"] = want;
    }
  }
}

function stepMs() {
  var v = dev["power_ctrl"]["step_ms"];
  if (typeof v !== "number" || isNaN(v)) { return STEP_MS_DEFAULT; }
  if (v < STEP_MS_MIN) { return STEP_MS_MIN; }
  if (v > STEP_MS_MAX) { return STEP_MS_MAX; }
  return v;
}

function finish() {
  seqTimer = null;
  dev["power_ctrl"]["running"] = false;
  var word = seqOn ? "включено " : "выключено ";
  dev["power_ctrl"]["status"] = seqSwitched
    ? "готово, " + word + seqSwitched + " из " + RELAYS.length
    : (seqOn ? "все блоки уже были включены" : "все блоки уже были выключены");
  log("power_seq: последовательность закончена, переключено реле: " + seqSwitched);
}

// Один шаг: берём следующее реле по порядку (при выключении — с конца),
// щёлкаем только если оно не в нужном состоянии, и ждём паузу.
function step() {
  if (seqIndex >= RELAYS.length) { finish(); return; }

  var r = seqOn ? RELAYS[seqIndex] : RELAYS[RELAYS.length - 1 - seqIndex];
  seqIndex++;

  if (!!dev[r.dev][r.ctl] === seqOn) {
    dev["power_ctrl"]["status"] = r.name + (seqOn ? " уже включён" : " уже выключен");
    seqTimer = setTimeout(step, 20);
    return;
  }

  // включать «горячим» нельзя — если блок выключили только что, ждём остаток паузы
  if (seqOn) {
    var left = coolLeft(r);
    if (left > 0) {
      seqIndex--;                                 // этот же блок и попробуем снова
      dev["power_ctrl"]["status"] = "жду остывания " + r.name + ": " +
                                    Math.ceil(left / 1000) + " с";
      seqTimer = setTimeout(step, left > 1000 ? 1000 : left + 50);
      return;
    }
  }

  dev[r.dev][r.ctl] = seqOn;
  if (!seqOn) { offAt[keyOf(r)] = now(); }
  seqSwitched++;
  dev["power_ctrl"]["status"] = (seqOn ? "включаю " : "выключаю ") + r.name +
                                " (" + seqIndex + " из " + RELAYS.length + ")";
  seqTimer = setTimeout(step, stepMs());
}

function startAll(on) {
  if (dev["power_ctrl"]["running"]) {
    log("power_seq: последовательность уже идёт, повторный запуск пропущен");
    return;
  }
  seqOn = on;
  seqIndex = 0;
  seqSwitched = 0;
  dev["power_ctrl"]["running"] = true;
  dev["power_ctrl"]["status"] = (on ? "включаю все, пауза " : "выключаю все, пауза ") + stepMs() + " мс";
  log("power_seq: " + (on ? "включаю" : "выключаю") + " блоки по одному, пауза " + stepMs() + " мс");
  step();
}

// Переключатель — это команда, а не отражение состояния: реле могут стоять
// вразнобой, и одна кнопка честно показать это не может. Поэтому рядом счётчик
// «включено N из 15» — он и есть настоящее состояние.
defineRule("power_all_switch", {
  whenChanged: "power_ctrl/all_power",
  then: function (newValue) {
    if (syncing) { syncing = false; return; }
    startAll(!!newValue);
  }
});

// Счётчик пересчитывается при любом изменении любого реле питания — хоть с
// дашборда, хоть с пульта, хоть этой же последовательностью.
var WATCH = [];
for (var wi = 0; wi < RELAYS.length; wi++) {
  WATCH.push(RELAYS[wi].dev + "/" + RELAYS[wi].ctl);
}

defineRule("power_count", {
  whenChanged: WATCH,
  then: function () { refreshCount(); }
});

// первичный пересчёт после старта правил, когда состояния реле уже пришли
setTimeout(refreshCount, 2000);

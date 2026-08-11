// power_seq.js — последовательное включение блоков питания макета «Живая вода».
//
// Пятнадцать блоков питания сидят на реле 101·K1…103·K3. Включать их разом
// нельзя: у импульсных блоков пусковой ток в разы больше рабочего, и все
// пятнадцать зарядных ёмкостей, поднятые одним щелчком, дают бросок,
// от которого выбивает автомат. Поэтому кнопка одна, а замыкание —
// по одному реле с паузой.
//
// Виртуальное устройство power_ctrl:
//   «Включить все БП» — кнопка, запускает последовательность
//   «Пауза между блоками» — мс, по умолчанию 500
//   «Состояние» — текст, видно ход выполнения
//   «Идёт включение» — признак, чтобы не запускать вторую последовательность
//
// Уже включённые блоки пропускаются, поэтому повторное нажатие безопасно
// и работает как «дозакрыть то, что осталось».

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

defineVirtualDevice("power_ctrl", {
  title: { en: "Power Supplies", ru: "Блоки питания" },
  cells: {
    all_on: {
      type: "pushbutton", value: false, order: 1,
      title: { en: "Switch All On", ru: "Включить все БП" }
    },
    all_off: {
      type: "pushbutton", value: false, order: 2,
      title: { en: "Switch All Off", ru: "Выключить все БП" }
    },
    status: {
      type: "text", value: "готово", readonly: true, order: 2,
      title: { en: "Status", ru: "Состояние" }
    },
    running: {
      type: "switch", value: false, readonly: true, order: 3,
      title: { en: "In Progress", ru: "Идёт включение" }
    },
    step_ms: {
      type: "value", value: STEP_MS_DEFAULT, units: "ms", readonly: false, order: 4,
      title: { en: "Delay Between Units", ru: "Пауза между блоками" }
    }
  }
});

var seqIndex = 0;
var seqSwitched = 0;
var seqTimer = null;
var seqOn = true;          // что делаем: включаем или выключаем

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

  dev[r.dev][r.ctl] = seqOn;
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

defineRule("power_all_on", {
  whenChanged: "power_ctrl/all_on",
  then: function () { startAll(true); }
});

defineRule("power_all_off", {
  whenChanged: "power_ctrl/all_off",
  then: function () { startAll(false); }
});

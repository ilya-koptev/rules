// water_level.js — управление насосом по уровню воды
// Устройство уровня : wb-mai2-mini_171 (MAI2-mini, токовый вход 4–20 мА)
// Насос             : Innovert ISD-mini-PLUS_101 (команда управления)
// Целевой уровень   : SETPOINT (мм, реальный уровень в резервуаре)
// Автовыключение    : каждый день в 20:00
//
// Уровень считается по КАЛИБРОВОЧНОЙ ТАБЛИЦЕ CAL (ток датчика, мА -> собственная
// шкала датчика, мм) кусочно-линейной интерполяцией: 49 точек, ток 0.69…19.72 мА,
// собственная шкала 0…26.02 мм. За границами таблицы значение фиксируется на
// крайней точке.
//
// Датчик установлен ПЕРЕВЁРНУТО: чем больше воды, тем меньше ток. Поэтому модель
// инвертированная, плюс ручная поправка показания:
//     level_mm = OFFSET - interp(ток) + level_trim
// OFFSET — константа ниже (76.86), получена из полевого замера: 68 мм ↔ 12.53 мА.
// level_trim — контрол «Изменить уровень», ±5 мм; правит показание, а не уставку.
//
// ВНИМАНИЕ: датчик насыщается — при токе > ~17 мА разрешение по уровню резко
// падает (последние 3 мм шкалы укладываются в 0.14 мА). Рабочая точка сейчас
// ~11–12.5 мА, это приличная часть кривой; выше не забираться.

var PUMP = "INNOVERT-ISD-mini-PLUS_101/Команда управления";
var SENSOR = "wb-mai2-mini_171/input_1_current";
var SETPOINT = 70;              // базовый целевой уровень (мм)
var HYST = 1.5;                 // гистерезис по умолчанию (мм, полная ширина коридора), редактируется в UI
var OFFSET = 76.86;             // инверт. модель level = OFFSET - interp: замер 68 мм ↔ 12.53 мА, 68+interp(12.53)=76.86
var MIN_OFF_PAUSE_SEC = 30;
var MAX_RUN_SEC = 8 * 60;

var pumpBlocked = false;
var maxRunTimer = null;

// Калибровка: [ток_датчика_мА, собственный_уровень_мм], ток строго возрастает.
var CAL = [
  [0.69,0],[0.7,0.9],[1.3,1.8],[1.67,2.1],[2.47,2.74],[3.13,3.26],[4.06,3.9],
  [4.4,4.13],[5.4,4.77],[6.34,5.29],[7.48,5.93],[8.07,6.23],[9.31,6.87],
  [10.16,7.39],[11.27,8.1],[11.35,8.03],[12.35,8.74],[13.15,9.26],[14.04,9.9],
  [14.44,10.2],[15.19,10.84],[15.77,11.36],[16.37,12],[16.55,12.23],
  [17.04,12.87],[17.36,13.39],[17.7,14.03],[17.85,14.33],[18.15,14.97],
  [18.35,15.49],[18.55,16.12],[18.73,16.76],[18.85,17.28],[18.98,17.92],
  [19.05,18.22],[19.15,18.86],[19.23,19.38],[19.31,20.02],[19.33,20.25],
  [19.4,20.89],[19.45,21.41],[19.52,22.2],[19.55,22.99],[19.58,23.51],
  [19.62,24.15],[19.65,24.22],[19.66,24.86],[19.7,25.38],[19.72,26.02]
];

// Кусочно-линейная интерполяция ток (мА) -> собственный уровень датчика (мм).
// За границами таблицы значение фиксируется на крайней точке (clamp).
function currentToLevel(mA) {
  if (mA <= CAL[0][0]) { return CAL[0][1]; }
  var last = CAL.length - 1;
  if (mA >= CAL[last][0]) { return CAL[last][1]; }
  for (var i = 1; i <= last; i++) {
    if (mA <= CAL[i][0]) {
      var x0 = CAL[i - 1][0], y0 = CAL[i - 1][1];
      var x1 = CAL[i][0],     y1 = CAL[i][1];
      return y0 + (y1 - y0) * (mA - x0) / (x1 - x0);
    }
  }
  return CAL[last][1];
}

// Реальный уровень: датчик ИНВЕРТИРОВАН (больше воды -> меньше тока),
// поэтому level = OFFSET - interp(ток) + ручная коррекция показания.
function computeLevel() {
  var raw = currentToLevel(dev[SENSOR]);
  return Math.round((OFFSET - raw + dev["pump_ctrl/level_trim"]) * 100) / 100;
}

defineVirtualDevice("pump_ctrl", {
  title: { en: "Pump Level Control", ru: "Управление уровнем" },
  cells: {
    auto_mode: { type: "switch", value: false, order: 1,
                 title: { en: "Auto Mode", ru: "Авторежим" } },
    level_mm: { type: "value", value: 0, units: "mm", readonly: true, order: 2,
                title: { en: "Water Level", ru: "Уровень воды" } },
    pump_running: { type: "switch", value: false, readonly: true, order: 3,
                    title: { en: "Pump Running", ru: "Насос работает" } },
    level_trim: { type: "range", value: 0, min: -5, max: 5, precision: 0.1,
                  units: "mm", readonly: false, order: 4,
                  title: { en: "Adjust Level", ru: "Изменить уровень" } },
    hyst_mm: { type: "value", value: HYST, units: "mm", readonly: false, order: 5,
               title: { en: "Hysteresis", ru: "Гистерезис" } }
  }
});

function startPump() {
  dev[PUMP] = 2;
  dev["pump_ctrl/pump_running"] = true;
  maxRunTimer = setTimeout(function() {
    log.warning("Насос работает более {} мин — аварийное выключение!", MAX_RUN_SEC / 60);
    stopPump();
  }, MAX_RUN_SEC * 1000);
  log("Насос ВКЛЮЧЁН: уровень={} мм", dev["pump_ctrl/level_mm"]);
}

function stopPump() {
  if (maxRunTimer !== null) { clearTimeout(maxRunTimer); maxRunTimer = null; }
  dev[PUMP] = 1;
  dev["pump_ctrl/pump_running"] = false;
  pumpBlocked = true;
  setTimeout(function() {
    pumpBlocked = false;
    log("Блокировка пуска снята — насос готов к следующему включению");
  }, MIN_OFF_PAUSE_SEC * 1000);
  log("Насос ВЫКЛЮЧЕН: уровень={} мм", dev["pump_ctrl/level_mm"]);
}

// Правило 1: пересчёт уровня по калибровке
defineRule("level_calc", {
  whenChanged: SENSOR,
  then: function() {
    dev["pump_ctrl/level_mm"] = computeLevel();
  }
});

// Правило 2: управление насосом по уровню
defineRule("pump_control", {
  whenChanged: ["pump_ctrl/level_mm", "pump_ctrl/auto_mode", "pump_ctrl/hyst_mm"],
  then: function() {
    if (!dev["pump_ctrl/auto_mode"]) { return; }
    var level = dev["pump_ctrl/level_mm"];
    var sp    = SETPOINT;                        // всегда 70 мм
    var half  = dev["pump_ctrl/hyst_mm"] / 2;    // hyst_mm — полная ширина коридора, пороги = 70 ± half
    var isOn  = dev["pump_ctrl/pump_running"];
    if (isOn) {
      if (level >= sp + half) { stopPump(); }
    } else {
      if (level <= sp - half && !pumpBlocked) { startPump(); }
    }
  }
});

// Правило 3: автовыключение в 20:00
defineRule("auto_off_at_20", {
  when: cron("0 0 17 * * *"), // UTC +3 h
  then: function() {
    if (dev["pump_ctrl/auto_mode"]) {
      dev["pump_ctrl/auto_mode"] = false;
      log("Авторежим выключен по расписанию (20:00)");
    }
  }
});

// Правило 4: остановка при выключении авторежима
defineRule("auto_mode_changed", {
  whenChanged: "pump_ctrl/auto_mode",
  then: function(newValue) {
    if (!newValue && dev["pump_ctrl/pump_running"]) {
      stopPump();
      log("Авторежим выключен → насос остановлен");
    }
  }
});

// Правило 5: синхронизация статуса с реальным состоянием Innovert
defineRule("pump_status_sync", {
  whenChanged: PUMP,
  then: function(newValue) {
    dev["pump_ctrl/pump_running"] = (newValue === 2);
    if (newValue !== 2 && maxRunTimer !== null) {
      clearTimeout(maxRunTimer);
      maxRunTimer = null;
      pumpBlocked = true;
      setTimeout(function() { pumpBlocked = false; }, MIN_OFF_PAUSE_SEC * 1000);
    }
  }
});

// Правило 6: пересчёт уровня при изменении ручной коррекции показания
defineRule("recalc_on_trim_change", {
  whenChanged: "pump_ctrl/level_trim",
  then: function() {
    dev["pump_ctrl/level_mm"] = computeLevel();
  }
});
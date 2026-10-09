# lock

Правило `wb-rules`: судоходный шлюз — двое ворот, камера, налив и слив.
Снаружи две команды («открыть верхний бьеф», «открыть нижний бьеф»), всё
остальное делает автоматика. Для наладки — устройства с ручным режимом.

Главное правило: обе ворота никогда не открыты одновременно. При сбое
(пропал Ethernet, работа от батареи, старт с открытыми воротами) ворота
закрываются в любом режиме.

## Установка

В начале `lock.js` задать имя устройства `LOCK_ID` и, если провода другие,
константы входов/выходов (`HI_*`, `LO_*`, `LEVEL_SENSOR_MA`, клапаны).

```bash
scp lock.js root@<контроллер>:/etc/wb-rules/
ssh root@<контроллер> journalctl -u wb-rules --since '30s ago' --no-pager
```

Нужно в конфиге драйвера: у WB-MAO4 входы 1/2 — концевики «открыто»/«закрыто»
с локальным выключением канала 1; у WB-MAI6 IN1/IN2 — напряжение с датчиков
тока моторов, IN3 — токовый вход 4–20 мА датчика уровня.

## MQTT API — для внешней системы

Устройство `<LOCK_ID>`.

| Контрол | Тип | Назначение |
|---|---|---|
| `open_upstream` | pushbutton | открыть верхний бьеф: закрыть ворота, налить камеру, открыть верхние |
| `open_downstream` | pushbutton | открыть нижний бьеф: закрыть ворота, слить камеру, открыть нижние |
| `status` | text | `busy` — идёт цикл или не готов; `upstream_open`; `downstream_open`; `error` |

Ворота после цикла стоят открытыми до противоположной команды. Новая команда
посреди цикла прерывает его и начинает свою. В ручном режиме и при ошибке
команды не принимаются.

### Примеры

```bash
mosquitto_sub -h <контроллер> -t '/devices/<LOCK_ID>/controls/status' -v

mosquitto_pub -h <контроллер> -t /devices/<LOCK_ID>/controls/open_upstream/on   -m 1
mosquitto_pub -h <контроллер> -t /devices/<LOCK_ID>/controls/open_downstream/on -m 1
```

## MQTT API — наладка

### `lock_ctl` — шлюз

| Контрол | Тип | Назначение |
|---|---|---|
| `manual` | switch | ручной режим: внешние команды не принимаются, работают кнопки |
| `step` | text | шаг автоматики |
| `error` | text | ошибка шлюза |
| `reset_error` | pushbutton | сбросить ошибки шлюза и ворот (ворота не двигает) |
| `level_mm`, `level_rate` | value | уровень в камере от пола, мм; скорость, мм/с |
| `chamber` | text | `полная` / `пустая` / `между` |
| `valve_fill`, `valve_drain` | switch | клапаны вручную (только в ручном режиме) |
| `empty_mm`, `full_mm`, `tolerance_mm` | value | уровни пустой/полной камеры и допуск |
| `plateau_rate`, `plateau_s`, `valve_grace_s` | value | «полка»: налив/слив закончен, когда скорость ниже порога столько-то секунд |
| `sensor_zero_ma`, `sensor_mm_per_ma`, `sensor_axis_mm` | value | калибровка датчика уровня |
| `travel_timeout_s` | value | общий таймаут хода ворот |
| `battery_shutdown`, `battery_shutdown_s` | switch, value | выключать контроллер при работе от батареи |

### `hi_gate`, `lo_gate` — ворота

| Контрол | Тип | Назначение |
|---|---|---|
| `state` | text | `closed` / `opened` / `closing` / `opening` / `stopped` / `unknown` / `error` |
| `position` | value | пройдено хода, % |
| `current` | value | ток мотора |
| `error` | text | причина ошибки |
| `open`, `close` | pushbutton | ход вручную (только в ручном режиме) |
| `stop` | pushbutton | стоп (в любом режиме) |
| `full_travel` | value | импульсов датчика оборотов на полный ход |
| `fast_speed`, `slow_speed`, `slow_from` | value | скорости, % и с какой доли хода замедляться, % |
| `overrun_pct` | value | перебег, % хода — стоп и ошибка |
| `no_pulse_s` | value | нет импульсов дольше — стоп и ошибка |
| `max_current` | value | порог тока — стоп и ошибка |
| `invert` | switch | направление наоборот |

Параметры сохраняются при перезагрузке. Ошибка сбрасывается только `reset_error`.

```bash
# ручной режим, открыть верхние ворота
mosquitto_pub -h <контроллер> -t /devices/lock_ctl/controls/manual/on -m 1
mosquitto_pub -h <контроллер> -t /devices/hi_gate/controls/open/on   -m 1

# порог тока нижних ворот
mosquitto_pub -h <контроллер> -t /devices/lo_gate/controls/max_current/on -m 2.0
```

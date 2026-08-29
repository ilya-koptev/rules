# power-supplies

Правило `wb-rules`: последовательное включение блоков питания по одному с паузой,
одной кнопкой. Виртуальное устройство `power_ctrl`.

## Установка

```bash
scp power_seq.js root@<контроллер>:/etc/wb-rules/
```

## MQTT API

| Контрол | Тип | Назначение |
|---|---|---|
| `all_power` | switch | включить/выключить все по очереди |
| `on_count` | text | сколько включено |
| `status` | text | ход выполнения |
| `step_ms` | value | пауза между блоками, мс |

### Примеры

```bash
mosquitto_sub -h <контроллер> -t '/devices/power_ctrl/controls/+' -v

# включить всё по очереди / выключить
mosquitto_pub -h <контроллер> -t /devices/power_ctrl/controls/all_power/on -m 1
mosquitto_pub -h <контроллер> -t /devices/power_ctrl/controls/all_power/on -m 0

# задать паузу 800 мс между блоками
mosquitto_pub -h <контроллер> -t /devices/power_ctrl/controls/step_ms/on -m 800
```

Рядом [`map_probe.py`](map_probe.py) — снятие токов по блокам.

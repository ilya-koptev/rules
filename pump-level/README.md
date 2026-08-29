# pump-level

Правило `wb-rules`: насос по уровню воды (датчик 4–20 мА на аналоговом входе,
калибровка по таблице). Виртуальное устройство `pump_ctrl`. Рядом
[`hmi-panel/`](hmi-panel/) — утилита Android-панели.

## Установка

```bash
scp water_level.js root@<контроллер>:/etc/wb-rules/
```

## MQTT API

| Контрол | Тип | Назначение |
|---|---|---|
| `level_mm` | value | уровень воды, мм |
| `auto_mode` | switch | авторежим |
| `pump_running` | switch | насос работает |
| `hyst_mm` | value | гистерезис, мм |
| `level_trim` | value | поправка уровня, мм |

### Примеры

```bash
mosquitto_sub -h <контроллер> -t '/devices/pump_ctrl/controls/+' -v

# включить авторежим, задать гистерезис 20 мм
mosquitto_pub -h <контроллер> -t /devices/pump_ctrl/controls/auto_mode/on -m 1
mosquitto_pub -h <контроллер> -t /devices/pump_ctrl/controls/hyst_mm/on   -m 20
```

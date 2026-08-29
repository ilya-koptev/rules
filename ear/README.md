# ear

Правило `wb-rules`: наведение по двум осям (азимут 0–330°, элевация 35–90°),
сценарии, согласованное ведение. Виртуальное устройство `ear`.

## Установка

```bash
scp ear.js root@<контроллер>:/etc/wb-rules/
```

## MQTT API

Чтение — `/devices/ear/controls/<контрол>`, команда — тот же топик с `/on`.

| Контрол | Тип | Назначение |
|---|---|---|
| `azimuth` | range 0–330 | текущий/целевой азимут |
| `elevation` | range 35–90 | текущая/целевая элевация |
| `home` | pushbutton | хоминг и парковка |
| `stop` | pushbutton | аварийный стоп |
| `scenario` | pushbutton | запустить сценарий |
| `scenarioSteps` | text | шаги сценария (JSON) |
| `sync` | switch | согласованное ведение осей |
| `homed` | switch | референс установлен |
| `status` | text | idle/homing/moving/parked/ERROR |

### Примеры

```bash
# смотреть всё состояние
mosquitto_sub -h <контроллер> -t '/devices/ear/controls/+' -v

# навести на азимут 120°, элевацию 60°
mosquitto_pub -h <контроллер> -t /devices/ear/controls/azimuth/on   -m 120
mosquitto_pub -h <контроллер> -t /devices/ear/controls/elevation/on -m 60

# хоминг и аварийный стоп
mosquitto_pub -h <контроллер> -t /devices/ear/controls/home/on -m 1
mosquitto_pub -h <контроллер> -t /devices/ear/controls/stop/on -m 1
```

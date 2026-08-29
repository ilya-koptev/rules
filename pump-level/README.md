# pump-level

Правило `wb-rules`: насос по уровню воды (датчик 4–20 мА на аналоговом входе,
калибровка по таблице). Рядом [`hmi-panel/`](hmi-panel/) — пульт для Android-панели.

## Установка

```bash
scp water_level.js root@<контроллер>:/etc/wb-rules/
```

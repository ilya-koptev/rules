# power-supplies

Правило `wb-rules`: включение блоков питания по одному с паузой, одной кнопкой.
Виртуальное устройство `power_ctrl`.

## Поставить

```bash
scp power_seq.js root@<контроллер>:/etc/wb-rules/
```

Рядом [`map_probe.py`](map_probe.py) — снятие токов по блокам.

# -*- coding: utf-8 -*-
"""Выполняется НА «Свете»: вливает порты макета в wb-mqtt-serial выключенными.

Совпадение ищется по паре адрес+порт, поэтому чужой `192.168.69.48:1` остаётся
на месте — у макета на том же адресе свой порт 8886.
"""
import json, os, shutil, time

CONF = os.path.realpath('/etc/wb-mqtt-serial.conf')
bak = CONF + '.bak-maket-' + time.strftime('%Y%m%d-%H%M%S')
shutil.copy2(CONF, bak)

cfg = json.load(open(CONF, encoding='utf-8'))
new = json.load(open('/tmp/maket_ports.json', encoding='utf-8'))['ports']
for p in new:
    p['enabled'] = False                       # ставим выключенными

key = lambda p: (p.get('address'), p.get('port'))
keys = {key(p) for p in new}
before = len(cfg.get('ports', []))
cfg['ports'] = [p for p in cfg.get('ports', [])
                if not (p.get('port_type') == 'tcp' and key(p) in keys)]
kept = len(cfg['ports'])
cfg['ports'] += new

tmp = CONF + '.tmp'
with open(tmp, 'w', encoding='utf-8') as fh:
    json.dump(cfg, fh, ensure_ascii=False, indent=2)
json.load(open(tmp, encoding='utf-8'))
os.replace(tmp, CONF)

print('бэкап:', bak)
print('портов было:', before, '| чужих оставлено:', kept, '| добавлено:', len(new),
      '| стало:', len(cfg['ports']))
print('порты макета добавлены выключенными (enabled = false)')

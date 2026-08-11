# -*- coding: utf-8 -*-
"""Смотрит, что реально со светом: кто не отвечает и где команда не встала."""
import json, subprocess, collections, sys, time

СОКЕТ = '/var/run/mosquitto/mosquitto.sock'


def дамп(тема, сек=12):
    r = subprocess.run(['timeout', str(сек), 'mosquitto_sub', '--unix', СОКЕТ,
                        '-t', тема, '-v'], capture_output=True, text=True)
    out = {}
    for стр in r.stdout.split('\n'):
        if ' ' in стр:
            t, _, v = стр.partition(' ')
            out[t] = v
    return out


имена = дамп('/devices/+/meta/name', 8)
город = {}
for t, v in имена.items():
    d = t.split('/')[2]
    if d.startswith('ld58_'):
        город[d] = v.split(' · ')[0]

знач = дамп('/devices/+/controls/+')
ошиб = дамп('/devices/+/controls/+/meta/error', 8)

каналы = collections.defaultdict(dict)
for t, v in знач.items():
    ч = t.split('/')
    if len(ч) == 5 and ч[2].startswith('ld58_') and ч[4].isdigit():
        каналы[ч[2]][ч[4]] = v

плохие = collections.Counter()
for t, v in ошиб.items():
    ч = t.split('/')
    if ч[2].startswith('ld58_') and v:
        плохие[ч[2]] += 1

по_городу = collections.defaultdict(lambda: [0, 0])
for dev, chs in каналы.items():
    for v in chs.values():
        по_городу[город.get(dev, '?')][0 if v == '1' else 1] += 1

print('модулей в MQTT: %d, каналов: %d'
      % (len(каналы), sum(len(x) for x in каналы.values())))
print('модулей с ошибками опроса: %d  %s'
      % (len(плохие), ', '.join('%s(%d)' % (k, v) for k, v in sorted(плохие.items()))))
print()
print('%-14s %6s %6s' % ('участок', 'горит', 'не горит'))
for k in sorted(по_городу, key=lambda x: (x == '?', x)):
    on, off = по_городу[k]
    print('%-14s %6d %6d' % (k, on, off))
print()
итого = [sum(x[0] for x in по_городу.values()), sum(x[1] for x in по_городу.values())]
print('ИТОГО горит %d, не горит %d' % tuple(итого))

if '--список' in sys.argv:
    print('\nмодули, где горит НЕ всё:')
    for dev in sorted(каналы):
        off = [c for c, v in каналы[dev].items() if v != '1']
        if off:
            print('   %-16s %-12s не горят: %s' % (dev, город.get(dev, '?'),
                                                   ','.join(sorted(off, key=int))))

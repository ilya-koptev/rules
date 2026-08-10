# -*- coding: utf-8 -*-
"""Генерирует дашборды панели «Свет» для homeui: один дашборд на город,
внутри — виджет на каждый модуль LD58, строки = каналы (подпись «шлюз|модуль|канал|имя»)."""
import json, io, collections

cfg = json.load(io.open('wb-mqtt-serial.maket.json', encoding='utf-8'))

CITY_ORDER = {c: i for i, c in enumerate(
    ['Калязин', 'Углич', 'Мышкин', 'Кашин', 'Кимры', 'Дубна', 'Борок'])}

# id дашборда уходит в URL homeui — только латиница
CITY_SLUG = {'Калязин': 'kalyazin', 'Углич': 'uglich', 'Мышкин': 'myshkin',
             'Кашин': 'kashin', 'Кимры': 'kimry', 'Дубна': 'dubna', 'Борок': 'borok'}


def city_key(uch):
    parts = uch.split()
    return (CITY_ORDER.get(parts[0], 99), int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0)


dashboards, widgets = [], []
skipped_free = 0
by_city = collections.defaultdict(list)      # город -> [(ключ сортировки, widget_id)]

for p in cfg['ports']:
    eb = p['address'].rsplit('.', 1)[1]
    devs = p['devices']
    uchs = sorted({d['name'].split(' · ')[0] for d in devs}, key=city_key)
    w_ids = []
    for d in sorted(devs, key=lambda x: x['slave_id']):
        uch = d['name'].split(' · ')[0]
        cells = []
        for ch in d['channels']:
            cid = ch.get('id')
            if cid == 'addr' or cid.endswith('_freq'):
                continue        # техническое: адрес и частота ШИМ правятся в «Устройствах»
            if '(свободен)' in ch['name']:
                skipped_free += 1
                continue
            cells.append({"id": f"{d['id']}/{cid}", "type": ch['type'], "extra": {}})
        if not cells:
            continue
        wid = f"w_light_{eb}_{d['slave_id']}"
        widgets.append({
            "id": wid,
            "name": f"{uch} · LD {d['slave_id']}",
            "description": "",
            "compact": False,
            "cells": cells,
        })
        w_ids.append(wid)
        by_city[uch.split()[0]].append((city_key(uch), d['slave_id'], wid))

for city in sorted(by_city, key=lambda c: CITY_ORDER.get(c, 99)):
    items = sorted(by_city[city])
    dashboards.append({
        "id": f"dash_light_{CITY_SLUG.get(city, city)}",
        "name": city,
        "isSvg": False,
        "options": {},
        "widgets": [w for _, _, w in items],
    })

io.open('light_dashboards.json', 'w', encoding='utf-8').write(
    json.dumps({"dashboards": dashboards, "widgets": widgets}, ensure_ascii=False, indent=2))

rows = sum(len(w['cells']) for w in widgets)
print(f'дашбордов: {len(dashboards)}')
print(f'виджетов:  {len(widgets)}')
print(f'строк(каналов+ШИМ): {rows}')
print(f'пропущено свободных каналов: {skipped_free}')
print('примеры имён дашбордов:')
for d in dashboards[:5]:
    print('   ', d['name'], '->', len(d['widgets']), 'виджет(ов)')

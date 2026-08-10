# -*- coding: utf-8 -*-
"""Генерирует правило групп (wb-rules) и виджеты «Группы» для дашбордов.

Группа = набор каналов, которые включаются/выключаются разом. Пока три вида:
всё (кроме свободных), фонари, машинки — по каждому городу и по макету целиком.
"""
import json, io, csv, collections

cfg = json.load(io.open('wb-mqtt-serial.maket.json', encoding='utf-8'))
addr = list(csv.DictReader(io.open('G:/Мой диск/i-Claude/maket-podsvetka/адресация.csv',
                                   encoding='utf-8')))

CITY_ORDER = ['Калязин', 'Углич', 'Мышкин', 'Кашин', 'Кимры', 'Дубна', 'Борок']
CITY_SLUG = {'Калязин': 'kalyazin', 'Углич': 'uglich', 'Мышкин': 'myshkin',
             'Кашин': 'kashin', 'Кимры': 'kimry', 'Дубна': 'dubna', 'Борок': 'borok'}

# назначение канала → вид: L фонарь, M машинка, O прочее (дом, светофор, плеер),
# свободные каналы в группы не входят вовсе
KIND = {'Фонарь': 'L', 'Машинка': 'M'}

# портовые краны: 40 Гц и скважность ≤30 %, включать их пачкой пока нельзя —
# в группы не входят вовсе, только вручную
KRANY = {('139', '7'), ('139', '8'), ('185', '7'), ('185', '8')}

purpose = {}
for r in addr:
    if r['ld58']:
        purpose[(r['ld58'], r['канал'])] = r['назначение']

rows = []                      # [устройство, канал, слаг города, вид]
for p in cfg['ports']:
    for d in p['devices']:
        city = d['name'].split(' · ')[0].split()[0]
        for ch in d['channels']:
            cid = ch.get('id', '')
            if not cid.isdigit():
                continue                        # addr, яркость, частота — не канал
            naz = purpose.get((str(d['slave_id']), cid), '')
            if naz in ('---', ''):
                continue                        # свободный канал в группы не берём
            if (str(d['slave_id']), cid) in KRANY:
                continue                        # портовые краны — только вручную
            rows.append([d['id'], cid, CITY_SLUG[city], KIND.get(naz, 'O')])

cnt = collections.Counter(r[3] for r in rows)
print('каналов в группах:', len(rows), '| фонарей:', cnt['L'], '| машинок:', cnt['M'],
      '| кранов исключено:', len(KRANY))

# --- правило ---
cells = []
for c in CITY_ORDER:
    s = CITY_SLUG[c]
    cells += [(s + '_all', c + ' — всё'), (s + '_lamps', c + ' — фонари'),
              (s + '_cars', c + ' — машинки')]
cells += [('all', 'Весь макет — всё'), ('lamps', 'Весь макет — фонари'),
          ('cars', 'Весь макет — машинки')]

js = u'''// Группы света макета: включить/выключить разом.
// Сгенерировано gen_groups.py по таблице адресации — руками не править.
//
// Канал: [устройство, номер, город, вид]; вид L — фонарь, M — машинка, O — прочее.
// В группы не входят: свободные каналы и портовые краны (LD 139/185, каналы 7-8) —
// краны включаются только вручную, у них 40 Гц и скважность не выше 30 %.

var CH = __CH__;

var CELLS = __CELLS__;

var CHUNK = 40;          // каналов за один заход, чтобы не подвесить движок правил
var STEP_MS = 50;
var queue = [], busy = false, applied = 0, total = 0;

function members(scope, kind) {
  var out = [];
  for (var i = 0; i < CH.length; i++) {
    var c = CH[i];
    if (scope && c[2] !== scope) continue;
    if (kind && c[3] !== kind) continue;
    out.push(c[0] + '/' + c[1]);
  }
  return out;
}

function pump(value) {
  var n = 0;
  while (queue.length && n < CHUNK) {
    dev[queue.shift()] = value;
    n++; applied++;
  }
  dev['svet']['status'] = queue.length
    ? 'переключаю: ' + applied + ' из ' + total
    : 'готово: ' + applied + ' каналов';
  if (queue.length) setTimeout(function () { pump(value); }, STEP_MS);
  else busy = false;
}

function apply(list, value) {
  queue = list; total = list.length; applied = 0; busy = true;
  pump(value);
}

var controls = {};
for (var i = 0; i < CELLS.length; i++) {
  controls[CELLS[i][0]] = { type: 'switch', value: false, title: CELLS[i][1],
                            order: i + 1, readonly: false };
}
controls['status'] = { type: 'text', value: '', title: 'Состояние',
                       order: CELLS.length + 1, readonly: true };
controls['poll'] = { type: 'switch', value: false, title: 'Опрос шлюзов',
                     order: 0, readonly: false };
controls['pollStatus'] = { type: 'text', value: '', title: 'Опрос',
                           order: 0.5, readonly: true };

defineVirtualDevice('svet', { title: 'Свет макета', cells: controls });

function makeRule(id) {
  var parts = id.split('_');
  var kind = parts[parts.length - 1];
  var scope = parts.length > 1 ? parts.slice(0, -1).join('_') : '';
  var k = kind === 'lamps' ? 'L' : (kind === 'cars' ? 'M' : '');
  defineRule('svet_group_' + id, {
    whenChanged: 'svet/' + id,
    then: function (newValue) {
      if (busy) {
        dev['svet']['status'] = 'занято, дождись окончания';
        return;
      }
      apply(members(scope, k), newValue);
    }
  });
}

for (var j = 0; j < CELLS.length; j++) makeRule(CELLS[j][0]);

// --- опрос макета ---
// Выключенный опрос освобождает ВСЕ шлюзы Ebyte (макет и «Ухо»): по ним можно
// работать напрямую, мимо контроллера. Порты из конфига не исчезают, у них лишь
// снимается enabled. Пока опрос выключен, «Ухо» тоже недоступно.
var pollSyncing = false;

defineRule('svet_poll', {
  whenChanged: 'svet/poll',
  then: function (newValue) {
    if (pollSyncing) return;
    // Переключение перезапускает wb-mqtt-serial, а это пауза в опросе ВСЕГО,
    // включая «Ухо». Пока Ухо едет — не трогаем, иначе оно потеряет тики и встанет.
    var ear = dev['ear'] && dev['ear']['status'];
    if (ear && ear !== 'idle' && ear !== 'parked' && ear.indexOf('ERROR') !== 0) {
      pollSyncing = true;
      dev['svet']['poll'] = !newValue;          // возвращаем переключатель назад
      pollSyncing = false;
      dev['svet']['pollStatus'] = 'Ухо в движении (' + ear + ') — переключить нельзя';
      return;
    }
    dev['svet']['pollStatus'] = newValue ? 'включаю опрос…' : 'выключаю опрос…';
    runShellCommand('/usr/local/bin/svet-poll ' + (newValue ? 'on' : 'off'), {
      captureOutput: true,
      exitCallback: function (code, out) {
        dev['svet']['pollStatus'] = code === 0
          ? (newValue ? 'опрос идёт' : 'выключен — шлюзы свободны, Ухо недоступно')
          : 'ошибка: ' + out;
      }
    });
  }
});

// при старте правила показываем, как есть на самом деле
runShellCommand('/usr/local/bin/svet-poll state', {
  captureOutput: true,
  exitCallback: function (code, out) {
    var st = (out || '').replace(/\s+$/, '');
    var on = st.indexOf('on') === 0;
    pollSyncing = true;
    dev['svet']['poll'] = on;
    pollSyncing = false;
    if (st.indexOf('mixed') === 0) {
      var m = st.split(' ');
      dev['svet']['pollStatus'] = 'частично: опрашивается ' + m[1] + ' шлюз(ов) из ' + m[2];
    } else {
      dev['svet']['pollStatus'] = on
        ? 'опрос идёт'
        : 'выключен — шлюзы свободны, Ухо недоступно';
    }
  }
});
'''.replace('__CH__', json.dumps(rows, ensure_ascii=False, separators=(',', ':')))     .replace('__CELLS__', json.dumps(cells, ensure_ascii=False))

io.open('svet-gruppy.js', 'w', encoding='utf-8', newline='\n').write(js)
print('правило:', len(js), 'символов')

# --- отдельная панель «Управление» после городов ---
dash = json.load(io.open('light_dashboards.json', encoding='utf-8'))
dash['widgets'] = [w for w in dash['widgets'] if not w['id'].startswith('w_light_groups_')]
dash['dashboards'] = [d for d in dash['dashboards'] if d['id'] != 'dash_light_groups']

widgets = [{
    "id": "w_light_groups_poll", "name": "Опрос шлюзов", "description": "", "compact": False,
    "cells": [{"id": "svet/poll", "type": "switch", "extra": {}},
              {"id": "svet/pollStatus", "type": "text", "extra": {}}],
}, {
    "id": "w_light_groups_all", "name": "Весь макет", "description": "", "compact": False,
    "cells": [{"id": "svet/all", "type": "switch", "extra": {}},
              {"id": "svet/lamps", "type": "switch", "extra": {}},
              {"id": "svet/cars", "type": "switch", "extra": {}},
              {"id": "svet/status", "type": "text", "extra": {}}],
}]
for c in CITY_ORDER:
    s_ = CITY_SLUG[c]
    widgets.append({
        "id": "w_light_groups_" + s_, "name": c, "description": "", "compact": False,
        "cells": [{"id": "svet/" + s_ + "_all", "type": "switch", "extra": {}},
                  {"id": "svet/" + s_ + "_lamps", "type": "switch", "extra": {}},
                  {"id": "svet/" + s_ + "_cars", "type": "switch", "extra": {}}],
    })

dash['widgets'] += widgets
dash['dashboards'].append({
    "id": "dash_light_groups", "name": "Управление", "isSvg": False, "options": {},
    "widgets": [w["id"] for w in widgets],
})

io.open('light_dashboards.json', 'w', encoding='utf-8').write(
    json.dumps(dash, ensure_ascii=False, indent=2))
print('дашбордов:', len(dash['dashboards']), '| виджетов:', len(dash['widgets']))

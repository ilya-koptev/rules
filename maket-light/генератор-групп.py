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

GW = collections.defaultdict(list)          # слаг города -> адреса Ebyte
for p in cfg['ports']:
    city = p['devices'][0]['name'].split(' · ')[0].split()[0]
    GW[CITY_SLUG[city]].append(p['address'])
EAR_GW = '192.168.69.35'                     # Ebyte «Уха», в таблице макета его нет

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

gw_all = [a for v in GW.values() for a in v] + [EAR_GW]
gw_map = {'poll_all': gw_all, 'poll_ear': [EAR_GW]}
poll_cells = [('poll_all', 'Все Ebyte'), ('poll_ear', 'Ухо')]
for c in CITY_ORDER:
    gw_map['poll_' + CITY_SLUG[c]] = GW[CITY_SLUG[c]]
    poll_cells.append(('poll_' + CITY_SLUG[c], c))

js = r'''// Группы света макета: включить/выключить разом.
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
var GW = __GW__;                 // область -> адреса Ebyte
var POLL = __POLL__;             // [id контрола, подпись]

for (var q = 0; q < POLL.length; q++) {
  controls[POLL[q][0]] = { type: 'switch', value: false, title: POLL[q][1],
                           order: 100 + q, readonly: false };
}
controls['pollStatus'] = { type: 'text', value: '', title: 'Опрос',
                           order: 99, readonly: true };

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

// --- опрос Ebyte ---
// Выключенный Ebyte освобождает шину: по ней можно работать напрямую, мимо
// контроллера. Порты из конфига не исчезают, у них лишь снимается enabled.
// Переключение перезапускает wb-mqtt-serial — пауза в опросе ВСЕГО, поэтому
// пока «Ухо» едет, переключать нельзя: оно потеряет тики и встанет.
// Свои же записи в переключатели не должны запускать правило заново, иначе одно
// нажатие расплодится в десяток перезапусков драйвера. Помечаем ожидаемое значение
// и только тогда, когда запись реально меняет контрол — то есть когда правило
// действительно сработает.
var expected = {};

function quietSet(id, value) {
  if (dev['svet'][id] !== value) {
    expected[id] = value;
    dev['svet'][id] = value;
  }
}

function selfWrite(id, value) {
  if (expected.hasOwnProperty(id) && expected[id] === value) {
    delete expected[id];
    return true;
  }
  return false;
}

function earBusy() {
  var st = dev['ear'] && dev['ear']['status'];
  return st && st !== 'idle' && st !== 'parked' && st.indexOf('ERROR') !== 0 ? st : '';
}

function syncPoll() {
  runShellCommand('/usr/local/bin/svet-poll list', {
    captureOutput: true,
    exitCallback: function (code, out) {
      if (code !== 0) { dev['svet']['pollStatus'] = 'ошибка: ' + out; return; }
      var state = {}, on = 0, total = 0;
      var lines = (out || '').split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].split(' ');
        if (t.length < 2) continue;
        state[t[0]] = t[1].charAt(0) === '1';
        total++; if (state[t[0]]) on++;
      }
      for (var k = 0; k < POLL.length; k++) {
        var id = POLL[k][0], list = GW[id], all = list.length > 0;
        for (var j = 0; j < list.length; j++) if (!state[list[j]]) { all = false; break; }
        quietSet(id, all);
      }
      dev['svet']['pollStatus'] = on === 0 ? 'выключен весь — Ebyte свободны'
        : (on === total ? 'опрашиваются все ' + total
                        : 'опрашивается ' + on + ' из ' + total);
    }
  });
}

function makePollRule(id) {
  defineRule('svet_poll_' + id, {
    whenChanged: 'svet/' + id,
    then: function (newValue) {
      if (selfWrite(id, newValue)) return;
      var busyEar = earBusy();
      if (busyEar) {
        quietSet(id, !newValue);
        dev['svet']['pollStatus'] = 'Ухо в движении (' + busyEar + ') — переключить нельзя';
        return;
      }
      // сразу показываем намерение: перезапуск драйвера занимает секунд десять,
      // и всё это время переключатели иначе висели бы в прежнем положении
      if (id === 'poll_all') {
        for (var z = 0; z < POLL.length; z++) quietSet(POLL[z][0], newValue);
      } else if (!newValue) {
        quietSet('poll_all', false);
      }
      dev['svet']['pollStatus'] = (newValue ? 'включаю: ' : 'выключаю: ') + POLL_TITLE[id] +
                                  ' — драйвер перезапускается, секунд десять';
      runShellCommand('/usr/local/bin/svet-poll set ' + (newValue ? 'on' : 'off') +
                      ' ' + GW[id].join(','), {
        captureOutput: true,
        exitCallback: function (code, out) {
          if (code !== 0) dev['svet']['pollStatus'] = 'ошибка: ' + out;
          syncPoll();
        }
      });
    }
  });
}

var POLL_TITLE = {};
for (var t = 0; t < POLL.length; t++) POLL_TITLE[POLL[t][0]] = POLL[t][1];
for (var t2 = 0; t2 < POLL.length; t2++) makePollRule(POLL[t2][0]);

syncPoll();     // при старте показываем, как есть на самом деле
'''.replace('__CH__', json.dumps(rows, ensure_ascii=False, separators=(',', ':')))     .replace('__CELLS__', json.dumps(cells, ensure_ascii=False))     .replace('__GW__', json.dumps(gw_map, ensure_ascii=False))     .replace('__POLL__', json.dumps(poll_cells, ensure_ascii=False))

io.open('svet-gruppy.js', 'w', encoding='utf-8', newline='\n').write(js)
print('правило:', len(js), 'символов')

# --- отдельная панель «Управление» после городов ---
dash = json.load(io.open('light_dashboards.json', encoding='utf-8'))
dash['widgets'] = [w for w in dash['widgets'] if not w['id'].startswith('w_light_groups_')]
dash['dashboards'] = [d for d in dash['dashboards'] if d['id'] != 'dash_light_groups']

widgets = [{
    "id": "w_light_groups_poll", "name": "Опрос", "description": "", "compact": False,
    "cells": ([{"id": "svet/poll_all", "type": "switch", "extra": {}},
               {"id": "svet/poll_ear", "type": "switch", "extra": {}}] +
              [{"id": 'svet/poll_' + CITY_SLUG[c], "type": "switch", "extra": {}}
               for c in CITY_ORDER] +
              [{"id": "svet/pollStatus", "type": "text", "extra": {}}]),
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

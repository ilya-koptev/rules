# -*- coding: utf-8 -*-
"""Свет макета: из таблицы адресации собирает всё, что уезжает на контроллер.

    python3 собрать.py

На выходе три файла рядом:
    svet.json        порты wb-mqtt-serial + дашборды homeui — то, что ставит установщик
    svet-gruppy.js   правило групп и опроса для /etc/wb-rules/
    каналы-топики.csv карта «топик ↔ ebyte/модуль/канал» — справочная, для людей

Источник истины — адресация.csv рядом (нормализованная выгрузка из xlsx).
"""
import json, io, csv, re, collections, os

ЗДЕСЬ = os.path.dirname(os.path.abspath(__file__))


def рядом(имя):
    return os.path.join(ЗДЕСЬ, имя)



SRC = рядом('адресация.csv')
rows_csv = list(csv.DictReader(io.open(SRC, encoding='utf-8')))

real = [r for r in rows_csv if r['ld58']]
ghost = [r for r in rows_csv if not r['ld58']]

# --- справочные строки: имя + клапан для чужих каналов ---
extra_name, extra_klapan = {}, collections.defaultdict(set)
for g in ghost:
    m = re.search(r'ld\s*(\d+)', g['комментарий'] or '', re.I)
    if not m:
        continue
    key = (m.group(1), g['канал'])
    nm = ' / '.join(x for x in (g['объект'], g['примечание']) if x)
    if nm:
        extra_name.setdefault(key, nm)
    extra_klapan[key].add(g['участок'])


def klapans(r):
    """все места канала: свой участок + упомянутые в комментарии + из справочных строк"""
    s = {r['участок']}
    c = r['комментарий'] or ''
    if 'клапан' in c.lower():
        for part in re.findall(r'(Углич|Мышкин|Кашин|Калязин|Кимры|Дубна|Борок)\s*(\d+)', c):
            s.add(f'{part[0]} {part[1]}')
    s |= extra_klapan.get((r['ld58'], r['канал']), set())
    return sorted(s)


def name_of(r):
    nm = ' — '.join(x for x in (r['объект'], r['примечание']) if x)
    if not nm:
        nm = extra_name.get((r['ld58'], r['канал']), '')
    if not nm:
        nm = r['назначение'] if r['назначение'] not in ('---', '') else 'свободен'
    return сократить(sanitize(nm))


def sanitize(t):
    """схема wb-mqtt-serial: имя/id не должны содержать $ # + / " '"""
    t = t.replace('/', '∕').replace('"', '').replace("'", '')
    t = re.sub(r'[$#+]', '', t)
    return re.sub(r'\s+', ' ', t).strip()


# --- сокращение длинных подписей ---------------------------------------------
# Плашка на дашборде узкая, а имена из таблицы бывают в 60 символов. Правила
# механические, поэтому переживают перегенерацию из таблицы. Приставки вида
# «территория …» / «здание …» / «освещение …» НЕ режем: дальше идёт родительный
# падеж, и выходит обрубок («территория музея» -> «музея»).

ЦЕЛИКОМ = {
    'МАУК Музей Дубны. Отделение истории создания крылатых ракет':
        'Музей Дубны: крылатые ракеты',
    'храм Преображения Господня и Похвалы Пресвятой Богородицы':
        'храм Преображения и Похвалы',
    'Калязинское Ухо — подсветка здания и красные маячки': 'Ухо: здание и маячки',
    'дом Фёдора Онуфриевича Потапенко. Том Сойер фест': 'дом Ф.О. Потапенко, Том Сойер фест',
    'Савеловский машиностроительный завод, проходная': 'СМЗ, проходная',
    'д∕с — здание управления грузового порта Углича': 'д∕с — управление грузового порта',
}

ПРАВИЛА = [
    # заметки, которым не место в названии (предупреждение про 30 % — в README)
    (r'^рекомендовано 20% 40Гц\. pwm более 30% не включать — ', ''),
    (r'\s*—?\s*уменьшить яркость\?', ''),
    (r'вместе с ([\d.]+) составляет одну нить фонарей', r'фонари, нить с '),
    (r'RGB бег\.огни центр\.части моста через реле и контроллер', 'мост: RGB бегущие огни'),
    (r'^сборка линий фонарей ', 'фонари '),
    # дубль «жд»: «жд стрелка … — жд синий»
    (r'^жд стрелка ', 'стрелка '), (r'^жд переезд ', 'переезд '), (r'^жд пути ', 'пути '),
    (r'— жд ', '— '),
    (r'перед станцией', 'до ст.'), (r'после станции', 'за ст.'),
    (r'до станции', 'до ст.'), (r'за станцией', 'за ст.'),
    (r'(\d)(ый|ой|ий) путь', r'путь '),
    (r'в Калязине ', 'Калязин '),
    (r'\(в сторону Поречья\)', '(на Поречье)'), (r'\(в сторону Углича\)', '(на Углич)'),
    # словарные сокращения
    (r'жилой деревянный дом в стиле модерн', 'дерев. дом, модерн'),
    (r'жилой деревянный дом, модерн', 'дерев. дом, модерн'),
    (r'Божией Матери', 'БМ'),
    (r'монастыря', 'мон.'), (r'монастырь', 'мон.'),
    (r'Богоявленского мон\.', 'Богоявл. мон.'),
    (r'Пресвятой Богородицы', 'Пресв. Богородицы'),
    (r'Краеведческий музей', 'краевед. музей'),
    (r'[Мм]узейно-административный комплекс', 'музейно-адм. корпус'),
    (r'Ихтиологический корпус', 'ихтиологич. корпус'),
    (r'^ул\. ', ''), (r' ул\. ', ' '),
    (r'внутренняя подсветка', 'внутр. подсветка'),
    (r'внешняя подсветка', 'внешн. подсветка'),
    (r'типовая городская застройка', 'типовая застройка'),
]


def сократить(t):
    if t in ЦЕЛИКОМ:
        return ЦЕЛИКОМ[t]
    for a, b in ПРАВИЛА:
        t = re.sub(a, b, t)
    return re.sub(r'\s+', ' ', t).strip()


# --- сборка ---
by_dev = collections.defaultdict(list)
for r in real:
    by_dev[(r['ebyte'], r['ld58'], r['участок'])].append(r)

ports, mapping = [], []
by_gw = collections.defaultdict(list)
for (eb, ld, uch), chans in by_dev.items():
    by_gw[eb].append((ld, uch, sorted(chans, key=lambda x: int(x['канал']))))

for eb in sorted(by_gw, key=lambda x: int(x)):
    devices = []
    for ld, uch, chans in sorted(by_gw[eb], key=lambda x: int(x[0])):
        ch_cfg = [{
            "name": "Адрес модуля", "id": "addr", "reg_type": "holding", "address": "0x00FD",
            "type": "value", "readonly": True
        }]
        for r in chans:
            n = int(r['канал'])
            nm = name_of(r)
            # подпись = адрес канала в скобках + человеческое имя: [23·193·1] Аэродром
            adr = f'[{eb}·{ld}·{n}]'
            title = f'{adr} {nm}'
            if r['назначение'] in ('---', ''):
                title = f'{adr} канал {n}'      # назначение неизвестно — пишем просто номер
            if n <= 6:
                ch_cfg.append({"name": title, "id": f"{n}", "reg_type": "holding",
                               "address": f"0x0080:{n-1}:1", "type": "switch"})
            else:
                base = 0x0060 if n == 7 else 0x0070
                ch_cfg.append({"name": title, "id": f"{n}", "reg_type": "holding",
                               "address": f"0x{base+2:04X}", "type": "switch",
                               "on_value": "0xFFFF", "off_value": "0x0000"})
                # яркость и частота есть у каждого 7-го и 8-го канала — это железо
                # модуля, независимо от того, помечен канал в таблице как ШИМ или нет
                if True:
                    ch_cfg.append({"name": f'{adr} яркость', "id": f"{n}_pwm", "reg_type": "holding",
                                   "address": f"0x{base+1:04X}", "type": "range",
                                   "min": 0, "max": 100})
                    # частота живёт только на странице «Устройства»: везде 400 Гц,
                    # кроме портовых кранов LD 139/185 (40 Гц)
                    ch_cfg.append({"name": f'{adr} частота, Гц', "id": f"{n}_freq", "reg_type": "holding",
                                   "address": f"0x{base:04X}", "type": "value",
                                   "min": 1, "max": 20000})
            mapping.append({
                'топик': f'/devices/ld58_{eb}_{ld}/controls/{n}',
                'подпись': title,
                'шлюз': f'192.168.69.{eb}', 'ld58': ld, 'канал': n,
                'назначение': r['назначение'], 'режим': r['режим'],
                'имя': nm, 'клапаны': '; '.join(klapans(r)),
            })
        devices.append({
            "name": f'{uch} · LD {ld} · .{eb}',
            "id": f'ld58_{eb}_{ld}',
            "slave_id": int(ld),
            "max_read_registers": 1,
            "guard_interval_us": 5000,
            "response_timeout_ms": 500,
            "channels": ch_cfg,
        })
    ports.append({
        "address": f'192.168.69.{eb}',
        "port": 8886,
        "port_type": "tcp",
        "response_timeout_ms": 500,
        "poll_interval": 200,
        "enabled": True,
        "devices": devices,
    })

cfg = {"ports": ports}

# ============================ 2. ДАШБОРДЫ ====================================

CITY_ORDER = {c: i for i, c in enumerate(
    ['Калязин', 'Углич', 'Мышкин', 'Кашин', 'Кимры', 'Дубна', 'Борок'])}

# id дашборда уходит в URL homeui — только латиница
CITY_SLUG = {'Калязин': 'kalyazin', 'Углич': 'uglich', 'Мышкин': 'myshkin',
             'Кашин': 'kashin', 'Кимры': 'kimry', 'Дубна': 'dubna', 'Борок': 'borok'}


def city_key(uch):
    """Сортировка участков: сперва по городу, потом по номеру участка."""
    parts = uch.split()
    return (CITY_ORDER.get(parts[0], 99),
            int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0)

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
                continue    # адрес и частота — только на странице «Устройства»
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


# ============================ 3. ПРАВИЛО ГРУПП И ОПРОСА ======================

# назначение канала → вид: L фонарь, M машинка, O прочее (дом, светофор, плеер),
# свободные каналы в группы не входят вовсе
KIND = {'Фонарь': 'L', 'Машинка': 'M'}

# портовые краны: 40 Гц и скважность ≤30 %, включать их пачкой пока нельзя —
# в группы не входят вовсе, только вручную
KRANY = {('139', '7'), ('139', '8'), ('185', '7'), ('185', '8')}

purpose = {}
for r in rows_csv:
    if r['ld58']:
        purpose[(r['ld58'], r['канал'])] = r['назначение']

группы_каналов = []                      # [устройство, канал, слаг города, вид]
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
            группы_каналов.append([d['id'], cid, CITY_SLUG[city], KIND.get(naz, 'O')])

GW = collections.defaultdict(list)          # слаг города -> адреса Ebyte
for p in cfg['ports']:
    city = p['devices'][0]['name'].split(' · ')[0].split()[0]
    GW[CITY_SLUG[city]].append(p['address'])
EAR_GW = '192.168.69.35'                     # Ebyte «Уха», в таблице макета его нет

cnt = collections.Counter(r[3] for r in группы_каналов)

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
      dev['svet']['pollStatus'] = on === 0
        ? 'выключено всё — Ebyte свободны; плашки без названий — это нормально'
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
'''.replace('__CH__', json.dumps(группы_каналов, ensure_ascii=False, separators=(',', ':')))     .replace('__CELLS__', json.dumps(cells, ensure_ascii=False))     .replace('__GW__', json.dumps(gw_map, ensure_ascii=False))     .replace('__POLL__', json.dumps(poll_cells, ensure_ascii=False))



# ============================ 4. ПАНЕЛЬ «УПРАВЛЕНИЕ» =========================
# --- отдельная панель «Управление» после городов ---
dash = {'dashboards': dashboards, 'widgets': widgets}
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


# ============================ 5. ЧТО ПОЛУЧИЛОСЬ ==============================
свет = {'ports': ports, 'dashboards': dash['dashboards'], 'widgets': dash['widgets']}
io.open(рядом('svet.json'), 'w', encoding='utf-8').write(
    json.dumps(свет, ensure_ascii=False, indent=1))

io.open(рядом('svet-gruppy.js'), 'w', encoding='utf-8', newline='\n').write(js)

with io.open(рядом('каналы-топики.csv'), 'w', encoding='utf-8', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(mapping[0].keys()), delimiter=';')
    w.writeheader()
    w.writerows(mapping)

строк = sum(len(w['cells']) for w in dash['widgets'])
print('устройств:      %d, контролов %d'
      % (sum(len(x['devices']) for x in ports),
         sum(len(d['channels']) for x in ports for d in x['devices'])))
print('дашбордов:      %d, виджетов %d, строк %d'
      % (len(dash['dashboards']), len(dash['widgets']), строк))
print('в группах:      %d каналов (фонарей %d, машинок %d)'
      % (len(группы_каналов), cnt['L'], cnt['M']))
print('svet.json:      %d КБ' % (len(json.dumps(свет, ensure_ascii=False)) / 1024))

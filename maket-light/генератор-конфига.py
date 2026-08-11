# -*- coding: utf-8 -*-
"""Генератор из таблицы адресации:
   1) конфиг wb-mqtt-serial (порты-шлюзы Ebyte + 92 модуля LD58A08 с человеческими именами)
   2) карта «MQTT-топик <-> физический канал» для документации и групп
Каналы 1-6: бит в регистре 0x0080. Каналы 7-8: вкл (0x_2), ШИМ % (0x_1), частота Гц (0x_0).
"""
import csv, io, json, re, collections

SRC = 'ld58_channels.csv'
rows = list(csv.DictReader(io.open(SRC, encoding='utf-8')))

real = [r for r in rows if r['ld58']]
ghost = [r for r in rows if not r['ld58']]

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
io.open('wb-mqtt-serial.maket.json', 'w', encoding='utf-8').write(
    json.dumps(cfg, ensure_ascii=False, indent=2))

with io.open('каналы-топики.csv', 'w', encoding='utf-8', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(mapping[0].keys()))
    w.writeheader()
    w.writerows(mapping)

# --- сводка ---
sw = sum(1 for m in mapping if m['канал'] <= 6)
pwm = sum(1 for m in mapping if m['режим'] == 'ШИМ')
ctrl = sum(len(d['channels']) for p in ports for d in p['devices'])
multi = [m for m in mapping if ';' in m['клапаны']]
print(f'портов(шлюзов): {len(ports)}')
print(f'устройств:      {sum(len(p["devices"]) for p in ports)}')
print(f'каналов:        {len(mapping)}  (вкл/выкл {sw}, ШИМ {pwm})')
print(f'контролов MQTT: {ctrl}')
print(f'каналов на нескольких клапанах: {len(multi)}')
print(f'размер конфига: {len(json.dumps(cfg, ensure_ascii=False))/1024:.0f} КБ')

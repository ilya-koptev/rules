#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Ставит свет макета на контроллер. Выполняется НА контроллере, из папки с файлами.

    python3 svet-install.py              всё разом
    python3 svet-install.py --freq       вдобавок разложить 400 Гц по модулям

Делает:
  1. вливает 38 портов Ebyte в /etc/wb-mqtt-serial.conf — выключенными, чужие порты
     не трогает; те, что уже опрашивались, остаются включёнными;
  2. вливает панели и дашборды в /etc/wb-webui.conf — свои пересоздаёт по префиксам
     dash_light_* / w_light_* / w_poll_*, чужие и дашборд по умолчанию не трогает;
  3. кладёт правило в /etc/wb-rules/svet-gruppy.js;
  4. кладёт утилиту опроса в /usr/local/bin/svet-poll;
  5. перезапускает wb-mqtt-serial и бэкенд веба.

Оба конфига перед правкой бэкапятся рядом с собой (.bak-svet-<дата>).
Операция идемпотентная: гонять повторно безопасно.
"""
import json, io, os, shutil, subprocess, sys, time

ЗДЕСЬ = os.path.dirname(os.path.abspath(__file__))
СЕРИАЛ = os.path.realpath('/etc/wb-mqtt-serial.conf')
ВЕБ = os.path.realpath('/etc/wb-webui.conf')
ПРАВИЛО = '/etc/wb-rules/svet-gruppy.js'
УТИЛИТА = '/usr/local/bin/svet-poll'
МЕТКА = time.strftime('%Y%m%d-%H%M%S')


def рядом(имя):
    return os.path.join(ЗДЕСЬ, имя)


def читать(путь):
    return json.load(io.open(путь, encoding='utf-8'))


def записать(путь, данные):
    """Пишем через временный файл и перечитываем — битый конфиг не доедет до места."""
    врем = путь + '.tmp'
    with io.open(врем, 'w', encoding='utf-8') as fh:
        json.dump(данные, fh, ensure_ascii=False, indent=2)
    читать(врем)
    os.replace(врем, путь)


def бэкап(путь):
    имя = путь + '.bak-svet-' + МЕТКА
    shutil.copy2(путь, имя)
    return имя


свет = читать(рядом('svet.json'))

# --- 1. порты драйвера ------------------------------------------------------
print('бэкап:', бэкап(СЕРИАЛ))
cfg = читать(СЕРИАЛ)
ключ = lambda p: (p.get('address'), p.get('port'))
# кто опрашивался до нас — таким и вернём, чтобы установка не меняла режим работы
включены = {ключ(p) for p in cfg.get('ports', []) if p.get('enabled')}
новые = свет['ports']
for p in новые:
    p['enabled'] = ключ(p) in включены
адреса = {ключ(p) for p in новые}
было = len(cfg.get('ports', []))
cfg['ports'] = [p for p in cfg.get('ports', [])
                if not (p.get('port_type') == 'tcp' and ключ(p) in адреса)]
чужих = len(cfg['ports'])
cfg['ports'] += новые
записать(СЕРИАЛ, cfg)
print('порты: было %d, чужих оставлено %d, наших %d (включённых %d)'
      % (было, чужих, len(новые), sum(1 for p in новые if p['enabled'])))

# --- 2. панели и дашборды ---------------------------------------------------
print('бэкап:', бэкап(ВЕБ))
веб = читать(ВЕБ)
мои_д = lambda i: str(i).startswith('dash_light_') or str(i) == 'dash_poll'
мои_в = lambda i: str(i).startswith('w_light_') or str(i).startswith('w_poll_')
веб['dashboards'] = [d for d in веб.get('dashboards', []) if not мои_д(d.get('id'))]
веб['widgets'] = [w for w in веб.get('widgets', []) if not мои_в(w.get('id'))]
чужих_д, чужих_в = len(веб['dashboards']), len(веб['widgets'])
веб['dashboards'] += свет['dashboards']
веб['widgets'] += свет['widgets']
записать(ВЕБ, веб)
print('панели: чужих оставлено %d, наших %d; виджетов чужих %d, наших %d'
      % (чужих_д, len(свет['dashboards']), чужих_в, len(свет['widgets'])))
print('дашборд по умолчанию не тронут:', веб.get('defaultDashboardId'))

# --- 3–4. правило и утилита -------------------------------------------------
shutil.copyfile(рядом('svet-gruppy.js'), ПРАВИЛО)
shutil.copyfile(рядом('svet-poll'), УТИЛИТА)
os.chmod(УТИЛИТА, 0o755)
print('правило:', ПРАВИЛО)
print('утилита:', УТИЛИТА)

# --- 5. перезапуск ----------------------------------------------------------
for служба in ('wb-mqtt-serial', 'wb-homeui-backend'):
    subprocess.run(['systemctl', 'restart', служба])
time.sleep(8)
for служба in ('wb-mqtt-serial', 'wb-homeui-backend', 'wb-rules'):
    состояние = subprocess.run(['systemctl', 'is-active', служба],
                               capture_output=True, text=True).stdout.strip()
    print('%-18s %s' % (служба, состояние))

# --- 400 Гц по запросу ------------------------------------------------------
# Частота живёт в самих модулях, не в конфиге, поэтому раскладывается отдельно
# и только при включённом опросе. Портовые краны LD 139/185 остаются на 40 Гц.
if '--freq' in sys.argv:
    КРАНЫ = {('139', '7'), ('139', '8'), ('185', '7'), ('185', '8')}
    сокет = '/var/run/mosquitto/mosquitto.sock'
    сколько = 0
    for порт in свет['ports']:
        for d in порт['devices']:
            for ch in d['channels']:
                cid = ch.get('id', '')
                if cid.endswith('_freq') and (str(d['slave_id']), cid.split('_')[0]) not in КРАНЫ:
                    subprocess.run(['mosquitto_pub', '--unix', сокет, '-t',
                                    '/devices/%s/controls/%s/on' % (d['id'], cid),
                                    '-m', '400'])
                    сколько += 1
    print('400 Гц отправлено на %d каналов (краны оставлены на 40)' % сколько)

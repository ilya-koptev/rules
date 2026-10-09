#!/usr/bin/env python3
# Панели веб-интерфейса для правила shluses.js: «Шлюз» (работа) и «Шлюз — настройки» (параметры).
# Запуск на контроллере: python3 add-dashboards.py <SHLUSES_ID>
import json, sys, shutil, time
ID = sys.argv[1]                       # имя внешнего устройства шлюза
P = "/mnt/data/etc/wb-webui.conf"
shutil.copy2(P, "/root/wb-webui.conf.bak-" + time.strftime("%Y%m%d-%H%M%S"))
c = json.load(open(P))
C = "shluses_ctl"
def w(wid, name, cells):
    return {"id": wid, "name": name, "description": "", "compact": False,
            "cells": [{"id": a, "name": b} for a, b in cells]}
def gate(g, title):
    return w("shl_" + g, title, [(g+"/state","Состояние"),(g+"/position","Пройдено хода, %"),(g+"/current","Ток мотора"),
        (g+"/error","Ошибка"),(g+"/open","Открыть (ручной)"),(g+"/close","Закрыть (ручной)"),(g+"/stop","Стоп")])
def gate_par(g, title):
    return w("shl_" + g + "_par", title, [(g+"/full_travel","Импульсов на полный ход"),(g+"/fast_speed","Скорость основная, %"),
        (g+"/slow_speed","Скорость у концевика, %"),(g+"/slow_from","Замедляться с, % хода"),(g+"/overrun_pct","Перебег, % хода"),
        (g+"/no_pulse_s","Нет импульсов дольше, с"),(g+"/max_current","Порог тока"),(g+"/invert","Направление наоборот")])
W = [
  w("shl_main", "Шлюз", [(ID+"/status","Статус"),(ID+"/open_upstream","Открыть верхний бьеф"),(ID+"/open_downstream","Открыть нижний бьеф"),
     (C+"/manual","Ручной режим"),(C+"/step","Шаг автоматики"),(C+"/error","Ошибка"),(C+"/reset_error","Сбросить ошибку")]),
  w("shl_chamber", "Камера", [(C+"/level_mm","Уровень от пола, мм"),(C+"/level_rate","Скорость уровня, мм/с"),(C+"/chamber","Камера"),
     (C+"/valve_fill","Клапан налива (ручной)"),(C+"/valve_drain","Клапан слива (ручной)")]),
  gate("hi_gate", "Верхние ворота"), gate("lo_gate", "Нижние ворота"),
  w("shl_chamber_par", "Камера — уровни", [(C+"/empty_mm","Пустая, мм"),(C+"/full_mm","Полная, мм"),(C+"/tolerance_mm","Допуск, ±мм"),
     (C+"/plateau_rate","Полка: скорость ниже, мм/с"),(C+"/plateau_s","Полка: держится, с"),(C+"/valve_grace_s","Не судить о полке первые, с")]),
  w("shl_sensor_par", "Датчик уровня — калибровка", [(C+"/sensor_zero_ma","Ток на воздухе, мА"),(C+"/sensor_mm_per_ma","мм на 1 мА"),
     (C+"/sensor_axis_mm","Ось мембраны над полом, мм")]),
  w("shl_common_par", "Общее", [(C+"/travel_timeout_s","Общий таймаут хода, с"),(C+"/battery_shutdown","Выключать от батареи"),
     (C+"/battery_shutdown_s","…через, с")]),
  gate_par("hi_gate", "Верхние ворота — параметры"), gate_par("lo_gate", "Нижние ворота — параметры"),
]
ids = {x["id"] for x in W}
c["widgets"] = [x for x in c.get("widgets", []) if x["id"] not in ids] + W
D = [{"id": "shluses", "name": "Шлюз", "widgets": ["shl_main", "shl_chamber", "shl_hi_gate", "shl_lo_gate"]},
     {"id": "shluses_par", "name": "Шлюз — настройки", "widgets": ["shl_chamber_par", "shl_sensor_par", "shl_common_par", "shl_hi_gate_par", "shl_lo_gate_par"]}]
dids = {d["id"] for d in D}
c["dashboards"] = [d for d in c.get("dashboards", []) if d["id"] not in dids] + D
json.dump(c, open(P, "w"), ensure_ascii=False, indent=2)
print("dashboards:", [d["name"] for d in c["dashboards"]], "widgets:", len(c["widgets"]))

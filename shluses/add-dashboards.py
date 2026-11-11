#!/usr/bin/env python3
# Панели веб-интерфейса для shluses.js:
#   «Шлюз»          — для пользователя: кнопки и состояние;
#   «Шлюз — наладка» — ручное управление воротами и клапанами, параметры.
# Запуск на контроллере: python3 add-dashboards.py
# Бэкап конфига — в /root/. Чужие панели не трогает, повторный запуск заменяет свои.
import json, shutil, time

P = "/mnt/data/etc/wb-webui.conf"
shutil.copy2(P, "/root/wb-webui.conf.bak-" + time.strftime("%Y%m%d-%H%M%S"))
c = json.load(open(P))
A, S = "shluz", "shluz_service"


def w(wid, name, cells):
    return {"id": wid, "name": name, "description": "", "compact": False,
            "cells": [{"id": a, "name": b} for a, b in cells]}


W = [
    w("shl_main", "Шлюз", [
        (A + "/status", "Состояние"), (A + "/step", "Что делает"), (A + "/error", "Ошибка"),
        (A + "/open_upstream", "Открыть верхний бьеф"), (A + "/open_downstream", "Открыть нижний бьеф"),
        (A + "/close_gates", "Закрыть ворота"), (A + "/stop", "Стоп"), (A + "/reset", "Сбросить ошибку"),
        (A + "/init", "Инициализация")]),
    w("shl_view", "Ворота и камера", [
        (A + "/upper_gate", "Верхние ворота"), (A + "/lower_gate", "Нижние ворота"),
        (A + "/chamber", "Камера, %")]),
    w("shl_manual", "Ручное управление", [
        (S + "/upper_open", "Верхние: открыть"), (S + "/upper_close", "Верхние: закрыть"),
        (S + "/lower_open", "Нижние: открыть"), (S + "/lower_close", "Нижние: закрыть"),
        (A + "/stop", "Стоп"),
        (S + "/fill", "Налив"), (S + "/drain", "Слив"), (S + "/valves_off", "Клапаны закрыть"),
        (S + "/valve_fill", "Налив открыт"), (S + "/valve_drain", "Слив открыт"),
        (S + "/last_block", "Последний запрет")]),
    w("shl_meas", "Измерения", [
        (S + "/upper_current", "Ток верхних"), (S + "/lower_current", "Ток нижних"),
        (S + "/level_ma", "Датчик уровня, мА"), (S + "/level_mm", "Уровень, мм")]),
    w("shl_par_gates", "Ворота — параметры", [
        (S + "/upper_timeout_s", "Верхние: таймаут, с"), (S + "/lower_timeout_s", "Нижние: таймаут, с"),
        (S + "/upper_pulses", "Верхние: импульсов на ход"), (S + "/lower_pulses", "Нижние: импульсов на ход"),
        (S + "/max_current", "Порог тока (0 — нет)"),
        (S + "/no_pulse_s", "Нет импульсов — ошибка, с"),
        (S + "/init_on_start", "Закрывать после старта")]),
    w("shl_par_chamber", "Камера — параметры", [
        (S + "/use_level", "По датчику уровня"), (S + "/empty_mm", "Пустая, мм"), (S + "/full_mm", "Полная, мм"),
        (S + "/tolerance_mm", "Допуск, ±мм"), (S + "/pct0_mm", "Камера 0 % при, мм"), (S + "/pct100_mm", "Камера 100 % при, мм"), (S + "/valve_max_s", "Налив/слив, с"),
        (S + "/level_check_s", "Проверять каждые, с"), (S + "/level_min_mm", "Сдвиг не меньше, мм"),
        (S + "/crack_s", "Приоткрыть ворота, с"),
        (S + "/sensor_zero_ma", "Датчик: ноль, мА"), (S + "/sensor_mm_per_ma", "Датчик: мм на мА"),
        (S + "/sensor_offset_mm", "Датчик: смещение, мм")]),
    w("shl_par_pumps", "Заливочные насосы", [
        (S + "/pump_host", "Контроллер реле"), (S + "/pump_fill", "Реле налива"),
        (S + "/pump_drain", "Реле слива"), (S + "/pump_river", "Реле русла (выкл. при сливе)")]),
    w("shl_par_power", "Питание", [
        (S + "/battery_poweroff", "Выкл. от батареи"), (S + "/battery_poweroff_s", "Выкл. через, с")]),
]
D = [
    {"id": "shluz", "name": "Шлюз", "widgets": ["shl_main", "shl_view"]},
    {"id": "shluz_service", "name": "Шлюз — наладка",
     "widgets": ["shl_manual", "shl_meas", "shl_par_gates", "shl_par_chamber", "shl_par_pumps", "shl_par_power"]},
]
OLD = {"shluses", "shluses_par"}          # панели прежней версии правил

wids = {x["id"] for x in W}
c["widgets"] = [x for x in c.get("widgets", []) if x["id"] not in wids and not x["id"].startswith("shl_")] + W
dids = {d["id"] for d in D} | OLD
c["dashboards"] = [d for d in c.get("dashboards", []) if d["id"] not in dids] + D
c["defaultDashboardId"] = "shluz"
json.dump(c, open(P, "w"), ensure_ascii=False, indent=2)
print("панели:", [d["name"] for d in c["dashboards"]], "по умолчанию:", c["defaultDashboardId"])

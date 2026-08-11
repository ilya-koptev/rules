# Собирает дашборды объекта в /etc/wb-webui.conf.
# Идемпотентно: свои виджеты и дашборды каждый раз перезаписываются целиком,
# чужие не трогаются.
import json, shutil, time

CONF = "/etc/wb-webui.conf"
BAK = "/mnt/data/wb-webui.conf.bak-" + time.strftime("%Y%m%d-%H%M%S")

VFD = "INNOVERT-ISD-mini-PLUS_101"

def cells(pairs):
    return [{"id": i, "name": n} for i, n in pairs]

WIDGETS = [
    {"id": "wPumpLevel", "name": "Уровень и режим", "description": "", "compact": False,
     "cells": cells([
         ("pump_ctrl/level_mm",                 "Уровень воды, мм"),
         ("pump_ctrl/auto_mode",                "Авторежим"),
         ("pump_ctrl/pump_running",             "Насос работает"),
         ("pump_ctrl/hyst_mm",                  "Гистерезис, мм"),
         ("pump_ctrl/level_trim",               "Поправка уровня, мм"),
         ("wb-mai2-mini_171/input_1_current",   "Ток датчика, мА"),
     ])},

    {"id": "wPump", "name": "Насос 1", "description": "", "compact": False,
     "cells": cells([
         (VFD + "/Выходная частота",            "Частота, Гц"),
         (VFD + "/Выходной ток",                "Ток, А"),
         (VFD + "/Выходное напряжение",         "Напряжение, В"),
         (VFD + "/Счетчик часов эксплуатации",  "Наработка, ч"),
         (VFD + "/Текущий код ошибки",          "Код ошибки"),
     ])},

    {"id": "wValvesDubna", "name": "Клапаны · Дубна", "description": "", "compact": False,
     "cells": cells([
         ("wb-mr6c_103/K4", "Наполнение русла"),
         ("wb-mr6c_103/K5", "Залив шлюза"),
         ("wb-mr6c_103/K6", "Слив шлюза"),
     ])},

    {"id": "wValvesUglich", "name": "Клапаны · Углич", "description": "", "compact": False,
     "cells": cells([
         ("wb-mr6c_105/K1", "Наполнение русла"),
         ("wb-mr6c_105/K2", "Залив шлюза"),
         ("wb-mr6c_105/K3", "Слив шлюза"),
     ])},

    {"id": "wValvesRybinsk", "name": "Клапаны · Рыбинск", "description": "", "compact": False,
     "cells": cells([
         ("wb-mr6c_105/K4", "Наполнение русла"),
         ("wb-mr6c_105/K5", "Залив шлюза 1"),
         ("wb-mr6c_105/K6", "Залив шлюза 2"),
         ("wb-mr6c_106/K1", "Слив шлюза 1"),
         ("wb-mr6c_106/K2", "Слив шлюза 2"),
     ])},

    {"id": "wPowerCtrl", "name": "Управление питанием", "description": "", "compact": False,
     "cells": cells([
         ("power_ctrl/all_power", "Все блоки питания"),
         ("power_ctrl/on_count",  "Включено блоков"),
         ("power_ctrl/status",    "Состояние"),
         ("power_ctrl/running",   "Идёт переключение"),
         ("power_ctrl/step_ms",   "Пауза между блоками, мс"),
     ])},

    # Питание разложено по модулям реле — так плашки совпадают с железом в щите,
    # и по номеру канала сразу понятно, куда идти щёлкать.
    {"id": "wPower101", "name": "Питание · модуль 101", "description": "", "compact": False,
     "cells": cells([("wb-mr6cv3_101/K%d" % i, "БП %d" % i) for i in range(1, 7)])},

    {"id": "wPower102", "name": "Питание · модуль 102", "description": "", "compact": False,
     "cells": cells([("wb-mr6cu_102/K%d" % i, "БП %d" % (i + 6)) for i in range(1, 7)])},

    {"id": "wPower103", "name": "Питание · модуль 103", "description": "", "compact": False,
     "cells": cells([("wb-mr6c_103/K%d" % i, "БП %d" % (i + 12)) for i in range(1, 4)])},

    # Разметка проверена 11.08.2026 под нагрузкой: гасили блоки по одному и
    # смотрели, какой вход просел. Один трансформатор тока охватывает пучок
    # целого модуля реле, а не отдельную линию. Суммы просадок совпали с
    # базовыми уровнями — значит скрытых потребителей за ними нет.
    {"id": "wPowerCurrents", "name": "Токи по модулям", "description": "", "compact": False,
     "cells": cells([
         ("wb-map12e_104/Ch 2 Irms L1", "Модуль 101 · БП 1–6"),
         ("wb-map12e_104/Ch 2 Irms L2", "Модуль 102 · БП 7–12"),
         ("wb-map12e_104/Ch 2 Irms L3", "Модуль 103 · БП 13–15"),
         ("wb-map12e_104/Ch 4 Irms L1", "Насос"),
     ])},
]

DASHBOARDS = [
    {"id": "dashPump", "isSvg": False, "name": "Насосная",
     "widgets": ["wPumpLevel", "wPump", "wValvesDubna", "wValvesUglich", "wValvesRybinsk"]},
    {"id": "dashPower", "isSvg": False, "name": "Питание",
     "widgets": ["wPowerCtrl", "wPower101", "wPower102", "wPower103", "wPowerCurrents"]},
]
DEFAULT = "dashPump"

shutil.copy2(CONF, BAK)
with open(CONF, encoding="utf-8") as f:
    conf = json.load(f)

mine_w = {w["id"] for w in WIDGETS}
mine_d = {d["id"] for d in DASHBOARDS}
conf["widgets"] = [w for w in conf.get("widgets", []) if w.get("id") not in mine_w] + WIDGETS
conf["dashboards"] = [d for d in conf.get("dashboards", []) if d.get("id") not in mine_d] + DASHBOARDS
conf["defaultDashboardId"] = DEFAULT

# виджеты, на которые больше никто не ссылается, не копим
used = set()
for d in conf["dashboards"]:
    used.update(d.get("widgets", []))
conf["widgets"] = [w for w in conf["widgets"] if w.get("id") in used]

with open(CONF, "w", encoding="utf-8") as f:
    json.dump(conf, f, ensure_ascii=False, indent=4)

print("бэкап:", BAK)
for d in conf["dashboards"]:
    mark = " (по умолчанию)" if d["id"] == conf["defaultDashboardId"] else ""
    print("дашборд:", d["name"], mark)
    for wid in d["widgets"]:
        w = next(x for x in conf["widgets"] if x["id"] == wid)
        print("   %-22s ячеек: %d" % (w["name"], len(w["cells"])))
print("виджетов всего:", len(conf["widgets"]))

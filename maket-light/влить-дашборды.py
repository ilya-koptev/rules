# -*- coding: utf-8 -*-
"""Выполняется НА «Свете»: вливает дашборды панели «Свет» в /etc/wb-webui.conf."""
import json, os, shutil, time

CONF = os.path.realpath("/etc/wb-webui.conf")
bak = CONF + ".bak-light-" + time.strftime("%Y%m%d-%H%M%S")
shutil.copy2(CONF, bak)

cfg = json.load(open(CONF, encoding="utf-8"))
new = json.load(open("/tmp/light_dashboards.json", encoding="utf-8"))

was_d = len(cfg.get("dashboards", []))
was_w = len(cfg.get("widgets", []))

# идемпотентность: убираем прежние сгенерированные, чужие не трогаем
cfg["dashboards"] = [d for d in cfg.get("dashboards", [])
                     if not str(d.get("id", "")).startswith("dash_light_")]
cfg["widgets"] = [w for w in cfg.get("widgets", [])
                  if not str(w.get("id", "")).startswith("w_light_")]
kept_d = len(cfg["dashboards"])
kept_w = len(cfg["widgets"])

add_d = len(new["dashboards"])
add_w = len(new["widgets"])
cfg["dashboards"] += new["dashboards"]
cfg["widgets"] += new["widgets"]

tmp = CONF + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(cfg, fh, ensure_ascii=False, indent=2)
json.load(open(tmp, encoding="utf-8"))          # проверка валидности
os.replace(tmp, CONF)

print("бэкап:", bak)
print("дашборды: было", was_d, "| своих оставлено", kept_d, "| добавлено", add_d, "| стало", len(cfg["dashboards"]))
print("виджеты:  было", was_w, "| своих оставлено", kept_w, "| добавлено", add_w, "| стало", len(cfg["widgets"]))
print("дашборд по умолчанию:", cfg.get("defaultDashboardId"))
print("первые дашборды:")
for d in cfg["dashboards"][:8]:
    print("   ", d.get("id"), "|", d.get("name"), "| виджетов:", len(d.get("widgets") or []))

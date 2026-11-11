#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Отдать панель шлюза наружу по Modbus TCP — и только её.

ВРЕМЕННОЕ РЕШЕНИЕ. Основной способ управления шлюзом — MQTT, см. README.
Этот скрипт для внешней системы, которая MQTT не умеет.

Правит /etc/wb-mqtt-mbgate.conf штатной службы wb-mqtt-mbgate:

  1. бэкап конфига в /mnt/data/etc/;
  2. всем существующим строкам ставит "enabled": false — в том числе прямым
     каналам WB-MAO4, если они там были: отдавать мотор наружу мимо правила
     и его защит нельзя;
  3. включает двенадцать топиков устройства shluz:
       coils  0..5    — шесть кнопок, запись 1 = нажатие;
       inputs 0..143  — шесть текстов, varchar по 24 регистра;
     всё на unit ID 1, адреса подряд — так внешней системе проще.

Повторный запуск не плодит дубли: свои строки сначала удаляются.
Службу не трогает, запуск отдельно:

    python3 add-mbgate.py && systemctl enable --now wb-mqtt-mbgate

Карта регистров и повадки mbgate (varchar по символу на регистр, пустое
значение = исключение 11, кнопки не читаются) — в README, раздел «Modbus TCP».
"""
import json
import os
import shutil
import sys
import time

CONF = "/etc/wb-mqtt-mbgate.conf"
BAK_DIR = "/mnt/data/etc"
UNIT = 1
TEXT_SIZE = 24          # регистров на поле; varchar у mbgate — символ на регистр

BUTTONS = ["open_upstream", "open_downstream", "close_gates", "stop", "reset", "init"]
TEXTS = ["status", "step", "error", "upper_gate", "lower_gate", "chamber"]


def main():
    if not os.path.exists(CONF):
        print("нет %s — поставь пакет wb-mqtt-mbgate" % CONF)
        return 1
    c = json.load(open(CONF, encoding="utf-8"))
    reg = c.setdefault("registers", {})
    for kind in ("discretes", "coils", "inputs", "holdings"):
        reg.setdefault(kind, [])

    c.setdefault("modbus", {})
    c["modbus"].setdefault("host", "*")
    c["modbus"].setdefault("port", 502)

    os.makedirs(BAK_DIR, exist_ok=True)
    bak = os.path.join(BAK_DIR, "wb-mqtt-mbgate.conf.bak-shluz-" + time.strftime("%Y%m%d-%H%M%S"))
    shutil.copyfile(CONF, bak)
    print("бэкап:", bak)

    for kind in reg:
        reg[kind] = [it for it in reg[kind] if not it.get("topic", "").startswith("shluz/")]

    was_on = [(k, it["topic"]) for k, items in reg.items() for it in items if it.get("enabled")]
    for items in reg.values():
        for it in items:
            it["enabled"] = False
    if was_on:
        print("выключено чужих строк:", len(was_on))
        for k, t in was_on:
            print("   ", k, t)

    def busy(kind):
        out = set()
        for it in reg.get(kind, []):
            a = it.get("address", 0)
            n = it.get("size", 1) if it.get("format") == "varchar" else 1
            for i in range(max(1, n)):
                out.add(a + i)
        return out

    b_coils, b_inputs = busy("coils"), busy("inputs")

    addr = 0
    for name in BUTTONS:
        if addr in b_coils:
            print("адрес coil %d занят — останавливаюсь, конфиг не изменён" % addr)
            return 1
        reg["coils"].append({"enabled": True, "topic": "shluz/" + name,
                             "unitId": UNIT, "address": addr})
        addr += 1

    addr = 0
    for name in TEXTS:
        for i in range(TEXT_SIZE):
            if addr + i in b_inputs:
                print("адрес input %d занят — останавливаюсь, конфиг не изменён" % (addr + i))
                return 1
        reg["inputs"].append({"enabled": True, "topic": "shluz/" + name,
                              "unitId": UNIT, "address": addr, "format": "varchar",
                              "size": TEXT_SIZE, "scale": 1,
                              "byteswap": False, "wordswap": False})
        addr += TEXT_SIZE

    json.dump(c, open(CONF, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print("\nвключено наружу:")
    for kind, items in reg.items():
        for it in items:
            if it.get("enabled"):
                extra = "  varchar x%d" % it["size"] if it.get("format") == "varchar" else ""
                print("   %-9s %-26s unit %-3d адрес %-5d%s"
                      % (kind, it["topic"], it["unitId"], it["address"], extra))
    print("\nдальше:  systemctl enable --now wb-mqtt-mbgate")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/bin/sh
# Выполняется на мосту. Вливает порты макета в wb-mqtt-serial на «Свете» (.106).
# Аргумент: имя файла с портами, уже лежащего в /tmp на мосту.
SRC="$1"
T=192.168.69.106
S="ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

echo "=== копирую $SRC на Свет ==="
scp -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$SRC" root@$T:/tmp/maket_ports.json || exit 1

$S root@$T 'python3 - <<PYEOF
import json, os, shutil, time
CONF = os.path.realpath("/etc/wb-mqtt-serial.conf")
bak = CONF + ".bak-maket-" + time.strftime("%Y%m%d-%H%M%S")
shutil.copy2(CONF, bak)
cfg = json.load(open(CONF, encoding="utf-8"))
new = json.load(open("/tmp/maket_ports.json", encoding="utf-8"))["ports"]
addrs = {p["address"] for p in new}
before = len(cfg.get("ports", []))
# идемпотентность: выкидываем прежние версии этих же портов, чужие не трогаем
cfg["ports"] = [p for p in cfg.get("ports", [])
                if not (p.get("port_type") == "tcp" and p.get("address") in addrs)]
kept = len(cfg["ports"])
cfg["ports"] += new
tmp = CONF + ".tmp"
json.dump(cfg, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(tmp, encoding="utf-8"))          # проверка валидности
os.replace(tmp, CONF)
print("бэкап:", bak)
print("портов было:", before, "| оставлено чужих:", kept, "| добавлено:", len(new), "| стало:", len(cfg["ports"]))
print("устройств добавлено:", sum(len(p["devices"]) for p in new))
PYEOF'

echo "=== перезапуск wb-mqtt-serial ==="
$S root@$T 'systemctl restart wb-mqtt-serial; sleep 12; systemctl is-active wb-mqtt-serial'
echo "=== ошибки в журнале за минуту ==="
$S root@$T 'journalctl -u wb-mqtt-serial --since "60s ago" --no-pager 2>/dev/null | grep -iE "error|warn|fail|timeout" | tail -15; echo "(пусто = чисто)"'
echo "=== появившиеся устройства ld58_* ==="
$S root@$T 'timeout 6 mosquitto_sub --unix /var/run/mosquitto/mosquitto.sock -t "/devices/+/meta/name" -v 2>/dev/null | grep ld58 | sort | head -20; echo "---"'

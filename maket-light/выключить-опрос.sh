#!/bin/sh
# Выполняется на мосту: самопроверка + снятие опроса макета со «Света».
T=192.168.69.106
S="ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

echo "=== САМОПРОВЕРКА: addr из модуля vs slave в топике ==="
$S root@$T 'timeout 15 mosquitto_sub --unix /var/run/mosquitto/mosquitto.sock -t "/devices/+/controls/addr" -v 2>/dev/null > /tmp/addrs.txt; python3 - <<PYEOF
ok = bad = 0
mismatch = []
for line in open("/tmp/addrs.txt", encoding="utf-8"):
    t, _, v = line.strip().partition(" ")
    if "/ld58_" not in t:
        continue
    dev = t.split("/")[2]              # ld58_<eb>_<ld>
    ld = dev.split("_")[2]
    if v == ld:
        ok += 1
    else:
        bad += 1
        mismatch.append((dev, v))
print(f"  совпало: {ok}   не совпало: {bad}")
for m in mismatch[:10]:
    print("   расхождение:", m)
PYEOF'

echo
echo "=== СНИМАЮ ОПРОС МАКЕТА (возврат к конфигу до макета) ==="
$S root@$T 'set -e
B=$(ls -t /mnt/data/etc/wb-mqtt-serial.conf.bak-maket-* | tail -1)   # самый первый бэкап = до макета
echo "  восстанавливаю из: $B"
python3 -c "import json,sys; c=json.load(open(sys.argv[1],encoding=\"utf-8\")); print(\"  портов в нём:\", len(c[\"ports\"]))" "$B"
cp "$B" /mnt/data/etc/wb-mqtt-serial.conf
systemctl restart wb-mqtt-serial'
sleep 12

echo "=== ПРОВЕРКА ПОСЛЕ СНЯТИЯ ==="
$S root@$T 'echo -n "  устройств ld58 осталось в MQTT: "; timeout 10 mosquitto_sub --unix /var/run/mosquitto/mosquitto.sock -t "/devices/+/meta/name" -v 2>/dev/null | grep -c ld58 || echo 0
echo -n "  сервис: "; systemctl is-active wb-mqtt-serial
echo -n "  Ухо: "; timeout 4 mosquitto_sub --unix /var/run/mosquitto/mosquitto.sock -t /devices/ear/controls/status -C 1 2>/dev/null
echo -n "  WB-LED Уха (Channel 1): "; timeout 4 mosquitto_sub --unix /var/run/mosquitto/mosquitto.sock -t "/devices/wb-led_71/controls/Channel 1" -C 1 2>/dev/null
echo -n "  портов в активном конфиге: "; python3 -c "import json;print(len(json.load(open(\"/mnt/data/etc/wb-mqtt-serial.conf\",encoding=\"utf-8\"))[\"ports\"]))"'

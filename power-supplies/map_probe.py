# Разметка токовых входов MAP по реле питания — под нагрузкой, версия 2.
#
# Отличие от первой попытки: базовый уровень снимается ЗАНОВО перед каждым реле.
# Потухшие ранее участки к этому моменту уже сидят в базовом уровне шага и
# ничего не искажают, а свой участок у проверяемого блока ещё горит.
import subprocess, time

H = ["-h", "127.0.0.1"]
MAP = "wb-map12e_104"
CH = [(c, p) for c in range(1, 5) for p in range(1, 4)]

RELAYS = ([("wb-mr6cv3_101", "K%d" % i, "БП %d" % i) for i in range(1, 7)] +
          [("wb-mr6cu_102",  "K%d" % i, "БП %d" % (i + 6)) for i in range(1, 7)] +
          [("wb-mr6c_103",   "K%d" % i, "БП %d" % (i + 12)) for i in range(1, 4)])

def get(t):
    return subprocess.run(["mosquitto_sub"] + H + ["-t", t, "-C", "1", "-W", "4"],
                          capture_output=True, text=True, timeout=8).stdout.strip()

def put(t, v):
    subprocess.run(["mosquitto_pub"] + H + ["-t", t, "-m", v], timeout=8)

def currents():
    out = {}
    for c, p in CH:
        v = get("/devices/%s/controls/Ch %d Irms L%d" % (MAP, c, p))
        try:
            out[(c, p)] = float(v)
        except ValueError:
            out[(c, p)] = 0.0
    return out

start = currents()
print("токи на старте:", "  ".join("%d·%d=%.3f" % (c, p, start[(c, p)])
                                   for c, p in CH if start[(c, p)] > 0.01))
print()
print("%-6s %-22s %s" % ("блок", "реле", "что просело в момент щелчка"))
print("-" * 74)

table = []
try:
    for dev, ctl, name in RELAYS:
        topic = "/devices/%s/controls/%s" % (dev, ctl)
        if get(topic) != "1":
            print("%-6s %-22s пропуск, уже выключено" % (name, dev + " " + ctl))
            continue

        before = currents()                 # уровень непосредственно перед щелчком
        put(topic + "/on", "0")
        time.sleep(2)
        if get(topic) != "0":
            put(topic + "/on", "1")
            print("%-6s %-22s реле не разомкнулось" % (name, dev + " " + ctl))
            time.sleep(2)
            continue

        time.sleep(5)
        after = currents()
        put(topic + "/on", "1")

        drops = [(k, before[k] - after[k]) for k in CH if before[k] - after[k] > 0.04]
        drops.sort(key=lambda x: -x[1])
        txt = ", ".join("Ch %d L%d −%.3f А" % (k[0], k[1], d) for k, d in drops) or "—"
        print("%-6s %-22s %s" % (name, dev + " " + ctl, txt), flush=True)
        table.append((name, drops))
        time.sleep(4)
finally:
    print()
    print("=== возврат ===")
    for dev, ctl, name in RELAYS:
        put("/devices/%s/controls/%s/on" % (dev, ctl), "1")
        time.sleep(0.4)
    time.sleep(3)
    off = [n for d, c, n in RELAYS if get("/devices/%s/controls/%s" % (d, c)) != "1"]
    print("осталось выключенным:", off if off else "ничего, все реле включены")

print()
print("=== сводка по входам ===")
by_ch = {}
for name, drops in table:
    for k, d in drops:
        by_ch.setdefault(k, []).append((name, d))
for k in sorted(by_ch):
    print("  Ch %d Irms L%d:" % k, ", ".join("%s %.3f А" % (n, d) for n, d in by_ch[k]))
silent = [n for n, dr in table if not dr]
if silent:
    print("  без измеряемого тока:", ", ".join(silent))

#!/bin/sh
# Разворачивает свет макета на контроллер «Свет». Запускается с моста «Тверской»
# (192.168.69.104) или с любой машины, откуда контроллер виден по ssh.
#
#     sh svet-deploy.sh [адрес] [--freq]
#
# По умолчанию адрес 192.168.69.106. Ключ --freq вдобавок разложит 400 Гц
# по модулям (нужен включённый опрос).
#
# Копирует четыре файла и запускает установщик на самом контроллере.
set -e

TARGET=192.168.69.106
FREQ=""
for a in "$@"; do
  case "$a" in
    --freq) FREQ="--freq" ;;
    -*)     echo "неизвестный ключ: $a" >&2; exit 1 ;;
    *)      TARGET="$a" ;;
  esac
done

HERE=$(dirname "$0")
O="-o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10"

echo "=== копирую на $TARGET ==="
ssh $O root@"$TARGET" 'mkdir -p /tmp/svet'
scp $O "$HERE/svet.json" "$HERE/svet-gruppy.js" "$HERE/svet-poll" \
       "$HERE/svet-install.py" root@"$TARGET":/tmp/svet/

echo "=== ставлю ==="
ssh $O root@"$TARGET" "python3 /tmp/svet/svet-install.py $FREQ"

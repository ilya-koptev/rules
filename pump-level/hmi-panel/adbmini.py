#!/usr/bin/env python3
"""Minimal ADB-over-TCP client: enough to run one shell command.

Only works against devices that do not demand authentication
(device answers CNXN straight away instead of AUTH).
"""
import socket
import struct
import sys

A_CNXN = b'CNXN'
A_OPEN = b'OPEN'
A_OKAY = b'OKAY'
A_WRTE = b'WRTE'
A_CLSE = b'CLSE'
A_AUTH = b'AUTH'

MAXDATA = 256 * 1024


def pack(cmd, arg0, arg1, data=b''):
    c = struct.unpack('<I', cmd)[0]
    crc = sum(data) & 0xFFFFFFFF
    return struct.pack('<6I', c, arg0, arg1, len(data), crc, c ^ 0xFFFFFFFF) + data


def recv_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError('connection closed')
        buf += chunk
    return buf


def read_msg(sock):
    cmd, arg0, arg1, length, _crc, _magic = struct.unpack('<6I', recv_exact(sock, 24))
    data = recv_exact(sock, length) if length else b''
    return struct.pack('<I', cmd), arg0, arg1, data


def shell(host, port, command, timeout=15):
    sock = socket.create_connection((host, port), timeout)
    sock.settimeout(timeout)

    # Deliberately advertise no features: without shell_v2 the device replies
    # with a raw byte stream instead of the framed shell protocol.
    sock.sendall(pack(A_CNXN, 0x01000001, MAXDATA, b'host::\x00'))
    cmd, _, _, banner = read_msg(sock)
    if cmd == A_AUTH:
        sock.close()
        raise RuntimeError('device requires adb authorisation (AUTH); '
                           'a signing key is needed')
    if cmd != A_CNXN:
        sock.close()
        raise RuntimeError('unexpected reply to CNXN: %r' % cmd)

    local_id = 1
    sock.sendall(pack(A_OPEN, local_id, 0, b'shell:' + command.encode() + b'\x00'))

    remote_id = None
    out = b''
    while True:
        try:
            cmd, arg0, arg1, data = read_msg(sock)
        except (EOFError, socket.timeout):
            break
        if cmd == A_OKAY and remote_id is None:
            remote_id = arg0
        elif cmd == A_WRTE:
            out += data
            sock.sendall(pack(A_OKAY, local_id, arg0))
        elif cmd == A_CLSE:
            sock.sendall(pack(A_CLSE, local_id, arg0))
            break
    sock.close()
    return banner, out


if __name__ == '__main__':
    target = sys.argv[1]
    host, _, port = target.partition(':')
    banner, out = shell(host, int(port or 5555), ' '.join(sys.argv[2:]))
    sys.stdout.write(out.decode('utf-8', 'replace'))

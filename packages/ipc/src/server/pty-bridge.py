# Haus — A thoughtful home.
# Copyright © 2026 Andrii Vynohradov. All rights reserved.
# Licensed under the GNU General Public License v3.0 or later; see LICENSE.
# SPDX-License-Identifier: GPL-3.0-or-later.
"""Minimal POSIX PTY bridge for Haus Secure Terminal IPC.

Binary framing on stdin/stdout:
  [type: 1 byte][length: 4 bytes big-endian][payload: length bytes]
  - 0x01: terminal bytes (stdin -> PTY master, PTY master -> stdout)
  - 0x02: resize (parent -> helper): [rows: uint16 BE][cols: uint16 BE]
  - 0x03: exit (helper -> parent): [code: int32 BE][sig_len: uint8][sig_utf8]
"""

from __future__ import annotations

import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

FRAME_DATA = 1
FRAME_RESIZE = 2
FRAME_EXIT = 3
MAX_FRAME_LEN = 131072


def write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    written = 0
    while written < len(view):
        try:
            n = os.write(fd, view[written:])
            if n <= 0:
                raise BrokenPipeError("short write")
            written += n
        except InterruptedError:
            continue
        except BlockingIOError:
            select.select([], [fd], [], 0.25)


def emit_frame(frame_type: int, payload: bytes) -> None:
    header = struct.pack(">BI", frame_type, len(payload))
    write_all(1, header + payload)


def set_winsize(master_fd: int, rows: int, cols: int) -> None:
    rows = max(1, min(300, rows))
    cols = max(2, min(500, cols))
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def terminate_group(pid: int) -> None:
    for sig in (signal.SIGHUP, signal.SIGTERM):
        try:
            os.killpg(pid, sig)
        except ProcessLookupError:
            return
        except OSError:
            pass
    deadline = time.monotonic() + 0.8
    while time.monotonic() < deadline:
        try:
            done, _ = os.waitpid(pid, os.WNOHANG)
            if done == pid:
                return
        except ChildProcessError:
            return
        time.sleep(0.04)
    try:
        os.killpg(pid, signal.SIGKILL)
    except OSError:
        pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass


def main() -> int:
    if len(sys.argv) < 4:
        return 2
    shell_path = sys.argv[1]
    cols = max(2, min(500, int(sys.argv[2])))
    rows = max(1, min(300, int(sys.argv[3])))

    pid, master_fd = pty.fork()
    if pid == 0:
        try:
            argv = [os.path.basename(shell_path), "-i"]
            os.execve(shell_path, argv, os.environ)
        except OSError:
            os._exit(127)

    try:
        set_winsize(master_fd, rows, cols)
    except OSError:
        pass

    stdin_fd = 0
    for fd in (stdin_fd, master_fd):
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    in_buf = bytearray()
    stdin_eof = False
    master_eof = False

    def handle_signal(_signum: int, _frame: object) -> None:
        nonlocal stdin_eof
        stdin_eof = True

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    try:
        while not stdin_eof and not master_eof:
            read_fds = [master_fd]
            if not stdin_eof:
                read_fds.append(stdin_fd)
            try:
                ready, _, _ = select.select(read_fds, [], [], 0.25)
            except InterruptedError:
                continue

            if master_fd in ready:
                batch = bytearray()
                while len(batch) < 32768:
                    try:
                        chunk = os.read(master_fd, 32768 - len(batch))
                        if not chunk:
                            master_eof = True
                            break
                        batch.extend(chunk)
                    except OSError as exc:
                        if exc.errno == errno.EAGAIN:
                            break
                        if exc.errno in (errno.EIO, errno.EBADF):
                            master_eof = True
                        else:
                            master_eof = True
                        break
                if batch:
                    emit_frame(FRAME_DATA, bytes(batch))

            if stdin_fd in ready:
                try:
                    raw = os.read(stdin_fd, 16384)
                    if not raw:
                        stdin_eof = True
                    else:
                        in_buf.extend(raw)
                except OSError as exc:
                    if exc.errno != errno.EAGAIN:
                        stdin_eof = True

            while len(in_buf) >= 5:
                frame_type, length = struct.unpack(">BI", in_buf[:5])
                if length > MAX_FRAME_LEN:
                    stdin_eof = True
                    break
                if len(in_buf) < 5 + length:
                    break
                payload = bytes(in_buf[5 : 5 + length])
                del in_buf[: 5 + length]
                if frame_type == FRAME_DATA and payload:
                    try:
                        write_all(master_fd, payload)
                    except OSError:
                        master_eof = True
                        break
                elif frame_type == FRAME_RESIZE and len(payload) == 4:
                    new_rows, new_cols = struct.unpack(">HH", payload)
                    try:
                        set_winsize(master_fd, new_rows, new_cols)
                        os.killpg(pid, signal.SIGWINCH)
                    except OSError:
                        pass
    finally:
        try:
            os.close(master_fd)
        except OSError:
            pass
        code = -1
        sig_name = ""
        try:
            done_pid, status = os.waitpid(pid, os.WNOHANG)
            if done_pid == 0:
                terminate_group(pid)
            else:
                if os.WIFEXITED(status):
                    code = os.WEXITSTATUS(status)
                elif os.WIFSIGNALED(status):
                    sig_num = os.WTERMSIG(status)
                    code = 128 + sig_num
                    try:
                        sig_name = signal.Signals(sig_num).name
                    except ValueError:
                        sig_name = f"SIG{sig_num}"
        except ChildProcessError:
            pass
        sig_bytes = sig_name.encode("utf-8")[:255]
        try:
            emit_frame(FRAME_EXIT, struct.pack(">iB", code, len(sig_bytes)) + sig_bytes)
        except OSError:
            pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

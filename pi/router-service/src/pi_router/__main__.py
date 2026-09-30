"""Run from a checkout without installing: `python -m pi_router serve|warm|spike [args]`."""

import sys

from . import service, spike

COMMANDS = {"serve": service.main, "warm": service.warm, "spike": spike.main}

if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
    sys.exit(f"usage: python -m pi_router {{{'|'.join(COMMANDS)}}} [args]")
command = sys.argv.pop(1)
COMMANDS[command]()

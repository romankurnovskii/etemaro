#!/usr/bin/env python3
"""Shared timestamped logger for the etemaro review scripts.

Every CLI in this directory writes a run-specific log file to
``scripts/.logs/<tool>_<UTC timestamp>.log`` — the skill-creator convention
(``./.logs/<tool>_<timestamp>.log``) resolved against the scripts directory so
the location is deterministic regardless of the caller's working directory.

The console handler stays at WARNING so each tool's stdout result contract is
unchanged; the file captures the full INFO/DEBUG detail for after-the-fact
debugging.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(SCRIPTS_DIR, '.logs')

_FORMAT = '%(asctime)sZ %(levelname)-7s %(name)s %(message)s'
_DATEFMT = '%Y-%m-%dT%H:%M:%S'


def get_logger(tool_name: str) -> logging.Logger:
    """Return a configured logger for ``tool_name`` (idempotent per name)."""
    logger = logging.getLogger(tool_name)
    if getattr(logger, '_etemaro_configured', False):
        return logger

    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    formatter = logging.Formatter(_FORMAT, _DATEFMT)

    # Console: WARNING+ only, so stdout summaries stay the agent-facing contract.
    console = logging.StreamHandler()
    console.setLevel(logging.WARNING)
    console.setFormatter(formatter)
    logger.addHandler(console)

    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        stamp = datetime.now(UTC).strftime('%Y%m%d-%H%M%S')
        file_handler = logging.FileHandler(os.path.join(LOG_DIR, f'{tool_name}_{stamp}.log'), encoding='utf-8')
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except OSError as exc:  # read-only checkout etc. — never break the tool
        logger.warning('could not create log file under %s: %s', LOG_DIR, exc)

    logger._etemaro_configured = True  # type: ignore[attr-defined]
    logger.debug('log dir: %s', LOG_DIR)
    return logger

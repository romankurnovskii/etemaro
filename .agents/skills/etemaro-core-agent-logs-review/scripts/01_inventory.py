#!/usr/bin/env python3
"""Step 1 (core agent): inventory an Etemaro core-agent run directory.

Usage:
    python3 01_inventory.py [target-dir] [--out PATH] [--json]

A **core-agent instance** is a directory carrying at least one of the core store
markers (``state.json``, ``lessons.json``, ``decision-log.json``). With no
argument the tool searches this repo's known locations in order:

    ./.data
    ./data/remote-server/data/instances/*
    ./data/instances/*

and treats a directory full of core-agent instances as a *dataset root*.

For every instance it reports the store inventory, the log parse accounting
(``log_coverage``: files / parsed / continuations / skipped / dialects), the
observed ``agentId`` values and the log time bounds, then writes
``<target>/reports/inventory.json``.

**Always read ``log_coverage`` before drawing any conclusion.** ``parsed: 0``
with ``total_lines > 0`` means ingestion is broken, not that the agent was idle.

Stdlib only; no network calls.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from datetime import UTC, datetime

from _dialects import agent_ids, coverage as log_coverage, log_bounds
from _logger import get_logger

#: files that prove a directory is a core-agent instance
CORE_MARKERS = ('state.json', 'lessons.json', 'decision-log.json')

#: optional stores worth listing when present
OPTIONAL_STORES = (
    'signal-weights.json',
    'pool-memory.json',
    'hivemind-cache.json',
    '.smart-wallets-snapshot.json',
    'notifications.jsonl',
)

DEFAULT_SEARCH = (
    '.data',
    'data/remote-server/data/instances',
    'data/instances',
)


def now_iso() -> str:
    return datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def read_json(path, default=None):
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def is_core_instance(path: str) -> bool:
    if not os.path.isdir(path):
        return False
    return any(os.path.exists(os.path.join(path, m)) for m in CORE_MARKERS)


def find_instances(root: str):
    """Return ``(instances, mode)`` for *root*.

    ``mode`` is ``single`` when *root* itself is an instance, ``multi`` when it is
    a dataset root holding instance directories, else ``[]``/``unknown``.
    """
    if is_core_instance(root):
        return [root], 'single'
    children = sorted(d for d in glob.glob(os.path.join(root, '*')) if is_core_instance(d))
    if children:
        return children, 'multi'
    return [], 'unknown'


def discover_default():
    """First existing default search root that actually holds core-agent instances."""
    for relative in DEFAULT_SEARCH:
        candidate = os.path.abspath(relative)
        if not os.path.isdir(candidate):
            continue
        instances, _mode = find_instances(candidate)
        if instances:
            return candidate, instances, 'multi' if len(instances) > 1 else 'single'
    return None, [], 'unknown'


def performance_bounds(instance_dir: str):
    """``(n_records, earliest recorded_at, latest recorded_at)`` from lessons.json."""
    data = read_json(os.path.join(instance_dir, 'lessons.json'), {})
    records = (data or {}).get('performance') if isinstance(data, dict) else None
    if not isinstance(records, list):
        return 0, None, None
    stamps = [r.get('recorded_at') for r in records if isinstance(r, dict) and r.get('recorded_at')]
    return len(records), (min(stamps) if stamps else None), (max(stamps) if stamps else None)


def summarise_instance(path: str) -> dict:
    n_records, first_rec, last_rec = performance_bounds(path)
    state = read_json(os.path.join(path, 'state.json'), {})
    decisions = read_json(os.path.join(path, 'decision-log.json'), {})
    log_first, log_last, log_lines = log_bounds(path)
    cov = log_coverage(path)

    positions = state.get('positions') if isinstance(state, dict) else None
    pending = state.get('pendingLiquidations') if isinstance(state, dict) else None
    decision_list = decisions.get('decisions') if isinstance(decisions, dict) else None

    return {
        'id': os.path.basename(path.rstrip('/')),
        'dir': os.path.abspath(path),
        'agent_ids': agent_ids(path),
        'stores': {
            'markers': [m for m in CORE_MARKERS if os.path.exists(os.path.join(path, m))],
            'optional': [m for m in OPTIONAL_STORES if os.path.exists(os.path.join(path, m))],
        },
        'performance_records': n_records,
        'performance_first_recorded_at': first_rec,
        'performance_last_recorded_at': last_rec,
        'state_positions': len(positions) if isinstance(positions, dict) else None,
        'state_pending_liquidations': len(pending) if isinstance(pending, dict) else None,
        'decisions': len(decision_list) if isinstance(decision_list, list) else None,
        'log_first_ts': log_first,
        'log_last_ts': log_last,
        'log_lines': log_lines,
        'log_coverage': cov,
    }


def main() -> int:
    log = get_logger('01_inventory')
    ap = argparse.ArgumentParser(description='Inventory an Etemaro core-agent run directory.')
    ap.add_argument('target_dir', nargs='?', default=None)
    ap.add_argument('--out', default=None)
    ap.add_argument('--json', action='store_true', help='print the JSON instead of a summary')
    args = ap.parse_args()

    if args.target_dir:
        root = os.path.abspath(args.target_dir)
        instances, mode = find_instances(root)
    else:
        root, instances, mode = discover_default()

    log.info('start target=%s mode=%s instances=%d', root, mode, len(instances))

    if not root or not os.path.isdir(root):
        print('no target directory found; pass one explicitly')
        log.error('no target directory (searched %s)', ', '.join(DEFAULT_SEARCH))
        return 1
    if not instances:
        print(f'no core-agent instance found at {root}')
        print('a core-agent instance carries at least one of: ' + ', '.join(CORE_MARKERS))
        log.error('no core-agent instance under %s', root)
        return 1

    summarised = [summarise_instance(p) for p in instances]

    opens = [i['performance_first_recorded_at'] for i in summarised if i['performance_first_recorded_at']]
    closes = [i['performance_last_recorded_at'] for i in summarised if i['performance_last_recorded_at']]
    log_first = min((i['log_first_ts'] for i in summarised if i['log_first_ts']), default=None)
    log_last = max((i['log_last_ts'] for i in summarised if i['log_last_ts']), default=None)

    report = {
        'schema': 'etemaro.core-agent-inventory/v1',
        'generated_at': now_iso(),
        'target': root,
        'family': 'core-agent',
        'mode': mode,
        'instances': summarised,
        'suggested_window': {
            'from': min(opens) if opens else log_first,
            'to': max(closes) if closes else log_last,
            'log_from': log_first,
            'log_to': log_last,
        },
        'reports_dir': os.path.join(root, 'reports'),
        'step': '01_inventory',
    }

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f'family=core-agent mode={mode} instances={len(summarised)}')
        for inst in summarised:
            cov = inst['log_coverage']
            print(
                f'  {inst["id"]}: perf={inst["performance_records"]} '
                f'open={inst["state_positions"]} pending={inst["state_pending_liquidations"]} '
                f'decisions={inst["decisions"]} agents={",".join(inst["agent_ids"]) or "?"}'
            )
            print(
                f'      logs: files={cov.get("files", 0)} lines={cov.get("total_lines", 0)} '
                f'parsed={cov.get("parsed", 0)} cont={cov.get("continuations", 0)} '
                f'skipped={cov.get("skipped", 0)} dialects={cov.get("dialects", {})}'
            )
            if cov.get('files') and not cov.get('parsed'):
                print('      !! zero records parsed — ingestion is broken, not a quiet period')
        print(f'  suggested window: {report["suggested_window"]["from"]} -> {report["suggested_window"]["to"]}')

    out = args.out or os.path.join(report['reports_dir'], 'inventory.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, indent=2)
        fh.write('\n')
    if not args.json:
        print(f'wrote {out}')
    log.info('wrote %s', out)
    return 0


if __name__ == '__main__':
    sys.exit(main())

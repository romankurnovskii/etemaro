#!/usr/bin/env python3
"""Step 3 (core agent): deterministic incident, liveness & telemetry forensics.

Usage:
    python3 03_incidents.py <target-dir> [--from ISO] [--to ISO]
        [--only-instance ID] [--out PATH] [--cycle-gap 30]

Produces the machine-readable basis for report section 8. Every number here is
computed, never grepped:

* **where the errors actually are** — ``structured-*.jsonl`` categories
  ``api_error`` / ``swap_error`` / ``tx_error``, plus ``actions-*.jsonl`` rows
  with ``success: false``. ``agent-*.log`` carries almost no error signal: its
  bracket is a component tag, not a severity level. A forensics pass that greps
  the text log finds nothing and falsely reports a clean run.
* **liveness** — ``[cron]`` events clustered into management cycles, measured
  against the configured ``schedule.managementIntervalMin``. Raw consecutive
  cron gaps are meaningless (the component emits many lines per cycle).
* **tool volume** — distinct-timestamp call counts. ``sweepUnsoldTokens`` and
  ``sweep_unsold_tokens`` log the same invocations twice under two spellings;
  counting either alone undercounts, summing both double-counts.
* **parse accounting** — files / parsed / continuations / skipped / dialects.

Stdlib only; no network calls.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import statistics
import sys
from datetime import UTC, datetime

from _dialects import (
    action_calls,
    component_census,
    coverage as log_coverage,
    cron_cycles,
    deploy_outcomes,
    failed_actions,
    structured_errors,
    sweeper_retries,
)
from _logger import get_logger

log = get_logger('03_incidents')

ERROR_CATEGORIES = ('api_error', 'swap_error', 'tx_error')

#: a management cycle gap beyond this multiple of the configured interval is a stall
STALL_MULTIPLE = 2.5


def now_iso() -> str:
    return datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def read_json(path, default=None):
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def is_core_instance(path: str) -> bool:
    return os.path.isdir(path) and any(
        os.path.exists(os.path.join(path, m)) for m in ('state.json', 'lessons.json', 'decision-log.json')
    )


def discover_instances(target: str):
    if is_core_instance(target):
        return [target]
    return sorted(d for d in (os.path.join(target, n) for n in os.listdir(target)) if is_core_instance(d))


def find_repo_root(start: str) -> str:
    cur = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(cur, 'config', 'shared', 'strategy-library.json')):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return os.path.abspath(start)
        cur = parent


def locate_config(instance_dir: str, repo_root: str):
    base = os.path.basename(instance_dir.rstrip('/'))
    candidates = [
        os.path.join(instance_dir, f'{base}.json'),
        os.path.join(instance_dir, 'agent-config.json'),
    ]
    instances_dir = os.path.join(repo_root, 'config', 'instances')
    if os.path.isdir(instances_dir):
        named = [n for n in sorted(os.listdir(instances_dir)) if base and base in n and n.endswith('.json')]
        candidates.append(os.path.join(instances_dir, named[-1]) if named else '')
        exact = os.path.join(instances_dir, f'{base}.json')
        candidates.append(exact)
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


def config_schedule(config: dict):
    schedule = (config or {}).get('schedule') or {}
    return {
        'managementIntervalMin': schedule.get('managementIntervalMin'),
        'screeningIntervalMin': schedule.get('screeningIntervalMin'),
        'healthCheckIntervalMin': schedule.get('healthCheckIntervalMin'),
    }


def fingerprint(message: str | None) -> str:
    """Collapse a message to a stable grouping key (digits and addresses masked)."""
    text = str(message or '')
    text = re.sub(r'0x[0-9a-fA-F]+', '<hex>', text)
    text = re.sub(r'[1-9A-HJ-NP-Za-km-z]{32,44}', '<addr>', text)
    text = re.sub(r'\d+', '<n>', text)
    return text.strip()[:160]


def group_errors(records: list):
    """``{category: {count, fingerprints: [...], samples: [...]}}``"""
    grouped = collections.defaultdict(list)
    for rec in records:
        grouped[rec['category']].append(rec)
    out = {}
    for category, items in grouped.items():
        prints = collections.Counter(fingerprint(i.get('message')) for i in items)
        out[category] = {
            'count': len(items),
            'fingerprints': [{'pattern': p, 'count': c} for p, c in prints.most_common()],
            'samples': [
                {'ts': i.get('ts'), 'message': (i.get('message') or '')[:400]} for i in items[:5]
            ],
        }
    return out


def sweeper_accounting(instance_dir: str, config: dict) -> dict:
    """Persisted sweeper retry counts, separated from the configured budget.

    The audit report claimed a dead token was *"correctly marked dead after 3
    retries"*. The persisted record said ``attempts: 1`` and the log said
    *"abandoning immediately without further retries"*. ``sweeperMaxAttempts`` is a
    budget, not an observation, so it is carried in its own key and never merged
    into the observed counts.
    """
    state = read_json(os.path.join(instance_dir, 'state.json'), {}) or {}
    pending = state.get('pendingLiquidations') if isinstance(state, dict) else None
    items = []
    if isinstance(pending, dict):
        for mint, item in pending.items():
            if not isinstance(item, dict):
                continue
            items.append(
                {
                    'symbol': item.get('symbol') or (mint[:8] if isinstance(mint, str) else None),
                    'mint': item.get('mint') or mint,
                    'status': item.get('status'),
                    'attempts': item.get('attempts'),
                    'last_error_code': item.get('last_error_code'),
                }
            )
    observed = [i['attempts'] for i in items if isinstance(i.get('attempts'), int)]
    management = (config or {}).get('management') or {}
    return {
        'configured_max_attempts': management.get('sweeperMaxAttempts'),
        'abandon_window_hours': management.get('sweeperAbandonWindowHours'),
        'items': items,
        'max_persisted_attempts': max(observed) if observed else None,
        'snapshot_note': 'state.json is a report-time snapshot, not windowed to the review period',
    }


def analyse_instance(instance_dir: str, frm, to, cycle_gap: int, repo_root: str) -> dict:
    cov = log_coverage(instance_dir, window=(frm, to) if (frm or to) else None)
    census = component_census(instance_dir, window=(frm, to) if (frm or to) else None)
    structured = structured_errors(instance_dir, window=(frm, to) if (frm or to) else None)
    failures = failed_actions(instance_dir, window=(frm, to) if (frm or to) else None)
    raw_tool_counts, distinct_tool_counts, _records = action_calls(
        instance_dir, window=(frm, to) if (frm or to) else None
    )

    cycle_starts, cycle_gaps = cron_cycles(instance_dir, gap_seconds=cycle_gap, window=(frm, to) if (frm or to) else None)

    deploys = deploy_outcomes(instance_dir, window=(frm, to) if (frm or to) else None)
    sweeper = sweeper_retries(instance_dir, window=(frm, to) if (frm or to) else None)

    config_path = locate_config(instance_dir, repo_root)
    config = read_json(config_path, {}) if config_path else {}
    schedule = config_schedule(config)
    expected_min = schedule.get('managementIntervalMin')
    sweeper_state = sweeper_accounting(instance_dir, config)

    stall_threshold = None
    stall_count = None
    max_gap = None
    if cycle_gaps:
        max_gap = max(cycle_gaps)
        if isinstance(expected_min, (int, float)) and expected_min:
            stall_threshold = round(expected_min * STALL_MULTIPLE, 2)
            stall_count = sum(1 for g in cycle_gaps if g > stall_threshold)

    runtime = census.get('coreagent_runtime', {})
    structured_census = census.get('coreagent_structured', {})

    dedup = {
        'by_tool_records': raw_tool_counts,
        'by_tool_distinct_ts': distinct_tool_counts,
        'double_logged_tools': {},
    }
    for tool, count in raw_tool_counts.items():
        snake = re.sub(r'(?<!^)(?=[A-Z])', '_', tool).lower()
        if snake != tool and snake in raw_tool_counts:
            dedup['double_logged_tools'][tool] = {
                'records': count,
                'distinct_ts': distinct_tool_counts.get(tool),
                'twin_spelling': snake,
                'twin_distinct_ts': distinct_tool_counts.get(snake),
                'union_distinct_ts': len(
                    set(_stamps_for(_records, tool)) | set(_stamps_for(_records, snake))
                ),
            }

    warnings = []
    if not cov.get('files'):
        warnings.append('no log files found in this instance directory')
    if cov.get('files') and not cov.get('parsed'):
        warnings.append('zero records parsed — ingestion is broken, not a quiet period')
    if cov.get('skipped'):
        warnings.append(f'{cov["skipped"]} line(s) matched no known core-agent dialect')
    if 'jsonl_unclassified' in (cov.get('dialects') or {}):
        warnings.append('an unhandled JSONL dialect is present — counts may be incomplete')
    unexplained = (deploys.get('causes') or {}).get('unexplained')
    if unexplained:
        warnings.append(
            f'{unexplained} deploy failure(s) have no guard record and no timeout token — '
            'the cause is not in the log; do not name one'
        )

    return {
        'id': os.path.basename(instance_dir.rstrip('/')),
        'dir': os.path.abspath(instance_dir),
        'config_path': config_path,
        'log_coverage': cov,
        'coverage_warnings': warnings,
        'components': {
            'runtime_tags': dict(sorted(runtime.items(), key=lambda kv: -kv[1])),
            'structured_categories': dict(sorted(structured_census.items(), key=lambda kv: -kv[1])),
        },
        'errors': {
            'structured': group_errors(structured),
            'structured_total': len(structured),
            'failed_actions': failures,
            'failed_actions_total': len(failures),
            'error_categories_present': sorted({r['category'] for r in structured}),
        },
        # Deploy causes are attributed from the guard record that precedes the
        # failure, never from the failure's shape. `causes` is the only sanctioned
        # source for a cause sentence in the report.
        'deploys': deploys,
        'sweeper': {'observed': sweeper, 'persisted': sweeper_state},
        'liveness': {
            'cycle_gap_threshold_sec': cycle_gap,
            'cycles': len(cycle_starts),
            'first_cycle': cycle_starts[0] if cycle_starts else None,
            'last_cycle': cycle_starts[-1] if cycle_starts else None,
            'gap_minutes': {
                'median': round(statistics.median(cycle_gaps), 2) if cycle_gaps else None,
                'p95': round(sorted(cycle_gaps)[int(len(cycle_gaps) * 0.95)], 2) if cycle_gaps else None,
                'max': max_gap,
            },
            'configured_management_interval_min': expected_min,
            'stall_threshold_min': stall_threshold,
            'stall_count': stall_count,
            'stalls': sorted(cycle_gaps, reverse=True)[:10] if cycle_gaps else [],
        },
        'tools': dedup,
    }


def _stamps_for(records, tool):
    return [ts for ts, name, _ok, _err in records if name == tool and ts]


def main() -> int:
    ap = argparse.ArgumentParser(description='Core-agent incident, liveness & telemetry forensics.')
    ap.add_argument('target_dir')
    ap.add_argument('--from', dest='frm', default=None)
    ap.add_argument('--to', dest='to', default=None)
    ap.add_argument('--only-instance', default=None)
    ap.add_argument('--cycle-gap', type=int, default=30, help='seconds; cron events closer than this are one cycle')
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    target = os.path.abspath(args.target_dir)
    log.info('start target=%s from=%s to=%s cycle_gap=%s', target, args.frm, args.to, args.cycle_gap)
    if not os.path.isdir(target):
        log.error('target is not a directory: %s', target)
        return 1

    instances = discover_instances(target)
    if args.only_instance:
        instances = [p for p in instances if os.path.basename(p.rstrip('/')) == args.only_instance]
    if not instances:
        log.error('no core-agent instances under %s', target)
        print('no core-agent instance found')
        return 1

    repo_root = find_repo_root(target)
    result = {
        'schema': 'etemaro.core-agent-incidents/v1',
        'generated_at': now_iso(),
        'target': target,
        'window': {'from': args.frm, 'to': args.to},
        'cycle_gap_seconds': args.cycle_gap,
        'instances': [analyse_instance(p, args.frm, args.to, args.cycle_gap, repo_root) for p in instances],
        'step': '03_incidents',
    }

    out = args.out or os.path.join(target, 'reports', '03-incidents.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(result, fh, indent=2)
        fh.write('\n')

    for inst in result['instances']:
        cov = inst['log_coverage']
        live = inst['liveness']
        print(
            f'== {inst["id"]} logs: files={cov.get("files", 0)} lines={cov.get("total_lines", 0)} '
            f'parsed={cov.get("parsed", 0)} cont={cov.get("continuations", 0)} skipped={cov.get("skipped", 0)}'
        )
        print(
            f'   errors: structured={inst["errors"]["structured_total"]} '
            f'categories={inst["errors"]["error_categories_present"]} '
            f'failed_actions={inst["errors"]["failed_actions_total"]}'
        )
        for category, info in inst['errors']['structured'].items():
            print(f'      {category}: {info["count"]}  top: {info["fingerprints"][0]["pattern"][:80] if info["fingerprints"] else ""}')
        dep = inst.get('deploys') or {}
        print(
            f'   deploys: attempts={dep.get("attempts")} confirmed={dep.get("confirmed")} '
            f'skipped={dep.get("skipped")} failed={dep.get("failed")} causes={dep.get("causes")}'
        )
        if dep.get('empty_address_logs'):
            print(
                f'      note: {dep["empty_address_logs"]} "Deployed <empty>" log line(s) — a logging artefact, not a failed deploy'
            )
        print(
            f'      timeout tokens in window: {dep.get("timeout_evidence", 0)} '
            f'by component {dep.get("timeout_by_component") or "{}"}'
        )
        sw = inst.get('sweeper') or {}
        obs, per = sw.get('observed') or {}, sw.get('persisted') or {}
        print(
            f'   sweeper: immediate_abandons={obs.get("immediate_abandons")} '
            f'max_persisted_attempts={per.get("max_persisted_attempts")} '
            f'bucket={obs.get("reported_attempts")} configured_budget={per.get("configured_max_attempts")} (budget, not observed)'
        )
        print(
            f'   liveness: cycles={live["cycles"]} median={live["gap_minutes"]["median"]}min '
            f'max={live["gap_minutes"]["max"]}min configured={live["configured_management_interval_min"]}min '
            f'stalls>{live["stall_threshold_min"]}min: {live["stall_count"]}'
        )
        for tool, info in inst['tools']['double_logged_tools'].items():
            print(
                f'   !! double-logged tool {tool}/{info["twin_spelling"]}: '
                f'{info["records"]} records but union {info["union_distinct_ts"]} distinct invocations'
            )
        for warning in inst['coverage_warnings']:
            print(f'   !! {warning}')
    print(f'wrote {out}')
    log.info('wrote %s', out)
    return 0


if __name__ == '__main__':
    sys.exit(main())

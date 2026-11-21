#!/usr/bin/env python3
"""Step 2 (core agent): deterministic financial & performance metrics.

Usage:
    python3 02_performance.py <target-dir> [--from ISO8601] [--to ISO8601]
        [--only-instance ID] [--out PATH]

Reads each instance's ``lessons.json`` → ``performance[]`` (the closed-trade
ledger) and produces the machine-readable basis for report sections 3-6:

* accounting integrity — ``net_pnl_usd == price_pnl_usd + fees_earned_usd``;
* **settlement split by ``status``** (``realized`` / ``closed_pending_swap`` /
  ``abandoned_loss``) — the single most important split in this repo, where
  ``closed_pending_swap`` routinely outnumbers ``realized``;
* win/loss/neutral on net USD, per status and overall;
* daily breakdown, exit-reason families, hold-time and range-efficiency stats;
* best/worst trades.

``closed_pending_swap`` rows are **not** realized. Their
``unrealized_residual_usd`` is reported separately and never summed into
realized cash. ``abandoned_loss`` counts as a loss.

Stdlib only; no network calls.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import sys
from datetime import UTC, datetime

from _logger import get_logger

log = get_logger('02_performance')

STATUSES = ('realized', 'closed_pending_swap', 'abandoned_loss')

#: ``take profit (pnl=0.23% threshold=0.2%)`` and ``stop loss: pnl -29.51% <= -20%``
#: both collapse to their family; some reasons are parenthesised, some colon-separated.
_REASON_FAMILY_RE = re.compile(r'^(?P<family>[^(:]+?)\s*(?:\(|:|$)')

#: ``net_pnl_usd`` is persisted **rounded to USD cents**, so ``price + fees`` can
#: legitimately differ by up to half a cent. Anything beyond this is a real
#: accounting break, not rounding.
ACCOUNTING_TOLERANCE_USD = 0.011

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


def to_float(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None


def in_window(ts, frm, to) -> bool:
    dt = parse_time(ts)
    if dt is None:
        return False
    if frm and dt < frm:
        return False
    if to and dt > to:
        return False
    return True


def reason_family(close_reason: str | None) -> str:
    """Collapse a parameterised close reason to its family.

    ``take profit (pnl=0.23% threshold=0.2%)`` → ``take profit``. The raw reason
    is kept on the record; only the *grouping* key is normalised, so the exit
    histogram does not shatter into hundreds of one-off buckets.
    """
    if not close_reason:
        return '(none)'
    match = _REASON_FAMILY_RE.match(str(close_reason).strip())
    return (match.group('family') if match else str(close_reason)).strip().lower() or '(none)'


def classify_outcome(record: dict) -> str:
    """``win`` / ``loss`` / ``neutral`` / ``unknown`` on net USD.

    ``abandoned_loss`` is a loss regardless of a zero net figure — the residual
    was written off, and counting it as neutral would flatter the run.
    """
    net = to_float(record.get('net_pnl_usd'))
    if record.get('status') == 'abandoned_loss':
        return 'loss'
    if net is None:
        return 'unknown'
    if net > 0:
        return 'win'
    if net < 0:
        return 'loss'
    return 'neutral'


def effective_cash_usd(record: dict):
    """Cash actually returned, plus the unrealized residual kept separate."""
    status = record.get('status')
    cash = to_float(record.get('cash_realized_usd'))
    residual = to_float(record.get('unrealized_residual_usd')) or 0.0
    if status == 'closed_pending_swap':
        return (cash or 0.0) + residual, residual
    return cash, 0.0


def mean(values):
    values = [v for v in values if isinstance(v, (int, float))]
    return round(sum(values) / len(values), 6) if values else None


def normalise_record(rec: dict) -> dict:
    net = to_float(rec.get('net_pnl_usd'))
    price = to_float(rec.get('price_pnl_usd'))
    fees = to_float(rec.get('fees_earned_usd'))
    residual = to_float(rec.get('unrealized_residual_usd')) or 0.0
    cash, _ = effective_cash_usd(rec)
    drift = None
    if net is not None and (price is not None or fees is not None):
        drift = round(net - ((price or 0.0) + (fees or 0.0)), 6)
    return {
        'position': rec.get('position'),
        'pool': rec.get('pool'),
        'pool_name': rec.get('pool_name'),
        'base_mint': rec.get('base_mint'),
        'strategy': rec.get('strategy'),
        'status': rec.get('status'),
        'recorded_at': rec.get('recorded_at'),
        'settled_at': rec.get('settled_at'),
        'minutes_held': to_float(rec.get('minutes_held')),
        'minutes_in_range': to_float(rec.get('minutes_in_range')),
        'range_efficiency': to_float(rec.get('range_efficiency')),
        'amount_sol': to_float(rec.get('amount_sol')),
        'net_pnl_usd': net,
        'price_pnl_usd': price,
        'price_pnl_pct': to_float(rec.get('price_pnl_pct')),
        'fees_earned_usd': fees,
        'pnl_pct': to_float(rec.get('pnl_pct')),
        'pnl_usd': to_float(rec.get('pnl_usd')),
        'initial_value_usd': to_float(rec.get('initial_value_usd')),
        'final_value_usd': to_float(rec.get('final_value_usd')),
        'cash_realized_usd': to_float(rec.get('cash_realized_usd')),
        'cash_realized_sol': to_float(rec.get('cash_realized_sol')),
        'unrealized_residual_usd': residual,
        'effective_cash_usd': round(cash, 6) if cash is not None else None,
        'close_reason': rec.get('close_reason'),
        'close_reason_family': reason_family(rec.get('close_reason')),
        'outcome': classify_outcome(rec),
        'accounting_drift_usd': drift,
        'liquidation_tx': rec.get('liquidation_tx'),
    }


def bucket_summary(rows: list) -> dict:
    wins = sum(1 for r in rows if r['outcome'] == 'win')
    losses = sum(1 for r in rows if r['outcome'] == 'loss')
    neutral = sum(1 for r in rows if r['outcome'] == 'neutral')
    unknown = sum(1 for r in rows if r['outcome'] == 'unknown')
    return {
        'trades': len(rows),
        'wins': wins,
        'losses': losses,
        'neutral': neutral,
        'unknown': unknown,
        'win_rate_pct': round(100.0 * wins / len(rows), 2) if rows else None,
        'net_pnl_usd': round(sum(r['net_pnl_usd'] or 0.0 for r in rows), 6),
        'price_pnl_usd': round(sum(r['price_pnl_usd'] or 0.0 for r in rows), 6),
        'fees_earned_usd': round(sum(r['fees_earned_usd'] or 0.0 for r in rows), 6),
        'cash_realized_usd': round(sum(r['cash_realized_usd'] or 0.0 for r in rows), 6),
        'unrealized_residual_usd': round(sum(r['unrealized_residual_usd'] or 0.0 for r in rows), 6),
        'effective_cash_usd': round(sum(r['effective_cash_usd'] or 0.0 for r in rows), 6),
        'mean_pnl_pct': mean([r['pnl_pct'] for r in rows]),
        'mean_minutes_held': mean([r['minutes_held'] for r in rows]),
        'mean_range_efficiency': mean([r['range_efficiency'] for r in rows]),
    }


def daily_breakdown(rows: list):
    by_day = collections.defaultdict(list)
    for row in rows:
        day = (row.get('recorded_at') or '')[:10] or '(no date)'
        by_day[day].append(row)
    out = []
    for day in sorted(by_day):
        summary = bucket_summary(by_day[day])
        out.append({'date': day, **summary})
    return out


def exit_distribution(rows: list):
    families = collections.Counter(r['close_reason_family'] for r in rows)
    raw = collections.Counter(r['close_reason'] or '(none)' for r in rows)
    return {
        'families': dict(families.most_common()),
        'raw_reasons': [{'reason': reason, 'count': count} for reason, count in raw.most_common(25)],
    }


def extreme_trades(rows: list):
    ranked = sorted(rows, key=lambda r: (r['net_pnl_usd'] if r['net_pnl_usd'] is not None else float('-inf')))
    return {
        'best': ranked[-5:][::-1],
        'worst': ranked[:5],
    }


def analyse_instance(instance_dir: str, frm, to) -> dict:
    data = read_json(os.path.join(instance_dir, 'lessons.json'), {})
    raw = (data or {}).get('performance') if isinstance(data, dict) else []
    raw = raw if isinstance(raw, list) else []

    rows = [
        normalise_record(r)
        for r in raw
        if isinstance(r, dict) and (not (frm or to) or in_window(r.get('recorded_at'), frm, to))
    ]

    by_status = {}
    for status in STATUSES:
        subset = [r for r in rows if r['status'] == status]
        if subset:
            by_status[status] = bucket_summary(subset)

    drift = [
        r for r in rows if r['accounting_drift_usd'] not in (None, 0) and abs(r['accounting_drift_usd']) > ACCOUNTING_TOLERANCE_USD
    ]
    unknown_status = [r['position'] for r in rows if r['status'] not in STATUSES]
    pending = [r for r in rows if r['status'] == 'closed_pending_swap']

    state = read_json(os.path.join(instance_dir, 'state.json'), {})
    pending_liq = state.get('pendingLiquidations') if isinstance(state, dict) else {}

    return {
        'id': os.path.basename(instance_dir.rstrip('/')),
        'dir': os.path.abspath(instance_dir),
        'records_total': len(raw),
        'records_in_window': len(rows),
        'overall': bucket_summary(rows),
        'by_status': by_status,
        'daily': daily_breakdown(rows),
        'exits': exit_distribution(rows),
        'extremes': extreme_trades(rows),
        'integrity': {
            'accounting_tolerance_usd': ACCOUNTING_TOLERANCE_USD,
            'net_equals_price_plus_fees_violations': len(drift),
            'violation_positions': [r['position'] for r in drift[:20]],
            'unknown_status_positions': unknown_status,
            'closed_pending_swap_count': len(pending),
            'closed_pending_swap_residual_usd': round(sum(r['unrealized_residual_usd'] or 0.0 for r in pending), 6),
            'pending_liquidations_in_state': len(pending_liq) if isinstance(pending_liq, dict) else None,
        },
        'trades': rows,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description='Core-agent financial & performance metrics.')
    ap.add_argument('target_dir')
    ap.add_argument('--from', dest='frm', default=None, help='ISO8601 inclusive lower bound')
    ap.add_argument('--to', dest='to', default=None, help='ISO8601 inclusive upper bound')
    ap.add_argument('--only-instance', default=None)
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    target = os.path.abspath(args.target_dir)
    log.info('start target=%s from=%s to=%s only_instance=%s', target, args.frm, args.to, args.only_instance)
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

    frm, to = parse_time(args.frm), parse_time(args.to)
    result = {
        'schema': 'etemaro.core-agent-performance/v1',
        'generated_at': now_iso(),
        'target': target,
        'window': {'from': args.frm, 'to': args.to},
        'instances': [analyse_instance(p, frm, to) for p in instances],
        'step': '02_performance',
    }

    out = args.out or os.path.join(target, 'reports', '02-performance.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(result, fh, indent=2)
        fh.write('\n')

    for inst in result['instances']:
        o = inst['overall']
        integ = inst['integrity']
        print(
            f'== {inst["id"]} trades={o["trades"]} W/L/N={o["wins"]}/{o["losses"]}/{o["neutral"]} '
            f'net={o["net_pnl_usd"]:+.4f}USD fees={o["fees_earned_usd"]:+.4f} '
            f'win_rate={o["win_rate_pct"]}%'
        )
        for status, summary in inst['by_status'].items():
            print(
                f'   {status:<20} n={summary["trades"]:<4} net={summary["net_pnl_usd"]:+.4f} '
                f'W/L={summary["wins"]}/{summary["losses"]} residual={summary["unrealized_residual_usd"]:.4f}'
            )
        print(f'   top exits: {list(inst["exits"]["families"].items())[:5]}')
        if integ['net_equals_price_plus_fees_violations']:
            print(f'   !! net != price+fees on {integ["net_equals_price_plus_fees_violations"]} row(s) — data-quality finding')
        if integ['unknown_status_positions']:
            print(f'   !! {len(integ["unknown_status_positions"])} row(s) with an unknown status')
    print(f'wrote {out}')
    log.info('wrote %s', out)
    return 0


if __name__ == '__main__':
    sys.exit(main())

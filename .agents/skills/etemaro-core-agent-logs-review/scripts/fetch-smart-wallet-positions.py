#!/usr/bin/env python3
"""Fetch tracked smart-wallet LP positions and write a review analysis JSON.

Usage:
    python3 fetch-smart-wallet-positions.py <target-dir> [--report-date YYYY-MM-DD]
                                            [--config PATH] [--out PATH]
                                            [--timeout 20] [--delay-ms 300]

Reads the agent config + the active strategy-library entry (which carries
smartWalletListId) and config/shared/smart-wallets.json, fetches each tracked
"lp" wallet's open positions plus its closed-position history, verifies whether
each of the agent's deploys happened while a tracked wallet held that pool, and
writes:

    <target-dir>/reports/REPORT-<date>.smart-wallets.json

Matches references/smart-wallets-analysis.template.json. Stdlib only; no LLM
calls. The report author still sets the final verdicts in the HTML.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime

from _logger import get_logger

log = get_logger('fetch-smart-wallet-positions')

ET_OPEN = 'https://api.etemaro.com/v1/solana/portfolio/open'
ET_CLOSED = 'https://api.etemaro.com/v1/solana/portfolio/closed'
MET_OPEN = 'https://dlmm.datapi.meteora.ag/portfolio/open'


def now_iso():
    return datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_epoch(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip().replace('Z', '+00:00')
    try:
        return int(datetime.fromisoformat(text).timestamp())
    except ValueError:
        return None


def load_json(path, default=None):
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def find_repo_root(start):
    cur = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(cur, 'config', 'shared', 'strategy-library.json')):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return os.path.abspath(start)
        cur = parent


def locate_config(target_dir, explicit):
    if explicit:
        return explicit
    if os.path.isdir(target_dir):
        for name in sorted(os.listdir(target_dir)):
            if name.startswith('agent-config') and name.endswith('.json'):
                return os.path.join(target_dir, name)
    inst = os.path.join(find_repo_root(target_dir), 'config', 'instances')
    if os.path.isdir(inst):
        base = os.path.basename(target_dir.rstrip('/'))
        candidates = [n for n in sorted(os.listdir(inst)) if base and base in n]
        candidates = [n for n in candidates if n.endswith('.json') and not n.endswith('.bak')]
        if candidates:
            return os.path.join(inst, candidates[-1])
        all_cfg = [n for n in sorted(os.listdir(inst)) if n.startswith('agent-config') and n.endswith('.json')]
        if all_cfg:
            return os.path.join(inst, all_cfg[-1])
    return None


def get_json(url, timeout):
    req = urllib.request.Request(url, headers={'accept': 'application/json', 'user-agent': 'etemaro-review/1'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def parse_open_pools(payload):
    pools = []
    for pool in (payload or {}).get('pools', []) or []:
        pos = pool.get('listPositions') or pool.get('positions') or []
        pools.append(
            {
                'pool_address': pool.get('poolAddress') or pool.get('pool_address') or pool.get('pool'),
                'token_x': pool.get('tokenX') or pool.get('token_x'),
                'token_y': pool.get('tokenY') or pool.get('token_y'),
                'position_addresses': [p for p in pos if isinstance(p, str)],
                'out_of_range': bool(pool.get('outOfRange') or pool.get('out_of_range')),
                'positions_out_of_range': pool.get('positionsOutOfRange') or [],
                'bin_step': pool.get('binStep') or pool.get('bin_step'),
                'fee_per_tvl_24h': pool.get('feePerTvl24h') or pool.get('fee_per_tvl_24h'),
                'pnl_usd': pool.get('pnlUsd') or pool.get('pnl_usd'),
                'pnl_pct_change': pool.get('pnlPctChange') or pool.get('pnl_pct_change'),
            }
        )
    return [p for p in pools if p['pool_address']]


def parse_closed_positions(payload):
    out = []
    for item in (payload or {}).get('positions', []) or []:
        out.append(
            {
                'position': item.get('positionAddress') or item.get('position'),
                'pool': item.get('poolAddress') or item.get('pool'),
                'created_at': parse_epoch(item.get('createdAt') or item.get('created_at')),
                'closed_at': parse_epoch(item.get('closedAt') or item.get('closed_at')),
            }
        )
    return [p for p in out if p['pool']]


def fetch_wallet(address, timeout, delay_ms):
    """Returns open positions + closed history; open tries api.etemaro then Meteora."""
    errors = []
    result = {
        'status': 'error',
        'source_used': None,
        'error': None,
        'open_pools': [],
        'closed_positions': [],
        'history_ok': False,
        'errors': errors,
    }
    opens = [
        ('api.etemaro', ET_OPEN + '?' + urllib.parse.urlencode({'wallet': address, 'provider': 'meteora', 'page_size': 100})),
        ('meteora_datapi', MET_OPEN + '?' + urllib.parse.urlencode({'user': address})),
    ]
    for name, url in opens:
        try:
            result['open_pools'] = parse_open_pools(get_json(url, timeout))
            result['status'] = 'ok'
            result['source_used'] = name
            break
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError) as exc:
            errors.append(f'{name} open: {exc}')
            log.warning('open fetch failed (%s) wallet=%s: %s', name, address, exc)
        finally:
            if delay_ms:
                time.sleep(delay_ms / 1000.0)
    try:
        closed = get_json(ET_CLOSED + '?' + urllib.parse.urlencode({'wallet': address, 'provider': 'meteora', 'page_size': 100}), timeout)
        result['closed_positions'] = parse_closed_positions(closed)
        result['history_ok'] = True
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError) as exc:
        errors.append(f'api.etemaro closed: {exc}')
        log.warning('closed fetch failed wallet=%s: %s', address, exc)
    if errors:
        result['error'] = '; '.join(errors)
    result['open_positions_count'] = sum(len(p['position_addresses']) for p in result['open_pools'])
    return result


def wallet_covered(history, pool, dep_ts):
    for h in history:
        if h['pool'] == pool and h['created_at']:
            end = h['closed_at'] or 10**12
            if h['created_at'] <= dep_ts <= end:
                return True
    return False


def main():
    ap = argparse.ArgumentParser(description='Fetch smart-wallet positions for a run review.')
    ap.add_argument('target_dir')
    ap.add_argument('--report-date', default=datetime.now().strftime('%Y-%m-%d'))
    ap.add_argument('--config', default=None)
    ap.add_argument('--out', default=None)
    ap.add_argument('--timeout', type=int, default=20)
    ap.add_argument('--delay-ms', type=int, default=300)
    args = ap.parse_args()

    target = os.path.abspath(args.target_dir)
    root = find_repo_root(target)
    config_path = locate_config(target, args.config)
    cfg = load_json(config_path, {}) if config_path else {}
    active_id = (cfg.get('strategy') or {}).get('activeStrategyId')
    lib = load_json(os.path.join(root, 'config', 'shared', 'strategy-library.json'), {}) or {}
    shared_lib = load_json(os.path.join(root, 'config', 'shared', 'strategy-library.shared.json'), {}) or {}
    merged = {**(shared_lib.get('strategies') or {}), **(lib.get('strategies') or {})}
    entry_source = (cfg.get('screening') or {}).get('entrySource')
    list_id = ((merged.get(active_id) or {}).get('smartWalletListId')) if active_id else None
    wallets_data = load_json(os.path.join(root, 'config', 'shared', 'smart-wallets.json'), {'lists': {}})
    wallets = ((wallets_data.get('lists') or {}).get(list_id) or {}).get('wallets', []) if list_id else []
    lp_wallets = [w for w in wallets if (w.get('type') or 'lp') == 'lp']

    state = load_json(os.path.join(target, 'state.json'), {}) or {}
    snapshot = load_json(os.path.join(target, '.smart-wallets-snapshot.json'), {}) or {}
    snapshot_positions = set(snapshot.get('positions') or [])

    source_meta = [
        {
            'name': 'api.etemaro',
            'base_url': 'https://api.etemaro.com',
            'endpoints': ['/v1/solana/portfolio/open', '/v1/solana/portfolio/closed'],
            'used': False,
            'errors': [],
        },
        {'name': 'meteora_datapi', 'base_url': 'https://dlmm.datapi.meteora.ag', 'endpoints': ['/portfolio/open'], 'used': False, 'errors': []},
    ]
    wallet_results = []
    pool_to_open_wallets = {}
    pool_ever = set()
    all_wallet_positions = set()
    history_ok_all = True

    for w in lp_wallets:
        res = fetch_wallet(w['address'], args.timeout, args.delay_ms)
        for meta in source_meta:
            if meta['name'] == res.get('source_used'):
                meta['used'] = True
            if meta['name'] in (res.get('error') or ''):
                meta['errors'].append(res['error'])
        if not res['history_ok']:
            history_ok_all = False
        for p in res['open_pools']:
            pool_to_open_wallets.setdefault(p['pool_address'], []).append(w.get('name') or w['address'])
            pool_ever.add(p['pool_address'])
            all_wallet_positions.update(p['position_addresses'])
        for h in res['closed_positions']:
            pool_ever.add(h['pool'])
        wallet_results.append(
            {
                'name': w.get('name'),
                'address': w['address'],
                'type': w.get('type') or 'lp',
                'category': w.get('category'),
                'status': res['status'],
                'error': res['error'],
                'source_used': res['source_used'],
                'fetched_at': now_iso(),
                'open_positions_count': res['open_positions_count'],
                'pools': res['open_pools'],
                'closed_positions': res['closed_positions'],
                'history_ok': res['history_ok'],
            }
        )

    deploys = []
    for _addr, pos in (state.get('positions') or {}).items():
        pool = pos.get('pool')
        if not pool:
            continue
        dep_ts = parse_epoch(pos.get('deployed_at'))
        in_open = sorted(set(pool_to_open_wallets.get(pool, [])))
        in_history = (
            sorted(
                {w['name'] for w, res in zip(wallet_results, wallet_results) if w and wallet_covered(res.get('closed_positions') or [], pool, dep_ts)}
            )
            if dep_ts
            else []
        )
        present = bool(in_open) or bool(in_history)
        pool_known = pool in pool_ever
        if present:
            verdict = 'PASS'
            basis = 'open-position' if in_open else 'closed-history'
        elif not pool_known and history_ok_all and lp_wallets:
            verdict = 'FAIL'
            basis = 'never-seen-in-tracked-wallets'
        else:
            verdict = 'UNVERIFIED'
            basis = 'no-evidence-of-overlap'
        deploys.append(
            {
                'pool_address': pool,
                'pool_name': None,
                'deployed_at': pos.get('deployed_at'),
                'closed_at': pos.get('closed_at'),
                'exit_reason': (pos.get('notes') or [None])[0],
                'smart_wallet_present': present,
                'wallets': sorted(set(in_open + in_history)),
                'evidence_basis': basis,
                'was_new_vs_snapshot': None,
                'deploy_lag_seconds': None,
                'verdict': verdict,
            }
        )

    failed = [w for w in wallet_results if w['status'] != 'ok']
    if not lp_wallets or len(failed) == len(lp_wallets):
        overall = 'UNVERIFIED'
    elif any(d['verdict'] == 'FAIL' for d in deploys if deploys) or failed:
        overall = 'PARTIAL'
    elif any(d['verdict'] == 'UNVERIFIED' for d in deploys):
        overall = 'PARTIAL'
    else:
        overall = 'PASS'
    gates = [d['verdict'] for d in deploys]
    gate_integrity = 'FAIL' if 'FAIL' in gates else ('PASS' if gates and all(g == 'PASS' for g in gates) else 'UNVERIFIED')

    analysis = {
        'schema': 'etemaro.smart-wallets-analysis/v1',
        'report_date': args.report_date,
        'generated_at': now_iso(),
        'instance': {
            'id': os.path.basename(target),
            'agent_id': cfg.get('agentId'),
            'config_path': config_path,
            'active_strategy_id': active_id,
            'smart_wallet_list_id': list_id,
            'entry_source': entry_source,
            'max_positions': (cfg.get('risk') or {}).get('maxPositions'),
        },
        'sources': source_meta,
        'wallets': wallet_results,
        'agent_deploys': deploys,
        'verification': {
            'gate_integrity': gate_integrity,
            'snapshot_valid': bool(snapshot.get('initialized')),
            'snapshot_positions': len(snapshot_positions),
            'known_wallet_positions': len(all_wallet_positions),
            'max_positions_respected': None,
            'exit_matches_config': None,
            'wallet_liveness': 'ok' if not failed else f'{len(failed)}/{len(wallet_results)} fetch failed',
            'wallets_checked': len(wallet_results),
            'wallets_failed': len(failed),
            'overall_verdict': overall,
            'limitations': [
                'Open-position API reflects review time; closed history (createdAt/closedAt) is used to reconstruct deploy-time overlap.',
                'Gate verdict UNVERIFIED means the wallet never appeared in open or closed '
                'history for that pool, which may also be pagination-limited.',
            ],
        },
    }

    out = args.out or os.path.join(target, 'reports', f'REPORT-{args.report_date}.smart-wallets.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(analysis, fh, indent=2)
        fh.write('\n')

    print(f'list={list_id!r} entrySource={entry_source!r} lp_wallets={len(lp_wallets)} failed={len(failed)} gate={gate_integrity} verdict={overall}')
    for d in deploys:
        print(f'  deploy {d["pool_address"][:8]} present={d["smart_wallet_present"]} basis={d["evidence_basis"]} verdict={d["verdict"]}')
    print(f'wrote {out}')
    log.info(
        'done list=%r entrySource=%r lp_wallets=%d failed=%d gate=%s verdict=%s -> %s',
        list_id,
        entry_source,
        len(lp_wallets),
        len(failed),
        gate_integrity,
        overall,
        out,
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())

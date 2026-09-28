#!/usr/bin/env python3
"""Step 4 (core agent): render the self-contained HTML review report.

Usage:
    python3 04_render_report.py <target-dir> [--from ISO] [--to ISO]
        [--only-instance ID] [--out PATH] [--date YYYY-MM-DD]

Reads the JSON written by steps 1-3 in ``<target>/reports/``:

    inventory.json       (01_inventory.py)
    02-performance.json  (02_performance.py)
    03-incidents.json    (03_incidents.py)

plus ``<target>/reports/REPORT-<date>.smart-wallets.json`` when present, and
writes ``<target>/reports/REPORT-<tag>.html`` (consolidated, one file with a
section per instance — core-agent runs are reviewed per agent, not per bot
wallet, so a single report is the right default here).

Sections emitted deterministically: the header, 1 Executive Summary, 2 Agent
Configuration & Expected Strategy Behavior (mechanical snapshot + expected-model
rows derived from the config), 3 Financial & Performance Metrics, 4 Exit Reason
Distribution, 5 Deep-Dive Trades, 6 Strategy & Execution Analysis, 7 Smart
Wallet Signal Verification (when the smart-wallets JSON exists), 6b veto
forensics (when present), 8 Stability & Incident Forensics, 9 Hardening &
Recommendations.

Every recommendation in section 9 is rule-generated and cites an observed count —
no invented advice. Keep the wording in sync with
``references/report-template.html`` and the rule table in ``SKILL.md``.

Self-contained HTML (all CSS inline, no external assets). Stdlib only.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys
from datetime import UTC, datetime

from _logger import get_logger

log = get_logger('04_render_report')

CARD = '<div style="background:#ffffff;border:1px solid #e3e8ef;border-radius:12px;margin-top:16px;padding:22px 28px;">'
H2 = '<div style="font-size:16px;font-weight:700;color:#101828;border-bottom:2px solid #101828;padding-bottom:8px;">{title}</div>'
TH = 'style="padding:6px 8px;text-align:left;"'
THR = 'style="padding:6px 8px;text-align:right;"'
TD = 'style="padding:6px 8px;"'
TDR = 'style="padding:6px 8px;text-align:right;"'
ROW = '<tr style="background:{bg};border-bottom:1px solid #e3e8ef;">'
FOOT = '</div></body></html>'

BUCKET_LABEL = {
    'A': ('A &middot; Critical fixes', '#b91c1c'),
    'B': ('B &middot; Strategy tuning', '#92400e'),
    'C': ('C &middot; Telemetry &amp; memory infra', '#1d4ed8'),
}

PAGE_HEAD = """<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2733;">
<div style="max-width:1100px;margin:0 auto;padding:24px 16px;">"""


# --------------------------------------------------------------------------- #
# formatting
# --------------------------------------------------------------------------- #
def esc(value) -> str:
    return html.escape('' if value is None else str(value), quote=True)


def fmt(value, digits=4):
    """Signed USD figure, or an em dash when absent."""
    if value is None:
        return '&mdash;'
    try:
        return f'{float(value):+.{digits}f}'
    except (TypeError, ValueError):
        return esc(value)


def num(value, digits=2):
    if value is None:
        return '&mdash;'
    try:
        return f'{float(value):,.{digits}f}'
    except (TypeError, ValueError):
        return esc(value)


def pct(value, digits=2):
    if value is None:
        return '&mdash;'
    try:
        return f'{float(value):+.{digits}f}%'
    except (TypeError, ValueError):
        return esc(value)


def tint(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return '#101828'
    return '#15803d' if value > 0 else ('#b91c1c' if value < 0 else '#101828')


def stat_card(label, value, sub, color='#101828', width='23%'):
    return (
        f'<div style="display:inline-block;width:{width};vertical-align:top;background:#f0f7ff;border:1px solid #cfe4ff;'
        'border-radius:10px;padding:14px;margin-top:14px;margin-right:1%;">'
        f'<div style="font-size:11px;color:#5b7286;text-transform:uppercase;letter-spacing:1px;">{label}</div>'
        f'<div style="font-size:22px;font-weight:700;color:{color};">{value}</div>'
        f'<div style="font-size:12px;color:#5b7286;">{sub}</div></div>'
    )


def banner(kind, title, body):
    palette = {
        'critical': ('#fef2f2', '#fecaca', '#b91c1c', '#7f1d1d'),
        'warn': ('#fffbeb', '#fde68a', '#92400e', '#78350f'),
        'ok': ('#f0fdf4', '#bbf7d0', '#15803d', '#166534'),
    }[kind]
    bg, border, fg, body_fg = palette
    return (
        f'<div style="margin-top:12px;background:{bg};border:1px solid {border};border-radius:8px;padding:14px 16px;">'
        f'<div style="font-size:14px;font-weight:700;color:{fg};">{title}</div>'
        f'<div style="font-size:13px;color:{body_fg};line-height:1.6;margin-top:6px;">{body}</div></div>'
    )


def parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None


def window_tag(frm, to):
    a, b = parse_time(frm), parse_time(to)
    if a and b and a.date() == b.date():
        return f'{a:%Y-%m-%d}-{a:%H}-{b:%H}'
    if a and b:
        return f'{a:%Y-%m-%d-%H}-{b:%Y-%m-%d-%H}'
    return datetime.now(UTC).strftime('%Y-%m-%d')


def load(path, default):
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


# --------------------------------------------------------------------------- #
# section 2 — config snapshot & mechanically derived expected behaviour
# --------------------------------------------------------------------------- #
def config_rows(cfg: dict):
    """``[(area, value_html, expected_effect)]`` from real config fields only."""
    risk = cfg.get('risk') or {}
    screening = cfg.get('screening') or {}
    opportunity = cfg.get('opportunity') or {}
    strategy = cfg.get('strategy') or {}
    mgmt = cfg.get('management') or {}
    schedule = cfg.get('schedule') or {}
    pnl = cfg.get('pnl') or {}
    conn = cfg.get('connection') or {}

    rows = []
    if risk:
        rows.append(
            (
                'risk',
                f'maxPositions={esc(risk.get("maxPositions"))} &middot; maxDeployAmount={esc(risk.get("maxDeployAmount"))}',
                'Hard ceiling on simultaneous positions and per-deploy size.',
            )
        )
    if screening:
        bounds = ' &middot; '.join(
            f'{key}={esc(screening.get(key))}'
            for key in ('entrySource', 'timeframe', 'minTvl', 'maxTvl', 'minVolume', 'minOrganic', 'minHolders', 'minBinStep', 'maxBinStep')
            if screening.get(key) is not None
        )
        rows.append(('screening', bounds or 'present', 'Deterministic filters applied before any LLM sees a candidate.'))
    if opportunity:
        rows.append(
            (
                'opportunity',
                f'enabled={esc(opportunity.get("enabled"))} &middot; minScore={esc(opportunity.get("minScore"))} '
                f'&middot; smartWalletScoreBonus={esc(opportunity.get("smartWalletScoreBonus"))}',
                'A pool fires only when its score clears minScore; the bonus decides whether smart-wallet presence alone can trigger.',
            )
        )
    if strategy:
        rows.append(
            (
                'strategy',
                f'{esc(strategy.get("activeStrategyId"))} &middot; {esc(strategy.get("strategyMeteora"))} '
                f'&middot; bins {esc(strategy.get("minBinsBelow"))}&ndash;{esc(strategy.get("maxBinsBelow"))}',
                'Deploy strategy and the bin-width window used for every entry.',
            )
        )
    if mgmt:
        rows.append(
            (
                'management',
                f'TP={esc(mgmt.get("takeProfitPct"))} &middot; SL={esc(mgmt.get("stopLossPct"))} '
                f'&middot; size={esc(mgmt.get("deployAmountSol"))}/{esc(mgmt.get("positionSizePct"))} '
                f'&middot; OOR wait={esc(mgmt.get("outOfRangeWaitMinutes"))}m',
                'Exit rules, sizing and the out-of-range timer that gate every close.',
            )
        )
        if mgmt.get('sweeperEnabled') is not None:
            rows.append(
                (
                    'sweeper',
                    f'enabled={esc(mgmt.get("sweeperEnabled"))} &middot; every {esc(mgmt.get("sweeperIntervalMin"))}m '
                    f'&middot; min ${esc(mgmt.get("sweeperMinUsd"))} &middot; abandon after {esc(mgmt.get("sweeperAbandonWindowHours"))}h',
                    'Unsold base tokens are swapped back to SOL; residuals are tracked in state.pendingLiquidations.',
                )
            )
    if schedule:
        rows.append(
            (
                'schedule',
                f'screen {esc(schedule.get("screeningIntervalMin"))}m &middot; manage {esc(schedule.get("managementIntervalMin"))}m '
                f'&middot; health {esc(schedule.get("healthCheckIntervalMin"))}m',
                'Cycle cadence the liveness section is measured against.',
            )
        )
    if pnl:
        rows.append(
            (
                'pnl',
                f'{esc(pnl.get("source"))} &middot; poll {esc(pnl.get("pollIntervalSec"))}s &middot; confirm {esc(pnl.get("confirmTicks"))}',
                'Exit latency is poll interval multiplied by confirm ticks.',
            )
        )
    if conn:
        rows.append(
            (
                'connection',
                f'wallet={esc(conn.get("wallet"))} &middot; dryRun={esc(conn.get("dryRun"))} &middot; model={esc((cfg.get("llm") or {}).get("model"))}',
                'Execution mode and the model driving screening/management.',
            )
        )
    return rows


def expected_rows(cfg: dict):
    """``[(trigger, governing, expected, verify_in)]`` derived from config only."""
    screening = cfg.get('screening') or {}
    opportunity = cfg.get('opportunity') or {}
    strategy = cfg.get('strategy') or {}
    mgmt = cfg.get('management') or {}
    schedule = cfg.get('schedule') or {}
    risk = cfg.get('risk') or {}
    rows = []

    if schedule.get('screeningIntervalMin'):
        rows.append(
            (
                f'Screening cycle every {esc(schedule["screeningIntervalMin"])}m',
                'schedule.screeningIntervalMin, screening.entrySource',
                f'Universe = <b>{esc(screening.get("entrySource"))}</b>'
                + (' (tracked LP wallets)' if screening.get('entrySource') == 'smart_wallets' else ' (market scrape)')
                + '; every candidate passes the deterministic filters first.',
                '<code>agent-*.log</code> [screening]',
            )
        )
    if opportunity:
        min_score = opportunity.get('minScore')
        bonus = opportunity.get('smartWalletScoreBonus') or 0
        only_wallets = isinstance(min_score, (int, float)) and isinstance(bonus, (int, float)) and bonus >= min_score
        rows.append(
            (
                'Opportunity gate',
                'opportunity.minScore, opportunity.smartWalletScoreBonus',
                (
                    f'With minScore={esc(min_score)} and bonus={esc(bonus)} the effective gate is '
                    '<b>satisfiable only by smart-wallet presence</b>.'
                    if only_wallets
                    else f'A pool deploys only when score &ge; {esc(min_score)}.'
                ),
                '<code>structured-*.jsonl</code> metadata.goal',
            )
        )
    if screening.get('entrySource') == 'smart_wallets':
        rows.append(
            (
                'Smart-wallet poller',
                'screening.entrySource, strategy.activeStrategyId',
                'Each cycle diffs tracked <code>type: lp</code> wallets against '
                '<code>.smart-wallets-snapshot.json</code> and deploys into newly seen pools, subject to the filters and the cap.',
                '<code>agent-*.log</code> [cron]/[agent]',
            )
        )
    if strategy.get('minBinsBelow') is not None or mgmt.get('deployAmountSol') is not None:
        rows.append(
            (
                'Deploy',
                'strategy.minBinsBelow/maxBinsBelow, management.deployAmountSol',
                f'bins_below scales with volatility inside [{esc(strategy.get("minBinsBelow"))}, {esc(strategy.get("maxBinsBelow"))}]; '
                f'amount = {esc(mgmt.get("deployAmountSol"))} SOL or positionSizePct, whichever binds.',
                '<code>actions-*.jsonl</code> deploy tool',
            )
        )
    if mgmt.get('takeProfitPct') is not None:
        trailing = ''
        if mgmt.get('trailingTakeProfit'):
            trailing = (
                f' Trailing armed at {esc(mgmt.get("trailingTriggerPct"))}%, '
                f'closes on a {esc(mgmt.get("trailingDropPct"))}% retrace.'
            )
        rows.append(
            (
                f'Take profit at {esc(mgmt.get("takeProfitPct"))}%',
                'management.takeProfitPct',
                f'Close when PnL &ge; {esc(mgmt.get("takeProfitPct"))}%.{trailing}',
                '<code>lessons.json</code> close_reason',
            )
        )
    if mgmt.get('stopLossPct') is not None:
        rows.append(
            (
                f'Stop loss at {esc(mgmt.get("stopLossPct"))}%',
                'management.stopLossPct',
                f'Close when PnL &le; {esc(mgmt.get("stopLossPct"))}%.',
                '<code>lessons.json</code> close_reason',
            )
        )
    if mgmt.get('outOfRangeWaitMinutes') is not None:
        rows.append(
            (
                'Out-of-range exit',
                'management.outOfRangeBinsToClose/outOfRangeWaitMinutes',
                f'Close after being out of range beyond {esc(mgmt.get("outOfRangeBinsToClose"))} bins for '
                f'{esc(mgmt.get("outOfRangeWaitMinutes"))} minutes.',
                '<code>agent-*.log</code> [positions]',
            )
        )
    if risk.get('maxPositions') is not None:
        rows.append(
            (
                'Position cap',
                'risk.maxPositions, risk.maxDeployAmount',
                f'Never more than {esc(risk.get("maxPositions"))} open at once; never deploy above {esc(risk.get("maxDeployAmount"))}.',
                '<code>state.json</code>, <code>agent-*.log</code>',
            )
        )
    if mgmt.get('sweeperEnabled'):
        rows.append(
            (
                f'Unsold-token sweeper every {esc(mgmt.get("sweeperIntervalMin"))}m',
                'management.sweeper*',
                f'Swap non-SOL residuals back to SOL; track &ge; ${esc(mgmt.get("sweeperMinUsd"))}, alert at '
                f'${esc(mgmt.get("sweeperAlertUsd"))}, abandon after {esc(mgmt.get("sweeperAbandonWindowHours"))}h.',
                '<code>actions-*.jsonl</code> sweep_unsold_tokens',
            )
        )
    return rows


# --------------------------------------------------------------------------- #
# section 9 — deterministic recommendations
# --------------------------------------------------------------------------- #
def build_recommendations(perf_inst, incidents_inst):
    overall = (perf_inst or {}).get('overall') or {}
    by_status = (perf_inst or {}).get('by_status') or {}
    integrity = (perf_inst or {}).get('integrity') or {}
    exits = ((perf_inst or {}).get('exits') or {}).get('families') or {}
    errors = (incidents_inst or {}).get('errors') or {}
    liveness = (incidents_inst or {}).get('liveness') or {}
    tools = (incidents_inst or {}).get('tools') or {}
    warnings = (incidents_inst or {}).get('coverage_warnings') or []
    deploys = (incidents_inst or {}).get('deploys') or {}
    sweeper = (incidents_inst or {}).get('sweeper') or {}

    realized = by_status.get('realized') or {}
    pending = by_status.get('closed_pending_swap') or {}
    abandoned = by_status.get('abandoned_loss') or {}
    trades = overall.get('trades') or 0
    recs = []

    # ---- A: critical ----
    if pending.get('trades'):
        residual = pending.get('unrealized_residual_usd') or 0.0
        recs.append(
            (
                'A',
                f'<b>Realized vs pending settlement.</b> {pending["trades"]} of {trades} closed trades sit in '
                f'<code>closed_pending_swap</code>, carrying {fmt(residual)} USD of unsold residual that is '
                f'<i>not</i> realized cash. Realized-only net is {fmt(realized.get("net_pnl_usd"))} USD against a '
                f'{fmt(overall.get("net_pnl_usd"))} USD headline. Confirm each residual was swept on-chain before quoting the headline.',
            )
        )
    if abandoned.get('trades'):
        recs.append(
            (
                'A',
                f'<b>{abandoned["trades"]} abandoned position(s).</b> Residual tokens were written off for '
                f'{fmt(abandoned.get("net_pnl_usd"))} USD. Review the sweeper attempt log for those mints.',
            )
        )
    structured_total = errors.get('structured_total') or 0
    if structured_total:
        cats = ', '.join(f'{name}&times;{info["count"]}' for name, info in sorted(errors.get('structured', {}).items()))
        failed_n = len(errors.get('failed_actions') or [])
        failed_txt = f' {failed_n} tool call(s) also returned <code>success: false</code>.' if failed_n else ''
        recs.append(
            (
                'A',
                f'<b>{structured_total} structured error(s)</b> in this window ({cats}).{failed_txt} '
                f'Each one is a real incident — <code>agent-*.log</code> alone would have shown a clean run.',
            )
        )
    if integrity.get('net_equals_price_plus_fees_violations'):
        recs.append(
            (
                'A',
                f'<b>{integrity["net_equals_price_plus_fees_violations"]} accounting break(s).</b> '
                f'<code>net_pnl_usd != price_pnl_usd + fees_earned_usd</code> beyond the '
                f'{fmt(integrity.get("accounting_tolerance_usd"), 3)} USD rounding tolerance. Investigate before trusting any PnL figure.',
            )
        )
    causes = deploys.get('causes') or {}
    guard_fails = sum(n for cause, n in causes.items() if str(cause).startswith('local_guard:'))
    if guard_fails:
        timeout_note = (
            f'the window contains {deploys.get("timeout_evidence") or 0} timeout token(s) in total '
            f'({esc(deploys.get("timeout_by_component") or {})}), none of them a deploy request'
        )
        empty_note = (
            f' {deploys["empty_address_logs"]} <code>Deployed&nbsp;&nbsp;on</code> line(s) were logged on the '
            '<i>successful</i> deploys — the caller read an address it never checked and counted the skip as a deploy.'
            if deploys.get('empty_address_logs')
            else ''
        )
        message = (
            f'<b>{guard_fails} deploy failure(s) were local guard short-circuits, not network failures.</b> '
            f'Each was preceded by an <code>[deploy] &hellip; is on cooldown &mdash; skipping</code> line, so the venue was '
            f'never contacted and no order was submitted ({timeout_note}).{empty_note} '
            'Do not label these RPC timeouts — the logs disprove it.'
        )
        recs.append(('A', message))
    if causes.get('unexplained'):
        message = (
            f'<b>{causes["unexplained"]} deploy failure(s) carry no guard record and no timeout token.</b> '
            'The cause is not in the log; report the raw error and name no cause.'
        )
        recs.append(('B', message))
    sw_obs = sweeper.get('observed') or {}
    sw_per = sweeper.get('persisted') or {}
    if sw_obs.get('immediate_abandons'):
        persisted = sw_per.get('max_persisted_attempts')
        budget = sw_per.get('configured_max_attempts')
        message = (
            f'<b>{sw_obs["immediate_abandons"]} sweeper abandon(s) were <i>immediate</i>.</b> '
            '<code>liquidation-queue</code> marked the token dead on the first failed quote — no retry loop ran. '
            f'Persisted <code>attempts</code> max is {persisted if persisted is not None else "absent"}; the configured '
            f'<code>sweeperMaxAttempts</code>={budget if budget is not None else "default"} is a budget. '
            'Quoting the budget as the observed retry count is wrong.'
        )
        recs.append(('B', message))
    if liveness.get('stall_count'):
        recs.append(
            (
                'A',
                f'<b>{liveness["stall_count"]} management stall(s).</b> Cycle gap exceeded '
                f'{num(liveness.get("stall_threshold_min"))} min (2.5&times; the configured '
                f'{num(liveness.get("configured_management_interval_min"))} min interval); longest '
                f'{num(liveness.get("gap_minutes", {}).get("max"))} min. Correlate against the structured error timestamps.',
            )
        )
    if (overall.get('net_pnl_usd') or 0) > 0 and (realized.get('net_pnl_usd') or 0) < 0:
        recs.append(
            (
                'A',
                f'<b>Headline PnL is carried by unrealized rows.</b> Overall {fmt(overall.get("net_pnl_usd"))} USD, '
                f'realized-only {fmt(realized.get("net_pnl_usd"))} USD. The run is not profitable on settled cash yet.',
            )
        )

    # ---- B: strategy tuning ----
    if (overall.get('net_pnl_usd') or 0) < 0:
        recs.append(
            (
                'B',
                f'<b>Negative net return {fmt(overall.get("net_pnl_usd"))} USD</b> across {trades} trades '
                f'(fees {fmt(overall.get("fees_earned_usd"))} USD, price {fmt(overall.get("price_pnl_usd"))} USD). '
                f'Fees do not cover adverse price movement at this range width.',
            )
        )
    if trades and (overall.get('losses') or 0) / trades >= 0.4:
        recs.append(
            (
                'B',
                f'<b>Loss rate {overall["losses"]}/{trades}.</b> Review the bin width and the out-of-range wait against '
                f'these pools&rsquo; realized volatility; mean range efficiency was {num(overall.get("mean_range_efficiency"))}.',
            )
        )
    if exits.get('take profit'):
        recs.append(
            (
                'B',
                f'<b>Take profit dominates the exit mix ({exits["take profit"]}/{trades}).</b> A mechanical TP truncates the '
                f'right tail: winners are capped while losers run to the stop. Consider a trailing exit on the best performers.',
            )
        )
    range_exits = (exits.get('pumped far above range') or 0) + (exits.get('out of range') or 0) + (
        exits.get('dumped far below range') or 0
    )
    if trades and range_exits / trades >= 0.2:
        recs.append(
            (
                'B',
                f'<b>{range_exits}/{trades} exits were range breaks.</b> The configured bin width is too narrow for the '
                f'pools selected; widen <code>maxBinsBelow</code> or tighten the volatility filter.',
            )
        )
    if (overall.get('fees_earned_usd') or 0) > 0 and (overall.get('price_pnl_usd') or 0) < 0:
        recs.append(
            (
                'B',
                f'<b>Fees are masking adverse price movement.</b> {fmt(overall.get("fees_earned_usd"))} USD of fees against '
                f'{fmt(overall.get("price_pnl_usd"))} USD of price PnL on {trades} trades — the pools stayed in range but the '
                f'underlying moved against the position. Entry selection matters more than exit tuning here.',
            )
        )

    # ---- C: telemetry & memory infra ----
    if pending.get('trades') and integrity.get('pending_liquidations_in_state') == 0:
        recs.append(
            (
                'C',
                f'{pending["trades"]} trade(s) are <code>closed_pending_swap</code> but '
                f'<code>state.pendingLiquidations</code> is empty — the sweeper ledger and the performance ledger disagree. '
                f'Reconcile before the next run so residuals cannot be silently forgotten.',
            )
        )
    for tool, info in (tools.get('double_logged_tools') or {}).items():
        recs.append(
            (
                'C',
                f'{info["twin_distinct_ts"]} + {info["distinct_ts"]} records for <code>{esc(tool)}</code> / '
                f'<code>{esc(info["twin_spelling"])}</code> are only <b>{info["union_distinct_ts"]}</b> distinct invocations. '
                f'Any tool-volume metric built on a single spelling is wrong by '
                f'{round(100 * (1 - max(info["distinct_ts"], info["twin_distinct_ts"]) / info["union_distinct_ts"]))}%.',
            )
        )
    for warning in warnings:
        recs.append(('C', f'{esc(warning)}.'))
    if 'api_error' in (errors.get('structured') or {}):
        recs.append(
            (
                'C',
                f'{errors["structured"]["api_error"]["count"]} upstream API error(s) were logged and retried — '
                f'confirm the retry budget is exhausted before a cycle is abandoned.',
            )
        )

    if not recs:
        recs.append(
            (
                'OK',
                f'No action required: {trades} trades closed, no structured errors, no liveness stalls and full log coverage in this window.',
            )
        )
    log.debug('recommendations fired: %s', [bucket for bucket, _ in recs])
    return recs


# --------------------------------------------------------------------------- #
# section builders
# --------------------------------------------------------------------------- #
def header(instance_id, agent_ids, window, cfg, dry_run):
    llm = cfg.get('llm') or {}
    strategy = cfg.get('strategy') or {}
    risk = cfg.get('risk') or {}
    mgmt = cfg.get('management') or {}
    return f"""
  <div style="background:linear-gradient(135deg,#101828 0%,#1d3a5f 100%);border-radius:12px;padding:26px 30px;color:#ffffff;">
    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8ab4ff;margin-bottom:8px;">Agent Run Log &amp; Performance Review</div>
    <div style="font-size:24px;font-weight:700;line-height:1.2;">{esc(instance_id)} &middot; {esc(', '.join(agent_ids) or 'unknown agent')}</div>
    <div style="font-size:14px;color:#c3d2e3;margin-top:10px;">
      Window (UTC): <b style="color:#fff;">{esc(window)}</b><br>
      Mode: <b style="color:#fff;">{'DRY-RUN' if dry_run else 'LIVE'}</b> &nbsp;&middot;&nbsp;
      Model: <b style="color:#fff;">{esc(llm.get('model'))}</b> &nbsp;&middot;&nbsp;
      Strategy: <b style="color:#fff;">{esc(strategy.get('activeStrategyId'))}</b><br>
      Caps: <b style="color:#fff;">maxPositions={esc(risk.get('maxPositions'))} &middot; deploy={esc(mgmt.get('deployAmountSol'))} SOL &middot; TP={esc(mgmt.get('takeProfitPct'))}% &middot; SL={esc(mgmt.get('stopLossPct'))}%</b>
    </div>
  </div>"""


def section_executive(inst_id, perf, incidents, inventory):
    o = perf.get('overall') or {}
    realized = (perf.get('by_status') or {}).get('realized') or {}
    cov = (incidents or {}).get('log_coverage') or {}
    exits = ((perf.get('exits') or {}).get('families') or {})
    exit_brief = ', '.join(f'{name} {count}' for name, count in list(exits.items())[:5]) or 'none recorded'
    err_total = ((incidents or {}).get('errors') or {}).get('structured_total') or 0
    stalls = ((incidents or {}).get('liveness') or {}).get('stall_count')

    parts = [CARD, H2.format(title='1 &middot; Executive Summary')]
    parts.append(stat_card('Net Return', f'{fmt(o.get("net_pnl_usd"))} USD', f'Fees {fmt(o.get("fees_earned_usd"))} &middot; Price {fmt(o.get("price_pnl_usd"))}', tint(o.get('net_pnl_usd'))))
    parts.append(stat_card('Closed Trades', f'{o.get("trades") or 0}', f'{o.get("wins", 0)}W / {o.get("losses", 0)}L / {o.get("neutral", 0)}N ({num(o.get("win_rate_pct"))}% win)'))
    parts.append(stat_card('Avg Hold', f'{num(o.get("mean_minutes_held"), 1)}m', f'Range eff. {num(o.get("mean_range_efficiency"))}'))
    parts.append(stat_card('Realized-only', f'{fmt(realized.get("net_pnl_usd"))} USD', f'{realized.get("trades", 0)} settled trade(s)', tint(realized.get('net_pnl_usd'))))
    parts.append(
        '<div style="font-size:13px;color:#33424f;line-height:1.6;margin-top:16px;">'
        f'<b>Exits:</b> {esc(exit_brief)}.<br>'
        f'<b>Settlement:</b> {esc(_settlement_sentence(perf))}<br>'
        f'<b>Log coverage:</b> {cov.get("files", 0):,} file(s), {cov.get("total_lines", 0):,} lines, '
        f'{cov.get("parsed", 0):,} parsed, {cov.get("continuations", 0):,} continuations, '
        f'{cov.get("skipped", 0):,} skipped &mdash; dialects {esc(cov.get("dialects") or {})}.'
        '</div>'
    )
    if err_total or stalls:
        bits = []
        if err_total:
            bits.append(f'{err_total} structured error(s)')
        if stalls:
            bits.append(f'{stalls} liveness stall(s)')
        parts.append(
            banner(
                'critical',
                '&#128308; ' + ', '.join(bits),
                'See section 8 for the classified evidence. These are counted from <code>structured-*.jsonl</code> and '
                'the clustered <code>[cron]</code> timeline — not from the text log, which carries no severity.',
            )
        )
    else:
        parts.append(
            banner(
                'ok',
                '&#9989; No structured errors and no liveness stalls',
                f'{cov.get("parsed", 0):,} records parsed across {cov.get("files", 0)} file(s); the run was quiet, and the '
                'ingestion is provably complete rather than silently empty.',
            )
        )
    parts.append('</div>')
    return ''.join(parts)


def _settlement_sentence(perf):
    by_status = perf.get('by_status') or {}
    bits = [f'{status} {summary["trades"]}' for status, summary in by_status.items()]
    residual = sum((s.get('unrealized_residual_usd') or 0.0) for s in by_status.values())
    return f'{", ".join(bits) or "no trades"}; unrealized residual {fmt(residual)} USD (not realized cash)'


def section_config(inst_id, cfg, config_path, baseline):
    parts = [CARD, H2.format(title='2 &middot; Agent Configuration &amp; Expected Strategy Behavior')]
    parts.append(
        '<div style="font-size:12px;color:#5b7286;margin-top:10px;line-height:1.6;">'
        f'Config: <span style="font-family:monospace;">{esc(config_path)}</span><br>'
        f'Strategy: <b>{esc((cfg.get("strategy") or {}).get("activeStrategyId"))}</b> &middot; '
        f'Mode: <b>{"DRY-RUN" if (cfg.get("connection") or {}).get("dryRun") else "LIVE"}</b><br>'
        f'<b>As-configured baseline:</b> {esc(baseline)}'
        '</div>'
    )
    rows = config_rows(cfg)
    if rows:
        parts.append(
            '<table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:12px;">'
            '<tr style="background:#101828;color:#fff;">'
            f'<th {TH}>Config area</th><th {TH}>Value</th><th {TH}>Expected effect</th></tr>'
        )
        for i, (area, value, effect) in enumerate(rows):
            parts.append(
                ROW.format(bg='#f9fafc' if i % 2 == 0 else '#ffffff')
                + f'<td {TD}><b>{esc(area)}</b></td><td {TD}><code>{value}</code></td><td {TD}>{esc(effect)}</td></tr>'
            )
        parts.append('</table>')
    else:
        parts.append('<div style="margin-top:12px;font-size:13px;color:#5b7286;">No parseable config fields found.</div>')

    expected = expected_rows(cfg)
    parts.append('<div style="font-size:13px;font-weight:700;color:#101828;margin-top:16px;">Expected behavior by trigger / signal</div>')
    if expected:
        parts.append(
            '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">'
            '<tr style="background:#101828;color:#fff;">'
            f'<th {TH}>Event / Trigger</th><th {TH}>Governing config</th><th {TH}>Expected behavior</th><th {TH}>Verify in</th></tr>'
        )
        for i, (trigger, governing, expected_text, verify) in enumerate(expected):
            parts.append(
                ROW.format(bg='#f9fafc' if i % 2 == 0 else '#ffffff')
                + f'<td {TD}><b>{trigger}</b></td><td {TD}><code>{esc(governing)}</code></td>'
                + f'<td {TD}>{expected_text}</td><td {TD}><code>{verify}</code></td></tr>'
            )
        parts.append('</table>')
    else:
        parts.append('<div style="margin-top:8px;font-size:13px;color:#5b7286;">No agent config found in this run.</div>')
    parts.append('</div>')
    return ''.join(parts)


def section_performance(perf):
    parts = [CARD, H2.format(title='3 &middot; Financial &amp; Performance Metrics')]
    by_status = perf.get('by_status') or {}
    parts.append('<div style="font-size:13px;font-weight:700;color:#101828;margin-top:14px;">Settlement split by status</div>')
    parts.append(
        '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">'
        '<tr style="background:#101828;color:#fff;">'
        f'<th {TH}>Status</th><th {THR}>Trades</th><th {THR}>W/L/N</th><th {THR}>Net USD</th>'
        f'<th {THR}>Fees USD</th><th {THR}>Price USD</th><th {THR}>Residual USD</th><th {THR}>Mean %</th></tr>'
    )
    for i, (status, s) in enumerate(by_status.items()):
        parts.append(
            ROW.format(bg='#f9fafc' if i % 2 == 0 else '#ffffff')
            + f'<td {TD}><b>{esc(status)}</b></td>'
            + f'<td {TDR}>{s["trades"]}</td>'
            + f'<td {TDR}>{s["wins"]}/{s["losses"]}/{s["neutral"]}</td>'
            + f'<td {TDR} style="color:{tint(s["net_pnl_usd"])};">{fmt(s["net_pnl_usd"])}</td>'
            + f'<td {TDR}>{fmt(s["fees_earned_usd"])}</td><td {TDR}>{fmt(s["price_pnl_usd"])}</td>'
            + f'<td {TDR}>{fmt(s["unrealized_residual_usd"])}</td><td {TDR}>{pct(s["mean_pnl_pct"])}</td></tr>'
        )
    parts.append('</table>')
    parts.append(
        '<div style="margin-top:10px;font-size:12px;color:#33424f;line-height:1.6;">'
        '<b>Accounting rule:</b> <code>net_pnl_usd = price_pnl_usd + fees_earned_usd</code>, persisted rounded to cents. '
        '<code>closed_pending_swap</code> rows are <b>not</b> realized: their <code>unrealized_residual_usd</code> is '
        'reported separately and never counted as cash. <code>abandoned_loss</code> counts as a loss.</div>'
    )

    daily = perf.get('daily') or []
    if daily:
        parts.append('<div style="font-size:13px;font-weight:700;color:#101828;margin-top:16px;">Daily breakdown</div>')
        parts.append(
            '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">'
            '<tr style="background:#101828;color:#fff;">'
            f'<th {TH}>Date</th><th {THR}>Trades</th><th {THR}>W/L/N</th><th {THR}>Net USD</th>'
            f'<th {THR}>Fees USD</th><th {THR}>Price USD</th><th {THR}>Win %</th></tr>'
        )
        for i, day in enumerate(daily):
            parts.append(
                ROW.format(bg='#f9fafc' if i % 2 == 0 else '#ffffff')
                + f'<td {TD}>{esc(day["date"])}</td><td {TDR}>{day["trades"]}</td>'
                + f'<td {TDR}>{day["wins"]}/{day["losses"]}/{day["neutral"]}</td>'
                + f'<td {TDR} style="color:{tint(day["net_pnl_usd"])};">{fmt(day["net_pnl_usd"])}</td>'
                + f'<td {TDR}>{fmt(day["fees_earned_usd"])}</td><td {TDR}>{fmt(day["price_pnl_usd"])}</td>'
                + f'<td {TDR}>{num(day["win_rate_pct"], 1)}</td></tr>'
            )
        parts.append('</table>')
    parts.append('</div>')
    return ''.join(parts)


def section_exits(perf):
    parts = [CARD, H2.format(title='4 &middot; Exit Reason Distribution')]
    families = ((perf.get('exits') or {}).get('families') or {})
    raw = ((perf.get('exits') or {}).get('raw_reasons') or [])
    total = sum(families.values()) or 1
    if families:
        parts.append(
            '<table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:12px;">'
            '<tr style="background:#101828;color:#fff;">'
            f'<th {TH}>Exit family</th><th {THR}>Count</th><th {THR}>Share</th><th {TH}>Bar</th></tr>'
        )
        for i, (name, count) in enumerate(families.items()):
            width = round(100 * count / total, 1)
            parts.append(
                ROW.format(bg='#f9fafc' if i % 2 == 0 else '#ffffff')
                + f'<td {TD}><b>{esc(name)}</b></td><td {TDR}>{count}</td><td {TDR}>{width}%</td>'
                + f'<td {TD}><span style="display:inline-block;height:10px;width:{max(width, 1)}%;background:#1d3a5f;border-radius:3px;"></span></td></tr>'
            )
        parts.append('</table>')
    else:
        parts.append('<div style="margin-top:12px;font-size:13px;color:#5b7286;">No exit reasons recorded.</div>')
    if raw:
        parts.append('<div style="font-size:13px;font-weight:700;color:#101828;margin-top:16px;">Raw close reasons (top 25)</div>')
        parts.append('<ul style="margin:6px 0 0 0;padding-left:20px;font-size:12px;color:#33424f;line-height:1.7;">')
        parts.extend(f'<li><code>{esc(item["reason"])}</code> &times;{item["count"]}</li>' for item in raw)
        parts.append('</ul>')
    parts.append('</div>')
    return ''.join(parts)


def _trade_row(index, trade):
    return (
        ROW.format(bg='#f9fafc' if index % 2 == 0 else '#ffffff')
        + f'<td {TD}><b>{esc(trade.get("pool_name"))}</b><div style="font-size:10px;color:#5b7286;">{esc((trade.get("pool") or "")[:8])}</div></td>'
        + f'<td {TD}>{esc((trade.get("recorded_at") or "")[:19])}</td>'
        + f'<td {TD}>{esc(trade.get("status"))}</td>'
        + f'<td {TDR}>{num(trade.get("minutes_held"), 1)}</td>'
        + f'<td {TDR} style="color:{tint(trade.get("net_pnl_usd"))};">{fmt(trade.get("net_pnl_usd"))}</td>'
        + f'<td {TDR}>{fmt(trade.get("fees_earned_usd"))}</td><td {TDR}>{fmt(trade.get("price_pnl_usd"))}</td>'
        + f'<td {TDR}>{pct(trade.get("pnl_pct"))}</td>'
        + f'<td {TD}><code>{esc((trade.get("close_reason") or "")[:70])}</code></td></tr>'
    )


def section_deep_dive(perf):
    parts = [CARD, H2.format(title='5 &middot; Deep-Dive Trades')]
    head = (
        '<table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:11px;">'
        '<tr style="background:#101828;color:#fff;">'
        f'<th {TH}>Pool</th><th {TH}>Closed</th><th {TH}>Status</th><th {THR}>Hold m</th>'
        f'<th {THR}>Net USD</th><th {THR}>Fees</th><th {THR}>Price</th><th {THR}>Pnl %</th><th {TH}>Close reason</th></tr>'
    )
    extremes = perf.get('extremes') or {}
    for label, key in (('Best 5 by net USD', 'best'), ('Worst 5 by net USD', 'worst')):
        rows = extremes.get(key) or []
        parts.append(f'<div style="font-size:13px;font-weight:700;color:#101828;margin-top:14px;">{label}</div>')
        if rows:
            parts.append(head)
            parts.extend(_trade_row(i, t) for i, t in enumerate(rows))
            parts.append('</table>')
        else:
            parts.append('<div style="margin-top:6px;font-size:12px;color:#5b7286;">Not present in this run directory.</div>')
    parts.append('</div>')
    return ''.join(parts)


def section_strategy(perf):
    """Close-reason family x strategy/volatility cross-tabs, from the trade rows."""
    parts = [CARD, H2.format(title='6 &middot; Strategy &amp; Execution Analysis')]
    trades = perf.get('trades') or []
    if not trades:
        parts.append('<div style="margin-top:12px;font-size:13px;color:#5b7286;">No trades to correlate.</div></div>')
        return ''.join(parts)

    def cross(key_fn, title, label):
        buckets = {}
        for trade in trades:
            bucket = key_fn(trade) or '(none)'
            entry = buckets.setdefault(bucket, {'n': 0, 'wins': 0, 'net': 0.0, 'fees': 0.0, 'eff': []})
            entry['n'] += 1
            entry['wins'] += 1 if trade.get('outcome') == 'win' else 0
            entry['net'] += trade.get('net_pnl_usd') or 0.0
            entry['fees'] += trade.get('fees_earned_usd') or 0.0
            if isinstance(trade.get('range_efficiency'), (int, float)):
                entry['eff'].append(trade['range_efficiency'])
        if not buckets:
            return ''
        out = [f'<div style="font-size:13px;font-weight:700;color:#101828;margin-top:16px;">{title}</div>']
        out.append(
            '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">'
            '<tr style="background:#101828;color:#fff;">'
            f'<th {TH}>{label}</th><th {THR}>Trades</th><th {THR}>Win %</th><th {THR}>Net USD</th>'
            f'<th {THR}>Fees USD</th><th {THR}>Mean range eff.</th></tr>'
        )
        for i, (bucket, e) in enumerate(sorted(buckets.items(), key=lambda kv: -kv[1]['n'])):
            mean_eff = round(sum(e['eff']) / len(e['eff']), 4) if e['eff'] else None
            out.append(
                ROW.format(bg='#f9fafc' if i % 2 == 0 else '#ffffff')
                + f'<td {TD}><b>{esc(bucket)}</b></td><td {TDR}>{e["n"]}</td>'
                + f'<td {TDR}>{round(100 * e["wins"] / e["n"], 1)}</td>'
                + f'<td {TDR} style="color:{tint(e["net"])};">{fmt(e["net"])}</td>'
                + f'<td {TDR}>{fmt(e["fees"])}</td><td {TDR}>{num(mean_eff)}</td></tr>'
            )
        out.append('</table>')
        return ''.join(out)

    parts.append(cross(lambda t: t.get('close_reason_family'), 'Outcome by exit family', 'Exit family'))
    parts.append(cross(lambda t: t.get('strategy'), 'Outcome by deployed strategy', 'Strategy'))
    parts.append(
        cross(
            lambda t: ('&lt;1m' if (t.get('minutes_held') or 0) < 1 else '1-10m' if (t.get('minutes_held') or 0) < 10 else '10-60m' if (t.get('minutes_held') or 0) < 60 else '&ge;60m'),
            'Outcome by hold time',
            'Hold bucket',
        )
    )
    parts.append('</div>')
    return ''.join(parts)


def section_smart_wallets(smart):
    parts = [CARD, H2.format(title='7 &middot; Smart Wallet Signal Verification')]
    if not smart:
        parts.append(
            '<div style="margin-top:12px;font-size:13px;color:#5b7286;">No '
            '<code>REPORT-&lt;date&gt;.smart-wallets.json</code> in this run directory. If the run is not smart-wallet '
            'driven, write &ldquo;Run is not smart-wallet driven &mdash; section not applicable.&rdquo;</div></div>'
        )
        return ''.join(parts)

    verification = smart.get('verification') or {}
    parts.append(
        '<div style="font-size:12px;color:#5b7286;margin-top:10px;line-height:1.6;">'
        f'Fetched: <b>{esc(smart.get("generated_at"))}</b> &middot; wallets checked '
        f'{esc(verification.get("wallets_checked"))} (failed {esc(verification.get("wallets_failed"))}) &middot; '
        f'list <code>{esc((smart.get("instance") or {}).get("smart_wallet_list_id"))}</code> &middot; '
        f'entrySource <code>{esc((smart.get("instance") or {}).get("entry_source"))}</code>'
        '</div>'
    )
    wallets = smart.get('wallets') or []
    if wallets:
        parts.append(
            '<table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:12px;">'
            '<tr style="background:#101828;color:#fff;">'
            f'<th {TH}>Wallet</th><th {TH}>Type</th><th {THR}>Open positions</th><th {TH}>Source</th><th {TH}>Status</th></tr>'
        )
        for i, wallet in enumerate(wallets):
            parts.append(
                ROW.format(bg='#f9fafc' if i % 2 == 0 else '#ffffff')
                + f'<td {TD}><b>{esc(wallet.get("name") or "(unnamed)")}</b><div style="font-size:10px;color:#5b7286;font-family:monospace;">{esc((wallet.get("address") or "")[:8])}&hellip;</div></td>'
                + f'<td {TD}>{esc(wallet.get("type"))}</td><td {TDR}>{esc(wallet.get("open_positions_count"))}</td>'
                + f'<td {TD}>{esc(wallet.get("source_used"))}</td>'
                + f'<td {TD}>{esc(wallet.get("status"))}{esc(": " + wallet["error"] if wallet.get("error") else "")}</td></tr>'
            )
        parts.append('</table>')

    deploys = smart.get('agent_deploys') or []
    if deploys:
        parts.append('<div style="font-size:13px;font-weight:700;color:#101828;margin-top:16px;">Per-deploy gate verification</div>')
        parts.append(
            '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">'
            '<tr style="background:#101828;color:#fff;">'
            f'<th {TH}>Pool</th><th {TH}>Deployed</th><th {TH}>Wallet present</th><th {TH}>Basis</th><th {TH}>Verdict</th></tr>'
        )
        for i, deploy in enumerate(deploys):
            colour = {'PASS': '#15803d', 'FAIL': '#b91c1c', 'UNVERIFIED': '#92400e'}.get(deploy.get('verdict'), '#101828')
            parts.append(
                ROW.format(bg='#f9fafc' if i % 2 == 0 else '#ffffff')
                + f'<td {TD}><code>{esc((deploy.get("pool_address") or "")[:12])}&hellip;</code></td>'
                + f'<td {TD}>{esc((deploy.get("deployed_at") or "")[:19])}</td>'
                + f'<td {TD}>{esc(deploy.get("smart_wallet_present"))}</td>'
                + f'<td {TD}>{esc(deploy.get("evidence_basis"))}</td>'
                + f'<td {TD} style="color:{colour};"><b>{esc(deploy.get("verdict"))}</b></td></tr>'
            )
        parts.append('</table>')

    verdict = verification.get('overall_verdict') or 'UNVERIFIED'
    kind = {'PASS': 'ok', 'FAIL': 'critical', 'PARTIAL': 'warn', 'UNVERIFIED': 'warn'}.get(verdict, 'warn')
    gates = verification.get('gate_integrity')
    parts.append(
        banner(
            kind,
            f'&#9873; Verdict: {esc(verdict)} (gate integrity {esc(gates)})',
            'Snapshot valid: ' + esc(verification.get('snapshot_valid'))
            + f' &middot; baseline positions {esc(verification.get("snapshot_positions"))} &middot; '
            + 'limitations: ' + esc('; '.join(verification.get('limitations') or []) or 'none recorded'),
        )
    )
    parts.append('</div>')
    return ''.join(parts)


def section_veto(smart):
    """Section 6b — per-position veto forensics, only when the JSON carries it."""
    forensics = (smart or {}).get('per_signal_veto_forensics') or []
    drops = (smart or {}).get('silent_drops') or []
    if not forensics and not drops:
        return ''
    parts = [CARD, H2.format(title='6b &middot; Per-position veto forensics')]
    if forensics:
        parts.append(
            '<table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:12px;">'
            '<tr style="background:#101828;color:#fff;">'
            f'<th {TH}>Signal</th><th {TH}>Veto at</th><th {TH}>First failing check</th>'
            f'<th {TH}>Value at veto</th><th {TH}>Threshold</th><th {TH}>Live value</th><th {TH}>Would pass now?</th></tr>'
        )
        for i, item in enumerate(forensics):
            live = item.get('live') or {}
            parts.append(
                ROW.format(bg='#f9fafc' if i % 2 == 0 else '#ffffff')
                + f'<td {TD}><b>{esc(item.get("signal"))}</b></td><td {TD}>{esc((item.get("veto_at") or "")[:19])}</td>'
                + f'<td {TD}><code>{esc(item.get("failed_check"))}</code></td>'
                + f'<td {TD}>{esc(item.get("value_at_veto"))}</td><td {TD}>{esc(item.get("threshold"))}</td>'
                + f'<td {TD}>{esc(live.get("value"))}</td><td {TD}>{esc(item.get("note") or "&mdash;")}</td></tr>'
            )
        parts.append('</table>')
    if drops:
        parts.append('<div style="font-size:13px;font-weight:700;color:#101828;margin-top:16px;">Silent drops (filtered before the veto log)</div>')
        parts.append('<ul style="margin:6px 0 0 0;padding-left:20px;font-size:12px;color:#33424f;line-height:1.7;">')
        parts.extend(f'<li><code>{esc(str(d))[:160]}</code></li>' for d in drops)
        parts.append('</ul>')
    parts.append('</div>')
    return ''.join(parts)


def section_incidents(incidents):
    parts = [CARD, H2.format(title='8 &middot; Stability &amp; Incident Forensics')]
    errors = (incidents or {}).get('errors') or {}
    structured = errors.get('structured') or {}
    failed = errors.get('failed_actions') or []
    liveness = (incidents or {}).get('liveness') or {}
    tools = (incidents or {}).get('tools') or {}
    warnings = (incidents or {}).get('coverage_warnings') or []
    deploys = (incidents or {}).get('deploys') or {}
    sweeper = (incidents or {}).get('sweeper') or {}

    if structured:
        parts.append('<div style="font-size:13px;font-weight:700;color:#101828;margin-top:14px;">Classified errors (from <code>structured-*.jsonl</code>)</div>')
        parts.append(
            '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">'
            '<tr style="background:#101828;color:#fff;">'
            f'<th {TH}>Category</th><th {THR}>Count</th><th {TH}>Top fingerprint</th></tr>'
        )
        for i, (category, info) in enumerate(sorted(structured.items())):
            top = info['fingerprints'][0]['pattern'] if info.get('fingerprints') else ''
            parts.append(
                ROW.format(bg='#f9fafc' if i % 2 == 0 else '#ffffff')
                + f'<td {TD}><b>{esc(category)}</b></td><td {TDR}>{info["count"]}</td>'
                + f'<td {TD}><code>{esc(top[:110])}</code></td></tr>'
            )
        parts.append('</table>')
        samples = [s for info in structured.values() for s in info.get('samples', [])][:6]
        if samples:
            parts.append('<div style="font-size:12px;color:#5b7286;margin-top:10px;">Samples</div>')
            parts.append('<ul style="margin:6px 0 0 0;padding-left:20px;font-size:12px;color:#33424f;line-height:1.7;">')
            parts.extend(f'<li><code>{esc(s["ts"][:19] if s.get("ts") else "")}</code> {esc((s.get("message") or "")[:200])}</li>' for s in samples)
            parts.append('</ul>')
    else:
        parts.append(
            banner(
                'ok',
                '&#9989; No structured errors',
                'No <code>api_error</code> / <code>swap_error</code> / <code>tx_error</code> record in this window. '
                'Note that <code>agent-*.log</code> alone could not have established this: its bracket is a component tag, not a severity.',
            )
        )

    if failed:
        parts.append('<div style="font-size:13px;font-weight:700;color:#101828;margin-top:16px;">Failed tool calls (<code>success: false</code>)</div>')
        parts.append('<ul style="margin:6px 0 0 0;padding-left:20px;font-size:12px;color:#33424f;line-height:1.7;">')
        parts.extend(
            f'<li><code>{esc(f["tool"])}</code> at {esc((f.get("ts") or "")[:19])} &mdash; {esc((f.get("error") or "")[:180])}</li>'
            for f in failed[:15]
        )
        parts.append('</ul>')

    causes = deploys.get('causes') or {}
    if deploys.get('attempts'):
        parts.append(
            '<div style="font-size:13px;font-weight:700;color:#101828;margin-top:16px;">'
            'Deploy outcomes &mdash; cause from the record, not from the failure shape</div>'
        )
        parts.append(
            '<div style="font-size:12px;color:#5b7286;margin-top:4px;">'
            f'{deploys.get("attempts")} deploy attempt(s): {deploys.get("confirmed")} confirmed, '
            f'{deploys.get("skipped")} guard-skipped, {deploys.get("failed")} failed. '
            'A <code>[deploy] &hellip; is on cooldown &mdash; skipping</code> line is a <b>local guard short-circuit</b>: '
            'the venue was never contacted and no order was submitted.</div>'
        )
        parts.append(
            '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">'
            '<tr style="background:#101828;color:#fff;">'
            f'<th {TH}>Attributed cause</th><th {THR}>Count</th></tr>'
        )
        for i, (cause, count) in enumerate(sorted(causes.items(), key=lambda kv: -kv[1])):
            parts.append(
                ROW.format(bg='#f9fafc' if i % 2 == 0 else '#ffffff')
                + f'<td {TD}><code>{esc(cause)}</code></td><td {TDR}>{count}</td></tr>'
            )
        parts.append('</table>')
        by_component = deploys.get('timeout_by_component') or {}
        parts.append(
            '<div style="font-size:12px;color:#5b7286;margin-top:8px;">'
            f'Timeout tokens in the window: <b>{deploys.get("timeout_evidence") or 0}</b> '
            f'(by component <code>{esc(by_component)}</code>). '
            'A local guard rejection must never be reported as an RPC timeout &mdash; the tokens decide, not the failure shape.</div>'
        )
        if deploys.get('empty_address_logs'):
            parts.append(
                banner(
                    'warn',
                    '&#9888; Empty deploy address logged',
                    f'{deploys["empty_address_logs"]} <code>[cron] &hellip; Deployed&nbsp;&nbsp;on &hellip;</code> line(s) sit alongside '
                    'deploys the adapter reported as <code>SUCCESS</code>. The caller logged an address it never checked.',
                )
            )
    obs = sweeper.get('observed') or {}
    per = sweeper.get('persisted') or {}
    if obs.get('abandon_events') or obs.get('immediate_abandons') or per.get('items'):
        parts.append(
            '<div style="font-size:13px;font-weight:700;color:#101828;margin-top:16px;">Sweeper retry accounting</div>'
        )
        parts.append(
            '<div style="font-size:12px;color:#33424f;line-height:1.7;margin-top:6px;">'
            f'{obs.get("immediate_abandons") or 0} token(s) abandoned <b>immediately</b> (unroutable/dead), '
            f'no retries attempted. Persisted <code>attempts</code> max '
            f'<b>{per.get("max_persisted_attempts") if per.get("max_persisted_attempts") is not None else "&mdash;"}</b>; '
            f'configured <code>sweeperMaxAttempts</code>='
            f'<b>{per.get("configured_max_attempts") if per.get("configured_max_attempts") is not None else "&mdash;"}</b> '
            'is a <i>budget</i>, not an observation. Quote the persisted counter, never the budget.'
            f'<br><span style="color:#5b7286;">{esc(per.get("snapshot_note") or "")}</span></div>'
        )

    gaps = liveness.get('gap_minutes') or {}
    parts.append(
        '<div style="font-size:13px;font-weight:700;color:#101828;margin-top:16px;">Liveness</div>'
        '<div style="font-size:12px;color:#33424f;line-height:1.7;margin-top:6px;">'
        f'<code>[cron]</code> events were clustered into <b>{liveness.get("cycles") or 0}</b> cycles '
        f'(merge window {liveness.get("cycle_gap_threshold_sec")} s). Cycle gap: median '
        f'{num(gaps.get("median"))} min, p95 {num(gaps.get("p95"))} min, max {num(gaps.get("max"))} min, against a configured '
        f'management interval of {num(liveness.get("configured_management_interval_min"))} min. '
        f'Stalls beyond {num(liveness.get("stall_threshold_min"))} min: <b>{liveness.get("stall_count") if liveness.get("stall_count") is not None else "n/a"}</b>.'
        '<br><span style="color:#5b7286;">Raw consecutive cron gaps are meaningless: the component emits many lines per cycle.</span>'
        '</div>'
    )

    double = (tools.get('double_logged_tools') or {})
    if double:
        parts.append('<div style="font-size:13px;font-weight:700;color:#101828;margin-top:16px;">Tool-counting trap</div>')
        parts.append('<ul style="margin:6px 0 0 0;padding-left:20px;font-size:12px;color:#33424f;line-height:1.7;">')
        for tool, info in double.items():
            parts.append(
                f'<li><code>{esc(tool)}</code> and <code>{esc(info["twin_spelling"])}</code> are logged separately; '
                f'union is <b>{info["union_distinct_ts"]}</b> distinct invocations, not {info["distinct_ts"]} or '
                f'{info["twin_distinct_ts"]}.</li>'
            )
        parts.append('</ul>')

    if warnings:
        parts.append(banner('warn', '&#9888; Coverage warnings', esc('; '.join(warnings))))
    cov = (incidents or {}).get('log_coverage') or {}
    parts.append(
        '<div style="font-size:12px;color:#5b7286;margin-top:16px;line-height:1.6;">'
        f'<b>Log coverage:</b> {cov.get("files", 0):,} files, {cov.get("total_lines", 0):,} lines, '
        f'{cov.get("parsed", 0):,} parsed, {cov.get("continuations", 0):,} continuations, '
        f'{cov.get("skipped", 0):,} skipped. Dialects: <code>{esc(cov.get("dialects") or {})}</code>.'
        '</div></div>'
    )
    return ''.join(parts)


def section_recommendations(recs, sources_note):
    parts = [CARD, H2.format(title='9 &middot; Hardening &amp; Recommendations')]
    parts.append(
        f'<div style="font-size:12px;color:#5b7286;margin-top:10px;">Derived deterministically from {sources_note} '
        '&mdash; every line cites an observed count.</div>'
    )
    parts.append('<div style="margin-top:14px;font-size:13px;line-height:1.7;color:#33424f;">')
    if recs and recs[0][0] == 'OK':
        parts.append(f'<b style="color:#166534;">No action required.</b> {recs[0][1].split(": ", 1)[-1]}')
    else:
        for key in ('A', 'B', 'C'):
            items = [text for bucket, text in recs if bucket == key]
            if not items:
                continue
            label, colour = BUCKET_LABEL[key]
            parts.append(f'<b style="color:{colour};">{label}</b><ul style="margin:6px 0 0 0;padding-left:20px;">')
            parts.extend(f'<li>{text}</li>' for text in items)
            parts.append('</ul>')
    parts.append('</div></div>')
    return ''.join(parts)


def build_report(inst, perf, incidents, config, smart):
    iid = inst.get('id') or perf.get('id') or 'unknown'
    cfg = config or {}
    window = f'{inst.get("log_first_ts") or "?"} &rarr; {inst.get("log_last_ts") or "?"}'
    baseline = _baseline_line(cfg, perf)
    parts = [PAGE_HEAD.format(title=f'Agent Run Review - {iid}')]
    parts.append(header(iid, inst.get('agent_ids') or [], window, cfg, (cfg.get('connection') or {}).get('dryRun')))
    parts.append(section_executive(iid, perf, incidents, inst))
    parts.append(section_config(iid, cfg, incidents.get('config_path') or inst.get('config_path'), baseline))
    parts.append(section_performance(perf))
    parts.append(section_exits(perf))
    parts.append(section_deep_dive(perf))
    parts.append(section_strategy(perf))
    veto = section_veto(smart)
    if veto:
        parts.append(veto)
    parts.append(section_smart_wallets(smart))
    parts.append(section_incidents(incidents))
    recs = build_recommendations(perf, incidents)
    sources = (
        f'<code>02-performance.json</code> ({perf.get("records_in_window")} rows in window), '
        f'<code>03-incidents.json</code> and <code>01_inventory.json</code>'
    )
    parts.append(section_recommendations(recs, sources))
    parts.append(
        '<div style="margin-top:16px;text-align:center;font-size:11px;color:#8a9aa9;line-height:1.6;">'
        f'Generated by <b>etemaro-core-agent-logs-review</b> &middot; Etemaro &middot; instance '
        f'<span style="font-family:monospace;">{esc(iid)}</span><br>'
        f'Review window {esc(inst.get("log_first_ts") or "?")} &rarr; {esc(inst.get("log_last_ts") or "?")} &mdash; for internal use only.'
        '</div>'
    )
    parts.append(FOOT)
    return ''.join(parts)


def _baseline_line(cfg, perf):
    screening = cfg.get('screening') or {}
    risk = cfg.get('risk') or {}
    mgmt = cfg.get('management') or {}
    strategy = cfg.get('strategy') or {}
    by_status = perf.get('by_status') or {}
    return (
        f'entrySource={screening.get("entrySource")}, maxPositions={risk.get("maxPositions")}, '
        f'takeProfitPct={mgmt.get("takeProfitPct")}, stopLossPct={mgmt.get("stopLossPct")}, '
        f'strategy={strategy.get("activeStrategyId")} -> {" ".join(f"{k} {v['trades']}" for k, v in by_status.items()) or "no trades"}'
    )


def main() -> int:
    ap = argparse.ArgumentParser(description='Render the core-agent HTML review report.')
    ap.add_argument('target_dir')
    ap.add_argument('--from', dest='frm', default=None)
    ap.add_argument('--to', dest='to', default=None)
    ap.add_argument('--only-instance', default=None)
    ap.add_argument('--date', default=None, help='report date tag; also selects REPORT-<date>.smart-wallets.json')
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    target = os.path.abspath(args.target_dir)
    reports = os.path.join(target, 'reports')
    log.info('start target=%s from=%s to=%s only_instance=%s', target, args.frm, args.to, args.only_instance)

    inventory = load(os.path.join(reports, 'inventory.json'), {})
    performance = load(os.path.join(reports, '02-performance.json'), {'instances': []})
    incidents = load(os.path.join(reports, '03-incidents.json'), {'instances': []})

    if not inventory:
        log.error('missing %s — run 01_inventory.py first', os.path.join(reports, 'inventory.json'))
        print(f'missing {os.path.join(reports, "inventory.json")} — run 01_inventory.py, 02_performance.py, 03_incidents.py first')
        return 1

    perf_by_id = {i['id']: i for i in performance.get('instances', [])}
    inc_by_id = {i['id']: i for i in incidents.get('instances', [])}

    date = args.date or datetime.now(UTC).strftime('%Y-%m-%d')
    smart_path = os.path.join(reports, f'REPORT-{date}.smart-wallets.json')
    smart = load(smart_path, None)

    instances = inventory.get('instances', [])
    if args.only_instance:
        instances = [i for i in instances if i['id'] == args.only_instance]
    if not instances:
        log.error('no instances to render under %s', target)
        print('no instances to render')
        return 1

    frm = args.frm or (inventory.get('suggested_window') or {}).get('from')
    to = args.to or (inventory.get('suggested_window') or {}).get('to')
    tag = window_tag(frm, to)

    body = []
    for inst in instances:
        iid = inst['id']
        perf = perf_by_id.get(iid, {'id': iid, 'trades': [], 'overall': {}, 'by_status': {}, 'exits': {}, 'extremes': {}, 'daily': [], 'integrity': {}})
        inc = inc_by_id.get(iid, {'id': iid, 'config_path': inst.get('config_path')})
        config = load(inc.get('config_path') or '', {})
        instance_smart = smart if (smart and (smart.get('instance') or {}).get('id') in (None, iid)) else None
        body.append(build_report(inst, perf, inc, config, instance_smart))

    html_text = ''.join(body)
    out = args.out or os.path.join(reports, f'REPORT-{tag}.html')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(html_text)

    div_balance = html_text.count('<div') - html_text.count('</div>')
    print(f'wrote {out} ({len(html_text):,} bytes, {len(instances)} instance(s), div balance {div_balance})')
    log.info('wrote %s bytes=%d instances=%d div_balance=%d', out, len(html_text), len(instances), div_balance)
    return 0


if __name__ == '__main__':
    sys.exit(main())

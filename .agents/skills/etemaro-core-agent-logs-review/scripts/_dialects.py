#!/usr/bin/env python3
"""Dialect-aware readers for the Etemaro **core agent** log streams.

Scope: this module reads only the core-agent family produced by
``packages/core`` and written under ``<instance>/logs/``. The copy-trader CLI
bot (``apps/bot-copy-trader``) is a different family with different dialects and
is covered by the sibling skill ``etemaro-copy-trader-logs-review`` — its
streams must not be parsed here.

Dialects
--------
======================== ================================================ ==========================================================
dialect                  location                                          shape
======================== ================================================ ==========================================================
``coreagent_runtime``    ``<inst>/logs/agent-<agentId>-<date>.log``        text ``[ts] [component] [agentId] msg``
``coreagent_actions``    ``<inst>/logs/actions-<agentId>-<date>.jsonl``    JSONL ``{ts,agentId,dryRun,tool,args,result,success?}``
``coreagent_structured`` ``<inst>/logs/structured-<agentId>-<date>.jsonl``  JSONL ``{ts,category,agentId,dryRun,message,metadata}``
``jsonl_unclassified``   anywhere                                          JSONL with ``ts`` but no known signature
======================== ================================================ ==========================================================

Why every reader must come through here
---------------------------------------
Reading the wrong stream with the right probe fails *silently*: a swallowed
``json.loads`` plus a ``"ts"`` regex that returns ``None`` yields an empty
result that is indistinguishable from "nothing happened". The three core-agent
streams carry the same conceptual data under three incompatible shapes, and the
error signal lives in exactly one of them:

* ``agent-*.log`` — human narrative. Its bracket is a **component tag, not a
  severity level**; it contains almost no error information.
* ``structured-*.jsonl`` — where ``api_error`` / ``swap_error`` / ``tx_error``
  actually are.
* ``actions-*.jsonl`` — per-tool audit trail; ``success: false`` is the failure
  signal.

An unrecognised JSONL record stays visible as ``jsonl_unclassified`` rather than
being mapped onto a dialect whose field names will not resolve (that would yield
``None`` keys and quietly corrupt every count built from them). Lines matching
no dialect (multi-line LLM output, pretty-printed JSON, stack traces) attach to
the preceding event as ``Event.continuation`` and are counted in
``coverage()["continuations"]``, never dropped.

Stdlib only.
"""

from __future__ import annotations

import collections
import glob
import json
import os
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime

# [2026-09-12T07:53:58.883Z] [startup] [agent-default] DLMM LP Agent starting...
CORE_RUNTIME_RE = re.compile(
    r'^\[(?P<ts>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z?)\]\s*'
    r'\[(?P<component>[^\]]+)\]\s*'
    r'\[(?P<agent>[^\]]+)\]\s*'
    r'(?P<msg>.*)$'
)

#: log file names this family owns, glob-relative to ``<instance>/logs/``
LOG_GLOBS = ('agent-*.log', 'actions-*.jsonl', 'structured-*.jsonl')

DIALECTS = (
    'coreagent_runtime',
    'coreagent_actions',
    'coreagent_structured',
    'jsonl_unclassified',
)


@dataclass
class Event:
    """One normalized log event. ``fields`` keeps the raw record, losslessly.

    ``component`` holds the runtime component tag, the structured ``category``
    or the action ``tool`` — one uniform axis for grouping. ``level`` is only
    ever set when the stream actually carries a severity (i.e. a failed action);
    it is never inferred from the runtime bracket.
    """

    ts: str | None
    dialect: str
    source: str
    line_no: int
    level: str | None = None
    component: str | None = None
    agent_id: str | None = None
    kind: str | None = None
    msg: str | None = None
    fields: dict = field(default_factory=dict)
    continuation: list = field(default_factory=list)


# --------------------------------------------------------------------------- #
# timestamps
# --------------------------------------------------------------------------- #
def ts_key(ts):
    """Return a timezone-aware sortable key for an ISO-8601 timestamp, or None.

    Never compare raw timestamp strings: the streams disagree on
    fractional-second precision, so lexicographic order is not time order.
    """
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


# --------------------------------------------------------------------------- #
# detection
# --------------------------------------------------------------------------- #
def _try_json(line: str):
    try:
        rec = json.loads(line)
    except ValueError:
        return None
    return rec if isinstance(rec, dict) else None


def classify_line(line: str):
    """Return the dialect name for one physical line, or None if it is a continuation.

    Detection is by explicit key signature, never by a bare ``"ts"`` catch-all.
    """
    line = line.rstrip('\n')
    if not line.strip():
        return None
    if CORE_RUNTIME_RE.match(line):
        return 'coreagent_runtime'
    rec = _try_json(line)
    if rec is None:
        return None
    if 'tool' in rec and ('agentId' in rec or 'success' in rec):
        return 'coreagent_actions'
    if 'category' in rec and 'message' in rec:
        return 'coreagent_structured'
    if 'ts' in rec:
        return 'jsonl_unclassified'
    return None


def detect_dialect(path: str):
    """Sniff a file's dialect from its first non-blank line."""
    try:
        with open(path, encoding='utf-8', errors='ignore') as fh:
            for line in fh:
                if line.strip():
                    return classify_line(line)
    except OSError:
        return None
    return None


# --------------------------------------------------------------------------- #
# file discovery
# --------------------------------------------------------------------------- #
def iter_files(target: str):
    """Yield this family's log files under *target* (a file or an instance directory)."""
    if os.path.isfile(target):
        yield target
        return
    seen = set()
    for pattern in LOG_GLOBS:
        for path in sorted(glob.glob(os.path.join(target, 'logs', pattern))):
            if path not in seen:
                seen.add(path)
                yield path


# --------------------------------------------------------------------------- #
# parsing
# --------------------------------------------------------------------------- #
def _normalize(rec: dict, dialect: str, source: str, line_no: int) -> Event:
    if dialect == 'coreagent_actions':
        success = rec.get('success')
        return Event(
            ts=rec.get('ts'),
            dialect=dialect,
            source=source,
            line_no=line_no,
            # `success` is optional in this repo's writer: only an explicit
            # false is a failure, an absent key is not evidence of success.
            level='error' if success is False else 'info',
            component=rec.get('tool'),
            agent_id=rec.get('agentId'),
            kind=rec.get('tool'),
            msg=rec.get('tool'),
            fields=rec,
        )
    if dialect == 'coreagent_structured':
        return Event(
            ts=rec.get('ts'),
            dialect=dialect,
            source=source,
            line_no=line_no,
            component=rec.get('category'),
            agent_id=rec.get('agentId'),
            kind=rec.get('category'),
            msg=rec.get('message'),
            fields=rec,
        )
    if dialect == 'jsonl_unclassified':
        return Event(
            ts=rec.get('ts'),
            dialect=dialect,
            source=source,
            line_no=line_no,
            level=rec.get('level'),
            component=rec.get('context') or rec.get('category') or rec.get('tool'),
            agent_id=rec.get('agentId'),
            kind=rec.get('type'),
            msg=rec.get('msg') or rec.get('message'),
            fields=rec,
        )
    raise ValueError(f'no record normalizer for dialect {dialect!r}')


def _in_window(ev, lo, hi, use_window: bool) -> bool:
    if not use_window:
        return True
    when = ts_key(ev.ts)
    if when is None:
        return False
    if lo and when < lo:
        return False
    if hi and when > hi:
        return False
    return True


def iter_events(target: str, window=None, stats=None):
    """Yield normalized :class:`Event` objects from *target*.

    Parameters
    ----------
    target
        A log file or an instance directory.
    window
        Optional ``(from, to)`` ISO-8601 bounds. Events outside the window are
        counted in *stats* but not yielded.
    stats
        Optional dict, mutated in place with parse accounting. Pass one to get
        :func:`coverage`-equivalent numbers without a second pass over the data.
    """
    if stats is not None:
        stats.setdefault('files', 0)
        stats.setdefault('total_lines', 0)
        stats.setdefault('parsed', 0)
        stats.setdefault('continuations', 0)
        stats.setdefault('skipped', 0)
        stats.setdefault('dialects', collections.Counter())

    lo = ts_key(window[0]) if window else None
    hi = ts_key(window[1]) if window else None

    for path in iter_files(target):
        source = os.path.basename(path)
        dialect = detect_dialect(path)
        if stats is not None:
            stats['files'] += 1
            if dialect:
                stats['dialects'][dialect] += 1
        pending = None
        try:
            fh = open(path, encoding='utf-8', errors='ignore')
        except OSError:
            continue
        with fh:
            for line_no, line in enumerate(fh, 1):
                if stats is not None:
                    stats['total_lines'] += 1
                line = line.rstrip('\n')
                line_dialect = classify_line(line)
                if line_dialect is None:
                    # continuation of a multi-line record, e.g. LLM markdown
                    if pending is not None and line.strip():
                        pending.continuation.append(line)
                        if stats is not None:
                            stats['continuations'] += 1
                    elif line.strip() and stats is not None:
                        stats['skipped'] += 1
                    continue
                if line_dialect == 'coreagent_runtime':
                    m = CORE_RUNTIME_RE.match(line)
                    ev = Event(
                        ts=m.group('ts'),
                        dialect=line_dialect,
                        source=source,
                        line_no=line_no,
                        component=m.group('component'),
                        agent_id=m.group('agent'),
                        kind=m.group('component'),
                        msg=m.group('msg'),
                        fields={'raw': line},
                    )
                else:
                    ev = _normalize(_try_json(line), line_dialect, source, line_no)
                if stats is not None:
                    stats['parsed'] += 1
                # A record is only complete once a *new* record starts, so hold it
                # back one step: Event.continuation must be final before the caller
                # receives the event.
                if pending is not None and _in_window(pending, lo, hi, bool(window)):
                    yield pending
                pending = ev
        if pending is not None and _in_window(pending, lo, hi, bool(window)):
            yield pending


# --------------------------------------------------------------------------- #
# accounting
# --------------------------------------------------------------------------- #
def coverage(target: str, window=None) -> dict:
    """Parse accounting for *target*: how much was understood, and as what."""
    stats = {}
    for _ in iter_events(target, window=window, stats=stats):
        pass
    stats['dialects'] = dict(stats.get('dialects', {}))
    return stats


def log_bounds(instance_dir: str):
    """Return ``(first_ts, last_ts, total_lines)`` over the instance's log files.

    ``total_lines`` counts every physical line (blank lines included).
    """
    stats = {}
    first = last = None
    first_key = last_key = None
    for ev in iter_events(instance_dir, stats=stats):
        key = ts_key(ev.ts)
        if key is None:
            continue
        if first_key is None or key < first_key:
            first, first_key = ev.ts, key
        if last_key is None or key > last_key:
            last, last_key = ev.ts, key
    return first, last, stats.get('total_lines', 0)


# --------------------------------------------------------------------------- #
# shared readers used by the numbered tools
# --------------------------------------------------------------------------- #
def agent_ids(instance_dir: str):
    """Distinct ``agentId`` values seen anywhere in the instance's logs."""
    found = set()
    for ev in iter_events(instance_dir):
        if ev.agent_id:
            found.add(ev.agent_id)
    return sorted(found)


def component_census(instance_dir: str, window=None) -> dict:
    """``{dialect: Counter(component -> n)}`` — the one grouping axis that matters."""
    census = collections.defaultdict(collections.Counter)
    for ev in iter_events(instance_dir, window=window):
        census[ev.dialect][ev.component or '(none)'] += 1
    return {dialect: dict(counter) for dialect, counter in census.items()}


def structured_categories(instance_dir: str, window=None) -> dict:
    """``Counter(category -> n)`` over ``structured-*.jsonl``."""
    counts = collections.Counter()
    for ev in iter_events(instance_dir, window=window):
        if ev.dialect == 'coreagent_structured':
            counts[ev.component or '(none)'] += 1
    return dict(counts)


def action_calls(instance_dir: str, window=None):
    """Distinct-timestamp tool call counts plus the raw per-record list.

    Returns ``(by_tool, distinct_by_tool, records)`` where ``records`` is a list
    of ``(ts, tool, success, error)``.

    **Some tools are logged twice under two spellings** — ``sweepUnsoldTokens``
    (summary) and ``sweep_unsold_tokens`` (per-token detail). They are not
    aliases: counting either alone undercounts, summing both double-counts the
    overlap. Always report ``distinct_by_tool`` (distinct timestamps), never a
    raw record count, when talking about tool volume.
    """
    by_tool = collections.Counter()
    stamps = collections.defaultdict(set)
    records = []
    for ev in iter_events(instance_dir, window=window):
        if ev.dialect != 'coreagent_actions':
            continue
        tool = ev.component or '(none)'
        by_tool[tool] += 1
        if ev.ts:
            stamps[tool].add(ev.ts)
        records.append((ev.ts, tool, ev.fields.get('success'), ev.fields.get('error')))
    distinct = {tool: len(values) for tool, values in stamps.items()}
    return dict(by_tool), distinct, records


def failed_actions(instance_dir: str, window=None):
    """Action records with an explicit ``success: false``."""
    out = []
    for ev in iter_events(instance_dir, window=window):
        if ev.dialect == 'coreagent_actions' and ev.fields.get('success') is False:
            out.append(
                {
                    'ts': ev.ts,
                    'tool': ev.component,
                    'error': ev.fields.get('error'),
                    'args': ev.fields.get('args'),
                }
            )
    return out


def structured_errors(instance_dir: str, window=None):
    """Error-category records from ``structured-*.jsonl``.

    This is where the run's failures actually live: ``agent-*.log`` carries
    almost none. Categories observed in this repo: ``api_error``,
    ``swap_error``, ``tx_error``.
    """
    out = []
    for ev in iter_events(instance_dir, window=window):
        if ev.dialect != 'coreagent_structured':
            continue
        if ev.component in ('api_error', 'swap_error', 'tx_error'):
            out.append(
                {
                    'ts': ev.ts,
                    'category': ev.component,
                    'message': ev.msg,
                    'metadata': (ev.fields.get('metadata') or {}),
                }
            )
    return out


def cron_cycles(instance_dir: str, gap_seconds: int = 30, window=None):
    """Cluster ``[cron]`` runtime events into management cycles.

    The ``cron`` component emits **many lines per cycle** — on the reference
    instance 11,219 cron lines spanned 3,663 cycles (median inter-line gap 0.4 s,
    median inter-cycle gap 2.0 min). Measuring raw consecutive-cron gaps
    therefore reports 0.4 s and is meaningless. Cluster first, then measure.

    Returns ``(cycle_start_ts_list, cycle_gap_minutes_list)``.
    """
    stamps = []
    for ev in iter_events(instance_dir, window=window):
        if ev.dialect == 'coreagent_runtime' and ev.component == 'cron':
            key = ts_key(ev.ts)
            if key is not None:
                stamps.append(key)
    stamps.sort()
    if not stamps:
        return [], []
    starts = [stamps[0]]
    for i in range(1, len(stamps)):
        if (stamps[i] - stamps[i - 1]).total_seconds() > gap_seconds:
            starts.append(stamps[i])
    gaps = [round((starts[i + 1] - starts[i]).total_seconds() / 60.0, 2) for i in range(len(starts) - 1)]
    return [s.isoformat().replace('+00:00', 'Z') for s in starts], gaps


# --------------------------------------------------------------------------- #
# deploy outcome classification
# --------------------------------------------------------------------------- #
#: A network/RPC timeout is only ever claimed when the record itself says so.
#: "RPC timeout" is **not** a synonym for "the deploy did not happen".
TIMEOUT_RE = re.compile(r'timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed', re.IGNORECASE)
#: ``MeteoraAdapter.deployPosition`` short-circuits before it touches the venue.
COOLDOWN_RE = re.compile(r'is on cooldown\s*[—\-]\s*skipping', re.IGNORECASE)
#: the same short-circuit, reported by the caller once it checks the response shape.
SKIPPED_RE = re.compile(r'\[SmartWallets\]\s+Deploy skipped for pool\s+(\S+?):\s*(.*)$')
#: the caller's blanket catch — the only place a deploy failure lands.
DEPLOY_FAILED_RE = re.compile(r'\[SmartWallets\]\s+Deploy failed for pool\s+(\S+?):\s*(.*)$')
#: the caller's success log; an empty or ``undefined`` address is a logging artefact.
DEPLOYED_RE = re.compile(r'\[SmartWallets\]\s+Deployed\s+(?P<addr>\S*)\s+on\s')
#: the adapter's own success line.
SWAP_SUCCESS_RE = re.compile(r'SUCCESS\s*[—\-]\s*\d+\s+tx\(s\)')
#: a guard rejection can only explain a failure logged within this many seconds.
GUARD_PAIRING_SECONDS = 10


def _guard_cause(msg: str) -> str:
    """Name the local guard that produced a skip — never a network cause."""
    low = (msg or '').lower()
    if 'base mint' in low:
        return 'local_guard:base_mint_cooldown'
    if 'pool' in low:
        return 'local_guard:pool_cooldown'
    return 'local_guard:cooldown'


def deploy_outcomes(instance_dir: str, window=None):
    """Attribute every smart-wallet deploy attempt in *window* to a cause.

    The audit report this reader exists to prevent claimed *"8 occurrences of
    undefined deploy response on RPC timeout"*. The **8 was right**; the cause was
    not. All eight were ``[deploy] … is on cooldown — skipping`` guard
    short-circuits, in a window whose logs contain **zero** timeout strings. The
    cause is therefore read from the guard record that immediately precedes the
    failure — never inferred from the *shape* of the failure.

    Returns ``causes`` (counts keyed by attributed cause), ``attempts``,
    ``skipped``, ``failed``, ``confirmed``, ``timeout_evidence`` (occurrences of a
    real timeout token in the window, broken down by component so an unrelated
    Telegram ``fetch failed`` cannot be read as an RPC timeout) and
    ``empty_address_logs`` (the ``Deployed `` / ``Deployed undefined`` artefact).
    ``causes`` is the only sanctioned source for a cause sentence in a report.
    """
    causes = collections.Counter()
    timeout_by_component = collections.Counter()
    events = []
    out = {
        'attempts': 0,
        'confirmed': 0,
        'skipped': 0,
        'failed': 0,
        'timeout_evidence': 0,
        'timeout_by_component': {},
        'empty_address_logs': 0,
        'causes': {},
        'events': events,
    }
    guard = None
    for ev in iter_events(instance_dir, window=window):
        if ev.dialect != 'coreagent_runtime':
            continue
        msg = ev.msg or ''
        if TIMEOUT_RE.search(msg):
            out['timeout_evidence'] += 1
            timeout_by_component[ev.component or '?'] += 1

        # 1. the guard short-circuit itself
        if ev.component == 'deploy' and COOLDOWN_RE.search(msg):
            guard = {'ts': ev.ts, 'source': ev.source, 'line_no': ev.line_no, 'msg': msg}
            continue

        # 2. an explicit skip reported by the caller (post-guard-check behaviour)
        if ev.component == 'deploy':
            m = SKIPPED_RE.search(msg)
            if m:
                reason = (m.group(2) or '').strip()
                cause = _guard_cause(reason) if 'cooldown' in reason.lower() else 'skip:other'
                causes[cause] += 1
                out['skipped'] += 1
                events.append({'ts': ev.ts, 'pool': m.group(1), 'outcome': 'skipped', 'cause': cause, 'detail': reason[:200]})
                guard = None
                continue
            # 3. the adapter's own success line
            if SWAP_SUCCESS_RE.search(msg):
                out['confirmed'] += 1
                continue

        # 4. the success log — an empty address is an artefact, not a deploy
        if ev.component == 'cron':
            m = DEPLOYED_RE.search(msg)
            if m and m.group('addr') in ('', 'undefined'):
                out['empty_address_logs'] += 1
                continue

        # 5. the blanket catch
        if ev.component == 'cron_error':
            m = DEPLOY_FAILED_RE.search(msg)
            if not m:
                continue
            reason = (m.group(2) or '').strip()
            paired = guard is not None and _same_guard(guard, ev)
            if paired:
                cause = _guard_cause(guard['msg'])
            elif TIMEOUT_RE.search(reason):
                cause = 'network_timeout'
            else:
                cause = 'unexplained'
            causes[cause] += 1
            out['failed'] += 1
            events.append(
                {
                    'ts': ev.ts,
                    'pool': m.group(1),
                    'outcome': 'failed',
                    'cause': cause,
                    'detail': reason[:200],
                    'guard_line': guard['line_no'] if paired and guard else None,
                }
            )
            guard = None

    out['attempts'] = out['confirmed'] + out['skipped'] + out['failed']
    out['causes'] = dict(causes.most_common())
    out['timeout_by_component'] = dict(timeout_by_component.most_common())
    return out


def _same_guard(guard: dict, failure: Event) -> bool:
    """True when *guard* is the short-circuit the *failure* immediately followed."""
    if guard.get('source') != failure.source:
        return False
    a, b = ts_key(guard.get('ts')), ts_key(failure.ts)
    if a is None or b is None:
        return True
    delta = (b - a).total_seconds()
    return 0 <= delta <= GUARD_PAIRING_SECONDS


# --------------------------------------------------------------------------- #
# sweeper retry accounting
# --------------------------------------------------------------------------- #
#: ``liquidation-queue.ts`` — the authoritative abandon record: mode + attempts.
LIQUIDATION_ABANDONED_RE = re.compile(
    r'Liquidation abandoned for\s+(?P<symbol>\S+?)\s+'
    r'(?P<mode>immediately|after\s+(?P<attempts>\d+)\s+attempts?)',
)
#: ``ToolExecutor`` — the immediate-abandon path; it never retries.
SWEEPER_ILLIQUID_RE = re.compile(
    r'Auto-swap sweeper permanently illiquid for\s+(?P<symbol>\S+?)\s*\((?P<code>[^)]*)\)',
)
#: per-cycle totals
SWEEPER_CYCLE_RE = re.compile(
    r'Sweeper cycle complete:\s*(?P<swapped>\d+)\s+swapped,\s*(?P<failed>\d+)\s+failed,\s*'
    r'(?P<abandoned>\d+)\s+abandoned',
)


def sweeper_retries(instance_dir: str, window=None):
    """Observed sweeper retry counts, read from the record.

    The audit report claimed a dead token was *"marked dead after 3 retries"*; the
    persisted ``pendingLiquidations`` record said ``attempts: 1`` and the log said
    *"abandoning immediately without further retries"*. The configured
    ``management.sweeperMaxAttempts`` is a **budget**, never an observation — and
    on this repo's default it is 10, not 3. Only ``attempts`` parsed here (and the
    persisted counter) may be quoted as a retry count.
    """
    abandons = []
    immediate = 0
    illiquid = []
    attempts_reported = []
    cycles = {'swapped': 0, 'failed': 0, 'abandoned': 0, 'cycles': 0}
    for ev in iter_events(instance_dir, window=window):
        if ev.dialect != 'coreagent_runtime':
            continue
        msg = ev.msg or ''
        m = SWEEPER_CYCLE_RE.search(msg)
        if m:
            cycles['swapped'] += int(m.group('swapped'))
            cycles['failed'] += int(m.group('failed'))
            cycles['abandoned'] += int(m.group('abandoned'))
            cycles['cycles'] += 1
            continue
        m = LIQUIDATION_ABANDONED_RE.search(msg)
        if m:
            mode = 'immediate' if m.group('mode') == 'immediately' else 'budget'
            attempts = int(m.group('attempts')) if m.group('attempts') else 0
            if mode == 'immediate':
                immediate += 1
            else:
                attempts_reported.append(attempts)
            abandons.append(
                {'ts': ev.ts, 'symbol': m.group('symbol'), 'mode': mode, 'attempts': attempts}
            )
            continue
        m = SWEEPER_ILLIQUID_RE.search(msg)
        if m:
            illiquid.append({'ts': ev.ts, 'symbol': m.group('symbol'), 'error_code': m.group('code')})
    return {
        'abandon_events': abandons,
        'immediate_abandons': immediate,
        'reported_attempts': attempts_reported,
        'max_reported_attempts': max(attempts_reported, default=None),
        'illiquid_immediate': illiquid,
        'cycles': cycles,
    }

"""Set result v2 serialization; no posture decisions or counting thresholds."""
import math
from .contract import json_safe


def item_result(basis, compliant, warning, unknown=0, not_applicable=0):
    if basis not in ('repetition', 'time'):
        raise ValueError('Unknown aggregation basis')
    for n in (compliant, warning, unknown, not_applicable):
        if not math.isfinite(n) or n < 0:
            raise ValueError('Item totals must be finite nonnegative values')
        if basis == 'repetition' and int(n) != n:
            raise ValueError('Repetition totals must be integers')
    evaluated = compliant + warning
    return dict(aggregationBasis=basis, unit='seconds' if basis == 'time' else 'repetitions',
                compliant=compliant, warning=warning, unknown=unknown,
                notApplicable=not_applicable, evaluated=evaluated,
                compliancePct=100*compliant/evaluated if evaluated else None)


def set_summary(*, exercise, engineVersion, items, count=None, holdSeconds=None,
                observedSeconds=None, gapSeconds=None, details=None):
    return json_safe(dict(schemaVersion='2.0', exercise=exercise, engineVersion=engineVersion,
        count=count, holdSeconds=holdSeconds, observedSeconds=observedSeconds,
        gapSeconds=gapSeconds, items=items, details=details or {}))


def set_completed(summary, timestamp_ms=None):
    return json_safe(dict(schemaVersion='2.0', type='set.completed',
        exercise=summary['exercise'], engineVersion=summary['engineVersion'],
        timestampMs=timestamp_ms, summary=summary))


def time_summary(raw):
    fields={k: raw.get(k) for k in ('exercise','engineVersion','count','holdSeconds','observedSeconds','gapSeconds')}
    details={k: raw[k] for k in ('sideCounts','repetitions','configuration')} if raw['exercise']=='bird_dog' else {}
    return set_summary(**fields, details=details, items={k: item_result('time',
        v['compliant_s'],v['warning_s'],v['unknown_s'],v.get('not_applicable_s',0))
        for k,v in raw['items'].items()})

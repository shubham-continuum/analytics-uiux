"""Shared helpers for One Studio's API modules. Holds the ONE ISO-NE sign boundary.

Provenance: Claude Opus 5.5 (data agent) · dossier one-studio/design (T3) · 2026-10-06 · sign-off pending · v1

ISO-NE settles LMP = energy + congestion + loss: a positive congestion component raises the node price.
What the unified DB stores, measured 2026-10-06 (design/progress/M2.md):
  * settled history (fact_lmp_hourly, mart_bus_year): already ISO-NE sign; LMP = E + C + L to the cent.
  * PROBE / PCR solved runs (fact_fcst_lmp_hourly, mart_bus_fcst_year): LMP = E - C + L. The per-hour
    cross-bus test confirms it: LMP + C_stored - L is one system energy price across ~2,700 buses (SD ~1e-6).
`to_isone_sign` flips a run's congestion once and recomputes energy from the flipped figure. The run's stored
energy, where a table has one, is never read (built the other way it is off by 2 x C). Any other code that
flips a sign is a second boundary and a defect.
"""

# Stored convention per source table. Only tables measured on the unified DB are listed; anything else is refused.
STORED_SIGN = {
    'fact_lmp_hourly': 'isone',
    'mart_bus_year': 'isone',
    'fact_fcst_lmp_hourly': 'probe',
    'mart_bus_fcst_year': 'probe',
    # S2-D 2026-10-06: avg_cong == avg(fact_fcst_lmp_hourly.congestion) per bus/run/hour (240 rows, max |diff| 0), so the run sign.
    'mart_bus_fcst_hour': 'probe',
}

# The two row shapes in use: hourly facts and annual marts. (lmp, energy, congestion, loss) keys.
_FAMILIES = (('lmp', 'energy', 'congestion', 'loss'), ('avg_lmp', 'avg_energy', 'avg_cong', 'avg_loss'))
_MARK = '_sign'


def to_isone_sign(row, source):
    """Return a copy of `row` on the ISO-NE sign (LMP = E + C + L). `source` names the table the row came from.

    Raises ValueError for an unknown source (never guess a convention) and for a row already converted
    (no double flip). Nulls stay null; arithmetic on a null gives null, never 0.
    """
    if row.get(_MARK) == 'isone':
        raise ValueError('row is already on the ISO-NE sign; converting again would flip it back')
    stored = STORED_SIGN.get(source)
    if stored is None:
        raise ValueError(f'unknown sign convention for source {source!r}; measure it and add it to STORED_SIGN')
    out = dict(row)
    if stored == 'probe':
        for lmp_k, e_k, c_k, l_k in _FAMILIES:
            if c_k not in out:
                continue
            c = out[c_k]
            c = None if c is None else -c + 0.0  # + 0.0 turns -0.0 into 0.0
            out[c_k] = c
            lmp, loss = out.get(lmp_k), out.get(l_k)
            out[e_k] = lmp - c - loss if None not in (lmp, c, loss) else None
    out[_MARK] = 'isone'
    out['_sign_source'] = source
    return out


def strip_marks(row):
    """The row without the bookkeeping keys, for publishing."""
    return {k: v for k, v in row.items() if k not in (_MARK, '_sign_source')}


def r(v, dp):
    """Round for publishing; None stays None (never 0)."""
    return None if v is None else round(float(v), dp)

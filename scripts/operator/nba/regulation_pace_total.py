"""Fixed C7 Total-only ridge. Old Margin is never fitted or selected here."""
import gzip
import hashlib
import json
import sys
from datetime import datetime
import numpy as np
from learned_shrinkage import design_matrix

RELEASE = 'nba_regulation_pace_total_2026_11_27_r1_original_duration'


def clock(s):
    d = datetime.fromisoformat(s.replace('Z', '+00:00'))
    if d.tzinfo is None:
        raise ValueError('pace_clock_requires_zone')
    return d.timestamp()


def training_rows(source):
    rows = [r for r in source['rows'] if r['season'] in (2021, 2022) and clock(r['finalAvailableAt']) < clock(source['firstEvaluation'])]
    rows.sort(key=lambda r: r['gameId'])
    if len(rows) != source['trainingRows'] or len({r['gameId'] for r in rows}) != len(rows) or not 10 < len(rows) <= 10000:
        raise ValueError('pace_training_scope')
    return rows


def prepare_design(rows, names):
    if len(names) != 75 or len(set(names)) != 75 or sum('pace48' in n for n in names) != 13:
        raise ValueError('pace_feature_contract')
    raw = np.array([[np.nan if r['durationAwareFeatures'].get(n) is None else r['durationAwareFeatures'][n] for n in names] for r in rows], dtype=float)
    missing = ~np.isfinite(raw)
    medians = np.array([np.median(raw[~missing[:, i], i]) if (~missing[:, i]).any() else 0. for i in range(len(names))])
    indicators = [i for i in range(len(names)) if missing[:, i].any()]
    filled = np.column_stack([np.where(missing, medians, raw), missing[:, indicators].astype(float)])
    means, sd = filled.mean(axis=0), filled.std(axis=0)
    sd[sd <= 1e-12] = 1.
    design = {'features': names, 'rawFeatureMedians': medians.tolist(), 'missingIndicatorColumns': [names[i] for i in indicators],
              'designMeans': means.tolist(), 'designStandardDeviations': sd.tolist(), 'designColumns': filled.shape[1], 'splineKnots': []}
    return (filled-means)/sd, design


def solve(x, y):
    beta = np.linalg.solve(x.T@x+1000*np.eye(x.shape[1]), x.T@(y-y.mean()))
    return np.r_[beta, y.mean()-x.mean(axis=0)@beta]


def main():
    source_path, output = sys.argv[1:]
    raw = open(source_path, 'rb').read()
    source = json.loads(gzip.decompress(raw))
    rows = training_rows(source)
    y = np.array([r['actualTotal'] for r in rows], dtype=float)
    # Independent reproduction of the already frozen legacy A2 Total head.
    reference = source['baseline']['artifact']
    old_x = design_matrix(rows, reference['design'])
    old_beta = solve(old_x, y)
    error = float(np.max(np.abs(old_beta-np.array(reference['coefficients']['target_total']))))
    if error > 1e-9:
        raise ValueError('legacy_total_fit_parity')
    x, design = prepare_design(rows, source['featureNames'])
    beta = solve(x, y)
    if not np.isfinite(beta).all():
        raise ValueError('nonfinite_pace_head')
    result = {'release': RELEASE, 'featureRelease': source['featureRelease'], 'inputSha256': hashlib.sha256(raw).hexdigest(),
              'trainingHash': source['trainingHash'], 'trainingRows': len(rows), 'trainingEnd': source['trainingEnd'],
              'baselineHash': source['baseline']['hash'], 'durationSourceHash': source['durationSourceHash'],
              'alpha': 1000, 'design': design, 'totalCoefficients': beta.tolist(), 'legacyCoefficientMaxDifference': error,
              'marginFitted': False, 'developmentReadByFit': False, 'productionWrites': 0, 'providerRequests': 0}
    with open(output, 'x') as f:
        json.dump(result, f, sort_keys=True, indent=2, allow_nan=False)
    print(json.dumps({k: v for k, v in result.items() if k not in ['design', 'totalCoefficients']}, sort_keys=True))


if __name__ == '__main__':
    main()

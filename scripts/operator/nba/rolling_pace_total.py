"""One deterministic fixed-recipe fit per declared rolling origin, offline."""
import gzip
import hashlib
import json
import sys
import numpy as np
from regulation_pace_total import clock, prepare_design, solve

RELEASE = 'nba_rolling_regulation_pace_total_2026_11_27_r1_prior_seasons'


def fit_design(rows, names, key):
    views = [{**r, 'durationAwareFeatures': r[key]} for r in rows]
    # Rename legacy columns only inside the generic numerical preprocessor;
    # restore their exact original names in the resulting legacy design.
    numerical_names = [n.replace('pace', 'pace48') if key == 'features' else n for n in names]
    if key == 'features':
        views = [{**r, 'durationAwareFeatures': {n.replace('pace', 'pace48'): v for n, v in r['features'].items()}} for r in rows]
    x, design = prepare_design(views, numerical_names)
    if key == 'features':
        design['features'] = names
        design['missingIndicatorColumns'] = [n.replace('pace48', 'pace') for n in design['missingIndicatorColumns']]
    return x, design


def rows_for_origin(source, origin):
    cutoffs = [r['cutoff'] for r in source['rows'] if r['season'] == origin]
    if not cutoffs:
        raise ValueError('missing_origin')
    first = min(cutoffs, key=clock)
    rows = [r for r in source['rows'] if 2021 <= r['season'] < origin and clock(r['finalAvailableAt']) < clock(first)]
    rows.sort(key=lambda r: r['gameId'])
    if not 1000 <= len(rows) <= 10000 or len({r['gameId'] for r in rows}) != len(rows):
        raise ValueError('rolling_training_scope')
    return first, rows


def main():
    input_path, c7_path, output = sys.argv[1:]
    raw = open(input_path, 'rb').read()
    source = json.loads(gzip.decompress(raw))
    c7 = json.load(open(c7_path))
    legacy_names = source['baseline']['artifact']['design']['features']
    models = []
    for origin in [2023, 2024, 2025]:
        first, rows = rows_for_origin(source, origin)
        old_x, old_design = fit_design(rows, legacy_names, 'features')
        new_x, new_design = fit_design(rows, source['featureNames'], 'durationAwareFeatures')
        total = np.array([r['actualTotal'] for r in rows])
        margin = np.array([r['actualMargin'] for r in rows])
        old_total, old_margin, new_total = solve(old_x, total), solve(old_x, margin), solve(new_x, total)
        parity = None
        if origin == 2023:
            a2 = source['baseline']['artifact']['coefficients']
            parity = max(float(np.max(np.abs(old_total-a2['target_total']))),
                         float(np.max(np.abs(old_margin-a2['target_home_margin']))),
                         float(np.max(np.abs(new_total-c7['head']['totalCoefficients']))))
            if parity > 1e-9:
                raise ValueError('first_origin_frozen_parity_failed')
        models.append({'origin': origin, 'trainingRows': len(rows), 'trainingEnd': max(rows, key=lambda r: clock(r['finalAvailableAt']))['finalAvailableAt'],
                       'firstEvaluation': first, 'trainingIdsHash': hashlib.sha256(json.dumps([r['gameId'] for r in rows], separators=(',', ':')).encode()).hexdigest(),
                       'legacy': {'design': old_design, 'margin': old_margin.tolist(), 'total': old_total.tolist()},
                       'candidateTotal': {'design': new_design, 'total': new_total.tolist()}, 'firstOriginFrozenMaxDifference': parity})
    result = {'release': RELEASE, 'inputSha256': hashlib.sha256(raw).hexdigest(), 'featureRelease': source['featureRelease'],
              'alpha': 1000, 'models': models, 'candidateMarginFitted': False, 'evaluationReadByFit': False,
              'productionWrites': 0, 'providerRequests': 0}
    with open(output, 'x') as f:
        json.dump(result, f, sort_keys=True, indent=2, allow_nan=False)
    print(json.dumps({**result, 'models': [{k: v for k, v in m.items() if k not in ['legacy', 'candidateTotal']} for m in models]}, sort_keys=True))


if __name__ == '__main__':
    main()

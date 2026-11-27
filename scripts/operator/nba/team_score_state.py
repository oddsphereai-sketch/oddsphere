"""C5: exact team scoring/prevention GP, offline original-source research only."""
import gzip
import hashlib
import json
import math
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
from scipy.optimize import minimize

RELEASE = 'nba_team_score_state_2026_11_26_r1_original_team_residuals'
SOURCE = 'nba_original_team_feature_source_2026_11_23_r1_native_box_counts'
BASELINE = 'nba_archived_portable_recipe_2026_11_23_r1_train_only_ridge1000'
PARAMETERS = ['scoringVariance', 'preventionVariance', 'noiseVariance', 'lengthDays']


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def instant(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('clock_requires_zone')
    return dt.timestamp() / 86400


def validate_row(r, season, baseline_hash):
    if (not re.fullmatch(r'\d{10}', r['gameId']) or r['season'] != season or
            r['baselineHash'] != baseline_hash or r['sourceRecipe'] != SOURCE or r['baselineRecipe'] != BASELINE or
            not re.fullmatch('[a-f0-9]{64}', r['sourceSha256']) or
            not re.fullmatch('[a-f0-9]{64}', baseline_hash)):
        raise ValueError('foreign_team_state_source')
    h, a = r['homeTeamId'], r['awayTeamId']
    if type(h) is not int or type(a) is not int or h <= 0 or a <= 0 or h == a:
        raise ValueError('invalid_native_team_identity')
    start, cutoff, final, trained = map(instant, [r['startAt'], r['cutoff'], r['finalAvailableAt'], r['baselineTrainingEnd']])
    if abs(start-cutoff-1/24) > 1e-9 or final <= start or trained >= cutoff:
        raise ValueError('invalid_team_state_source_clock')
    if (not all(type(r[k]) is int and r[k] >= 0 for k in ['homeScore', 'awayScore']) or
            r['homeScore'] == r['awayScore'] or
            not all(math.isfinite(r[k]) for k in ['baselineMargin', 'baselineTotal']) or
            r['baselineTotal'] <= abs(r['baselineMargin'])):
        raise ValueError('invalid_team_state_score')


def residual(r):
    return np.array([r['homeScore']-(r['baselineTotal']+r['baselineMargin'])/2,
                     r['awayScore']-(r['baselineTotal']-r['baselineMargin'])/2])


def observation(r, teams):
    n = len(teams)
    if r['homeTeamId'] not in teams or r['awayTeamId'] not in teams:
        raise ValueError('unknown_native_team')
    h, a = teams.index(r['homeTeamId']), teams.index(r['awayTeamId'])
    matrix = np.zeros((2, n*2))
    matrix[0, h] = matrix[0, n+a] = matrix[1, a] = matrix[1, n+h] = 1
    return matrix


def arrays(rows, teams):
    ordered = sorted(rows, key=lambda r: (instant(r['startAt']), r['gameId']))
    return [(instant(r['startAt']), observation(r, teams), residual(r)) for r in ordered]


def likelihood(log_params, records, n_teams):
    """Exact marginal NLL and forward sensitivities in four log parameters."""
    scoring, prevention, noise, length = np.exp(log_params)
    if not np.isfinite([scoring, prevention, noise, length]).all() or min(scoring, prevention, noise, length) <= 0:
        raise ValueError('invalid_team_state_parameters')
    n = n_teams*2
    q = np.diag([scoring]*n_teams+[prevention]*n_teams)
    dq = np.zeros((4, n, n))
    dq[0, :n_teams, :n_teams] = np.eye(n_teams)*scoring
    dq[1, n_teams:, n_teams:] = np.eye(n_teams)*prevention
    mean, cov = np.zeros(n), q.copy()
    dm, dp = np.zeros((4, n)), dq.copy()
    previous, nll, gradient = None, 0., np.zeros(4)
    eye2 = np.eye(2)
    for time, h, y in records:
        if previous is not None:
            gap = time-previous
            if gap < 0:
                raise ValueError('nonchronological_state')
            rho = math.exp(-gap/length)
            dr = np.zeros(4)
            dr[3] = rho*gap/length
            dm = rho*dm+dr[:, None]*mean
            dp = rho*rho*dp+(2*rho*dr)[:, None, None]*(cov-q)+(1-rho*rho)*dq
            mean = rho*mean
            cov = rho*rho*cov+(1-rho*rho)*q
        v, ph = y-h@mean, cov@h.T
        s = h@ph+noise*eye2
        sign, logdet = np.linalg.slogdet(s)
        if sign <= 0:
            raise ValueError('nonpositive_innovation')
        inverse = np.linalg.solve(s, eye2)
        alpha = inverse@v
        ds = h@dp@h.T
        ds[2] += noise*eye2
        dv = -dm@h.T
        gradient += .5*(np.einsum('ij,kji->k', inverse-np.outer(alpha, alpha), ds)+2*dv@alpha)
        nll += .5*(2*math.log(2*math.pi)+logdet+v@alpha)
        gain = ph@inverse
        dg = (dp@h.T-gain@ds)@inverse
        dm += np.einsum('kij,j->ki', dg, v)+dv@gain.T
        dp -= dg@ph.T+gain@(h@dp)
        mean += gain@v
        cov -= gain@ph.T
        cov = (cov+cov.T)/2
        dp = (dp+dp.transpose(0, 2, 1))/2
        previous = time
    if not math.isfinite(nll) or not np.isfinite(gradient).all():
        raise ValueError('nonfinite_team_state_likelihood')
    return float(nll), gradient


def posterior(params, records, n_teams, target_time, target_h):
    scoring, prevention, noise, length = params
    if not np.isfinite(params).all() or min(params) <= 0:
        raise ValueError('invalid_team_state_parameters')
    q = np.diag([scoring]*n_teams+[prevention]*n_teams)
    mean, cov, previous = np.zeros(n_teams*2), q.copy(), None
    for time, h, y in records:
        if time > target_time or previous is not None and time < previous:
            raise ValueError('nonchronological_posterior')
        if previous is not None:
            rho = math.exp(-(time-previous)/length)
            mean *= rho
            cov = rho*rho*cov+(1-rho*rho)*q
        ph = cov@h.T
        gain = np.linalg.solve(h@ph+noise*np.eye(2), ph.T).T
        mean += gain@(y-h@mean)
        cov -= gain@ph.T
        cov = (cov+cov.T)/2
        previous = time
    if previous is not None:
        rho = math.exp(-(target_time-previous)/length)
        mean *= rho
        cov = rho*rho*cov+(1-rho*rho)*q
    prediction, uncertainty = target_h@mean, target_h@cov@target_h.T
    if not np.isfinite(prediction).all() or not np.isfinite(uncertainty).all() or np.linalg.eigvalsh(uncertainty).min() < -1e-8:
        raise ValueError('nonfinite_team_state_posterior')
    return prediction, uncertainty


def training_rows(source):
    train = [r for r in source['rows'] if r['season'] == 2022 and instant(r['finalAvailableAt']) < instant(source['firstSelection'])]
    if len(train) != source['trainingRows'] or len(train) < 1000 or len(train) > 10000:
        raise ValueError('training_corpus_boundary')
    for r in train:
        validate_row(r, 2022, source['trainingBaselineHash'])
    if len({r['gameId'] for r in train}) != len(train):
        raise ValueError('duplicate_training_game')
    return sorted(train, key=lambda r: (instant(r['startAt']), r['gameId']))


def fit(source):
    train = training_rows(source)
    teams = sorted({r[k] for r in train for k in ['homeTeamId', 'awayTeamId']})
    if not 2 <= len(teams) <= 32:
        raise ValueError('team_budget')
    records = arrays(train, teams)
    noise = float(np.var(np.concatenate([residual(r) for r in train]), ddof=1))
    by_team = {t: [] for t in teams}
    by_time = {t: [] for t in teams}
    for r in train:
        for t, y in zip([r['homeTeamId'], r['awayTeamId']], residual(r)):
            by_team[t].append(y)
            by_time[t].append(instant(r['startAt']))
    signal = max(float(np.mean([np.mean(v)**2-noise/len(v) for v in by_team.values()]))/2, np.finfo(float).eps)
    length = float(np.median([b-a for values in by_time.values() for a, b in zip(values, values[1:]) if b > a]))
    initial = [signal, signal, noise, length]
    result = minimize(likelihood, np.log(initial), args=(records, len(teams)), method='L-BFGS-B', jac=True,
                      options={'maxiter': 200, 'ftol': 1e-10, 'gtol': 1e-6})
    params = np.exp(result.x)
    if not result.success or not np.isfinite(params).all() or min(params) <= 0:
        raise ValueError('fit_held:'+str(result.message))
    return {'release': RELEASE, 'sourceRecipe': SOURCE, 'baselineRecipe': BASELINE,
            'trainingSeason': 2022, 'trainingEnd': max(train, key=lambda r: instant(r['finalAvailableAt']))['finalAvailableAt'],
            'trainingRows': len(train), 'trainingHash': digest(train), 'trainingBaselineHash': source['trainingBaselineHash'],
            'teams': teams, 'parameters': dict(zip(PARAMETERS, map(float, params))),
            'fit': {'success': bool(result.success), 'message': str(result.message), 'iterations': int(result.nit),
                    'evaluations': int(result.nfev), 'nll': float(result.fun), 'logGradient': result.jac.tolist(), 'initial': initial}}


def forecast(head, target, observations):
    if (head['release'] != RELEASE or head['sourceRecipe'] != SOURCE or head['baselineRecipe'] != BASELINE or
            instant(head['trainingEnd']) >= instant(target['cutoff']) or target['season'] <= head['trainingSeason'] or
            len(observations) > 10000 or not 2 <= len(head['teams']) <= 32 or
            head['teams'] != sorted(set(head['teams'])) or
            any(type(t) is not int or t <= 0 for t in head['teams']) or
            type(target['season']) is not int):
        raise ValueError('incompatible_team_state_forecast')
    # Never inspect target outcome fields. A caller can supply a target without them.
    if (target['sourceRecipe'] != SOURCE or target['baselineRecipe'] != BASELINE or
            instant(target['baselineTrainingEnd']) >= instant(target['cutoff']) or
            abs(instant(target['startAt'])-instant(target['cutoff'])-1/24) > 1e-9 or
            not re.fullmatch(r'\d{10}', target['gameId']) or
            not re.fullmatch('[a-f0-9]{64}', target['baselineHash'])):
        raise ValueError('invalid_team_state_target')
    h = observation(target, head['teams'])
    admitted = {}
    for r in observations:
        if r['gameId'] == target['gameId'] or r['season'] != target['season']:
            continue
        if instant(r['startAt']) >= instant(target['startAt']) or instant(r['finalAvailableAt']) > instant(target['cutoff']):
            continue
        validate_row(r, target['season'], target['baselineHash'])
        if r['gameId'] in admitted and admitted[r['gameId']] != r:
            raise ValueError('conflicting_team_state_receipt')
        admitted[r['gameId']] = r
    rows = sorted(admitted.values(), key=lambda r: (instant(r['startAt']), r['gameId']))
    params = [head['parameters'][k] for k in PARAMETERS]
    correction, uncertainty = posterior(params, arrays(rows, head['teams']), len(head['teams']), instant(target['startAt']), h)
    total = target['baselineTotal']+float(correction.sum())
    margin = target['baselineMargin']+float(correction[0]-correction[1])
    if not math.isfinite(total) or not math.isfinite(margin) or total <= abs(margin):
        raise ValueError('invalid_team_state_forecast_score')
    return {'margin': margin, 'total': total, 'homeScore': (total+margin)/2, 'awayScore': (total-margin)/2,
            'homeCorrection': float(correction[0]), 'awayCorrection': float(correction[1]),
            'stateScoreCovariance': uncertainty.tolist(), 'observationsUsed': len(rows), 'sourceHash': digest(rows)}


def write_new(destination, value):
    with open(destination, 'x') as handle:
        json.dump(value, handle, sort_keys=True, indent=2, allow_nan=False)


def freeze(source_path, output):
    raw = open(source_path, 'rb').read()
    source = json.loads(gzip.decompress(raw))
    before = digest(source)
    head = fit(source)
    if digest(source) != before:
        raise ValueError('fit_mutated_source')
    artifact = {'frozenAt': datetime.now(ZoneInfo('UTC')).isoformat(), 'inputSha256': hashlib.sha256(raw).hexdigest(),
                'head': head, 'headHash': digest(head), 'productionWrites': 0, 'providerRequests': 0,
                'developmentReadByFit': False, 'fittingPerformed': True}
    write_new(output, artifact)
    print(json.dumps(artifact, sort_keys=True))


def metrics(rows):
    a = np.array([[r['actualMargin'], r['actualTotal'], r['baselineMargin'], r['baselineTotal'], r['candidateMargin'], r['candidateTotal']] for r in rows])
    loss_a = np.maximum(np.abs(a[:, 2]-a[:, 0]), np.abs(a[:, 3]-a[:, 1]))/2
    loss_c = np.maximum(np.abs(a[:, 4]-a[:, 0]), np.abs(a[:, 5]-a[:, 1]))/2
    return {'games': len(rows), 'teamMAE_A': float(loss_a.mean()), 'teamMAE_C': float(loss_c.mean()),
            'teamMAE_gain': float((loss_a-loss_c).mean()),
            'marginMAE_A': float(np.abs(a[:, 2]-a[:, 0]).mean()), 'marginMAE_C': float(np.abs(a[:, 4]-a[:, 0]).mean()),
            'totalMAE_A': float(np.abs(a[:, 3]-a[:, 1]).mean()), 'totalMAE_C': float(np.abs(a[:, 5]-a[:, 1]).mean()),
            'marginBias_A': float((a[:, 2]-a[:, 0]).mean()), 'marginBias_C': float((a[:, 4]-a[:, 0]).mean()),
            'totalBias_A': float((a[:, 3]-a[:, 1]).mean()), 'totalBias_C': float((a[:, 5]-a[:, 1]).mean()),
            'winnerCorrect_A': int(((a[:, 2] > 0) == (a[:, 0] > 0)).sum()),
            'winnerCorrect_C': int(((a[:, 4] > 0) == (a[:, 0] > 0)).sum())}


def evaluate(source_path, frozen_path, destination):
    raw = open(source_path, 'rb').read()
    source = json.loads(gzip.decompress(raw))
    frozen = json.load(open(frozen_path))
    if frozen['inputSha256'] != hashlib.sha256(raw).hexdigest() or frozen['headHash'] != digest(frozen['head']):
        raise ValueError('changed_frozen_head_or_input')
    originals = source['rows']
    if len(originals) > 10000 or len({r['gameId'] for r in originals}) != len(originals):
        raise ValueError('invalid_evaluation_scope')
    before, evaluated = digest(originals), []
    for season in [2023, 2024, 2025]:
        cohort = [r for r in originals if r['season'] == season]
        for r in sorted(cohort, key=lambda r: (instant(r['cutoff']), r['gameId'])):
            validate_row(r, season, source['evaluationBaselineHash'])
            result = forecast(frozen['head'], r, cohort)
            evaluated.append({'gameId': r['gameId'], 'season': season, 'startAt': r['startAt'], 'cutoff': r['cutoff'],
                              'sourceSha256': r['sourceSha256'], 'actualMargin': r['homeScore']-r['awayScore'],
                              'actualTotal': r['homeScore']+r['awayScore'], 'baselineMargin': r['baselineMargin'],
                              'baselineTotal': r['baselineTotal'], 'candidateMargin': result['margin'],
                              'candidateTotal': result['total'], **{k: v for k, v in result.items() if k not in ['margin', 'total', 'homeScore', 'awayScore']}})
        print(json.dumps({'completedSeason': season, 'games': len(cohort)}), flush=True)
    development = metrics([r for r in evaluated if r['season'] != 2025])
    replication = metrics([r for r in evaluated if r['season'] == 2025])
    weeks = {}
    for r in evaluated:
        dt = datetime.fromisoformat(r['startAt'].replace('Z', '+00:00')).astimezone(ZoneInfo('America/New_York')).date()
        key = (r['season'], dt.toordinal()-dt.weekday())
        weeks.setdefault(key, []).append(r)
    week_metrics = [{'season': k[0], 'mondayOrdinal': k[1], **metrics(v)} for k, v in sorted(weeks.items())]
    dev_weeks = [w for w in week_metrics if w['season'] != 2025]
    seed, samples = 20261123, []
    for _ in range(1000):
        gain, count = 0., 0
        for _ in dev_weeks:
            seed = (1664525*seed+1013904223) & 0xffffffff
            w = dev_weeks[int(seed/4294967296*len(dev_weeks))]
            gain += w['teamMAE_gain']*w['games']
            count += w['games']
        samples.append(gain/count)
    ci = [sorted(samples)[24], sorted(samples)[974]]
    no_regression = lambda m: m['marginMAE_C'] <= m['marginMAE_A'] and m['totalMAE_C'] <= m['totalMAE_A']
    passed_dev = development['teamMAE_gain'] >= .10 and ci[0] > 0 and no_regression(development)
    passed_rep = replication['teamMAE_gain'] > 0 and no_regression(replication)
    if digest(originals) != before:
        raise ValueError('evaluation_mutated_originals')
    report = {'release': RELEASE, 'frozenAt': frozen['frozenAt'], 'headHash': frozen['headHash'], 'inputSha256': frozen['inputSha256'],
              'labels': {'development': 'reopened_2023_2024', 'replication': 'opened_2025', 'untouchedHoldout': False,
                         'comparator': 'earlier_fit_native_A2_not_current_incumbent', 'pointForecastsOnly': True},
              'development': development, 'replication': replication,
              'bySeason': {str(s): metrics([r for r in evaluated if r['season'] == s]) for s in [2023, 2024, 2025]},
              'weekBlockBootstrap': {'draws': 1000, 'seed': 20261123, 'calendar': 'Eastern_Monday_slate_week', 'teamMAEGain95CI': ci},
              'developmentGatePassed': passed_dev, 'replicationGatePassed': passed_rep,
              'mayAdvanceToNextValidationStage': passed_dev and passed_rep, 'productionPromotionEligible': False,
              'originalRowsHashBefore': before, 'originalRowsHashAfter': digest(originals),
              'sourceRefusalsWithinVerifiedCorpus': 0, 'verifiedSourceRows': len(originals),
              'productionWrites': 0, 'providerRequests': 0, 'fittingPerformed': False,
              'weeks': week_metrics, 'evaluations': evaluated}
    payload = gzip.compress(json.dumps(report, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())
    with open(destination, 'xb') as handle:
        handle.write(payload)
    summary = {k: v for k, v in report.items() if k not in ['weeks', 'evaluations']}
    write_new(destination+'.summary.json', summary)
    print(json.dumps(summary, sort_keys=True))


if __name__ == '__main__':
    command, *arguments = sys.argv[1:]
    if command == 'freeze' and len(arguments) == 2:
        freeze(*arguments)
    elif command == 'evaluate' and len(arguments) == 3:
        evaluate(*arguments)
    else:
        raise SystemExit('usage: team_score_state.py freeze INPUT NEW_HEAD | evaluate INPUT HEAD NEW_REPORT.gz')

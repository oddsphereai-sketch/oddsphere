"""Offline fixed C3 fit. No provider/database/site imports or outcome tuning."""
import gzip
import hashlib
import json
import math
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
import numpy as np
from scipy.linalg import cho_factor, cho_solve
from scipy.optimize import minimize

RELEASE = 'nba_prior_finals_calibration_2026_11_24_r1_exponential'

def day(start):
    return datetime.fromisoformat(start.replace('Z', '+00:00')).astimezone(ZoneInfo('America/New_York')).date().toordinal()

def grouped(rows, channel):
    days = {}
    for r in rows:
        value = (r['homeScore'] - r['awayScore'] - r['baselineMargin']) if channel == 'margin' else (r['homeScore'] + r['awayScore'] - r['baselineTotal'])
        days.setdefault(day(r['startAt']), []).append(value)
    x = np.array(sorted(days), dtype=float)
    n = np.array([len(days[d]) for d in x], dtype=float)
    m = np.array([np.mean(days[d]) for d in x])
    sse = np.array([np.sum((np.array(days[d]) - mu)**2) for d, mu in zip(x, m)])
    return x, n, m, sse

def likelihood(log_params, x, n, m, sse):
    """Exact individual-game likelihood using sufficient daily statistics."""
    signal, noise, length = np.exp(log_params)
    distance = np.abs(x[:, None] - x[None, :])
    kernel = signal * np.exp(-distance / length)
    covariance = kernel + np.diag(noise / n)
    factor = cho_factor(covariance, lower=True, check_finite=True)
    alpha = cho_solve(factor, m)
    precision = cho_solve(factor, np.eye(len(x)))
    contrast_df = np.sum(n) - len(x)
    contrasts = np.sum(sse) / noise
    nll = .5 * (np.sum(n) * math.log(2 * math.pi) + 2 * np.log(np.diag(factor[0])).sum() + np.log(n).sum() + contrast_df * math.log(noise) + m @ alpha + contrasts)
    derivative = precision - np.outer(alpha, alpha)
    grad = .5 * np.array([np.sum(derivative * kernel), np.sum(np.diag(derivative) * noise / n) + contrast_df - contrasts, np.sum(derivative * kernel * distance / length)])
    if not math.isfinite(nll) or not np.isfinite(grad).all():
        raise ValueError('nonfinite_climate_likelihood')
    return float(nll), grad

def posterior(params, x, n, m, target):
    signal, noise, length = params
    mean, variance, previous = 0., signal, None
    for d, count, value in zip(x, n, m):
        if previous is not None:
            rho = math.exp(-(d - previous) / length)
            mean *= rho
            variance = rho*rho*variance + (1-rho*rho)*signal
        gain = variance / (variance + noise/count)
        mean += gain * (value - mean)
        variance *= 1-gain
        previous = d
    if previous is not None:
        if target < previous:
            raise ValueError('target_before_source')
        rho = math.exp(-(target - previous) / length)
        mean *= rho
        variance = rho*rho*variance + (1-rho*rho)*signal
    return mean, variance

def fit(rows, channel):
    x, n, m, sse = grouped(rows, channel)
    if len(x) < 2 or len(x) > 256 or np.sum(n) <= len(x):
        raise ValueError('invalid_training_groups')
    floor = np.finfo(float).eps
    noise = max(float(np.sum(sse) / (np.sum(n) - len(x))), floor)
    signal = max(float(np.mean(m*m) - noise*np.mean(1/n)), floor)
    length = float(np.median(np.diff(x)))
    initial = np.log([signal, noise, length])
    result = minimize(likelihood, initial, args=(x, n, m, sse), method='L-BFGS-B', jac=True, options={'maxiter': 200, 'ftol': 1e-10, 'gtol': 1e-6})
    params = np.exp(result.x)
    if not result.success or not np.isfinite(params).all() or not (params > 0).all():
        raise ValueError('fit_held:' + str(result.message))
    return {'signalVariance': float(params[0]), 'noiseVariance': float(params[1]), 'lengthDays': float(params[2])}, {'success': bool(result.success), 'message': str(result.message), 'iterations': int(result.nit), 'evaluations': int(result.nfev), 'nll': float(result.fun), 'logGradient': result.jac.tolist(), 'initialParameters': [signal, noise, length], 'trainingDays': len(x), 'trainingRows': int(np.sum(n))}

def main():
    source, destination = sys.argv[1:]
    raw = open(source, 'rb').read()
    data = json.loads(gzip.decompress(raw))
    train = [r for r in data['rows'] if r['season'] == 2022 and r['finalAvailableAt'] < data['firstSelection']]
    if len(train) != data['trainingRows'] or len(train) < 1000 or any(r['baselineHash'] != data['trainingBaselineHash'] for r in train):
        raise ValueError('training_source_contract_failed')
    # No evaluation-season residual is read by either fit.
    margin, margin_fit = fit(train, 'margin')
    total, total_fit = fit(train, 'total')
    out = {'release': RELEASE, 'sourceRecipe': data['sourceRecipe'], 'baselineRecipe': data['baselineRecipe'], 'clockMode': 'verified_original_publication_only', 'trainingSeason': 2022, 'trainingEnd': data['trainingEnd'], 'trainingHash': data['trainingHash'], 'trainingBaselineHash': data['trainingBaselineHash'], 'inputSha256': hashlib.sha256(raw).hexdigest(), 'margin': margin, 'total': total, 'fit': {'margin': margin_fit, 'total': total_fit}, 'productionWrites': 0, 'providerRequests': 0}
    with open(destination, 'x') as handle:
        json.dump(out, handle, sort_keys=True, indent=2, allow_nan=False)
    print(json.dumps(out, sort_keys=True))

if __name__ == '__main__':
    main()

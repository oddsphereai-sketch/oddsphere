"""C6 old-training-only zero-intercept Gaussian impact fit. No live imports."""
import gzip
import hashlib
import json
import math
import sys

import numpy as np
from scipy.optimize import minimize

RELEASE = 'nba_scaled_player_impact_2026_11_26_r1_training_only_gaussian'


def scale_matrix(x):
    x = np.asarray(x, dtype=float)
    if x.ndim != 2 or x.shape[1] != 6 or not np.isfinite(x).all():
        raise ValueError('invalid_player_design')
    scale = np.sqrt(np.mean(x*x, axis=0))
    scale[scale == 0] = 1.
    return x/scale, scale


def spectrum(x, y):
    # No centering or intercept removal: no player shock must mean zero impact.
    u, singular, vt = np.linalg.svd(x, full_matrices=False)
    keep = singular > np.finfo(float).eps*max(x.shape)*singular[0]
    eigen, z = singular[keep]**2, u[:, keep].T@y
    orthogonal = float(y@y-z@z)
    if orthogonal < -1e-8*max(1., float(y@y)):
        raise ValueError('invalid_player_orthogonal_target')
    return eigen, z, max(0., orthogonal), len(y)-len(eigen), u, singular, vt


def likelihood(log_params, eigen, z, orthogonal, residual_df):
    weight, noise = np.exp(log_params)
    v = noise+weight*eigen
    nll = .5*((len(eigen)+residual_df)*math.log(2*math.pi)+np.log(v).sum()+residual_df*math.log(noise)+(z*z/v).sum()+orthogonal/noise)
    derivative = 1/v-z*z/(v*v)
    gradient = .5*np.array([(derivative*weight*eigen).sum(), (derivative*noise).sum()+residual_df-orthogonal/noise])
    if not math.isfinite(nll) or not np.isfinite(gradient).all():
        raise ValueError('nonfinite_player_likelihood')
    return float(nll), gradient


def fit(x, y):
    eigen, z, orthogonal, df, u, singular, vt = spectrum(x, y)
    noise = float(np.mean(y*y))
    if not math.isfinite(noise) or noise <= 0 or df < 0:
        raise ValueError('invalid_player_training_variance')
    result = minimize(likelihood, np.log([noise/1000, noise]), args=(eigen, z, orthogonal, df),
                      method='L-BFGS-B', jac=True, options={'maxiter': 200, 'ftol': 1e-10, 'gtol': 1e-6})
    weight, noise = np.exp(result.x)
    if not result.success or not np.isfinite([weight, noise]).all() or min(weight, noise) <= 0:
        raise ValueError('player_fit_held:'+str(result.message))
    alpha = noise/weight
    coefficients = vt.T@((singular/(singular*singular+alpha))*(u.T@y))
    if not np.isfinite(coefficients).all():
        raise ValueError('nonfinite_player_coefficients')
    return {'weightVariance': float(weight), 'noiseVariance': float(noise), 'alpha': float(alpha),
            'coefficients': coefficients.tolist()}, {'success': bool(result.success), 'message': str(result.message),
            'iterations': int(result.nit), 'evaluations': int(result.nfev), 'nll': float(result.fun),
            'logGradient': result.jac.tolist(), 'initialWeightVariance': float(np.mean(y*y)/1000),
            'initialNoiseVariance': float(np.mean(y*y)), 'numericalRank': len(eigen)}


def training_rows(data):
    rows = [r for r in data['rows'] if r['season'] == 2022 and r['finalAvailableAt'] < data['firstEvaluation']]
    rows.sort(key=lambda r: r['gameId'])
    if len(rows) != data['trainingRows'] or not 10 < len(rows) <= 10000 or len({r['gameId'] for r in rows}) != len(rows):
        raise ValueError('player_training_scope')
    if any(r['baselineHash'] != data['trainingBaselineHash'] or r['sourceSchemaHash'] != data['sourceSchemaHash'] for r in rows):
        raise ValueError('foreign_player_training_source')
    return rows


def main():
    source, destination = sys.argv[1:]
    raw = open(source, 'rb').read()
    data = json.loads(gzip.decompress(raw))
    rows = training_rows(data)
    x, scales = scale_matrix([r['features'] for r in rows])
    m = np.array([r['actualMargin']-r['baselineMargin'] for r in rows])
    t = np.array([r['actualTotal']-r['baselineTotal'] for r in rows])
    margin, margin_fit = fit(x, m)
    total, total_fit = fit(x, t)
    for p in [margin, total]:
        p['rawCoefficients'] = (np.array(p['coefficients'])/scales).tolist()
        p['intercept'] = 0
    result = {'release': RELEASE, 'inputSha256': hashlib.sha256(raw).hexdigest(), 'trainingHash': data['trainingHash'],
              'trainingEnd': data['trainingEnd'], 'trainingRows': len(rows), 'sourceSchemaHash': data['sourceSchemaHash'],
              'ledgerHash': data['ledgerHash'], 'trainingBaselineHash': data['trainingBaselineHash'],
              'featureScales': scales.tolist(), 'scaleRule': 'training_rms_no_centering',
              'margin': margin, 'total': total, 'fit': {'margin': margin_fit, 'total': total_fit},
              'productionWrites': 0, 'providerRequests': 0, 'developmentReadByFit': False}
    with open(destination, 'x') as handle:
        json.dump(result, handle, sort_keys=True, indent=2, allow_nan=False)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()

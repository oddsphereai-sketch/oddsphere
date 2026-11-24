"""C4 isotropic Gaussian linear fit, restricted likelihood, no live imports."""
import gzip
import hashlib
import json
import math
import sys
import numpy as np
from scipy.optimize import minimize

RELEASE = 'nba_learned_shrinkage_2026_11_24_r1_training_only'

def design_matrix(rows, design):
    raw = np.array([[np.nan if r['features'].get(f) is None else r['features'][f] for f in design['features']] for r in rows], dtype=float)
    missing = ~np.isfinite(raw)
    filled = np.where(missing, np.array(design['rawFeatureMedians']), raw)
    indicators = [design['features'].index(f) for f in design['missingIndicatorColumns']]
    if indicators:
        filled = np.column_stack([filled, missing[:, indicators].astype(float)])
    x = (filled - np.array(design['designMeans'])) / np.array(design['designStandardDeviations'])
    if x.shape[1] != design['designColumns'] or not np.isfinite(x).all():
        raise ValueError('invalid_design')
    return x

def spectrum(x, y):
    x = x - x.mean(axis=0)
    centered = y-y.mean()
    u, singular, vt = np.linalg.svd(x, full_matrices=False)
    keep = singular > np.finfo(float).eps*max(x.shape)*singular[0]
    eigen = singular[keep]**2
    z = u[:, keep].T @ centered
    orthogonal_ss = float(centered@centered - z@z)
    if orthogonal_ss < -1e-8*max(1.,float(centered@centered)):
        raise ValueError('invalid_orthogonal_target')
    return eigen, z, max(0.,orthogonal_ss), len(y)-1-len(eigen), singular, vt, u

def likelihood(log_params, eigen, z, orthogonal_ss, residual_df):
    weight, noise = np.exp(log_params)
    variance = noise+weight*eigen
    nll = .5*((len(eigen)+residual_df)*math.log(2*math.pi)+np.log(variance).sum()+residual_df*math.log(noise)+(z*z/variance).sum()+orthogonal_ss/noise)
    d = (1/variance-z*z/(variance*variance))
    gradient = .5*np.array([np.sum(d*weight*eigen),np.sum(d*noise)+residual_df-orthogonal_ss/noise])
    if not math.isfinite(nll) or not np.isfinite(gradient).all():
        raise ValueError('nonfinite_likelihood')
    return float(nll),gradient

def fit(x, y):
    eigen,z,orthogonal_ss,residual_df,singular,vt,u = spectrum(x,y)
    noise = float(np.var(y,ddof=1))
    if noise <= 0 or residual_df < 0:
        raise ValueError('invalid_training_variance')
    initial = np.log([noise/1000,noise])
    result = minimize(likelihood,initial,args=(eigen,z,orthogonal_ss,residual_df),method='L-BFGS-B',jac=True,options={'maxiter':200,'ftol':1e-10,'gtol':1e-6})
    params = np.exp(result.x)
    if not result.success or not np.isfinite(params).all() or not (params>0).all():
        raise ValueError('fit_held:'+str(result.message))
    weight,noise = params
    alpha = noise/weight
    # Includes all numerical singular components in the posterior ridge solve.
    coefficients = vt.T @ ((singular/(singular*singular+alpha))*(u.T@(y-y.mean())))
    intercept = float(y.mean()-x.mean(axis=0)@coefficients)
    return {'weightVariance':float(weight),'noiseVariance':float(noise),'alpha':float(alpha),'coefficients':coefficients.tolist()+[intercept]}, {'success':bool(result.success),'message':str(result.message),'iterations':int(result.nit),'evaluations':int(result.nfev),'nll':float(result.fun),'logGradient':result.jac.tolist(),'numericalRank':len(eigen),'initialWeightVariance':float(np.exp(initial[0])),'initialNoiseVariance':float(np.exp(initial[1]))}

def training_rows(rows, first_evaluation):
    return [r for r in rows if r['season'] in (2021,2022) and r['finalAvailableAt'] < first_evaluation]

def main():
    source,destination = sys.argv[1:]
    raw=open(source,'rb').read()
    data=json.loads(gzip.decompress(raw))
    rows=training_rows(data['rows'],data['firstEvaluation'])
    if len(rows)!=2457 or len(rows)!=data['trainingRows'] or data['baseline']['trainingHash']!=data['trainingHash']:
        raise ValueError('training_source_mismatch')
    design=data['baseline']['artifact']['design']
    x=design_matrix(rows,design)
    targets={'margin':np.array([r['actualMargin'] for r in rows]),'total':np.array([r['actualTotal'] for r in rows])}
    # Prove identical fixed-alpha design/solve before changing the penalty.
    parity={}
    for channel,y in targets.items():
        beta=np.linalg.solve(x.T@x+1000*np.eye(x.shape[1]),x.T@(y-y.mean()))
        reference=np.array(data['baseline']['artifact']['coefficients']['target_home_margin' if channel=='margin' else 'target_total'])
        difference=float(np.max(np.abs(np.r_[beta,y.mean()-x.mean(axis=0)@beta]-reference)))
        if difference>1e-9:
            raise ValueError('fixed_baseline_coefficient_parity_failed')
        parity[channel]=difference
    margin,margin_fit=fit(x,targets['margin'])
    total,total_fit=fit(x,targets['total'])
    out={'release':RELEASE,'sourceRecipe':data['sourceRecipe'],'inputSha256':hashlib.sha256(raw).hexdigest(),'trainingHash':data['trainingHash'],'baselineHash':data['baseline']['hash'],'trainingEnd':data['baseline']['trainingEnd'],'trainingRows':len(rows),'design':design,'margin':margin,'total':total,'fit':{'margin':margin_fit,'total':total_fit},'fixed1000CoefficientMaxDifference':parity,'productionWrites':0,'providerRequests':0}
    with open(destination,'x') as f:json.dump(out,f,sort_keys=True,indent=2,allow_nan=False)
    print(json.dumps({k:v for k,v in out.items() if k not in ('design','margin','total')},sort_keys=True))

if __name__=='__main__':
    main()

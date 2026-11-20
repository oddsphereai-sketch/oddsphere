#!/usr/bin/env python3
"""Preserved fixed experiment, not an authorization to refit after confirmation. Requires NumPy."""
import argparse,json,gzip,pathlib,math,statistics,hashlib
import numpy as np
parser=argparse.ArgumentParser(description="Offline frozen NBA conditional-direction experiment; no provider or database access")
parser.add_argument('--source-dir',type=pathlib.Path,required=True,help='Private joined.json.gz and features.json.gz source directory')
parser.add_argument('--output-dir',type=pathlib.Path,required=True,help='New empty research output directory')
parser.add_argument('--declaration',type=pathlib.Path,required=True,help='Original frozen predeclaration.json')
args=parser.parse_args();S=args.source_dir;R=args.output_dir;decl=args.declaration
R.mkdir(parents=True,exist_ok=False)
ROOT=pathlib.Path(__file__).resolve().parents[3]
assert not (R/'model.json').exists(),'Frozen experiment: do not refit'
rows=json.load(gzip.open(S/'joined.json.gz'));keys=json.load(gzip.open(S/'features.json.gz'))['featureKeys'];season24=sorted([r for r in rows if r['season']==2024],key=lambda r:(r['start'],r['game']));half=len(season24)//2;train=[r for r in rows if r['season']==2023]+season24[:half];cal=season24[half:];test=sorted([r for r in rows if r['season']==2025],key=lambda r:(r['start'],r['game']))

def design(rs,c):
 return np.array([[r['native']['close'][c],r['native']['close'][c]-r['native']['open'][c],r['independent'][c]-r['native']['close'][c]]+[np.nan if r['stats'].get(k)is None else r['stats'][k]for k in keys]for r in rs],float)

def fit(rs,c):
 raw=design(rs,c);med=[]
 for j in range(raw.shape[1]):
  vals=raw[:,j][np.isfinite(raw[:,j])];med.append(float(np.median(vals))if len(vals)else 0.)
 x=np.where(np.isfinite(raw),raw,np.array(med));cuts=[np.unique(np.quantile(x[:,j],np.arange(.1,1,.1)))for j in range(x.shape[1])];y=np.array([r['actual'][c]-r['native']['close'][c]for r in rs]);pred=np.zeros(len(x));trees=[]
 def node(idx,res,depth):
  sy=float(res[idx].sum());n=len(idx);base=sy*sy/(n+10);best=(0,None,None,None)
  if depth<2 and n>=240:
   for j,cs in enumerate(cuts):
    vals=x[idx,j]
    for cut in cs:
     mask=vals<=cut;nl=int(mask.sum());nr=n-nl
     if min(nl,nr)<120:continue
     sl=float(res[idx[mask]].sum());gain=sl*sl/(nl+10)+(sy-sl)**2/(nr+10)-base
     if gain>best[0]+1e-12:best=(gain,j,float(cut),mask)
  if best[1]is None:return {'value':sy/(n+10),'n':n}
  _,j,cut,mask=best;return {'feature':j,'threshold':cut,'left':node(idx[mask],res,depth+1),'right':node(idx[~mask],res,depth+1),'n':n}
 for it in range(40):
  tree=node(np.arange(len(x)),y-pred,0);trees.append(tree);pred+=.05*treepredict(tree,x)
 return {'featureOrder':['native_current','economic_move','independent_minus_native']+keys,'missingMedians':med,'trees':trees,'learningRate':.05,'minimumLeafRows':120,'leafRidgePenalty':10,'trainingRows':len(rs)}

def treepredict(t,x):
 if 'value'in t:return np.full(len(x),t['value'])
 mask=x[:,t['feature']]<=t['threshold'];r=np.empty(len(x));r[mask]=treepredict(t['left'],x[mask]);r[~mask]=treepredict(t['right'],x[~mask]);return r

def rawpredict(h,rs,c):
 raw=design(rs,c);x=np.where(np.isfinite(raw),raw,np.array(h['missingMedians']));p=np.array([r['native']['close'][c]for r in rs]);
 for t in h['trees']:p+=h['learningRate']*treepredict(t,x)
 return p

models={c:fit(train,c)for c in ['margin','total']}
for c,h in models.items():
 p=rawpredict(h,cal,c);err=np.array([r['actual'][c]for r in cal])-p;bias=float(err.mean());h['calibrationBias']=bias;h['residuals']=sorted((err-bias).tolist());h['calibrationRows']=len(cal)
artifact={'release':json.loads(decl.read_text())['release'],'declarationSha256':hashlib.sha256(decl.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256((S/'joined.json.gz').read_bytes()).hexdigest(),'status':'shadow_only','models':models};(R/'model.json').write_text(json.dumps(artifact,indent=2)+'\n')
LAW=json.load(open(ROOT/'lib/automodel/nba/modelArtifacts/nbaProfessionalR15.json'))['distribution'];N=statistics.NormalDist()
def baseprob(mu,t,c):
 if c=='total':return N.cdf((mu-t)/LAW['totalSigma'])
 m=LAW['marginCalibration'];s=LAW['marginSigma'];return(1-m['tailWeight'])*N.cdf((mu-t)/(s*m['coreSigmaMultiplier']))+m['tailWeight']*N.cdf((mu-t)/(s*m['tailSigmaMultiplier']))
def innovation(i,a,cur,c):
 gap=i-a;move=cur-a;new=move if gap==0 or np.sign(gap)!=np.sign(move)else np.sign(move)*max(0,abs(move)-abs(gap));return i+new*(1.813 if c=='margin'else 1)
def evaluate(rs):
 detail=[];summary={}
 for c in ['margin','total']:
  h=models[c];mu=rawpredict(h,rs,c)+h['calibrationBias'];res=np.array(h['residuals']);values=[]
  for r,pred in zip(rs,mu):
   t=-r['native']['close']['spreadHome']if c=='margin'else r['native']['close']['totalLine'];actual=r['actual'][c];ind=r['independent'][c];proxy=innovation(ind,r['native']['open'][c],r['native']['close'][c],c);candidatep=(1+np.sum(res>t-pred)+.5*np.sum(res==t-pred))/(len(res)+2);pricekey='homeSpread'if c=='margin'and candidatep>=.5 else'awaySpread'if c=='margin'else'over'if candidatep>=.5 else'under';price=r['native']['close']['prices'][pricekey];decimal=1+(100/-price if price<0 else price/100);pickp=max(candidatep,1-candidatep)
   values.append({'game':r['game'],'start':r['start'],'actual':actual,'threshold':t,'price':price,'screen':bool(pickp>=.55 and pickp*decimal>1),'prediction':float(pred),'probability':float(candidatep),'proxy':proxy,'proxyProbability':baseprob(proxy,t,c),'independent':ind,'independentProbability':baseprob(ind,t,c),'native':r['native']['close'][c],'nativeProbability':baseprob(r['native']['close'][c],t,c)})
  settled=[v for v in values if v['actual']!=v['threshold']];truth=np.array([v['actual']>v['threshold']for v in settled]);metrics={}
  for label,pk,mk in [('candidate','probability','prediction'),('incumbentProxy','proxyProbability','proxy'),('independent','independentProbability','independent'),('native','nativeProbability','native')]:
   p=np.array([v[pk]for v in settled]);win=(p>=.5)==truth;metrics[label]={'wins':int(win.sum()),'losses':int((~win).sum()),'pushes':len(values)-len(settled),'mae':float(np.mean([abs(v[mk]-v['actual'])for v in values])),'brier':float(np.mean((p-truth)**2)),'logLoss':float(np.mean(-np.log(np.clip(np.where(truth,p,1-p),1e-12,1)))),'calibrationGap':float(p.mean()-truth.mean())}
  delta=(np.array([v['probability']for v in settled])-truth)**2-(np.array([v['proxyProbability']for v in settled])-truth)**2;rng=np.random.default_rng(20261120);boot=rng.choice(delta,(2000,len(delta)),replace=True).mean(1);metrics['candidate']['brierDeltaVsProxy95']=np.quantile(boot,[.025,.975]).tolist();screen=[v for v in settled if v['screen']];wins=sum((v['probability']>=.5)==(v['actual']>v['threshold'])for v in screen);metrics['candidate']['confidencePriceScreen']={'n':len(screen),'wins':int(wins),'losses':int(len(screen)-wins),'units':sum((100/-v['price']if v['price']<0 else v['price']/100)if (v['probability']>=.5)==(v['actual']>v['threshold'])else-1 for v in screen),'note':'Reconstructed close-source diagnostic; not locked T-60 grades.'};summary[c]=metrics;detail.append({'coordinate':c,'rows':values})
 return summary,detail
out={'release':artifact['release'],'partitions':{'training':len(train),'calibration':len(cal),'confirmation':len(test)},'status':'research_not_production_authorized','limitations':['Confirmation previously opened in predecessor research; not globally untouched.','Retail prematch closing quotes are not historical T-60 sharp quotes.','No candidate or threshold selection after reading confirmation.']};details={}
for label,rs in [('training',train),('calibration',cal),('confirmation',test)]:out[label],details[label]=evaluate(rs)
(R/'results.json').write_text(json.dumps(out,indent=2)+'\n');(R/'predictions.json.gz').write_bytes(gzip.compress(json.dumps(details).encode()));print(json.dumps({'partitions':out['partitions'],'confirmation':out['confirmation']},indent=2))

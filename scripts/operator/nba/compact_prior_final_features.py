"""Offline streaming subset: retains every needed original value, no fitting/network."""
import gzip,hashlib,json,os,sys
import ijson

def sha(path):
 h=hashlib.sha256()
 with open(path,'rb')as f:
  for b in iter(lambda:f.read(65536),b''):h.update(b)
 return h.hexdigest()

def main():
 features,baseline,destination=sys.argv[1:]
 if os.path.exists(destination):raise ValueError('destination_exists')
 with gzip.open(baseline,'rt')as f:b=json.load(f)
 names=set(b['baselineA1']['artifact']['design']['features'])
 if names!=set(b['baselineA2']['artifact']['design']['features']):raise ValueError('different_feature_recipe')
 names.update(['game_id','season','feature_cutoff','target_home_score','target_away_score','target_home_margin','target_total'])
 finals={}
 with gzip.open(features,'rb')as f:
  for r in ijson.items(f,'finals.item',use_float=True):
   if r['gameId']in finals or len(finals)>=10000:raise ValueError('final_identity_or_budget')
   finals[r['gameId']]=r
 count=0;seen=set()
 with open(destination,'xb')as raw:
  os.chmod(destination,0o600)
  with gzip.GzipFile(fileobj=raw,mode='wb',mtime=0)as out:
   def emit(v):out.write((json.dumps(v,separators=(',',':'),allow_nan=False)+'\n').encode())
   emit({'contract':'nba_prior_feature_subset_jsonl_r1','originalFeaturesSha256':sha(features),'baselineReportSha256':sha(baseline),'selectedFeatures':sorted(names)})
   with gzip.open(features,'rb')as f:
    for row in ijson.items(f,'features.item',use_float=True):
     if not 2022<=row['season']<=2025:continue
     if row['game_id']in seen or count>=10000 or row['game_id']not in finals:raise ValueError('feature_identity_or_budget')
     selected={k:row[k]for k in names if k in row};selected['originalFinal']=finals[row['game_id']]
     emit(selected);seen.add(row['game_id']);count+=1
   emit({'endCount':count})
 print(json.dumps({'rows':count,'compressedBytes':os.path.getsize(destination),'sha256':sha(destination),'providerRequests':0,'productionWrites':0,'fittingPerformed':False}))
if __name__=='__main__':main()

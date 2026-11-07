"""Read public daily NBA/NFL and official MLB calendars; no paid API or keys."""
import concurrent.futures
import csv
import datetime as dt
import json
from pathlib import Path
import urllib.request
from zoneinfo import ZoneInfo
import sys

root=Path(sys.argv[1]);root.mkdir(mode=0o700,parents=True,exist_ok=True)
cache=Path(sys.argv[2]);year=2026;et=ZoneInfo('America/New_York')

def fetch(task):
    sport,day=task;path=root/f'{sport}-{day}.json';old=cache/path.name
    if path.exists():return sport,day,json.loads(path.read_text())
    if old.exists():data=json.loads(old.read_text())
    else:
        league='basketball/nba' if sport=='nba' else 'football/nfl'
        url=f'https://site.api.espn.com/apis/site/v2/sports/{league}/scoreboard?dates={day}'
        with urllib.request.urlopen(url,timeout=45) as response:data=json.load(response)
    with path.open('x') as f:json.dump(data,f,separators=(',',':'))
    path.chmod(0o600);return sport,day,data

# ESPN publishes an explicit list of NBA game dates for each season.
dates=set()
for seed in ['20260401','20261101']:
    _,_,data=fetch(('nba',seed));league=data['leagues'][0]
    if league.get('calendarType')!='day' or not league.get('calendarIsWhitelist'):raise RuntimeError('Unknown NBA calendar contract')
    for stamp in league['calendar']:
        if stamp.startswith(str(year)):dates.add(stamp[:10].replace('-',''))
if not dates:raise RuntimeError('No published NBA game-date inventory')
tasks=[('nba',day) for day in sorted(dates)]
# nfldata has regular/postseason but no preseason. Audit every August day too.
tasks += [('nfl',f'{year}08{day:02d}') for day in range(1,32)]
rows=[];completed=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for sport,day,data in pool.map(fetch,tasks):
        events=data.get('events',[])
        if len(events)>=1000:raise RuntimeError('Possible schedule truncation')
        completed.append((sport,day,len(events)))
        for e in events:
            start=dt.datetime.fromisoformat(e['date'].replace('Z','+00:00'));date=start.astimezone(et).date().isoformat()
            if not date.startswith(str(year)):continue
            if sport=='nfl' and e.get('season',{}).get('type')!=1:continue
            rows.append(dict(sport=sport,id=e['id'],date=date,start=start.isoformat(),phase=e.get('season',{}).get('type')))
with (cache/'nfl-games.csv').open() as f:
    for game in csv.DictReader(f):
        if not game['gameday'].startswith(str(year)):continue
        start=dt.datetime.fromisoformat(game['gameday']+'T'+(game.get('gametime') or '13:00')).replace(tzinfo=et)
        rows.append(dict(sport='nfl',id=game['game_id'],date=game['gameday'],start=start.astimezone(dt.timezone.utc).isoformat(),phase=game['game_type']))
mlb=json.loads((cache/'mlb-schedule-2026.json').read_text())
for day in mlb['dates']:
    for e in day['games']:
        if e['gameType'] not in ['R','F','D','L','W','A']:continue
        start=dt.datetime.fromisoformat(e['gameDate'].replace('Z','+00:00'));date=start.astimezone(et).date().isoformat()
        rows.append(dict(sport='mlb',id=str(e['gamePk']),date=date,start=start.isoformat(),phase=e['gameType']))
unique={(r['sport'],r['id'],r['date']):r for r in rows};months=[]
for month in range(1,13):
    key=f'{year}-{month:02d}';games=[r for r in unique.values() if r['date'].startswith(key)];by_day={}
    for g in games:by_day[g['date']]=by_day.get(g['date'],0)+1
    months.append(dict(month=key,fullCalendarAvailable=True,counts={s:sum(g['sport']==s for g in games) for s in ['nba','nfl','mlb']},preseasonCounts={s:sum(g['sport']==s and g['phase']==1 for g in games) for s in ['nba','nfl']},maxGamesInDay=max(by_day.values(),default=0),games=games))
out=root/'calendar.json'
with out.open('x') as f:json.dump(dict(year=year,months=months,completedDailySources=completed,sourceCalendar='ESPN whitelist NBA + all August NFL dates, nfldata regular/postseason, official MLB Stats annual records',scope='All published NBA/NFL including preseason; MLB supported regular/postseason/all-star. ET calendar dates. Not a bound on unpublished future seasons or rescheduled games.',generationCalls=0),f,separators=(',',':'))
out.chmod(0o600)
print(json.dumps(dict(out=str(out),months=[{k:m[k] for k in ['month','counts','preseasonCounts','maxGamesInDay']} for m in months],generationCalls=0)))

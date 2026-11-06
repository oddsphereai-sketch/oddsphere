"""Build cost calendars from already-downloaded public records; no network or credentials."""
import argparse
import csv
import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo

p = argparse.ArgumentParser()
p.add_argument("--root", required=True)
p.add_argument("--out", required=True)
args = p.parse_args()
root = Path(args.root)
games = {}
nba_days = set()
for file in root.glob("nba-????????.json"):
    day = file.stem[4:]
    nba_days.add(day)
    for event in json.loads(file.read_text())["events"]:
        start = dt.datetime.fromisoformat(event["date"].replace("Z", "+00:00"))
        date = start.astimezone(ZoneInfo("America/New_York")).date().isoformat()
        key = ("nba", event["id"], date)
        games[key] = dict(sport="nba", id=event["id"], date=date, start=start.isoformat())
for file in root.glob("mlb-schedule-*.json"):
    for day in json.loads(file.read_text())["dates"]:
        for game in day["games"]:
            if game["gameType"] not in ("R", "F", "D", "L", "W", "A"):
                continue
            start = dt.datetime.fromisoformat(game["gameDate"].replace("Z", "+00:00"))
            date = start.astimezone(ZoneInfo("America/New_York")).date().isoformat()
            key = ("mlb", str(game["gamePk"]), date)
            games[key] = dict(sport="mlb", id=str(game["gamePk"]), date=date, start=start.isoformat())
with (root / "nfl-games.csv").open() as f:
    for game in csv.DictReader(f):
        if game["season"] not in ("2025", "2026"):
            continue
        date = game["gameday"]
        time = game.get("gametime") or "13:00"
        start = dt.datetime.fromisoformat(date + "T" + time).replace(tzinfo=ZoneInfo("America/New_York"))
        key = ("nfl", game["game_id"], date)
        games[key] = dict(sport="nfl", id=game["game_id"], date=date, start=start.astimezone(dt.timezone.utc).isoformat())
months = []
for month in ("2026-04", "2026-07", "2026-09", "2026-11"):
    rows = [g for g in games.values() if g["date"].startswith(month)]
    # April is a completed NBA/postseason + MLB overlap analog. July/September have no normal NBA slate.
    expected_days = 31 if month == "2026-07" else 30
    nba_complete = month in ("2026-07", "2026-09") or all(month.replace("-", "") + str(d).zfill(2) in nba_days for d in range(1, expected_days + 1))
    by_day = {}
    for g in rows:
        by_day[g["date"]] = by_day.get(g["date"], 0) + 1
    months.append(dict(month=month, fullCalendarAvailable=nba_complete, counts={sport: sum(g["sport"] == sport for g in rows) for sport in ("nba", "nfl", "mlb")}, maxGamesInDay=max(by_day.values(), default=0), games=rows))
result = dict(months=months, sources=["ESPN daily NBA scoreboard", "nflverse/nfldata games.csv", "MLB Stats API annual schedules"],
              exclusions=["spring training and other exhibitions", "unpublished future NBA playoff brackets"],
              limitations=["historical calendars may omit original dates of rescheduled games; retry/reschedule allowance required", "game counts are actual published workloads, not measured future AI output", "all scheduled games counted even if some lack eligible props"])
with Path(args.out).open("x") as f:
    json.dump(result, f, separators=(",", ":"))
print(json.dumps([dict(month=m["month"], counts=m["counts"], complete=m["fullCalendarAvailable"], maxGamesInDay=m["maxGamesInDay"]) for m in months]))

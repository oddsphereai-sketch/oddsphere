"""Local proxy counts only. Does not import credentials or call any API.

Usage: python3 count-tokens.py /private/tmp/props-product/manifest.json
Requires tiktoken, installed separately in an operator environment.
"""
import json
import pathlib
import sys
import tiktoken

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text())
encoding = tiktoken.get_encoding("o200k_base")
results = []
for row in manifest["packets"]:
    body = json.loads(pathlib.Path(row["payload"]).read_text())
    # Count the whole serialized request conservatively, not just the evidence body.
    tokens = len(encoding.encode(json.dumps(body, separators=(",", ":"), ensure_ascii=False)))
    results.append({**{k: row[k] for k in ("sport", "gameId", "stage")}, "model": body["model"], "maxOutputTokens": body["max_output_tokens"], "proxyInputTokens": tokens})
print(json.dumps({"encoding": "o200k_base", "modelSpecificApiCounts": False,
                  "billedOutputObserved": False, "monthlyBudgetValidated": False,
                  "requests": results}, indent=2))

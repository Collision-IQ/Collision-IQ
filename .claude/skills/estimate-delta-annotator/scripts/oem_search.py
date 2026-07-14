#!/usr/bin/env python3
"""
oem_search.py — Web search for OEM position statements / jurisdictional statute
via Serper (google.serper.dev). Used by the OEM compliance pass to find public
citations when the item isn't in the user's Google Drive OE-docs library.

Requires env var SERPER_API_KEY. Prints top results as JSON: [{title,link,snippet}].
If SERPER_API_KEY is unset, exits non-zero so the caller can fall back to the
built-in web search tool instead.

Usage:
    python oem_search.py "Mercedes-Benz aftermarket parts position statement"
    python oem_search.py "Pennsylvania aftermarket parts disclosure statute" --num 5
"""
import argparse, json, os, sys, urllib.request

def search(query, num=6):
    key = os.environ.get("SERPER_API_KEY")
    if not key:
        print("SERPER_API_KEY not set", file=sys.stderr)
        sys.exit(2)
    req = urllib.request.Request(
        "https://google.serper.dev/search",
        data=json.dumps({"q": query, "num": num}).encode(),
        headers={"X-API-KEY": key, "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    out = [{"title": o.get("title"), "link": o.get("link"),
            "snippet": o.get("snippet")} for o in data.get("organic", [])[:num]]
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--num", type=int, default=6)
    a = ap.parse_args()
    print(json.dumps(search(a.query, a.num), indent=2))

if __name__ == "__main__":
    main()

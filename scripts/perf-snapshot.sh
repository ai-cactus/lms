#!/usr/bin/env bash
# Capture a labeled performance snapshot of the platform for before/after comparison.
#
# Usage:
#   ./scripts/perf-snapshot.sh <label> [base-url]
#   ./scripts/perf-snapshot.sh baseline
#   ./scripts/perf-snapshot.sh after-tiered-cache
#   ./scripts/perf-snapshot.sh after-cache-rule https://staging-lms.theraptly.com
#
# Optional: SESSION_COOKIE='__Secure-admin.session-token=...' to also measure an
# authenticated page as a logged-in user (otherwise /dashboard measures the
# login redirect, which is still a consistent benchmark).
#
# Output: perf-results/<timestamp>-<label>.csv (gitignored) + median summary on stdout.
# Run 1 per URL is the COLD row (first request after idle); runs 2-3 are WARM.

set -euo pipefail

LABEL="${1:?usage: perf-snapshot.sh <label> [base-url]}"
BASE="${2:-https://training.theraptly.com}"
URLS=(/ /login /forgot-password /signup /partners /request-demo /dashboard /worker)
ASSET_PROBE="/_next/static/"   # resolved to a real chunk below, if possible
RUNS=3
OUTDIR="perf-results"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$OUTDIR/$STAMP-$LABEL.csv"

mkdir -p "$OUTDIR"
echo "label,url,run,state,dns_s,tcp_s,tls_s,ttfb_s,total_s,http_code,cf_cache_status,age" > "$OUT"

measure() {
  local url="$1" run="$2" state="$3"
  local hdrfile timing
  hdrfile="$(mktemp)"
  timing="$(curl -sS -o /dev/null -D "$hdrfile" \
    ${SESSION_COOKIE:+-H "Cookie: $SESSION_COOKIE"} \
    -w "%{time_namelookup},%{time_connect},%{time_appconnect},%{time_starttransfer},%{time_total},%{http_code}" \
    "$url" || echo ",,,,,000")"
  local cache age
  cache="$(grep -i '^cf-cache-status:' "$hdrfile" | tr -d '\r' | awk '{print $2}' | head -1 || true)"
  age="$(grep -i '^age:' "$hdrfile" | tr -d '\r' | awk '{print $2}' | head -1 || true)"
  rm -f "$hdrfile"
  echo "$LABEL,$url,$run,$state,$timing,${cache:-none},${age:-0}" >> "$OUT"
}

# Try to find one real static chunk URL from the homepage so asset caching is probed too.
CHUNK="$(curl -s "$BASE/" | grep -o '/_next/static/[^"]*\.js' | head -1 || true)"

for path in "${URLS[@]}"; do
  for run in $(seq 1 "$RUNS"); do
    state="warm"; [ "$run" -eq 1 ] && state="cold"
    measure "$BASE$path" "$run" "$state"
  done
done
if [ -n "$CHUNK" ]; then
  for run in 1 2; do
    state="warm"; [ "$run" -eq 1 ] && state="cold"
    measure "$BASE$CHUNK" "$run" "$state"
  done
fi

echo ""
echo "Snapshot '$LABEL' -> $OUT"
echo ""
echo "Warm-run medians (TTFB seconds) and cache status:"
awk -F, 'NR>1 && $4=="warm" { t[$2]=t[$2]" "$8; c[$2]=$11 }
  END { for (u in t) { n=split(t[u],a," "); asort_done=0;
    # simple 2-element median: average; 1 element: itself
    if (n==1) m=a[1]; else if (n==2) m=(a[1]+a[2])/2; else { for(i=1;i<n;i++)for(j=i+1;j<=n;j++)if(a[j]<a[i]){x=a[i];a[i]=a[j];a[j]=x}; m=a[int((n+1)/2)] }
    printf "  %-30s ttfb=%.3fs  cf-cache=%s\n", u, m, c[u] } }' "$OUT"
echo ""
echo "Cold first-hits (TTFB seconds):"
awk -F, 'NR>1 && $4=="cold" { printf "  %-30s ttfb=%ss\n", $2, $8 }' "$OUT"
echo ""
echo "Compare two snapshots later with:"
echo "  paste -d'|' <(sort perf-results/<before>.csv) <(sort perf-results/<after>.csv) | column -s'|' -t"

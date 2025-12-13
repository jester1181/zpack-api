#!/bin/bash
set -euo pipefail

API="http://localhost:3000/api/edge"

echo "=== 1) Health check ==="
curl -s "$API/health" | jq .

echo -e "\n=== 2) Publish ==="
curl -s -X POST "$API/publish" \
  -H "Content-Type: application/json" \
  --data-binary '{
    "vmid": 5001,
    "ctype": "game",
    "hostname": "mc-0001.zpack.zerolaghub.com",
    "publicPort": 25565,
    "privateIp": "10.200.0.50",
    "privatePort": 25565
  }' | tee /tmp/publish.json | jq .

echo -e "\n=== 3) Verify OPNsense Relayd rule ==="
curl -sk -u "$OPNSENSE_API_KEY:$OPNSENSE_API_SECRET" \
  "$OPNSENSE_API_URL/relayd/service/search" | jq .

echo -e "\n=== 4) Verify Technitium DNS A record ==="
curl -s "$TECHNITIUM_API_URL/dns/records/search?zone=$DNS_ZONE&type=A&token=$TECHNITIUM_API_TOKEN" | jq .

echo -e "\n=== 5) Verify Technitium DNS SRV record ==="
curl -s "$TECHNITIUM_API_URL/dns/records/search?zone=$DNS_ZONE&type=SRV&token=$TECHNITIUM_API_TOKEN" | jq .

echo -e "\n=== 6) Unpublish ==="
curl -s -X POST "$API/unpublish" \
  -H "Content-Type: application/json" \
  --data-binary '{
    "vmid": 5001,
    "hostname": "mc-0001.zpack.zerolaghub.com",
    "publicPort": 25565
  }' | jq .

echo -e "\n=== 7) Verify cleanup ==="
curl -sk -u "$OPNSENSE_API_KEY:$OPNSENSE_API_SECRET" \
  "$OPNSENSE_API_URL/relayd/service/search" | jq .
curl -s "$TECHNITIUM_API_URL/dns/records/search?zone=$DNS_ZONE&token=$TECHNITIUM_API_TOKEN" | jq .

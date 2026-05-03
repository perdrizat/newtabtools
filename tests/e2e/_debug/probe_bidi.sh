#!/bin/bash
# Probe Firefox ESR's BiDi endpoint
set -e

# Clean slate
pkill -f firefox-esr 2>/dev/null || true
sleep 2

# Launch Firefox ESR in background, redirect all output
firefox-esr -headless --remote-debugging-port 9222 > /tmp/firefox_esr.log 2>&1 &
FOX_PID=$!
echo "Launched Firefox ESR (PID: $FOX_PID)"
sleep 8

echo "=== Firefox log ==="
cat /tmp/firefox_esr.log
echo ""

echo "=== Probing HTTP root ==="
curl -s http://127.0.0.1:9222/ | head -10
echo ""

echo "=== Probing /session ==="
curl -s http://127.0.0.1:9222/session | head -10
echo ""

echo "=== WebSocket upgrade attempt ==="
curl -si -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  http://127.0.0.1:9222/ 2>&1 | head -10
echo ""

# Cleanup
kill $FOX_PID 2>/dev/null || true
echo "Done."
